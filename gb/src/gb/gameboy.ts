// GameBoy - top-level integration of all subsystems.
// Drives the main loop: CPU -> Timer -> PPU -> Serial, until a frame is ready.

import { CPU } from "./cpu";
import { MMU } from "./mmu";
import { PPU } from "./ppu";
import { Timer } from "./timer";
import { Joypad } from "./joypad";
import { Serial } from "./serial";
import { APU } from "./apu";

export interface GameBoyOptions {
  onSerialByte?: (byte: number) => void;
  onFrame?: (framebuffer: Uint8Array) => void;
}

export class GameBoy {
  ppu: PPU;
  timer: Timer;
  joypad: Joypad;
  serial: Serial;
  apu: APU;
  mmu: MMU;
  cpu: CPU;

  private onFrame?: (framebuffer: Uint8Array) => void;
  onSerialByte?: (byte: number) => void;

  // Throttle: run this many M-cycles per "tick" call.
  // One frame = 17556 M-cycles. Caller decides how often to invoke tick().
  private static readonly CYCLES_PER_FRAME = 17556;
  private serialBuffer: string = "";

  constructor(opts: GameBoyOptions = {}) {
    this.onFrame = opts.onFrame;
    this.onSerialByte = opts.onSerialByte;

    // Allocate placeholder MMU first - real wiring happens after construction
    this.mmu = null as unknown as MMU;
    this.cpu = new CPU(this.mmu);
    this.ppu = new PPU((bit) => this.mmu.requestInterrupt(bit));
    this.timer = new Timer(() => this.mmu.requestInterrupt(2));
    this.joypad = new Joypad(() => this.mmu.requestInterrupt(4));
    this.serial = new Serial(() => this.mmu.requestInterrupt(3));
    this.apu = new APU();

    // Now create the real MMU with all peripherals wired
    this.mmu = new MMU(this.cpu, this.ppu, this.timer, this.joypad, this.serial, this.apu);
    this.cpu.mmu = this.mmu;

    // Wire serial byte output
    this.serial.setByteHandler((byte) => {
      this.onSerialByte?.(byte);
      if (byte === 0x0A) {
        // Newline - flush line
        if (this.serialBuffer.trim().length > 0) {
          console.log("[Serial]", this.serialBuffer.trimEnd());
        }
        this.serialBuffer = "";
      } else if (byte >= 0x20 && byte < 0x7F) {
        this.serialBuffer += String.fromCharCode(byte);
      } else if (byte === 0x0D) {
        // CR - ignore
      } else {
        this.serialBuffer += "\\x" + byte.toString(16).padStart(2, "0");
      }
    });
  }

  loadRom(data: Uint8Array) {
    this.mmu.loadRom(data);
    // Use CGB reset if the ROM has the CGB flag, otherwise DMG reset
    if (this.mmu.cgbMode) {
      this.cpu.resetCGB();
    } else {
      this.cpu.reset();
    }
    this.ppu.cgbMode = this.mmu.cgbMode;
    this.ppu.reset();
    this.apu.reset();

    // Clear all RAM so stale data from the previous ROM doesn't bleed through.
    this.ppu.vram.fill(0);
    this.ppu.oam.fill(0);
    this.mmu.wram.fill(0);
    this.mmu.hram.fill(0);
    this.ppu.framebuffer.fill(0xFF);
    this.ppu.bgPalette.fill(0);
    this.ppu.objPalette.fill(0);
    this.ppu.frameReady = false;

    // Reset interrupt flags and IO state to post-boot defaults.
    // The boot ROMs clear IE/IF and initialize the timer before jumping to 0x0100.
    this.mmu.ie = 0x00;
    this.mmu.if_ = 0xE1;  // Top 3 bits always read as 1
    this.timer.div = 0xABCC;  // Post-boot DIV value (DMG)
    this.timer.tima = 0;
    this.timer.tma = 0;
    this.timer.tac = 0xF8;
    // Reset serial
    this.serial.sb = 0x00;
    this.serial.sc = 0x7E;
    // Reset CPU halt/stop state
    this.cpu.halted = false;
    this.cpu.stopped = false;
    this.cpu.ime = false;
    this.cpu.imeScheduled = false;
  }

  // Run a single instruction. Peripherals are ticked mid-instruction for cycle accuracy.
  // Returns total M-cycles consumed.
  step(): number {
    const cycles = this.cpu.step();
    if (cycles > 0) {
      if (this.ppu.frameReady) {
        this.ppu.frameReady = false;
        this.onFrame?.(this.ppu.framebuffer);
      }
    }
    return cycles;
  }

  // Run until a full frame is ready. Returns the framebuffer.
  runFrame(): Uint8Array {
    let frameCycles = 0;
    const limit = this.mmu.doubleSpeed ? (GameBoy.CYCLES_PER_FRAME * 2) : GameBoy.CYCLES_PER_FRAME;
    while (frameCycles < limit * 2) {
      const c = this.cpu.step();
      if (c > 0) {
        frameCycles += c;
      }
      if (this.ppu.frameReady) {
        this.ppu.frameReady = false;
        break;
      }
    }
    // Notify the frame callback (used by the browser UI to paint the canvas)
    this.onFrame?.(this.ppu.framebuffer);
    return this.ppu.framebuffer;
  }

  // Run for N frames. Useful for test runs and headless verification.
  runFrames(n: number) {
    for (let i = 0; i < n; i++) {
      this.runFrame();
    }
  }

  // Keyboard input from the host page
  setKey(key: string, pressed: boolean) {
    this.joypad.setKey(key, pressed);
  }
}
