import { ApuPortBridge, AudioEngine } from './audio';
import { Bus, CPU, Cartridge, createDemoROM, Disassembler } from './core';
import { PPU } from './graphics';

export interface RomDetails {
  title: string;
  mapper: string;
  version: string;
  checksum: string;
  sizeKb: number;
}

export const DEMO_ROM_DISPLAY_NAME = 'Demo Controller ROM';
export const DEFAULT_DEMO_ROM_DETAILS: RomDetails = {
  title: 'ANTIGRAVITY DEMO SNES',
  mapper: 'LoROM',
  version: '1.0',
  checksum: '0xAAAA',
  sizeKb: 32,
};

export interface CpuSnapshot {
  a: number;
  x: number;
  y: number;
  s: number;
  d: number;
  db: number;
  pb: number;
  pc: number;
  p: number;
  e: number;
}

export interface DisassemblyRow {
  address: number;
  disassembly: string;
  isCurrent: boolean;
}

export interface OamRow {
  id: number;
  x: number;
  y: number;
  tile: number;
  attr: number;
}

export interface DebugSnapshot {
  cpu: CpuSnapshot;
  isScreenBlank: boolean;
  bgMode: number;
  screenDisplay: number;
  disassembly: DisassemblyRow[];
  oam: OamRow[];
  cgram: number[];
  hexData: number[];
}

export interface RuntimeStatus {
  pc: number;
  nmiEnabled: boolean;
  screenDisplay: number;
  brightness: number;
}

export interface LegacyDebugState {
  cpu: {
    pc: string;
    lastInstructionAddress: string;
    cycles: number;
    p: string;
    s: string;
    a: string;
    x: string;
    y: string;
  };
  ppu: {
    currentScanline: number;
    bgMode: number;
  };
  bus: {
    nmiActive: boolean;
    nmiEnabled: boolean;
    irqActive: boolean;
  };
}

export interface PpuDebugState {
  bgMode: number;
  screenDisplay: number;
  mainScreenDesignation: number;
  subScreenDesignation: number;
  bgTilemaps: number[];
  bgCharAddress: number[];
}

export interface AudioDebugState {
  enabled: boolean;
  volume: number;
  queueChunks: number;
  queueSamples: number;
  rmsL: number;
  rmsR: number;
  zeroCrossRate: number;
  clipRatio: number;
}

export interface ApuDebugState {
  sampleRate: number;
  spc700Pc: number;
  spc700A: number;
  spc700X: number;
  spc700Y: number;
  spc700Sp: number;
  spc700Psw: number;
}

export class SnesEmulator {
  private readonly ppu: PPU;
  private readonly bus: Bus;
  private readonly cpu: CPU;
  private readonly apuBridge: ApuPortBridge;
  private readonly audio: AudioEngine;
  private romKind: 'demo' | 'custom' = 'custom';

  constructor() {
    this.ppu = new PPU();
    this.apuBridge = new ApuPortBridge();
    this.bus = new Bus(this.ppu, this.apuBridge);
    this.cpu = new CPU(this.bus);
    this.audio = new AudioEngine(this.apuBridge);
  }

  public reset(): void {
    this.bus.reset();
    this.cpu.reset();
    this.ppu.reset();
    this.audio.reset();
  }

  public loadDemoRom(): RomDetails {
    const demoRomBytes = createDemoROM();
    const rom = this.loadRomBytes(demoRomBytes);
    this.romKind = 'demo';
    return rom;
  }

  public loadRomBytes(bytes: Uint8Array): RomDetails {
    const cartridge = new Cartridge(bytes);
    this.bus.loadCartridge(cartridge);
    this.cpu.reset();
    this.ppu.reset();
    this.romKind = 'custom';

    return {
      title: cartridge.header.title,
      mapper: cartridge.header.isLoROM ? 'LoROM' : 'HiROM',
      version: `1.${cartridge.header.version}`,
      checksum: `0x${cartridge.header.checksum.toString(16).toUpperCase()}`,
      sizeKb: Math.round(bytes.length / 1024),
    };
  }

  public runFrame(controller1State: number, speedMultiplier: number): { pixels: Uint32Array; frameStartBlank: boolean } {
    this.bus.controller1State = controller1State;

    const targetCycles = 59666 * speedMultiplier;
    this.cpu.cycles = 0;

    const pixels = new Uint32Array(this.ppu.width * this.ppu.height);

    this.bus.initHdma();
    this.ppu.startFrame();

    const frameStartBlank = (this.ppu.screenDisplay & 0x80) !== 0;

    for (let sy = 0; sy < 262; sy++) {
      this.ppu.currentScanline = sy;
      const scanlineStartCycles = Math.floor((sy * targetCycles) / 262);
      const scanlineTargetCycles = Math.floor(((sy + 1) * targetCycles) / 262);

      let hasIrqOnThisScanline = false;
      let irqCycle = scanlineStartCycles;

      if (this.bus.virqEnabled && this.bus.hirqEnabled) {
        if (sy === this.bus.vtime) {
          hasIrqOnThisScanline = true;
          const htimeCycle = Math.floor((this.bus.htime / 340) * 228);
          irqCycle = scanlineStartCycles + htimeCycle;
        }
      } else if (this.bus.virqEnabled) {
        if (sy === this.bus.vtime) {
          hasIrqOnThisScanline = true;
          irqCycle = scanlineStartCycles;
        }
      } else if (this.bus.hirqEnabled) {
        hasIrqOnThisScanline = true;
        const htimeCycle = Math.floor((this.bus.htime / 340) * 228);
        irqCycle = scanlineStartCycles + htimeCycle;
      }

      if (sy === 224) {
        this.bus.nmiActive = true;
        this.cpu.nmiPending = true;
      }

      if (hasIrqOnThisScanline) {
        while (this.cpu.cycles < irqCycle && this.cpu.cycles < scanlineTargetCycles) {
          this.cpu.step();
        }

        if (this.cpu.cycles >= irqCycle) {
          this.bus.irqActive = true;
          if ((this.cpu.p & 0x04) === 0) {
            this.cpu.triggerIrq();
          }
        }
      }

      while (this.cpu.cycles < scanlineTargetCycles) {
        this.cpu.step();
      }

      if (sy < 224) {
        this.ppu.renderScanline(sy, pixels);
        this.bus.executeHdmaScanline(sy);
      }
    }

    this.ppu.fieldToggle = !this.ppu.fieldToggle;
    this.audio.updateFrame({ cpuCycles: this.cpu.totalCycles });
    return { pixels, frameStartBlank };
  }

  public async enableAudio(): Promise<void> {
    await this.audio.enable();
  }

  public disableAudio(): void {
    this.audio.disable();
  }

  public isAudioEnabled(): boolean {
    return this.audio.isEnabled();
  }

  public setAudioVolume(volume: number): void {
    this.audio.setVolume(volume);
  }

  public setAudioTempo(tempo: number): void {
    this.audio.setTempo(tempo);
  }

  public getAudioVolume(): number {
    return this.audio.getVolume();
  }

  public getAudioDebugState(): AudioDebugState {
    return this.audio.getDebugState();
  }

  public getApuDebugState(): ApuDebugState {
    return this.audio.getApuDebugState();
  }

  public stepInstructionAndRenderFrame(): Uint32Array {
    this.cpu.step();
    return this.renderFrame();
  }

  public renderFrame(): Uint32Array {
    const pixels = new Uint32Array(this.ppu.width * this.ppu.height);
    this.ppu.renderFrame(pixels);
    return pixels;
  }

  public createDebugSnapshot(hexOffset: number): DebugSnapshot {
    const cpu = this.cpu;
    const ppu = this.ppu;
    const bus = this.bus;

    const disassembly: DisassemblyRow[] = [];
    let tempPc = cpu.pc;
    for (let i = 0; i < 8; i++) {
      const res = Disassembler.disassemble(bus, cpu.pb, tempPc, cpu.isAcc8(), cpu.isIndex8());
      disassembly.push({
        address: tempPc,
        disassembly: res.disassembly,
        isCurrent: i === 0,
      });
      tempPc = (tempPc + res.bytesUsed) & 0xFFFF;
    }

    const oam: OamRow[] = [];
    for (let i = 0; i < 32; i++) {
      const offset = i * 4;
      const xLow = ppu.oam[offset];
      const y = ppu.oam[offset + 1];
      const tile = ppu.oam[offset + 2];
      const attr = ppu.oam[offset + 3];
      const highByteIdx = Math.floor(i / 4);
      const highBitShift = (i % 4) * 2;
      const highVal = ppu.oam[512 + highByteIdx];
      const xHigh = (highVal >> highBitShift) & 1;
      let x = xLow | (xHigh << 8);
      if (x >= 256) x -= 512;
      oam.push({ id: i, x, y, tile, attr });
    }

    const cgram: number[] = [];
    for (let i = 0; i < 256; i++) cgram.push(ppu.cgram[i]);

    const hexData: number[] = [];
    for (let i = 0; i < 128; i++) {
      hexData.push(bus.wram[(hexOffset + i) % bus.wram.length]);
    }

    return {
      cpu: {
        a: cpu.a,
        x: cpu.x,
        y: cpu.y,
        s: cpu.s,
        d: cpu.d,
        db: cpu.db,
        pb: cpu.pb,
        pc: cpu.lastInstructionAddress,
        p: cpu.p,
        e: cpu.e,
      },
      isScreenBlank: (ppu.screenDisplay & 0x80) !== 0,
      bgMode: ppu.bgMode,
      screenDisplay: ppu.screenDisplay,
      disassembly,
      oam,
      cgram,
      hexData,
    };
  }

  public renderVramPage(page: number): Uint32Array {
    const pixels = new Uint32Array(128 * 128);
    pixels.fill(0xFF000000);

    const paletteBase = page >= 4 ? 128 : 0;
    const charBase = page * 0x1000;
    const wordsPerTile = 16;

    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 16; tx++) {
        const localTileIdx = (ty * 16) + tx;
        const tileStartAddr = charBase + (localTileIdx * wordsPerTile);

        for (let py = 0; py < 8; py++) {
          const wordLow = this.ppu.vram[(tileStartAddr + py) & 0x7FFF];
          const wordHigh = this.ppu.vram[(tileStartAddr + 8 + py) & 0x7FFF];

          for (let px = 0; px < 8; px++) {
            const shift = 7 - px;
            const bit0 = (wordLow >> shift) & 1;
            const bit1 = (wordLow >> (8 + shift)) & 1;
            const bit2 = (wordHigh >> shift) & 1;
            const bit3 = (wordHigh >> (8 + shift)) & 1;
            const colorIdx = bit0 | (bit1 << 1) | (bit2 << 2) | (bit3 << 3);

            if (colorIdx !== 0) {
              const color = this.ppu.cgram[(paletteBase + colorIdx) & 0xFF];
              const r = (color & 0x1F) << 3;
              const g = ((color >> 5) & 0x1F) << 3;
              const b = ((color >> 10) & 0x1F) << 3;
              const canvasX = (tx * 8) + px;
              const canvasY = (ty * 8) + py;
              pixels[(canvasY * 128) + canvasX] = 0xFF000000 | (b << 16) | (g << 8) | r;
            }
          }
        }
      }
    }

    return pixels;
  }

  public createSaveState(romName: string): any {
    return {
      cpu: {
        a: this.cpu.a,
        x: this.cpu.x,
        y: this.cpu.y,
        s: this.cpu.s,
        d: this.cpu.d,
        db: this.cpu.db,
        pb: this.cpu.pb,
        p: this.cpu.p,
        pc: this.cpu.pc,
        e: this.cpu.e,
        waiting: this.cpu.waiting,
        nmiPending: this.cpu.nmiPending,
        cycles: this.cpu.cycles,
        totalCycles: this.cpu.totalCycles
      },
      ppu: {
        vram: Array.from(this.ppu.vram),
        cgram: Array.from(this.ppu.cgram),
        oam: Array.from(this.ppu.oam),
        bgMode: this.ppu.bgMode,
        bgSizes: this.ppu.bgSizes,
        bgTilemaps: this.ppu.bgTilemaps,
        bgTilemapSizes: this.ppu.bgTilemapSizes,
        bgCharAddress: this.ppu.bgCharAddress,
        bgScrollH: this.ppu.bgScrollH,
        bgScrollV: this.ppu.bgScrollV,
        screenDisplay: this.ppu.screenDisplay,
        spriteSize: (this.ppu as any).spriteSize,
        oamAddr: (this.ppu as any).oamAddr,
        oamBaseAddr: (this.ppu as any).oamBaseAddr,
        oamLatch: (this.ppu as any).oamLatch,
        oamWriteToggle: (this.ppu as any).oamWriteToggle,
        oamPriorityRotation: (this.ppu as any).oamPriorityRotation,
        mainScreenDesignation: this.ppu.mainScreenDesignation,
        subScreenDesignation: this.ppu.subScreenDesignation,
        bg3Priority: this.ppu.bg3Priority,
        scrollLatches: Array.from((this.ppu as any).scrollLatches),
        scrollToggles: Array.from((this.ppu as any).scrollToggles),
        vramIncrementMode: (this.ppu as any).vramIncrementMode,
        vramIncrementVal: (this.ppu as any).vramIncrementVal,
        vramAddressTranslation: (this.ppu as any).vramAddressTranslation,
        vramAddress: (this.ppu as any).vramAddress,
        cgramAddress: (this.ppu as any).cgramAddress,
        cgramLatch: (this.ppu as any).cgramLatch,
        cgramToggle: (this.ppu as any).cgramToggle,
        mosaicReg: (this.ppu as any).mosaicReg,
        w12sel: (this.ppu as any).w12sel,
        w34sel: (this.ppu as any).w34sel,
        wobjsel: (this.ppu as any).wobjsel,
        wbglog: (this.ppu as any).wbglog,
        wobjlog: (this.ppu as any).wobjlog,
        mainScreenWindowEnable: (this.ppu as any).mainScreenWindowEnable,
        subScreenWindowEnable: (this.ppu as any).subScreenWindowEnable,
        win1Left: (this.ppu as any).win1Left,
        win1Right: (this.ppu as any).win1Right,
        win2Left: (this.ppu as any).win2Left,
        win2Right: (this.ppu as any).win2Right,
        cgwsel: (this.ppu as any).cgwsel,
        cgadsub: (this.ppu as any).cgadsub,
        fixedColorR: (this.ppu as any).fixedColorR,
        fixedColorG: (this.ppu as any).fixedColorG,
        fixedColorB: (this.ppu as any).fixedColorB,
        setiniReg: (this.ppu as any).setiniReg,
        m7sel: (this.ppu as any).m7sel,
        m7a: (this.ppu as any).m7a,
        m7b: (this.ppu as any).m7b,
        m7c: (this.ppu as any).m7c,
        m7d: (this.ppu as any).m7d,
        m7x: (this.ppu as any).m7x,
        m7y: (this.ppu as any).m7y,
        m7Latches: { ...((this.ppu as any).m7Latches) },
        m7Toggles: { ...((this.ppu as any).m7Toggles) },
        registerCache: Array.from((this.ppu as any).registerCache),
        hCounterLatched: (this.ppu as any).hCounterLatched,
        vCounterLatched: (this.ppu as any).vCounterLatched,
        hvCounterLatchState: (this.ppu as any).hvCounterLatchState,
        hCounterLatchToggle: (this.ppu as any).hCounterLatchToggle,
        vCounterLatchToggle: (this.ppu as any).vCounterLatchToggle,
        currentScanline: this.ppu.currentScanline,
        fieldToggle: this.ppu.fieldToggle,
      },
      bus: {
        controllerStrobe: (this.bus as any).controllerStrobe,
        controller1Shift: (this.bus as any).controller1Shift,
        dmaRegisters: Array.from((this.bus as any).dmaRegisters),
        vblankToggle: (this.bus as any).vblankToggle,
        nmiEnabled: this.bus.nmiEnabled,
        nmiActive: this.bus.nmiActive,
        virqEnabled: this.bus.virqEnabled,
        hirqEnabled: this.bus.hirqEnabled,
        htime: this.bus.htime,
        vtime: this.bus.vtime,
        irqActive: this.bus.irqActive,
        hdmaEnable: (this.bus as any).hdmaEnable,
        hdmaTablePtr: Array.from(this.bus.hdmaTablePtr),
        hdmaBank: Array.from(this.bus.hdmaBank),
        hdmaActive: Array.from(this.bus.hdmaActive),
        hdmaLineCounter: Array.from(this.bus.hdmaLineCounter),
        hdmaRepeat: Array.from(this.bus.hdmaRepeat),
        hdmaDoTransfer: Array.from(this.bus.hdmaDoTransfer),
        hdmaIndirectPtr: Array.from(this.bus.hdmaIndirectPtr),
        hdmaIndirectBank: Array.from(this.bus.hdmaIndirectBank),
        wramAddressRegister: (this.bus as any).wramAddressRegister,
        cpuMultiplicand: (this.bus as any).cpuMultiplicand,
        cpuMultiplier: (this.bus as any).cpuMultiplier,
        cpuDividend: (this.bus as any).cpuDividend,
        cpuDivisor: (this.bus as any).cpuDivisor,
        cpuQuotient: (this.bus as any).cpuQuotient,
        cpuResult: (this.bus as any).cpuResult
      },
      wram: Array.from(this.bus.wram),
      sram: this.bus.cartridge ? Array.from(this.bus.cartridge.sram) : [],
      timestamp: new Date().toLocaleTimeString(),
      romKind: this.romKind,
      romName,
    };
  }

  public loadSaveState(state: any): void {
    this.cpu.a = state.cpu.a;
    this.cpu.x = state.cpu.x;
    this.cpu.y = state.cpu.y;
    this.cpu.s = state.cpu.s;
    this.cpu.d = state.cpu.d;
    this.cpu.db = state.cpu.db;
    this.cpu.pb = state.cpu.pb;
    this.cpu.p = state.cpu.p;
    this.cpu.pc = state.cpu.pc;
    this.cpu.e = state.cpu.e;
    this.cpu.waiting = state.cpu.waiting ?? false;
    this.cpu.nmiPending = state.cpu.nmiPending ?? false;
    this.cpu.cycles = state.cpu.cycles ?? 0;
    this.cpu.totalCycles = state.cpu.totalCycles ?? 0;

    this.ppu.vram.set(state.ppu.vram);
    this.ppu.cgram.set(state.ppu.cgram);
    this.ppu.oam.set(state.ppu.oam);
    this.ppu.bgMode = state.ppu.bgMode;
    this.ppu.bgSizes = state.ppu.bgSizes;
    this.ppu.bgTilemaps = state.ppu.bgTilemaps;
    this.ppu.bgTilemapSizes = state.ppu.bgTilemapSizes;
    this.ppu.bgCharAddress = state.ppu.bgCharAddress;
    this.ppu.bgScrollH = state.ppu.bgScrollH;
    this.ppu.bgScrollV = state.ppu.bgScrollV;

    if (state.ppu.screenDisplay !== undefined) {
      this.ppu.screenDisplay = state.ppu.screenDisplay;
      (this.ppu as any).spriteSize = state.ppu.spriteSize;
      (this.ppu as any).oamAddr = state.ppu.oamAddr;
      (this.ppu as any).oamBaseAddr = state.ppu.oamBaseAddr;
      (this.ppu as any).oamLatch = state.ppu.oamLatch;
      (this.ppu as any).oamWriteToggle = state.ppu.oamWriteToggle;
      (this.ppu as any).oamPriorityRotation = state.ppu.oamPriorityRotation;
      this.ppu.mainScreenDesignation = state.ppu.mainScreenDesignation;
      this.ppu.subScreenDesignation = state.ppu.subScreenDesignation;
      this.ppu.bg3Priority = state.ppu.bg3Priority;
      for (let i = 0; i < 8; i++) {
        (this.ppu as any).scrollLatches[i] = state.ppu.scrollLatches[i];
        (this.ppu as any).scrollToggles[i] = state.ppu.scrollToggles[i];
      }
      (this.ppu as any).vramIncrementMode = state.ppu.vramIncrementMode;
      (this.ppu as any).vramIncrementVal = state.ppu.vramIncrementVal;
      (this.ppu as any).vramAddressTranslation = state.ppu.vramAddressTranslation;
      (this.ppu as any).vramAddress = state.ppu.vramAddress;
      (this.ppu as any).cgramAddress = state.ppu.cgramAddress;
      (this.ppu as any).cgramLatch = state.ppu.cgramLatch;
      (this.ppu as any).cgramToggle = state.ppu.cgramToggle;
      (this.ppu as any).mosaicReg = state.ppu.mosaicReg;
      (this.ppu as any).w12sel = state.ppu.w12sel;
      (this.ppu as any).w34sel = state.ppu.w34sel;
      (this.ppu as any).wobjsel = state.ppu.wobjsel;
      (this.ppu as any).wbglog = state.ppu.wbglog;
      (this.ppu as any).wobjlog = state.ppu.wobjlog;
      (this.ppu as any).mainScreenWindowEnable = state.ppu.mainScreenWindowEnable;
      (this.ppu as any).subScreenWindowEnable = state.ppu.subScreenWindowEnable;
      (this.ppu as any).win1Left = state.ppu.win1Left;
      (this.ppu as any).win1Right = state.ppu.win1Right;
      (this.ppu as any).win2Left = state.ppu.win2Left;
      (this.ppu as any).win2Right = state.ppu.win2Right;
      (this.ppu as any).cgwsel = state.ppu.cgwsel;
      (this.ppu as any).cgadsub = state.ppu.cgadsub;
      (this.ppu as any).fixedColorR = state.ppu.fixedColorR;
      (this.ppu as any).fixedColorG = state.ppu.fixedColorG;
      (this.ppu as any).fixedColorB = state.ppu.fixedColorB;
      (this.ppu as any).setiniReg = state.ppu.setiniReg;
      (this.ppu as any).m7sel = state.ppu.m7sel;
      (this.ppu as any).m7a = state.ppu.m7a;
      (this.ppu as any).m7b = state.ppu.m7b;
      (this.ppu as any).m7c = state.ppu.m7c;
      (this.ppu as any).m7d = state.ppu.m7d;
      (this.ppu as any).m7x = state.ppu.m7x;
      (this.ppu as any).m7y = state.ppu.m7y;
      Object.assign((this.ppu as any).m7Latches, state.ppu.m7Latches);
      Object.assign((this.ppu as any).m7Toggles, state.ppu.m7Toggles);
      (this.ppu as any).registerCache.set(state.ppu.registerCache);
      (this.ppu as any).hCounterLatched = state.ppu.hCounterLatched;
      (this.ppu as any).vCounterLatched = state.ppu.vCounterLatched;
      (this.ppu as any).hvCounterLatchState = state.ppu.hvCounterLatchState;
      (this.ppu as any).hCounterLatchToggle = state.ppu.hCounterLatchToggle;
      (this.ppu as any).vCounterLatchToggle = state.ppu.vCounterLatchToggle;
      this.ppu.currentScanline = state.ppu.currentScanline;
      this.ppu.fieldToggle = state.ppu.fieldToggle;
    }

    if (state.bus) {
      (this.bus as any).controllerStrobe = state.bus.controllerStrobe;
      (this.bus as any).controller1Shift = state.bus.controller1Shift;
      (this.bus as any).dmaRegisters.set(state.bus.dmaRegisters);
      (this.bus as any).vblankToggle = state.bus.vblankToggle;
      this.bus.nmiEnabled = state.bus.nmiEnabled;
      this.bus.nmiActive = state.bus.nmiActive;
      this.bus.virqEnabled = state.bus.virqEnabled;
      this.bus.hirqEnabled = state.bus.hirqEnabled;
      this.bus.htime = state.bus.htime;
      this.bus.vtime = state.bus.vtime;
      this.bus.irqActive = state.bus.irqActive;
      (this.bus as any).hdmaEnable = state.bus.hdmaEnable;
      this.bus.hdmaTablePtr.set(state.bus.hdmaTablePtr);
      this.bus.hdmaBank.set(state.bus.hdmaBank);
      this.bus.hdmaActive.set(state.bus.hdmaActive);
      this.bus.hdmaLineCounter.set(state.bus.hdmaLineCounter);
      this.bus.hdmaRepeat.set(state.bus.hdmaRepeat);
      this.bus.hdmaDoTransfer.set(state.bus.hdmaDoTransfer);
      this.bus.hdmaIndirectPtr.set(state.bus.hdmaIndirectPtr);
      this.bus.hdmaIndirectBank.set(state.bus.hdmaIndirectBank);
      (this.bus as any).wramAddressRegister = state.bus.wramAddressRegister;
      (this.bus as any).cpuMultiplicand = state.bus.cpuMultiplicand;
      (this.bus as any).cpuMultiplier = state.bus.cpuMultiplier;
      (this.bus as any).cpuDividend = state.bus.cpuDividend;
      (this.bus as any).cpuDivisor = state.bus.cpuDivisor;
      (this.bus as any).cpuQuotient = state.bus.cpuQuotient;
      (this.bus as any).cpuResult = state.bus.cpuResult;
    }

    this.bus.wram.set(state.wram);
    if (state.sram && this.bus.cartridge) {
      this.bus.cartridge.sram.set(state.sram);
    }
    this.romKind = state.romKind === 'demo' ? 'demo' : 'custom';
  }

  public isDemoRomLoaded(): boolean {
    return this.romKind === 'demo';
  }

  public getDimensions(): { width: number; height: number } {
    return { width: this.ppu.width, height: this.ppu.height };
  }

  public getRuntimeStatus(): RuntimeStatus {
    return {
      pc: this.cpu.pc,
      nmiEnabled: this.bus.nmiEnabled,
      screenDisplay: this.ppu.screenDisplay,
      brightness: this.ppu.screenDisplay & 0x0F,
    };
  }

  public getLegacyDebugState(): LegacyDebugState {
    return {
      cpu: {
        pc: `0x${this.cpu.pc.toString(16).toUpperCase()}`,
        lastInstructionAddress: `0x${(this.cpu.lastInstructionAddress ?? 0).toString(16).toUpperCase()}`,
        cycles: this.cpu.cycles,
        p: `0x${this.cpu.p.toString(16).toUpperCase()}`,
        s: `0x${this.cpu.s.toString(16).toUpperCase()}`,
        a: `0x${this.cpu.a.toString(16).toUpperCase()}`,
        x: `0x${this.cpu.x.toString(16).toUpperCase()}`,
        y: `0x${this.cpu.y.toString(16).toUpperCase()}`,
      },
      ppu: {
        currentScanline: this.ppu.currentScanline,
        bgMode: this.ppu.bgMode,
      },
      bus: {
        nmiActive: this.bus.nmiActive,
        nmiEnabled: this.bus.nmiEnabled,
        irqActive: this.bus.irqActive,
      },
    };
  }

  public getPpuDebugState(): PpuDebugState {
    return {
      bgMode: this.ppu.bgMode,
      screenDisplay: this.ppu.screenDisplay,
      mainScreenDesignation: this.ppu.mainScreenDesignation,
      subScreenDesignation: this.ppu.subScreenDesignation,
      bgTilemaps: [...this.ppu.bgTilemaps],
      bgCharAddress: [...this.ppu.bgCharAddress],
    };
  }
}
