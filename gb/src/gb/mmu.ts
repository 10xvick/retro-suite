// Memory Management Unit - handles the Game Boy memory map and cartridge banking.
// Memory layout:
//   0x0000-0x3FFF  ROM bank 0 (always visible)
//   0x4000-0x7FFF  ROM bank N (switchable)
//   0x8000-0x9FFF  VRAM (8KB, CGB has banking but DMG does not)
//   0xA000-0xBFFF  External cartridge RAM (switchable)
//   0xC000-0xDFFF  Work RAM (8KB)
//   0xE000-0xFDFF  Echo of work RAM (unused, mirrors 0xC000-0xDDFF)
//   0xFE00-0xFE9F  OAM (Object Attribute Memory - sprite table)
//   0xFEA0-0xFEFF  Not usable
//   0xFF00-0xFF7F  I/O registers
//   0xFF80-0xFFFE  High RAM (HRAM)
//   0xFFFF         Interrupt Enable register

import { PPU } from "./ppu";
import { Timer } from "./timer";
import { Joypad } from "./joypad";
import { Serial } from "./serial";
import { APU } from "./apu";

export interface CPUInterface {
  requestInterrupt(bit: number): void;
  halted: boolean;
  haltBug: boolean;
}

export class MMU {
  rom: Uint8Array;                  // Full ROM image
  romBanks: number;
  eram: Uint8Array;                 // External cartridge RAM
  eramBanks: number;
  wram: Uint8Array = new Uint8Array(0x8000);     // 32KB total (CGB)
  wramBank: number = 1;
  hram: Uint8Array = new Uint8Array(0x7F);

  // I/O devices
  ppu: PPU;
  timer: Timer;
  joypad: Joypad;
  serial: Serial;
  apu: APU;
  cpu: CPUInterface;

  // CGB mode flag (set from ROM header 0x143)
  cgbMode: boolean = false;

  // Double-speed mode (CGB only)
  doubleSpeed: boolean = false;
  // KEY1 register: bit 7 = current speed, bit 0 = prepare speed switch
  key1: number = 0x00;

  // HDMA registers (CGB only)
  hdma1: number = 0;   // 0xFF51 - source high
  hdma2: number = 0;   // 0xFF52 - source low
  hdma3: number = 0;   // 0xFF53 - dest high
  hdma4: number = 0;   // 0xFF54 - dest low
  hdma5: number = 0xFF; // 0xFF55 - length/mode (bit 7 = mode 0=GDMA, 1=HDMA; bits 0-6 = length-1 in 16-byte blocks)
  hdmaActive: boolean = false;

  // Cartridge info
  mbcType: number;                  // 0=ROM-only, 1=MBC1, 2=MBC2, 3=MBC3, 5=MBC5
  hasBattery: boolean;
  hasRam: boolean;
  hasTimer: boolean;

  // Banking state
  romBank: number = 1;
  eramBank: number = 0;
  eramEnabled: boolean = false;
  bankingMode: number = 0;          // 0=ROM, 1=RAM (MBC1 only)

  // Interrupt registers
  ie: number = 0;                   // 0xFFFF: interrupt enable
  if_: number = 0xE1;               // 0xFF0F: interrupt flag (top 3 bits always 1)

  constructor(cpu: CPUInterface, ppu: PPU, timer: Timer, joypad: Joypad, serial: Serial, apu: APU) {
    this.cpu = cpu;
    this.ppu = ppu;
    this.timer = timer;
    this.joypad = joypad;
    this.serial = serial;
    this.apu = apu;

    // Default cartridge is empty - loaded by loadRom()
    this.rom = new Uint8Array(0);
    this.romBanks = 0;
    this.eram = new Uint8Array(0);
    this.eramBanks = 0;
    this.mbcType = 0;
    this.hasBattery = false;
    this.hasRam = false;
    this.hasTimer = false;
  }

  loadRom(data: Uint8Array) {
    this.rom = data;
    this.romBanks = data.length / 0x4000;

    // Parse header
    const cartType = data[0x147];
    const ramSizeFlag = data[0x149];
    const cgbFlag = data[0x143];

    // CGB mode: 0x80 = CGB-compatible (works on DMG too), 0xC0 = CGB-only
    this.cgbMode = (cgbFlag === 0x80 || cgbFlag === 0xC0);
    this.ppu.cgbMode = this.cgbMode;

    // Decode MBC type
    switch (cartType) {
      case 0x00: this.mbcType = 0; break;                       // ROM only
      case 0x01: case 0x02: case 0x03: this.mbcType = 1; break; // MBC1
      case 0x05: case 0x06: this.mbcType = 2; break;            // MBC2
      case 0x0F: case 0x10: case 0x11: case 0x12: case 0x13:
        this.mbcType = 3; break;                                // MBC3
      case 0x19: case 0x1A: case 0x1B: case 0x1C: case 0x1D: case 0x1E:
        this.mbcType = 5; break;                                // MBC5
      default: this.mbcType = 1; break;                         // Default to MBC1
    }

    this.hasBattery = [0x03, 0x06, 0x0D, 0x0F, 0x10, 0x13, 0x1B, 0x1E].includes(cartType);
    this.hasTimer = [0x0F, 0x10].includes(cartType);

    // External RAM sizing
    if (this.mbcType === 2) {
      this.eram = new Uint8Array(512);
      this.eramBanks = 1;
      this.hasRam = true;
    } else {
      const ramSizes: Record<number, number> = { 0: 0, 1: 0x800, 2: 0x2000, 3: 0x8000, 4: 0x20000, 5: 0x10000 };
      const size = ramSizes[ramSizeFlag] || 0;
      this.eram = new Uint8Array(size);
      this.eramBanks = size > 0 ? size / 0x2000 : 0;
      this.hasRam = size > 0;
    }

    // Reset banking state
    this.romBank = 1;
    this.eramBank = 0;
    this.eramEnabled = false;
    this.wramBank = 1;
    this.doubleSpeed = false;
    this.key1 = 0x00;
    this.hdma5 = 0xFF;
    this.hdmaActive = false;
    this.bankingMode = 0;
  }

  read(addr: number): number {
    // ROM bank 0
    if (addr < 0x4000) {
      // MBC1 advanced banking mode can remap bank 0
      if (this.mbcType === 1 && this.bankingMode === 1 && this.romBanks > 32) {
        // The 2 high bits (from register $4000) affect bank 0 in RAM banking mode
        const bank = ((this.romBank >> 5) & 0x03) << 5;
        return this.rom[bank * 0x4000 + addr];
      }
      return this.rom[addr];
    }
    // ROM bank N
    if (addr < 0x8000) {
      const bank = this.romBank % this.romBanks;
      return this.rom[bank * 0x4000 + (addr - 0x4000)];
    }
    // VRAM
    if (addr < 0xA000) {
      return this.ppu.readVram(addr - 0x8000);
    }
    // External RAM
    if (addr < 0xC000) {
      if (!this.eramEnabled || !this.hasRam) return 0xFF;
      if (this.mbcType === 2) {
        // MBC2: only 512x4 bits, addresses 0xA000-0xA1FF, lower nibble only
        return this.eram[(addr - 0xA000) & 0x1FF] | 0xF0;
      }
      const bank = this.eramBank % Math.max(1, this.eramBanks);
      return this.eram[bank * 0x2000 + (addr - 0xA000)];
    }
    // Work RAM: 0xC000-0xCFFF is always bank 0, 0xD000-0xDFFF is bank N (CGB)
    if (addr < 0xE000) {
      if (addr < 0xD000) {
        return this.wram[addr - 0xC000];                    // Bank 0
      }
      const bank = this.cgbMode ? (this.wramBank & 0x07) : 1;
      return this.wram[bank * 0x1000 + (addr - 0xD000)];   // Banked region
    }
    // Echo RAM (mirrors 0xC000-0xDDFF, i.e., 0xC000-0xDE00 maps to 0xE000-0xFE00)
    if (addr < 0xFE00) {
      const echoAddr = addr - 0xE000;
      if (echoAddr < 0x1000) {
        return this.wram[echoAddr];                          // Echo of bank 0
      }
      if (echoAddr < 0x2000) {
        const bank = this.cgbMode ? (this.wramBank & 0x07) : 1;
        return this.wram[bank * 0x1000 + (echoAddr - 0x1000)]; // Echo of banked region
      }
      return 0xFF;
    }
    // OAM
    if (addr < 0xFEA0) {
      return this.ppu.readOam(addr - 0xFE00);
    }
    // Unusable region
    if (addr < 0xFF00) {
      return 0xFF;
    }
    // I/O registers
    if (addr < 0xFF80) {
      return this.readIO(addr);
    }
    // HRAM
    if (addr < 0xFFFF) {
      return this.hram[addr - 0xFF80];
    }
    // 0xFFFF - IE
    return this.ie;
  }

  write(addr: number, value: number) {
    value &= 0xFF;

    if (addr < 0x8000) {
      // ROM bank control
      this.writeBankRegister(addr, value);
      return;
    }
    if (addr < 0xA000) {
      this.ppu.writeVram(addr - 0x8000, value);
      return;
    }
    if (addr < 0xC000) {
      if (!this.eramEnabled || !this.hasRam) return;
      if (this.mbcType === 2) {
        // MBC2: only lower nibble is stored
        this.eram[(addr - 0xA000) & 0x1FF] = value & 0x0F;
        return;
      }
      const bank = this.eramBank % Math.max(1, this.eramBanks);
      this.eram[bank * 0x2000 + (addr - 0xA000)] = value;
      return;
    }
    // Work RAM with CGB banking
    if (addr < 0xE000) {
      if (addr < 0xD000) {
        this.wram[addr - 0xC000] = value;                    // Bank 0
      } else {
        const bank = this.cgbMode ? (this.wramBank & 0x07) : 1;
        this.wram[bank * 0x1000 + (addr - 0xD000)] = value; // Banked region
      }
      return;
    }
    // Echo RAM
    if (addr < 0xFE00) {
      const echoAddr = addr - 0xE000;
      if (echoAddr < 0x1000) {
        this.wram[echoAddr] = value;
      } else if (echoAddr < 0x2000) {
        const bank = this.cgbMode ? (this.wramBank & 0x07) : 1;
        this.wram[bank * 0x1000 + (echoAddr - 0x1000)] = value;
      }
      return;
    }
    if (addr < 0xFEA0) {
      this.ppu.writeOam(addr - 0xFE00, value);
      return;
    }
    if (addr < 0xFF00) {
      return;
    }
    if (addr < 0xFF80) {
      this.writeIO(addr, value);
      return;
    }
    if (addr < 0xFFFF) {
      this.hram[addr - 0xFF80] = value;
      return;
    }
    this.ie = value;
  }

  // --- Bank register writes for MBC1/MBC2/MBC3/MBC5 ---
  private writeBankRegister(addr: number, value: number) {
    switch (this.mbcType) {
      case 0: break; // ROM only - ignore writes
      case 1: // MBC1
        if (addr < 0x2000) {
          // RAM enable (8-bit): 0x00=disable, 0x0A=enable
          this.eramEnabled = (value & 0x0F) === 0x0A;
        } else if (addr < 0x4000) {
          // ROM bank number lower 5 bits
          let bank = value & 0x1F;
          if (bank === 0) bank = 1;
          // Preserve upper bits (set via 0x4000-0x5FFF)
          this.romBank = (this.romBank & 0x60) | bank;
        } else if (addr < 0x6000) {
          // Upper 2 bits (RAM bank or upper ROM bank bits depending on mode)
          if (this.romBanks > 32 || this.eramBanks > 1) {
            this.romBank = (this.romBank & 0x1F) | ((value & 0x03) << 5);
            this.eramBank = value & 0x03;
          }
        } else {
          // Banking mode select
          this.bankingMode = value & 0x01;
          if (this.bankingMode === 0) {
            // Simple ROM mode: eram bank forced to 0
            // (romBank upper bits still apply, but bank 0 is the visible 0x0000-0x3FFF)
          }
        }
        break;
      case 2: // MBC2
        if (addr < 0x2000) {
          // RAM enable: only when bit 8 of address is 0
          if ((addr & 0x0100) === 0) {
            this.eramEnabled = (value & 0x0F) === 0x0A;
          }
        } else if (addr < 0x4000) {
          if ((addr & 0x0100) !== 0) {
            let bank = value & 0x0F;
            if (bank === 0) bank = 1;
            this.romBank = bank;
          }
        }
        break;
      case 3: // MBC3
        if (addr < 0x2000) {
          this.eramEnabled = (value & 0x0F) === 0x0A;
        } else if (addr < 0x4000) {
          let bank = value & 0x7F;
          if (bank === 0) bank = 1;
          this.romBank = bank;
        } else if (addr < 0x6000) {
          this.eramBank = value & 0x03;
        } else {
          // RTC latch (ignored - we don't emulate RTC)
        }
        break;
      case 5: // MBC5
        if (addr < 0x2000) {
          this.eramEnabled = (value & 0x0F) === 0x0A;
        } else if (addr < 0x3000) {
          this.romBank = (this.romBank & 0x100) | value;
        } else if (addr < 0x4000) {
          this.romBank = (this.romBank & 0xFF) | ((value & 0x01) << 8);
        } else if (addr < 0x6000) {
          this.eramBank = value & 0x0F;
        }
        break;
    }
  }

  private readIO(addr: number): number {
    switch (addr) {
      case 0xFF00: return this.joypad.read();
      case 0xFF01: return this.serial.sb;
      case 0xFF02: return this.serial.sc | 0x7E;
      case 0xFF04: return this.timer.div >> 8;
      case 0xFF05: return this.timer.tima;
      case 0xFF06: return this.timer.tma;
      case 0xFF07: return this.timer.tac | 0xF8;
      case 0xFF0F: return this.if_ | 0xE0;
      case 0xFF10: case 0xFF11: case 0xFF12: case 0xFF13: case 0xFF14:
      case 0xFF16: case 0xFF17: case 0xFF18: case 0xFF19:
      case 0xFF1A: case 0xFF1B: case 0xFF1C: case 0xFF1D: case 0xFF1E:
      case 0xFF20: case 0xFF21: case 0xFF22: case 0xFF23:
      case 0xFF24: case 0xFF25: case 0xFF26:
        return this.apu.read(addr);
      case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33:
      case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
      case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B:
      case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
        return this.apu.read(addr);
      case 0xFF40: return this.ppu.lcdc;
      case 0xFF41: return this.ppu.stat | 0x80;
      case 0xFF42: return this.ppu.scy;
      case 0xFF43: return this.ppu.scx;
      case 0xFF44: return this.ppu.ly;
      case 0xFF45: return this.ppu.lyc;
      case 0xFF46: return 0x00; // DMA - write only
      case 0xFF47: return this.ppu.bgp;
      case 0xFF48: return this.ppu.obp0;
      case 0xFF49: return this.ppu.obp1;
      case 0xFF4A: return this.ppu.wy;
      case 0xFF4B: return this.ppu.wx;
      // CGB registers
      case 0xFF4D: return this.key1 | 0x7E;                         // KEY1 - speed switch
      case 0xFF4F: return (this.ppu.vramBank & 0x01) | 0xFE;        // VRAM bank
      case 0xFF51: case 0xFF52: case 0xFF53: case 0xFF54: return 0xFF; // HDMA src/dst - write only
      case 0xFF55: return this.hdma5;                                // HDMA length/mode
      case 0xFF56: return 0xFF;                                      // RP - infrared (unused)
      case 0xFF68: return this.ppu.readBgpi();                       // BG palette index
      case 0xFF69: return this.ppu.readBgpd();                       // BG palette data
      case 0xFF6A: return this.ppu.readObpi();                       // OBJ palette index
      case 0xFF6B: return this.ppu.readObpd();                       // OBJ palette data
      case 0xFF6C: return this.ppu.opri | 0xFE;                      // OBJ priority mode
      case 0xFF70: return (this.wramBank & 0x07) | 0xF8;             // WRAM bank
      default:
        // Unused IO registers return 0xFF
        return 0xFF;
    }
  }

  private writeIO(addr: number, value: number) {
    switch (addr) {
      case 0xFF00: this.joypad.write(value); break;
      case 0xFF01: this.serial.sb = value; break;
      case 0xFF02:
        this.serial.sc = value & 0x83;
        if (value & 0x80) this.serial.startTransfer();
        break;
      case 0xFF04: this.timer.div = 0; break;   // Writing DIV resets it
      case 0xFF05: this.timer.tima = value; break;
      case 0xFF06: this.timer.tma = value; break;
      case 0xFF07: this.timer.tac = value & 0x07; break;
      case 0xFF0F: this.if_ = value & 0x1F; break;
      // Sound registers - route to APU
      case 0xFF10: case 0xFF11: case 0xFF12: case 0xFF13: case 0xFF14:
      case 0xFF16: case 0xFF17: case 0xFF18: case 0xFF19:
      case 0xFF1A: case 0xFF1B: case 0xFF1C: case 0xFF1D: case 0xFF1E:
      case 0xFF20: case 0xFF21: case 0xFF22: case 0xFF23:
      case 0xFF24: case 0xFF25: case 0xFF26:
        this.apu.write(addr, value);
        break;
      case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33:
      case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
      case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B:
      case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
        this.apu.write(addr, value);
        break;
      case 0xFF40: this.ppu.lcdc = value; break;
      case 0xFF41: this.ppu.setStat(value); break;
      case 0xFF42: this.ppu.scy = value; break;
      case 0xFF43: this.ppu.scx = value; break;
      case 0xFF44: this.ppu.ly = 0; break;      // LY write resets to 0 (DMG only)
      case 0xFF45: this.ppu.lyc = value; break;
      case 0xFF46: this.dmaTransfer(value); break;
      case 0xFF47: this.ppu.bgp = value; break;
      case 0xFF48: this.ppu.obp0 = value; break;
      case 0xFF49: this.ppu.obp1 = value; break;
      case 0xFF4A: this.ppu.wy = value; break;
      case 0xFF4B: this.ppu.wx = value; break;
      // CGB registers
      case 0xFF4D:  // KEY1 - prepare speed switch
        this.key1 = (this.key1 & 0x80) | (value & 0x01);
        // If bit 0 set and STOP is executed, switch speed. We handle STOP specially.
        break;
      case 0xFF4F:  // VRAM bank
        this.ppu.vramBank = value & 0x01;
        break;
      case 0xFF51: this.hdma1 = value; break;     // HDMA source high
      case 0xFF52: this.hdma2 = value; break;     // HDMA source low
      case 0xFF53: this.hdma3 = value; break;     // HDMA dest high
      case 0xFF54: this.hdma4 = value; break;     // HDMA dest low
      case 0xFF55: this.startHdma(value); break;  // HDMA length/start
      case 0xFF68: this.ppu.writeBgpi(value); break;
      case 0xFF69: this.ppu.writeBgpd(value); break;
      case 0xFF6A: this.ppu.writeObpi(value); break;
      case 0xFF6B: this.ppu.writeObpd(value); break;
      case 0xFF6C: this.ppu.opri = value & 0x01; break;
      case 0xFF70:  // WRAM bank
        this.wramBank = (value & 0x07) === 0 ? 1 : (value & 0x07);
        break;
      default:
        // Ignore writes to unused IO
        break;
    }
  }

  // HDMA/GDMA transfer (CGB only)
  // Source: 0xFF51-0xFF52 (16-bit, bits 4-15 used, lower 4 bits forced 0)
  // Dest:   0xFF53-0xFF54 (16-bit, bits 4-12 used, lower 4 bits forced 0, 0x8000-0x9FFF only)
  // Length: 0xFF55 bits 0-6 = (length-1) in 16-byte blocks; bit 7 = mode (0=GDMA, 1=HDMA)
  private startHdma(value: number) {
    // If HDMA is active, writing a value with bit 7 = 0 stops the transfer
    if (this.hdmaActive) {
      if ((value & 0x80) === 0) {
        this.hdmaActive = false;
        this.hdma5 |= 0x80; // set bit 7 to 1 (meaning disabled/inactive)
      } else {
        // Restart/reconfigure with new length
        this.hdma5 = value & 0x7F;
        this.hdmaActive = true;
      }
      return;
    }

    const mode = (value & 0x80) !== 0;
    const blocks = (value & 0x7F) + 1;  // 1-128 blocks of 16 bytes = 16-2048 bytes

    if (mode) {
      // HDMA: transfer one block per HBlank
      this.hdmaActive = true;
      this.hdma5 = value & 0x7F; // bit 7 = 0 (active), bits 0-6 = blocks-1
      if (this.ppu.mode === 0) {
        this.onHBlank();
      }
    } else {
      // GDMA: transfer all blocks immediately
      let src = ((this.hdma1 << 8) | this.hdma2) & 0xFFF0;
      let dst = ((this.hdma3 << 8) | this.hdma4) & 0x1FF0;
      dst |= 0x8000;  // VRAM region

      for (let i = 0; i < blocks * 16; i++) {
        const byte = this.read(src + i);
        this.ppu.writeVram(dst + i - 0x8000, byte);
      }

      // After transfer: HDMA5 = 0xFF (complete), src/dst advanced
      const bytesTransferred = blocks * 16;
      src = (src + bytesTransferred) & 0xFFFF;
      dst = (dst + bytesTransferred) & 0xFFFF;

      this.hdma1 = (src >> 8) & 0xFF;
      this.hdma2 = src & 0xF0;
      this.hdma3 = ((dst & 0x1FFF) >> 8) & 0xFF;
      this.hdma4 = dst & 0xF0;
      this.hdma5 = 0xFF;
      this.hdmaActive = false;
    }
  }

  // Triggered at the transition to H-Blank (Mode 0)
  onHBlank() {
    if (!this.hdmaActive) return;

    let src = ((this.hdma1 << 8) | this.hdma2) & 0xFFF0;
    let dst = ((this.hdma3 << 8) | this.hdma4) & 0x1FF0;
    dst |= 0x8000;  // VRAM region

    // Transfer one block (16 bytes)
    for (let i = 0; i < 16; i++) {
      const byte = this.read(src + i);
      this.ppu.writeVram(dst + i - 0x8000, byte);
    }

    // Advance src/dst by 16 bytes
    src = (src + 16) & 0xFFFF;
    dst = (dst + 16) & 0xFFFF;

    this.hdma1 = (src >> 8) & 0xFF;
    this.hdma2 = src & 0xF0;
    this.hdma3 = ((dst & 0x1FFF) >> 8) & 0xFF;
    this.hdma4 = dst & 0xF0;

    // Decrement remaining blocks count
    let blocksLeft = this.hdma5 & 0x7F;
    if (blocksLeft === 0) {
      // Completed!
      this.hdma5 = 0xFF;
      this.hdmaActive = false;
    } else {
      blocksLeft--;
      this.hdma5 = blocksLeft; // Keep bit 7 as 0 (active)
    }
  }

  // OAM DMA transfer: copy 160 bytes from source to OAM
  private dmaTransfer(source: number) {
    const src = source << 8;
    for (let i = 0; i < 0xA0; i++) {
      this.ppu.writeOam(i, this.read(src + i));
    }
  }

  tick(cycles: number) {
    this.timer.tick(cycles);
    const oldMode = this.ppu.mode;
    this.ppu.tick(cycles);
    const newMode = this.ppu.mode;
    if (oldMode !== 0 && newMode === 0) {
      this.onHBlank();
    }
    this.serial.tick(cycles);
    this.apu.tick(cycles);
  }

  requestInterrupt(bit: number) {
    this.if_ |= (1 << bit);
    this.cpu.requestInterrupt(bit);
  }
}
