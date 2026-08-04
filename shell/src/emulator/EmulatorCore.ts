import { SnesEmulator } from 'snes-core';
import { Bus as NesBus, CPU as NesCPU, PPU as NesPPU, Cartridge as NesCartridge } from 'nes-core';
import { GameBoy } from 'gb-core';
import { GBA } from '../../../gba/src';
import { Bus as AtariBus, Cartridge as AtariCartridge, Controller as AtariController } from 'atari-core';

export interface EmulatorCore {
  id: string;
  name: string;
  type: 'snes' | 'nes' | 'gb' | 'gbc' | 'gba' | 'atari';
  loadRom(data: ArrayBuffer): Promise<void>;
  runFrame(controllerState: number): { pixels: Uint32Array; frameStartBlank: boolean } | Promise<{ pixels: Uint32Array; frameStartBlank: boolean }>;
  reset(): Promise<void>;
  enableAudio(): Promise<void>;
  disableAudio(): Promise<void> | void;
  setAudioVolume(volume: number): void;
  setAudioTempo(tempo: number): void;
  setSpeedMultiplier(multiplier: number): void;
  createSaveState(): Promise<any>;
  loadSaveState(state: any): Promise<void>;
  getDebugSnapshot(hexOffset?: number): Promise<any>;
  getStatus(): 'ready' | 'running' | 'stopped';
  destroy(): void;
  getAudioContext(): AudioContext | null;
  getAudioNode(): AudioNode | null;
  getRomHeader?(): any;
}

export class EmulatorManager {
  private cores: Map<string, EmulatorCore> = new Map();
  private activeCore: EmulatorCore | null = null;

  constructor() { }

  registerCore(core: EmulatorCore) {
    this.cores.set(core.id, core);
  }

  setActiveCore(coreId: string) {
    if (!this.cores.has(coreId)) {
      throw new Error(`Emulator core ${coreId} not registered`);
    }

    // Stop current core if any
    if (this.activeCore) {
      this.activeCore.disableAudio();
      this.activeCore.setSpeedMultiplier(1);
    }

    this.activeCore = this.cores.get(coreId) || null;
  }

  getActiveCore(): EmulatorCore | null {
    return this.activeCore;
  }

  getAllCores(): EmulatorCore[] {
    return Array.from(this.cores.values());
  }

  getCoreById(id: string): EmulatorCore | null {
    return this.cores.get(id) || null;
  }

  destroyAll() {
    this.cores.forEach(core => core.destroy());
    this.cores.clear();
    this.activeCore = null;
  }
}

// Factory for creating emulator cores
export class EmulatorCoreFactory {
  static createSnesCore(): EmulatorCore {
    return new SnesEmulatorCore();
  }

  static createNesCore(): EmulatorCore {
    return new NesEmulatorCore();
  }

  static createGbcCore(): EmulatorCore {
    return new GbEmulatorCore('gbc');
  }

  static createGbaCore(): EmulatorCore {
    return new GbaEmulatorCore();
  }

  static createAtariCore(): EmulatorCore {
    return new AtariEmulatorCore();
  }
}

// SNES-specific implementation running on the Main Thread
export class SnesEmulatorCore implements EmulatorCore {
  id = 'snes';
  name = 'Super Nintendo';
  type: 'snes' | 'nes' | 'gb' | 'gbc' | 'gba' = 'snes';

  public emulator: SnesEmulator;
  private audioEnabled = false;
  private speedMultiplier = 1;
  private audioVolume = 0.35;
  private audioTempo = 1.0;
  private status: 'ready' | 'running' | 'stopped' = 'stopped';

  constructor() {
    this.emulator = new SnesEmulator();
  }

  async loadRom(data: ArrayBuffer): Promise<void> {
    const bytes = new Uint8Array(data);
    this.emulator.loadRomBytes(bytes);
    this.emulator.reset();
    this.status = 'ready';
  }

  runFrame(controllerState: number): { pixels: Uint32Array; frameStartBlank: boolean } {
    const frame = this.emulator.runFrame(controllerState, this.speedMultiplier);
    return {
      pixels: frame.pixels,
      frameStartBlank: frame.frameStartBlank
    };
  }

  async reset(): Promise<void> {
    this.emulator.reset();
  }

  async enableAudio(): Promise<void> {
    // Audio is permanently detached for now
    this.emulator.disableAudio();
    this.audioEnabled = false;
    this.status = 'ready';
  }

  disableAudio(): void {
    this.emulator.disableAudio();
    this.audioEnabled = false;
  }

  setAudioVolume(volume: number): void {
    this.audioVolume = volume;
    this.emulator.setAudioVolume(volume);
  }

  setAudioTempo(tempo: number): void {
    this.audioTempo = tempo;
    this.emulator.setAudioTempo(tempo);
  }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = multiplier;
  }

  async createSaveState(): Promise<any> {
    return this.emulator.createSaveState('');
  }

  async loadSaveState(state: any): Promise<void> {
    this.emulator.loadSaveState(state);
  }

  async getDebugSnapshot(hexOffset: number = 0): Promise<any> {
    return this.emulator.createDebugSnapshot(hexOffset);
  }

  getStatus(): 'ready' | 'running' | 'stopped' {
    return this.status;
  }

  getAudioContext(): AudioContext | null {
    return (this.emulator as any).audio?.context || null;
  }

  getAudioNode(): AudioNode | null {
    return (this.emulator as any).audio?.gainNode || null;
  }

  getRomHeader(): any {
    const cart = (this.emulator as any).bus?.cartridge;
    if (!cart) return null;
    const h = cart.header;
    return {
      title: h.title,
      mapper: h.isLoROM ? 'LoROM' : 'HiROM',
      version: `1.${h.version}`,
      checksum: `0x${h.checksum.toString(16).toUpperCase()}`
    };
  }

  destroy(): void {
    this.disableAudio();
  }
}

// NES Implementation (Main Thread)
export class NesEmulatorCore implements EmulatorCore {
  id = 'nes';
  name = 'Nintendo Entertainment System';
  type: 'snes' | 'nes' | 'gb' | 'gbc' | 'gba' = 'nes';

  public bus: NesBus;
  private ppu: NesPPU;
  private cpu: NesCPU;

  private romLoaded = false;
  private status: 'ready' | 'running' | 'stopped' = 'stopped';
  private audioVolume = 0.35;
  private audioEnabled = false;

  constructor() {
    this.bus = new NesBus();
    this.ppu = new NesPPU();
    this.cpu = new NesCPU(this.bus);
    this.bus.connect(this.cpu, this.ppu);
  }

  async loadRom(data: ArrayBuffer): Promise<void> {
    const cart = new NesCartridge(data);
    this.bus.insertCartridge(cart);

    this.cpu.reset();
    this.ppu.reset();
    this.bus.apu.reset();

    this.romLoaded = true;
    this.status = 'ready';
  }

  runFrame(controllerState: number): { pixels: Uint32Array; frameStartBlank: boolean } {
    if (!this.romLoaded) throw new Error('ROM not loaded');

    // Map controller bits (NES expects A, B, Select, Start, Up, Down, Left, Right)
    let state = 0x00;
    if (controllerState & 0x0080) state |= 0x01; // A (SNES A)
    if (controllerState & 0x8000) state |= 0x02; // B (SNES B)
    if (controllerState & 0x4000) state |= 0x02; // B (SNES Y)
    if (controllerState & 0x2000) state |= 0x04; // Select (SNES SELECT)
    if (controllerState & 0x1000) state |= 0x08; // Start (SNES START)
    if (controllerState & 0x0800) state |= 0x10; // Up (SNES UP)
    if (controllerState & 0x0400) state |= 0x20; // Down (SNES DOWN)
    if (controllerState & 0x0200) state |= 0x40; // Left (SNES LEFT)
    if (controllerState & 0x0100) state |= 0x80; // Right (SNES RIGHT)

    this.bus.controllerState[0] = state;

    // Emulate one frame
    let frameComplete = false;
    while (!frameComplete) {
      for (let p = 0; p < 3; p++) {
        this.ppu.clock();
        if (this.ppu.scanline === 0 && this.ppu.cycle === 0) {
          frameComplete = true;
        }
      }
      this.cpu.clock();
      this.bus.apu.clock();
    }

    // Map PPU framebuffer (256x240, 0xRRGGBB) to output pixels (256x240, AARRGGBB)
    const pixels = new Uint32Array(256 * 240);
    const fb = this.ppu.frameBuffer;
    for (let i = 0; i < pixels.length; i++) {
      const color = fb[i];
      const r = (color >> 16) & 0xFF;
      const g = (color >> 8) & 0xFF;
      const b = color & 0xFF;
      pixels[i] = r | (g << 8) | (b << 16) | 0xFF000000;
    }

    return {
      pixels,
      frameStartBlank: false
    };
  }

  async reset(): Promise<void> {
    this.cpu.reset();
    this.ppu.reset();
    this.bus.apu.reset();
  }

  async enableAudio(): Promise<void> {
    this.bus.apu.init();
    const ctx = (this.bus.apu as any).ctx;
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.bus.apu.setVolume(this.audioVolume);
    this.audioEnabled = true;
  }

  disableAudio(): void {
    this.bus.apu.setVolume(0);
    const ctx = (this.bus.apu as any).ctx;
    if (ctx) {
      ctx.suspend();
    }
    this.audioEnabled = false;
  }

  setAudioVolume(volume: number): void {
    this.audioVolume = volume;
    this.bus.apu.setVolume(volume);
  }

  setAudioTempo(tempo: number): void { }
  setSpeedMultiplier(multiplier: number): void { }

  async createSaveState(): Promise<any> {
    if (!this.romLoaded) return null;

    // Save CPU
    const cpuState = {
      a: this.cpu.a,
      x: this.cpu.x,
      y: this.cpu.y,
      stkp: this.cpu.stkp,
      pc: this.cpu.pc,
      status: this.cpu.status,
      cycles: this.cpu.cycles,
      dmaCycles: this.cpu.dmaCycles,
      fetched: (this.cpu as any).fetched,
      temp: (this.cpu as any).temp,
      addrAbs: (this.cpu as any).addrAbs,
      addrRel: (this.cpu as any).addrRel,
      opcode: (this.cpu as any).opcode
    };

    // Save Bus RAM
    const cpuRam = Array.from(this.bus.cpuRam);
    const controllerState = Array.from(this.bus.controllerState);
    const controllerLatch = Array.from((this.bus as any).controllerLatch);
    const controllerStrobe = (this.bus as any).controllerStrobe;

    // Save PPU
    const ppuState = {
      vram: Array.from(this.ppu.vram),
      palette: Array.from(this.ppu.palette),
      oam: Array.from(this.ppu.oam),
      scanline: this.ppu.scanline,
      cycle: this.ppu.cycle,
      nmiTriggered: this.ppu.nmiTriggered,
      control: (this.ppu as any).control,
      mask: (this.ppu as any).mask,
      status: (this.ppu as any).status,
      oamAddr: (this.ppu as any).oamAddr,
      vramAddr: (this.ppu as any).vramAddr,
      tempAddr: (this.ppu as any).tempAddr,
      fineX: (this.ppu as any).fineX,
      writeLatch: (this.ppu as any).writeLatch,
      ppuDataBuffer: (this.ppu as any).ppuDataBuffer,
      lastA12: (this.ppu as any).lastA12,
      a12LowTimer: (this.ppu as any).a12LowTimer
    };

    // Save Cartridge / Mapper
    let mapperState: any = null;
    if (this.bus.cart) {
      const cart = this.bus.cart;
      const chrROM = Array.from(cart.chrROM);

      if (cart.mapper && cart.mapper.constructor.name === 'Mapper4') {
        const m = cart.mapper as any;
        mapperState = {
          mapperId: 4,
          chrROM,
          mirror: cart.mirror,
          targetRegister: m.targetRegister,
          prgBankMode: m.prgBankMode,
          chrA12Inversion: m.chrA12Inversion,
          registers: Array.from(m.registers),
          ram: Array.from(m.ram),
          irqLatch: m.irqLatch,
          irqCounter: m.irqCounter,
          irqEnable: m.irqEnable,
          irqReload: m.irqReload,
          irqPending: m.irqPending
        };
      } else {
        mapperState = {
          mapperId: 0,
          chrROM,
          mirror: cart.mirror
        };
      }
    }

    // Save APU register state
    const apuState = {
      pulse1Enabled: (this.bus.apu as any).pulse1Enabled,
      pulse1Timer: (this.bus.apu as any).pulse1Timer,
      pulse1Volume: (this.bus.apu as any).pulse1Volume,
      pulse1Length: (this.bus.apu as any).pulse1Length,
      pulse1Halt: (this.bus.apu as any).pulse1Halt,
      pulse2Enabled: (this.bus.apu as any).pulse2Enabled,
      pulse2Timer: (this.bus.apu as any).pulse2Timer,
      pulse2Volume: (this.bus.apu as any).pulse2Volume,
      pulse2Length: (this.bus.apu as any).pulse2Length,
      pulse2Halt: (this.bus.apu as any).pulse2Halt,
      triEnabled: (this.bus.apu as any).triEnabled,
      triTimer: (this.bus.apu as any).triTimer,
      triLength: (this.bus.apu as any).triLength,
      triHalt: (this.bus.apu as any).triHalt,
      apuStatus: (this.bus.apu as any).apuStatus
    };

    return {
      coreId: 'nes',
      cpuState,
      cpuRam,
      controllerState,
      controllerLatch,
      controllerStrobe,
      ppuState,
      mapperState,
      apuState
    };
  }

  async loadSaveState(state: any): Promise<void> {
    if (!state || state.coreId !== 'nes' || !this.romLoaded) return;

    // Restore CPU
    this.cpu.a = state.cpuState.a;
    this.cpu.x = state.cpuState.x;
    this.cpu.y = state.cpuState.y;
    this.cpu.stkp = state.cpuState.stkp;
    this.cpu.pc = state.cpuState.pc;
    this.cpu.status = state.cpuState.status;
    this.cpu.cycles = state.cpuState.cycles;
    this.cpu.dmaCycles = state.cpuState.dmaCycles;
    (this.cpu as any).fetched = state.cpuState.fetched;
    (this.cpu as any).temp = state.cpuState.temp;
    (this.cpu as any).addrAbs = state.cpuState.addrAbs;
    (this.cpu as any).addrRel = state.cpuState.addrRel;
    (this.cpu as any).opcode = state.cpuState.opcode;

    // Restore Bus
    this.bus.cpuRam.set(state.cpuRam);
    this.bus.controllerState.set(state.controllerState);
    (this.bus as any).controllerLatch.set(state.controllerLatch);
    (this.bus as any).controllerStrobe = state.controllerStrobe;

    // Restore PPU
    this.ppu.vram.set(state.ppuState.vram);
    this.ppu.palette.set(state.ppuState.palette);
    this.ppu.oam.set(state.ppuState.oam);
    this.ppu.scanline = state.ppuState.scanline;
    this.ppu.cycle = state.ppuState.cycle;
    this.ppu.nmiTriggered = state.ppuState.nmiTriggered;
    (this.ppu as any).control = state.ppuState.control;
    (this.ppu as any).mask = state.ppuState.mask;
    (this.ppu as any).status = state.ppuState.status;
    (this.ppu as any).oamAddr = state.ppuState.oamAddr;
    (this.ppu as any).vramAddr = state.ppuState.vramAddr;
    (this.ppu as any).tempAddr = state.ppuState.tempAddr;
    (this.ppu as any).fineX = state.ppuState.fineX;
    (this.ppu as any).writeLatch = state.ppuState.writeLatch;
    (this.ppu as any).ppuDataBuffer = state.ppuState.ppuDataBuffer;
    (this.ppu as any).lastA12 = state.ppuState.lastA12;
    (this.ppu as any).a12LowTimer = state.ppuState.a12LowTimer;

    // Restore Cartridge / Mapper
    if (this.bus.cart && state.mapperState) {
      const cart = this.bus.cart;
      cart.chrROM.set(state.mapperState.chrROM);

      // Restore nametable mirroring mode
      if (state.mapperState.mirror !== undefined) {
        cart.mirror = state.mapperState.mirror;
      }

      if (state.mapperState.mapperId === 4 && cart.mapper && cart.mapper.constructor.name === 'Mapper4') {
        const m = cart.mapper as any;
        m.targetRegister = state.mapperState.targetRegister;
        m.prgBankMode = state.mapperState.prgBankMode;
        m.chrA12Inversion = state.mapperState.chrA12Inversion;
        m.registers.set(state.mapperState.registers);
        m.ram.set(state.mapperState.ram);
        m.irqLatch = state.mapperState.irqLatch;
        m.irqCounter = state.mapperState.irqCounter;
        m.irqEnable = state.mapperState.irqEnable;
        m.irqReload = state.mapperState.irqReload;
        m.irqPending = state.mapperState.irqPending;
      }
    }

    // Restore APU register state
    if (state.apuState) {
      const apu = this.bus.apu as any;
      apu.pulse1Enabled = state.apuState.pulse1Enabled;
      apu.pulse1Timer = state.apuState.pulse1Timer;
      apu.pulse1Volume = state.apuState.pulse1Volume;
      apu.pulse1Length = state.apuState.pulse1Length;
      apu.pulse1Halt = state.apuState.pulse1Halt;
      apu.pulse2Enabled = state.apuState.pulse2Enabled;
      apu.pulse2Timer = state.apuState.pulse2Timer;
      apu.pulse2Volume = state.apuState.pulse2Volume;
      apu.pulse2Length = state.apuState.pulse2Length;
      apu.pulse2Halt = state.apuState.pulse2Halt;
      apu.triEnabled = state.apuState.triEnabled;
      apu.triTimer = state.apuState.triTimer;
      apu.triLength = state.apuState.triLength;
      apu.triHalt = state.apuState.triHalt;
      apu.apuStatus = state.apuState.apuStatus;
      // Re-sync Web Audio nodes to restored register values
      apu.updatePulse1Frequency();
      apu.updatePulse1Volume();
      apu.updatePulse2Frequency();
      apu.updatePulse2Volume();
      apu.updateTriangleFrequency();
      apu.updateTriangleVolume();
    }
  }

  async getDebugSnapshot(hexOffset: number = 0): Promise<any> {
    return {
      cpu: {
        pc: this.cpu.pc,
        stkp: this.cpu.stkp,
        a: this.cpu.a,
        x: this.cpu.x,
        y: this.cpu.y,
        status: this.cpu.status,
        cycles: this.cpu.cycles
      },
      isScreenBlank: false,
      bgMode: 0,
      screenDisplay: 0,
      disassembly: [],
      oam: [],
      cgram: [],
      hexData: []
    };
  }

  getStatus(): 'ready' | 'running' | 'stopped' {
    return this.romLoaded ? 'ready' : 'stopped';
  }

  getAudioContext(): AudioContext | null {
    return (this.bus.apu as any)?.ctx || null;
  }

  getAudioNode(): AudioNode | null {
    return (this.bus.apu as any)?.masterGain || null;
  }

  getRomHeader(): any {
    if (!this.bus.cart) return null;
    const mapperId = this.bus.cart.mapper?.constructor.name.replace('Mapper', '') || '0';
    return {
      title: 'NES ROM',
      mapper: `Mapper ${mapperId}`,
      version: '1.0',
      checksum: 'N/A'
    };
  }

  destroy(): void {
    this.disableAudio();
  }
}

// Gameboy / GBC Implementation (Main Thread)
export class GbEmulatorCore implements EmulatorCore {
  id: string;
  name: string;
  type: 'snes' | 'nes' | 'gb' | 'gbc' | 'gba';

  public gb: GameBoy;
  private audioCtx: AudioContext | null = null;
  private audioNode: ScriptProcessorNode | null = null;
  private gainNode: GainNode | null = null;
  private audioEnabled = false;
  private romLoaded = false;
  private audioVolume = 0.35;

  public serialLog = '';

  constructor(type: 'gb' | 'gbc') {
    this.id = type;
    this.type = type;
    this.name = type === 'gb' ? 'Game Boy' : 'Game Boy Color';
    this.gb = new GameBoy({
      onSerialByte: (byte) => {
        this.serialLog += String.fromCharCode(byte);
      }
    });
  }

  async loadRom(data: ArrayBuffer): Promise<void> {
    this.serialLog = '';
    const bytes = new Uint8Array(data);
    this.gb.loadRom(bytes);
    this.romLoaded = true;
  }

  runFrame(controllerState: number): { pixels: Uint32Array; frameStartBlank: boolean } {
    if (!this.romLoaded) throw new Error('ROM not loaded');

    // Map SNES controllerState to GB joypad buttons (active low)
    let buttons = 0x0F;
    if (controllerState & 0x0080) buttons &= ~0x01; // A (SNES A)
    if (controllerState & 0x8000) buttons &= ~0x02; // B (SNES B)
    if (controllerState & 0x2000) buttons &= ~0x04; // Select (SNES SELECT)
    if (controllerState & 0x1000) buttons &= ~0x08; // Start (SNES START)

    let dpad = 0x0F;
    if (controllerState & 0x0100) dpad &= ~0x01; // Right (SNES RIGHT)
    if (controllerState & 0x0200) dpad &= ~0x02; // Left (SNES LEFT)
    if (controllerState & 0x0800) dpad &= ~0x04; // Up (SNES UP)
    if (controllerState & 0x0400) dpad &= ~0x08; // Down (SNES DOWN)

    this.gb.joypad.buttons = buttons;
    this.gb.joypad.dpad = dpad;

    // Run GB frame (returns Uint8Array of RGBA values)
    const fb = this.gb.runFrame();

    // Convert Uint8Array to Uint32Array (160x144, packed as 0xAARRGGBB)
    const pixels = new Uint32Array(160 * 144);
    for (let i = 0; i < pixels.length; i++) {
      const r = fb[i * 4];
      const g = fb[i * 4 + 1];
      const b = fb[i * 4 + 2];
      pixels[i] = r | (g << 8) | (b << 16) | 0xFF000000;
    }

    return {
      pixels,
      frameStartBlank: false
    };
  }

  async reset(): Promise<void> {
    this.serialLog = '';
    if (this.gb.mmu.cgbMode) {
      this.gb.cpu.resetCGB();
    } else {
      this.gb.cpu.reset();
    }
    this.gb.ppu.cgbMode = this.gb.mmu.cgbMode;
    this.gb.ppu.reset();
    this.gb.apu.reset();

    // Re-initialize RAM, registers, and timing parameters to match post-boot defaults
    this.gb.ppu.vram.fill(0);
    this.gb.ppu.oam.fill(0);
    this.gb.mmu.wram.fill(0);
    this.gb.mmu.hram.fill(0);
    this.gb.ppu.framebuffer.fill(0xFF);
    this.gb.ppu.bgPalette.fill(0);
    this.gb.ppu.objPalette.fill(0);
    this.gb.ppu.frameReady = false;

    this.gb.mmu.ie = 0x00;
    this.gb.mmu.if_ = 0xE1;
    this.gb.timer.div = 0xABCC;
    this.gb.timer.tima = 0;
    this.gb.timer.tma = 0;
    this.gb.timer.tac = 0xF8;
    this.gb.serial.sb = 0x00;
    this.gb.serial.sc = 0x7E;
  }

  async enableAudio(): Promise<void> {
    if (this.audioEnabled) return;

    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.audioVolume;

      const bufferSize = 2048;
      this.audioNode = this.audioCtx.createScriptProcessor(bufferSize, 0, 2);

      const gb = this.gb;
      const audioTempBuf = new Float32Array(8192);

      this.audioNode.onaudioprocess = (e: AudioProcessingEvent) => {
        const output = e.outputBuffer;
        const leftData = output.getChannelData(0);
        const rightData = output.getChannelData(1);
        const samplesNeeded = output.length;

        if (!this.audioEnabled || !gb) {
          leftData.fill(0);
          rightData.fill(0);
          return;
        }

        // Drain excess backlog of samples to prevent latency and warp-speed catch-up audio
        if (gb.apu.bufferSize > samplesNeeded * 4) {
          const discardCount = gb.apu.bufferSize - samplesNeeded * 2;
          const dummyBuf = new Float32Array(discardCount);
          gb.apu.readSamples(dummyBuf, discardCount);
        }

        const available = gb.apu.readSamples(audioTempBuf, samplesNeeded * 2);
        const ratio = (samplesNeeded * 2) / Math.max(1, available);
        for (let i = 0; i < samplesNeeded; i++) {
          const srcIdx = Math.floor(i * 2 / ratio);
          if (srcIdx + 1 < available) {
            leftData[i] = audioTempBuf[srcIdx];
            rightData[i] = audioTempBuf[srcIdx + 1];
          } else if (srcIdx < available) {
            leftData[i] = audioTempBuf[srcIdx];
            rightData[i] = 0;
          } else {
            leftData[i] = 0;
            rightData[i] = 0;
          }
        }
      };

      this.audioNode.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    this.audioEnabled = true;
  }

  disableAudio(): void {
    this.audioEnabled = false;
  }

  setAudioVolume(volume: number): void {
    this.audioVolume = volume;
    if (this.gainNode) {
      this.gainNode.gain.value = volume;
    }
  }

  setAudioTempo(tempo: number): void { }
  setSpeedMultiplier(multiplier: number): void { }
  async createSaveState(): Promise<any> {
    if (!this.romLoaded) return null;
    const gb = this.gb;

    // Save CPU
    const cpuState = {
      a: gb.cpu.a,
      b: gb.cpu.b,
      c: gb.cpu.c,
      d: gb.cpu.d,
      e: gb.cpu.e,
      h: gb.cpu.h,
      l: gb.cpu.l,
      f: gb.cpu.f,
      sp: gb.cpu.sp,
      pc: gb.cpu.pc,
      ime: gb.cpu.ime,
      imeScheduled: gb.cpu.imeScheduled,
      halted: gb.cpu.halted,
      haltBug: gb.cpu.haltBug,
      stopped: gb.cpu.stopped,
      totalCycles: gb.cpu.totalCycles
    };

    // Save MMU State & RAM Buffers
    const mmuState = {
      wram: Array.from(gb.mmu.wram),
      hram: Array.from(gb.mmu.hram),
      eram: Array.from(gb.mmu.eram),
      wramBank: gb.mmu.wramBank,
      cgbMode: gb.mmu.cgbMode,
      doubleSpeed: gb.mmu.doubleSpeed,
      key1: gb.mmu.key1,
      hdma1: gb.mmu.hdma1,
      hdma2: gb.mmu.hdma2,
      hdma3: gb.mmu.hdma3,
      hdma4: gb.mmu.hdma4,
      hdma5: gb.mmu.hdma5,
      hdmaActive: gb.mmu.hdmaActive,
      mbcType: gb.mmu.mbcType,
      hasBattery: gb.mmu.hasBattery,
      hasRam: gb.mmu.hasRam,
      hasTimer: gb.mmu.hasTimer,
      romBank: gb.mmu.romBank,
      eramBank: gb.mmu.eramBank,
      eramEnabled: gb.mmu.eramEnabled,
      bankingMode: gb.mmu.bankingMode,
      ie: gb.mmu.ie,
      if_: gb.mmu.if_
    };

    // Save PPU Registers
    const ppuState = {
      vram: Array.from(gb.ppu.vram),
      oam: Array.from(gb.ppu.oam),
      bgPalette: Array.from(gb.ppu.bgPalette),
      objPalette: Array.from(gb.ppu.objPalette),
      mode: gb.ppu.mode,
      modeClock: (gb.ppu as any).modeClock,
      line: gb.ppu.ly,
      lyc: gb.ppu.lyc,
      lcdc: gb.ppu.lcdc,
      stat: gb.ppu.stat,
      scy: gb.ppu.scy,
      scx: gb.ppu.scx,
      wy: gb.ppu.wy,
      wx: gb.ppu.wx,
      bgp: gb.ppu.bgp,
      obp0: gb.ppu.obp0,
      obp1: gb.ppu.obp1,
      vramBank: gb.ppu.vramBank,
      bgpi: gb.ppu.bgpi,
      obpi: gb.ppu.obpi,
      ppuCycleAccumulator: (gb.ppu as any).ppuCycleAccumulator
    };

    // Save Timer Registers
    const timerState = {
      div: gb.timer.div,
      tima: gb.timer.tima,
      tma: gb.timer.tma,
      tac: gb.timer.tac,
      timaCounter: (gb.timer as any).timaCounter
    };

    // Save Serial
    const serialState = {
      sb: gb.serial.sb,
      sc: gb.serial.sc
    };

    return {
      coreId: 'gbc',
      cpuState,
      mmuState,
      ppuState,
      timerState,
      serialState
    };
  }

  async loadSaveState(state: any): Promise<void> {
    if (!state || state.coreId !== 'gbc' || !this.romLoaded) return;
    const gb = this.gb;

    // Restore CPU Registers
    gb.cpu.a = state.cpuState.a;
    gb.cpu.b = state.cpuState.b;
    gb.cpu.c = state.cpuState.c;
    gb.cpu.d = state.cpuState.d;
    gb.cpu.e = state.cpuState.e;
    gb.cpu.h = state.cpuState.h;
    gb.cpu.l = state.cpuState.l;
    gb.cpu.f = state.cpuState.f;
    gb.cpu.sp = state.cpuState.sp;
    gb.cpu.pc = state.cpuState.pc;
    gb.cpu.ime = state.cpuState.ime;
    gb.cpu.imeScheduled = state.cpuState.imeScheduled;
    gb.cpu.halted = state.cpuState.halted;
    gb.cpu.haltBug = state.cpuState.haltBug;
    gb.cpu.stopped = state.cpuState.stopped;
    gb.cpu.totalCycles = state.cpuState.totalCycles;

    // Restore MMU RAM buffers & banking
    gb.mmu.wram.set(state.mmuState.wram);
    gb.mmu.hram.set(state.mmuState.hram);
    gb.mmu.eram.set(state.mmuState.eram);
    gb.mmu.wramBank = state.mmuState.wramBank;
    gb.mmu.cgbMode = state.mmuState.cgbMode;
    gb.mmu.doubleSpeed = state.mmuState.doubleSpeed;
    gb.mmu.key1 = state.mmuState.key1;
    gb.mmu.hdma1 = state.mmuState.hdma1;
    gb.mmu.hdma2 = state.mmuState.hdma2;
    gb.mmu.hdma3 = state.mmuState.hdma3;
    gb.mmu.hdma4 = state.mmuState.hdma4;
    gb.mmu.hdma5 = state.mmuState.hdma5;
    gb.mmu.hdmaActive = state.mmuState.hdmaActive;
    gb.mmu.mbcType = state.mmuState.mbcType;
    gb.mmu.hasBattery = state.mmuState.hasBattery;
    gb.mmu.hasRam = state.mmuState.hasRam;
    gb.mmu.hasTimer = state.mmuState.hasTimer;
    gb.mmu.romBank = state.mmuState.romBank;
    gb.mmu.eramBank = state.mmuState.eramBank;
    gb.mmu.eramEnabled = state.mmuState.eramEnabled;
    gb.mmu.bankingMode = state.mmuState.bankingMode;
    gb.mmu.ie = state.mmuState.ie;
    gb.mmu.if_ = state.mmuState.if_;

    // Restore PPU Registers
    gb.ppu.vram.set(state.ppuState.vram);
    gb.ppu.oam.set(state.ppuState.oam);
    gb.ppu.bgPalette.set(state.ppuState.bgPalette);
    gb.ppu.objPalette.set(state.ppuState.objPalette);
    gb.ppu.mode = state.ppuState.mode;
    (gb.ppu as any).modeClock = state.ppuState.modeClock;
    gb.ppu.ly = state.ppuState.line;
    gb.ppu.lyc = state.ppuState.lyc;
    gb.ppu.lcdc = state.ppuState.lcdc;
    gb.ppu.stat = state.ppuState.stat;
    gb.ppu.scy = state.ppuState.scy;
    gb.ppu.scx = state.ppuState.scx;
    gb.ppu.wy = state.ppuState.wy;
    gb.ppu.wx = state.ppuState.wx;
    gb.ppu.bgp = state.ppuState.bgp;
    gb.ppu.obp0 = state.ppuState.obp0;
    gb.ppu.obp1 = state.ppuState.obp1;
    gb.ppu.vramBank = state.ppuState.vramBank;
    gb.ppu.bgpi = state.ppuState.bgpi;
    gb.ppu.obpi = state.ppuState.obpi;
    (gb.ppu as any).ppuCycleAccumulator = state.ppuState.ppuCycleAccumulator;

    // Restore Timer
    gb.timer.div = state.timerState.div;
    gb.timer.tima = state.timerState.tima;
    gb.timer.tma = state.timerState.tma;
    gb.timer.tac = state.timerState.tac;
    (gb.timer as any).timaCounter = state.timerState.timaCounter;

    // Restore Serial
    gb.serial.sb = state.serialState.sb;
    gb.serial.sc = state.serialState.sc;
  }

  async getDebugSnapshot(hexOffset: number = 0): Promise<any> {
    return {
      cpu: {
        pc: this.gb.cpu.pc,
        sp: this.gb.cpu.sp,
        af: this.gb.cpu.af,
        bc: this.gb.cpu.bc,
        de: this.gb.cpu.de,
        hl: this.gb.cpu.hl,
        cycles: this.gb.cpu.totalCycles
      },
      isScreenBlank: false,
      bgMode: 0,
      screenDisplay: 0,
      disassembly: [],
      oam: [],
      cgram: [],
      hexData: []
    };
  }

  getStatus(): 'ready' | 'running' | 'stopped' {
    return this.romLoaded ? 'ready' : 'stopped';
  }

  getAudioContext(): AudioContext | null {
    return this.audioCtx;
  }

  getAudioNode(): AudioNode | null {
    return this.gainNode;
  }

  getRomHeader(): any {
    return {
      title: 'Game Boy ROM',
      mapper: this.id.toUpperCase(),
      version: '1.0',
      checksum: 'N/A'
    };
  }

  destroy(): void {
    this.disableAudio();
    if (this.audioNode) {
      this.audioNode.disconnect();
    }
    if (this.audioCtx) {
      this.audioCtx.close();
    }
  }
}

export class GbaEmulatorCore implements EmulatorCore {
  id = 'gba';
  name = 'Game Boy Advance';
  type: 'snes' | 'nes' | 'gb' | 'gbc' | 'gba' = 'gba';

  public gba: GBA;
  private romLoaded = false;
  private speedMultiplier = 1;
  private audioVolume = 0.35;
  private status: 'ready' | 'running' | 'stopped' = 'stopped';
  private biosData: Uint8Array | null = null;

  constructor() {
    this.gba = new GBA();
  }

  async loadRom(data: ArrayBuffer): Promise<void> {
    const bytes = new Uint8Array(data);
    this.gba.loadCart(bytes);

    if (this.biosData === null) {
      try {
        const response = await fetch('/emulator/retro-station/gba_bios.bin');
        if (response.ok) {
          const biosBuf = await response.arrayBuffer();
          this.biosData = new Uint8Array(biosBuf);
          this.gba.loadBios(this.biosData);
        }
      } catch (e) {
        console.warn('GBA Bios not found, using directBoot');
      }
    }

    if (this.biosData) {
      this.gba.reset();
    } else {
      this.gba.directBoot();
    }

    this.romLoaded = true;
    this.status = 'ready';
  }

  runFrame(controllerState: number): { pixels: Uint32Array; frameStartBlank: boolean } {
    let gbaKeys = 0x3FF; // all released (active-low)

    // SNES controller layout mapping:
    if (controllerState & 0x0080) gbaKeys &= ~0x0001; // A -> GBA A
    if (controllerState & 0x8000) gbaKeys &= ~0x0002; // B -> GBA B
    if (controllerState & 0x4000) gbaKeys &= ~0x0002; // Y -> GBA B
    if (controllerState & 0x2000) gbaKeys &= ~0x0004; // Select -> GBA Select
    if (controllerState & 0x1000) gbaKeys &= ~0x0008; // Start -> GBA Start
    if (controllerState & 0x0100) gbaKeys &= ~0x0010; // Right -> GBA Right
    if (controllerState & 0x0200) gbaKeys &= ~0x0020; // Left -> GBA Left
    if (controllerState & 0x0800) gbaKeys &= ~0x0040; // Up -> GBA Up
    if (controllerState & 0x0400) gbaKeys &= ~0x0080; // Down -> GBA Down
    if (controllerState & 0x0010) gbaKeys &= ~0x0100; // R -> GBA R
    if (controllerState & 0x0020) gbaKeys &= ~0x0200; // L -> GBA L

    this.gba.mem.setKeyInput(gbaKeys);

    this.gba.runFrame();

    const pixels = new Uint32Array(240 * 160);
    pixels.set(this.gba.ppu.framebuffer);

    return {
      pixels,
      frameStartBlank: false
    };
  }

  async reset(): Promise<void> {
    if (this.biosData) {
      this.gba.reset();
    } else {
      this.gba.directBoot();
    }
  }

  async enableAudio(): Promise<void> {
    // Audio is permanently detached for now
  }

  disableAudio(): void { }

  setAudioVolume(volume: number): void {
    this.audioVolume = volume;
  }

  setAudioTempo(tempo: number): void { }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = multiplier;
  }

  async createSaveState(): Promise<any> {
    return this.gba.saveState();
  }

  async loadSaveState(state: any): Promise<void> {
    this.gba.loadState(state);
  }

  async getDebugSnapshot(hexOffset: number = 0): Promise<any> {
    return {
      cpu: {
        r0: this.gba.cpu.r[0],
        r1: this.gba.cpu.r[1],
        r2: this.gba.cpu.r[2],
        r3: this.gba.cpu.r[3],
        r4: this.gba.cpu.r[4],
        r5: this.gba.cpu.r[5],
        r6: this.gba.cpu.r[6],
        r7: this.gba.cpu.r[7],
        r8: this.gba.cpu.r[8],
        r9: this.gba.cpu.r[9],
        r10: this.gba.cpu.r[10],
        r11: this.gba.cpu.r[11],
        r12: this.gba.cpu.r[12],
        sp: this.gba.cpu.r[13],
        lr: this.gba.cpu.r[14],
        pc: this.gba.cpu.r[15],
        cpsr: this.gba.cpu.cpsr,
        cycles: this.gba.cycles
      },
      isScreenBlank: false,
      bgMode: (this.gba.ppu.dispcnt & 7),
      screenDisplay: 0,
      disassembly: [],
      oam: [],
      cgram: [],
      hexData: []
    };
  }

  getStatus(): 'ready' | 'running' | 'stopped' {
    return this.romLoaded ? 'ready' : 'stopped';
  }

  getAudioContext(): AudioContext | null {
    return null;
  }

  getAudioNode(): AudioNode | null {
    return null;
  }

  getRomHeader(): any {
    return {
      title: 'Game Boy Advance',
      mapper: 'AGB-Cartridge',
      version: '1.0',
      checksum: 'N/A'
    };
  }

  destroy(): void { }
}

// Atari 2600 Implementation (Main Thread)
export class AtariEmulatorCore implements EmulatorCore {
  id = 'atari';
  name = 'Atari 2600';
  type: 'snes' | 'nes' | 'gb' | 'gbc' | 'gba' | 'atari' = 'atari';

  public bus: AtariBus;
  private controller: AtariController;
  private romLoaded = false;
  private speedMultiplier = 1;
  private audioVolume = 0.35;
  private status: 'ready' | 'running' | 'stopped' = 'stopped';
  private audioCtx: AudioContext | null = null;
  private audioNode: ScriptProcessorNode | null = null;
  private gainNode: GainNode | null = null;
  private audioEnabled = false;

  constructor() {
    this.bus = new AtariBus();
    this.controller = new AtariController();
  }

  async loadRom(data: ArrayBuffer): Promise<void> {
    const cart = new AtariCartridge(data);
    this.bus.insertCartridge(cart);
    this.bus.reset();
    this.romLoaded = true;
    this.status = 'ready';
  }

  runFrame(controllerState: number): { pixels: Uint32Array; frameStartBlank: boolean } {
    if (!this.romLoaded) throw new Error('ROM not loaded');

    // Map controller state
    this.controller.setControllerState(controllerState);
    this.bus.pia.controllerState = this.controller.state;

    // Run cycles until TIA signals a complete frame
    // 262 scanlines × 228 color-clocks = 59736 color-clocks per frame
    // CPU runs 1 cycle per 3 color-clocks → 19912 CPU cycles per frame
    const maxCycles = 25000; // safety cap
    this.bus.tia.frameComplete = false;
    let ran = 0;
    while (!this.bus.tia.frameComplete && ran < maxCycles) {
      if (!this.bus.cpu.wsyncHalt) {
        this.bus.cpu.clock();
      }
      this.bus.clock();
      ran++;
    }

    // Return the TIA framebuffer (160×262 rows, only 192 are normally visible)
    const pixels = new Uint32Array(160 * 192);
    pixels.set(this.bus.tia.framebuffer.subarray(0, 160 * 192));

    return {
      pixels,
      frameStartBlank: false
    };
  }

  async reset(): Promise<void> {
    this.bus.reset();
  }

  async enableAudio(): Promise<void> {
    if (this.audioEnabled) return;

    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.audioVolume;

      const bufferSize = 2048;
      this.audioNode = this.audioCtx.createScriptProcessor(bufferSize, 0, 2);

      const tia = this.bus.tia;
      const audioTempBuf = new Float32Array(8192);

      this.audioNode.onaudioprocess = (e: AudioProcessingEvent) => {
        const output = e.outputBuffer;
        const leftData = output.getChannelData(0);
        const rightData = output.getChannelData(1);
        const samplesNeeded = output.length;

        if (!this.audioEnabled || !tia) {
          leftData.fill(0);
          rightData.fill(0);
          return;
        }

        // TIA audio not yet implemented – output silence
        leftData.fill(0);
        rightData.fill(0);
      };

      this.audioNode.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    this.audioEnabled = true;
  }

  disableAudio(): void {
    this.audioEnabled = false;
  }

  setAudioVolume(volume: number): void {
    this.audioVolume = volume;
    if (this.gainNode) {
      this.gainNode.gain.value = volume;
    }
  }

  setAudioTempo(tempo: number): void { }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier = multiplier;
  }

  async createSaveState(): Promise<any> {
    if (!this.romLoaded) return null;

    return {
      coreId: 'atari',
      cpu: {
        a: this.bus.cpu.a,
        x: this.bus.cpu.x,
        y: this.bus.cpu.y,
        sp: this.bus.cpu.sp,
        pc: this.bus.cpu.pc,
        status: this.bus.cpu.status,
        cycles: this.bus.cpu.cycles,
        totalCycles: this.bus.cpu.totalCycles
      },
      piaRam: Array.from(this.bus.pia.ram),
      tia: {
        scanline: this.bus.tia.scanline,
        cycles: this.bus.tia.cycles,
        frame: this.bus.tia.frame,
        colubk: this.bus.tia.colubk,
        colupf: this.bus.tia.colupf,
        colup0: this.bus.tia.colup0,
        colup1: this.bus.tia.colup1,
        pf0: this.bus.tia.pf0,
        pf1: this.bus.tia.pf1,
        pf2: this.bus.tia.pf2,
        p0graphic: this.bus.tia.p0graphic,
        p1graphic: this.bus.tia.p1graphic,
        p0hpos: this.bus.tia.p0hpos,
        p1hpos: this.bus.tia.p1hpos
      },
      cart: {
        mapper: this.bus.cart?.mapper,
        currentBank: this.bus.cart?.currentBank
      }
    };
  }

  async loadSaveState(state: any): Promise<void> {
    if (!state || state.coreId !== 'atari' || !this.romLoaded) return;

    // Restore CPU
    this.bus.cpu.a = state.cpu.a;
    this.bus.cpu.x = state.cpu.x;
    this.bus.cpu.y = state.cpu.y;
    this.bus.cpu.sp = state.cpu.sp;
    this.bus.cpu.pc = state.cpu.pc;
    this.bus.cpu.status = state.cpu.status;
    this.bus.cpu.cycles = state.cpu.cycles;
    this.bus.cpu.totalCycles = state.cpu.totalCycles;

    // Restore PIA RAM
    this.bus.pia.ram.set(state.piaRam);

    // Restore TIA
    this.bus.tia.scanline = state.tia.scanline;
    this.bus.tia.cycles = state.tia.cycles;
    this.bus.tia.frame = state.tia.frame;
    this.bus.tia.colubk = state.tia.colubk;
    this.bus.tia.colupf = state.tia.colupf;
    this.bus.tia.colup0 = state.tia.colup0;
    this.bus.tia.colup1 = state.tia.colup1;
    this.bus.tia.pf0 = state.tia.pf0;
    this.bus.tia.pf1 = state.tia.pf1;
    this.bus.tia.pf2 = state.tia.pf2;
    this.bus.tia.p0graphic = state.tia.p0graphic;
    this.bus.tia.p1graphic = state.tia.p1graphic;
    this.bus.tia.p0hpos = state.tia.p0hpos;
    this.bus.tia.p1hpos = state.tia.p1hpos;

    // Restore Cartridge
    if (this.bus.cart && state.cart) {
      this.bus.cart.mapper = state.cart.mapper;
      this.bus.cart.currentBank = state.cart.currentBank;
    }
  }

  async getDebugSnapshot(hexOffset: number = 0): Promise<any> {
    return {
      cpu: {
        a: this.bus.cpu.a,
        x: this.bus.cpu.x,
        y: this.bus.cpu.y,
        sp: this.bus.cpu.sp,
        pc: this.bus.cpu.pc,
        status: this.bus.cpu.status,
        cycles: this.bus.cpu.totalCycles
      },
      isScreenBlank: false,
      bgMode: 0,
      screenDisplay: 0,
      disassembly: [],
      oam: [],
      cgram: [],
      hexData: []
    };
  }

  getStatus(): 'ready' | 'running' | 'stopped' {
    return this.romLoaded ? 'ready' : 'stopped';
  }

  getAudioContext(): AudioContext | null {
    return this.audioCtx;
  }

  getAudioNode(): AudioNode | null {
    return this.gainNode;
  }

  getRomHeader(): any {
    if (!this.bus.cart) return null;
    return {
      title: 'Atari 2600',
      mapper: this.bus.cart.mapper,
      version: '1.0',
      checksum: 'N/A'
    };
  }

  destroy(): void {
    this.disableAudio();
    if (this.audioNode) {
      this.audioNode.disconnect();
    }
    if (this.audioCtx) {
      this.audioCtx.close();
    }
  }
}
