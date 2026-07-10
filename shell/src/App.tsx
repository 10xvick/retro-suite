import React, { useState, useEffect, useRef } from 'react';
import { EmulatorManager, EmulatorCoreFactory, EmulatorCore, RetroStationDB, SnesEmulatorCore, NesEmulatorCore, GbEmulatorCore } from './emulator';
import { InputHandler } from 'snes-core';
import type { SavedRom } from './emulator';
import { Play, Pause, RotateCcw, SkipForward, Cpu, ImageIcon, Grid, List, Upload, FileText, Save, Maximize, Minimize, PanelLeft, PanelRight, X, Settings, Check, AlertCircle, RefreshCw, Monitor } from './icons';
import { PixelPlay, PixelPause, PixelRotateCcw, PixelSkipForward, PixelSettings, PixelX, PixelCheck, PixelPanelLeft, PixelPanelRight, PixelUpload, PixelMaximize, PixelMinimize, PixelCpu, PixelRefreshCw, PixelAlertCircle, PixelMonitor } from './pixel-icons';
import { KeyMapper } from './KeyMapper';
import { ExporterPanel } from './components/ExporterPanel';

type ThemeId = 'crt' | 'nes' | 'gameboy' | 'sfc' | 'vaporwave';
const THEMES: Record<ThemeId, { name: string; swatch: string[] }> = {
  crt: { name: 'CRT Station', swatch: ['#050510', 'var(--accent)', '#f6a626'] },
  nes: { name: 'NES Classic', swatch: ['#2c2c2c', '#e80000', '#d4a017'] },
  gameboy: { name: 'Game Boy', swatch: ['#9bbc0f', '#0f380f', '#306230'] },
  sfc: { name: 'Super Famicom', swatch: ['#3a2a4a', '#c0a0e0', '#a0b0d0'] },
  vaporwave: { name: 'Vaporwave', swatch: ['#15002a', '#ff00aa', '#00ffff'] },
};

// Define types for UI state
interface EmulatorState {
  romName: string;
  romSize: string;
  romInfo: {
    title: string;
    mapper: string;
    version: string;
    checksum: string;
  };
  isRunning: boolean;
  fps: number;
  speedMultiplier: number;
  audioEnabled: boolean;
  audioVolume: number;
  audioTempo: number;
  isScreenBlank: boolean;
  bgMode: number;
  screenDisplay: number;
  cpuState: any;
  disassemblyList: any[];
  oamList: any[];
  cgramList: number[];
  vramPage: number;
  hexOffset: number;
  hexData: number[];
  saveSlots: any[];
}

const getCoreDimensions = (coreId: string) => {
  if (coreId === 'nes') return { w: 256, h: 240 };
  if (coreId === 'gb' || coreId === 'gbc') return { w: 160, h: 144 };
  if (coreId === 'gba') return { w: 240, h: 160 };
  return { w: 256, h: 224 };
};

interface TestItem {
  id: string;
  name: string;
  coreId: string;
  path: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  message?: string;
}

const TEST_ROM_LIST: TestItem[] = [
  // Game Boy (GBC) Tests
  { id: 'gb-cpu', name: 'GB CPU Instructions', coreId: 'gbc', path: '/emulator/retro-station/tests/cpu_instrs.gb', status: 'pending' },
  { id: 'gb-timing', name: 'GB Instruction Timing', coreId: 'gbc', path: '/emulator/retro-station/tests/instr_timing.gb', status: 'pending' },
  { id: 'gb-spec', name: 'GB Special Instructions', coreId: 'gbc', path: '/emulator/retro-station/tests/01-special.gb', status: 'pending' },
  { id: 'gb-ints', name: 'GB Interrupts Test', coreId: 'gbc', path: '/emulator/retro-station/tests/02-interrupts.gb', status: 'pending' },
  { id: 'gb-sphl', name: 'GB OP SP,HL', coreId: 'gbc', path: '/emulator/retro-station/tests/03-op sp,hl.gb', status: 'pending' },
  { id: 'gb-rimm', name: 'GB OP R,IMM', coreId: 'gbc', path: '/emulator/retro-station/tests/04-op r,imm.gb', status: 'pending' },
  { id: 'gb-orp', name: 'GB OP RP', coreId: 'gbc', path: '/emulator/retro-station/tests/05-op rp.gb', status: 'pending' },
  { id: 'gb-ldrr', name: 'GB LD R,R', coreId: 'gbc', path: '/emulator/retro-station/tests/06-ld r,r.gb', status: 'pending' },
  { id: 'gb-jump', name: 'GB JR,JP,CALL,RET,RST', coreId: 'gbc', path: '/emulator/retro-station/tests/07-jr,jp,call,ret,rst.gb', status: 'pending' },
  { id: 'gb-misc', name: 'GB Misc Instructions', coreId: 'gbc', path: '/emulator/retro-station/tests/08-misc instrs.gb', status: 'pending' },
  { id: 'gb-oprr', name: 'GB OP R,R', coreId: 'gbc', path: '/emulator/retro-station/tests/09-op r,r.gb', status: 'pending' },
  { id: 'gb-bits', name: 'GB Bit Operations', coreId: 'gbc', path: '/emulator/retro-station/tests/10-bit ops.gb', status: 'pending' },
  { id: 'gb-ophl', name: 'GB OP A,(HL)', coreId: 'gbc', path: '/emulator/retro-station/tests/11-op a,(hl).gb', status: 'pending' },
  { id: 'gb-rtim', name: 'GB Read Timing', coreId: 'gbc', path: '/emulator/retro-station/tests/01-read_timing.gb', status: 'pending' },
  { id: 'gb-wtim', name: 'GB Write Timing', coreId: 'gbc', path: '/emulator/retro-station/tests/02-write_timing.gb', status: 'pending' },
  { id: 'gb-mtim', name: 'GB Modify Timing', coreId: 'gbc', path: '/emulator/retro-station/tests/03-modify_timing.gb', status: 'pending' },
  { id: 'gb-memt', name: 'GB Memory Timing', coreId: 'gbc', path: '/emulator/retro-station/tests/mem_timing.gb', status: 'pending' },

  // NES Tests
  { id: 'nes-basics', name: 'NES Basics Test', coreId: 'nes', path: '/emulator/retro-station/tests/01-basics.nes', status: 'pending' },
  { id: 'nes-implied', name: 'NES Implied Opcodes', coreId: 'nes', path: '/emulator/retro-station/tests/02-implied.nes', status: 'pending' },
  { id: 'nes-imm', name: 'NES Immediate Opcodes', coreId: 'nes', path: '/emulator/retro-station/tests/03-immediate.nes', status: 'pending' },
  { id: 'nes-zp', name: 'NES Zero Page Opcodes', coreId: 'nes', path: '/emulator/retro-station/tests/04-zero_page.nes', status: 'pending' },
  { id: 'nes-zpxy', name: 'NES ZP X,Y Opcodes', coreId: 'nes', path: '/emulator/retro-station/tests/05-zp_xy.nes', status: 'pending' },
  { id: 'nes-abs', name: 'NES Absolute Opcodes', coreId: 'nes', path: '/emulator/retro-station/tests/06-absolute.nes', status: 'pending' },
  { id: 'nes-absxy', name: 'NES ABS X,Y Opcodes', coreId: 'nes', path: '/emulator/retro-station/tests/07-abs_xy.nes', status: 'pending' },
  { id: 'nes-indx', name: 'NES Indirect X Opcodes', coreId: 'nes', path: '/emulator/retro-station/tests/08-ind_x.nes', status: 'pending' },
  { id: 'nes-indy', name: 'NES Indirect Y Opcodes', coreId: 'nes', path: '/emulator/retro-station/tests/09-ind_y.nes', status: 'pending' },
  { id: 'nes-branches', name: 'NES Branches', coreId: 'nes', path: '/emulator/retro-station/tests/10-branches.nes', status: 'pending' },
  { id: 'nes-stack', name: 'NES Stack Instructions', coreId: 'nes', path: '/emulator/retro-station/tests/11-stack.nes', status: 'pending' },
  { id: 'nes-jmp', name: 'NES Jmp/Jsr Instructions', coreId: 'nes', path: '/emulator/retro-station/tests/12-jmp_jsr.nes', status: 'pending' },
  { id: 'nes-rts', name: 'NES Rts Instruction', coreId: 'nes', path: '/emulator/retro-station/tests/13-rts.nes', status: 'pending' },
  { id: 'nes-rti', name: 'NES Rti Instruction', coreId: 'nes', path: '/emulator/retro-station/tests/14-rti.nes', status: 'pending' },
  { id: 'nes-brk', name: 'NES Brk Instruction', coreId: 'nes', path: '/emulator/retro-station/tests/15-brk.nes', status: 'pending' },
  { id: 'nes-spec', name: 'NES Special Opcodes', coreId: 'nes', path: '/emulator/retro-station/tests/16-special.nes', status: 'pending' },
  { id: 'nes-len-ctr', name: 'NES APU Len Ctr', coreId: 'nes', path: '/emulator/retro-station/tests/1-len_ctr.nes', status: 'pending' },
  { id: 'nes-len-table', name: 'NES APU Len Table', coreId: 'nes', path: '/emulator/retro-station/tests/2-len_table.nes', status: 'pending' },
  { id: 'nes-irq-flag', name: 'NES APU IRQ Flag', coreId: 'nes', path: '/emulator/retro-station/tests/3-irq_flag.nes', status: 'pending' },
  { id: 'nes-jitter', name: 'NES APU Jitter', coreId: 'nes', path: '/emulator/retro-station/tests/4-jitter.nes', status: 'pending' },
  { id: 'nes-len-timing', name: 'NES APU Len Timing', coreId: 'nes', path: '/emulator/retro-station/tests/5-len_timing.nes', status: 'pending' },
  { id: 'nes-irq-timing', name: 'NES APU IRQ Timing', coreId: 'nes', path: '/emulator/retro-station/tests/6-irq_flag_timing.nes', status: 'pending' },
  { id: 'nes-dmc-basics', name: 'NES APU DMC Basics', coreId: 'nes', path: '/emulator/retro-station/tests/7-dmc_basics.nes', status: 'pending' },
  { id: 'nes-dmc-rates', name: 'NES APU DMC Rates', coreId: 'nes', path: '/emulator/retro-station/tests/8-dmc_rates.nes', status: 'pending' },
  { id: 'nes-apu-test', name: 'NES APU Combined Test', coreId: 'nes', path: '/emulator/retro-station/tests/apu_test.nes', status: 'pending' },

  // SNES Tests
  { id: 'snes-adc', name: 'SNES CPU ADC Math', coreId: 'snes', path: '/emulator/retro-station/tests/CPUADC.sfc', status: 'pending' },
  { id: 'snes-and', name: 'SNES CPU AND Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUAND.sfc', status: 'pending' },
  { id: 'snes-asl', name: 'SNES CPU ASL Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUASL.sfc', status: 'pending' },
  { id: 'snes-bit', name: 'SNES CPU BIT Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUBIT.sfc', status: 'pending' },
  { id: 'snes-bra', name: 'SNES CPU BRA Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUBRA.sfc', status: 'pending' },
  { id: 'snes-cmp', name: 'SNES CPU CMP Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUCMP.sfc', status: 'pending' },
  { id: 'snes-dec', name: 'SNES CPU DEC Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUDEC.sfc', status: 'pending' },
  { id: 'snes-eor', name: 'SNES CPU EOR Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUEOR.sfc', status: 'pending' },
  { id: 'snes-inc', name: 'SNES CPU INC Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUINC.sfc', status: 'pending' },
  { id: 'snes-jmp', name: 'SNES CPU JMP Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUJMP.sfc', status: 'pending' },
  { id: 'snes-ldr', name: 'SNES CPU LDR Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPULDR.sfc', status: 'pending' },
  { id: 'snes-lsr', name: 'SNES CPU LSR Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPULSR.sfc', status: 'pending' },
  { id: 'snes-mov', name: 'SNES CPU MOV Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUMOV.sfc', status: 'pending' },
  { id: 'snes-msc', name: 'SNES CPU MSC Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUMSC.sfc', status: 'pending' },
  { id: 'snes-ora', name: 'SNES CPU ORA Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUORA.sfc', status: 'pending' },
  { id: 'snes-phl', name: 'SNES CPU PHL Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUPHL.sfc', status: 'pending' },
  { id: 'snes-psr', name: 'SNES CPU PSR Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUPSR.sfc', status: 'pending' },
  { id: 'snes-ret', name: 'SNES CPU RET Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPURET.sfc', status: 'pending' },
  { id: 'snes-rol', name: 'SNES CPU ROL Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUROL.sfc', status: 'pending' },
  { id: 'snes-ror', name: 'SNES CPU ROR Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUROR.sfc', status: 'pending' },
  { id: 'snes-sbc', name: 'SNES CPU SBC Math', coreId: 'snes', path: '/emulator/retro-station/tests/CPUSBC.sfc', status: 'pending' },
  { id: 'snes-str', name: 'SNES CPU STR Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUSTR.sfc', status: 'pending' },
  { id: 'snes-trn', name: 'SNES CPU TRN Instruction', coreId: 'snes', path: '/emulator/retro-station/tests/CPUTRN.sfc', status: 'pending' },
  { id: 'snes-spc-adc', name: 'SNES SPC700 ADC', coreId: 'snes', path: '/emulator/retro-station/tests/SPC700ADC.sfc', status: 'pending' },
  { id: 'snes-spc-and', name: 'SNES SPC700 AND', coreId: 'snes', path: '/emulator/retro-station/tests/SPC700AND.sfc', status: 'pending' },
  { id: 'snes-spc-dec', name: 'SNES SPC700 DEC', coreId: 'snes', path: '/emulator/retro-station/tests/SPC700DEC.sfc', status: 'pending' },
  { id: 'snes-spc-eor', name: 'SNES SPC700 EOR', coreId: 'snes', path: '/emulator/retro-station/tests/SPC700EOR.sfc', status: 'pending' },
  { id: 'snes-spc-inc', name: 'SNES SPC700 INC', coreId: 'snes', path: '/emulator/retro-station/tests/SPC700INC.sfc', status: 'pending' },
  { id: 'snes-spc-ora', name: 'SNES SPC700 ORA', coreId: 'snes', path: '/emulator/retro-station/tests/SPC700ORA.sfc', status: 'pending' },
  { id: 'snes-spc-sbc', name: 'SNES SPC700 SBC', coreId: 'snes', path: '/emulator/retro-station/tests/SPC700SBC.sfc', status: 'pending' },
  { id: 'snes-dma-irq', name: 'SNES DMA IRQ Test', coreId: 'snes', path: '/emulator/retro-station/tests/dma_irq_test.sfc', status: 'pending' },
  { id: 'snes-op-timing', name: 'SNES Op Timing Test', coreId: 'snes', path: '/emulator/retro-station/tests/op_timing_test_v2.sfc', status: 'pending' },
  { id: 'snes-timing', name: 'SNES Timing Test', coreId: 'snes', path: '/emulator/retro-station/tests/timing_test.sfc', status: 'pending' },
  { id: 'snes-hvdma', name: 'SNES H-Blank DMA Test', coreId: 'snes', path: '/emulator/retro-station/tests/hvdma.sfc', status: 'pending' },
  { id: 'snes-hvdma-max', name: 'SNES H-Blank DMA Max Test', coreId: 'snes', path: '/emulator/retro-station/tests/hvdma_max.sfc', status: 'pending' },
  { id: 'snes-hblank-emu', name: 'SNES H-Blank Emulator Test', coreId: 'snes', path: '/emulator/retro-station/tests/HblankEmuTest.sfc', status: 'pending' },
  { id: 'snes-split-screen', name: 'SNES Split Screen Test', coreId: 'snes', path: '/emulator/retro-station/tests/SplitScreen.sfc', status: 'pending' },
  { id: 'snes-test-math', name: 'SNES Hardware Math Test', coreId: 'snes', path: '/emulator/retro-station/tests/test_math.sfc', status: 'pending' },
  { id: 'snes-test-mul', name: 'SNES Hardware Mul Test', coreId: 'snes', path: '/emulator/retro-station/tests/test_mul.sfc', status: 'pending' },
  { id: 'snes-test-oam', name: 'SNES OAM Test', coreId: 'snes', path: '/emulator/retro-station/tests/test_oam.smc', status: 'pending' },
  { id: 'snes-test-tsc', name: 'SNES Cycle Timing Test', coreId: 'snes', path: '/emulator/retro-station/tests/snes_test_tsc.smc', status: 'pending' },
];

const checkSnesResult = (vram: Uint16Array) => {
  let hasPass = false;
  let hasFail = false;
  for (let i = 0; i < vram.length - 4; i++) {
    if (
      (vram[i] & 0xFF) === 0x46 && // F
      (vram[i+1] & 0xFF) === 0x41 && // A
      (vram[i+2] & 0xFF) === 0x49 && // I
      (vram[i+3] & 0xFF) === 0x4C    // L
    ) {
      hasFail = true;
    }
    if (
      (vram[i] & 0xFF) === 0x50 && // P
      (vram[i+1] & 0xFF) === 0x41 && // A
      (vram[i+2] & 0xFF) === 0x53 && // S
      (vram[i+3] & 0xFF) === 0x53    // S
    ) {
      hasPass = true;
    }
  }
  if (hasFail) return 'FAIL';
  if (hasPass) return 'PASS';
  return 'RUNNING';
};

const checkNesResult = (bus: any) => {
  const status = bus.cpuRead(0x6000);
  if (status === 0x80) return 'RUNNING';
  if (status === 0x00) return 'PASS';
  if (status > 0 && status < 0x80) {
    let str = '';
    let addr = 0x6004;
    while (true) {
      const char = bus.cpuRead(addr++);
      if (char === 0 || char === 0x0A || char === 0x0D || addr > 0x6080) break;
      str += String.fromCharCode(char);
    }
    return `FAIL: ${str}`;
  }
  return 'RUNNING';
};

const runSingleTest = async (test: TestItem): Promise<{ passed: boolean; message?: string }> => {
  const response = await fetch(test.path);
  if (!response.ok) {
    return { passed: false, message: `Fetch failed: ${response.statusText}` };
  }
  const buffer = await response.arrayBuffer();

  let core: EmulatorCore;
  if (test.coreId === 'snes') {
    core = EmulatorCoreFactory.createSnesCore();
  } else if (test.coreId === 'nes') {
    core = EmulatorCoreFactory.createNesCore();
  } else if (test.coreId === 'gb') {
    core = EmulatorCoreFactory.createGbcCore();
  } else {
    return { passed: false, message: `Unsupported core ${test.coreId}` };
  }

  await core.loadRom(buffer);
  await core.reset();
  core.disableAudio();

  let gbOutput = '';
  if (test.coreId === 'gb') {
    const gbInstance = (core as GbEmulatorCore).gb;
    gbInstance.serial.setByteHandler((byte) => {
      gbOutput += String.fromCharCode(byte);
    });
  }

  const maxFrames = 3500;
  let passed = false;
  let statusMsg = '';

  for (let frame = 0; frame < maxFrames; frame++) {
    const frameResult = core.runFrame(0);
    const res = frameResult instanceof Promise ? await frameResult : frameResult;

    if (test.coreId === 'snes') {
      const snesInstance = (core as SnesEmulatorCore).emulator;
      const vram = snesInstance['ppu'].vram;
      const snesResult = checkSnesResult(vram);
      if (snesResult === 'PASS') {
        passed = true;
        break;
      } else if (snesResult === 'FAIL') {
        passed = false;
        statusMsg = 'VRAM status reported FAIL';
        break;
      }
    } else if (test.coreId === 'nes') {
      const nesInstance = core as NesEmulatorCore;
      const nesResult = checkNesResult(nesInstance.bus);
      if (nesResult === 'PASS') {
        passed = true;
        break;
      } else if (nesResult.startsWith('FAIL')) {
        passed = false;
        statusMsg = nesResult;
        break;
      }
    } else if (test.coreId === 'gb') {
      if (gbOutput.toLowerCase().includes('passed') || gbOutput.toLowerCase().includes('success')) {
        passed = true;
        break;
      } else if (gbOutput.toLowerCase().includes('failed')) {
        passed = false;
        statusMsg = gbOutput.split('\n').filter(l => l.toLowerCase().includes('fail')).join(' ') || 'Serial output reported failure';
        break;
      }
    }

    if (frame % 400 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  if (!passed && !statusMsg) {
    if (test.coreId === 'gb') {
      if (gbOutput.toLowerCase().includes('passed') || gbOutput.toLowerCase().includes('success')) {
        passed = true;
      } else {
        statusMsg = gbOutput.trim().substring(0, 80) || 'Timeout';
      }
    } else {
      statusMsg = 'Timeout';
    }
  }

  core.destroy();
  return { passed, message: statusMsg };
};


export default function App() {
  const [emulatorManager] = useState(() => new EmulatorManager());
  const [activeCoreId, setActiveCoreId] = useState<string>('snes');
  const [testSuite, setTestSuite] = useState<TestItem[]>(TEST_ROM_LIST);
  const [isRunningAllTests, setIsRunningAllTests] = useState(false);
  const isRunningTestRef = useRef<boolean>(false);
  const startTimeRef = useRef<number>(0);

  const [runningLiveTestId, setRunningLiveTestId] = useState<string | null>(null);

  const loadAndRunTestLive = async (test: TestItem) => {
    try {
      isRunningTestRef.current = true;
      startTimeRef.current = Date.now();
      const response = await fetch(test.path);
      if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
      const buffer = await response.arrayBuffer();

      setActiveCoreId(test.coreId);
      await new Promise(r => setTimeout(r, 150));

      const core = emulatorInstance.current;
      if (!core || core.id !== test.coreId) {
        await new Promise(r => setTimeout(r, 200));
      }

      const targetCore = emulatorInstance.current;
      if (!targetCore) throw new Error('Failed to initialize active core');

      await targetCore.loadRom(buffer);
      await targetCore.reset();
      
      if (emulatorState.audioEnabled) {
        await targetCore.enableAudio();
      } else {
        targetCore.disableAudio();
      }

      setEmulatorState(prev => ({
        ...prev,
        romName: test.path.split('/').pop() || test.name,
        romSize: `${(buffer.byteLength / 1024).toFixed(0)} KB`,
        romInfo: {
          title: test.name.toUpperCase(),
          mapper: test.coreId.toUpperCase() + ' TEST',
          version: '1.0',
          checksum: 'TEST'
        },
        isRunning: true
      }));
    } catch (err: any) {
      isRunningTestRef.current = false;
      alert(`Error loading test ROM: ${err.message}`);
    }
  };

  useEffect(() => {
    if (!runningLiveTestId) {
      isRunningTestRef.current = false;
      return;
    }
    
    const activeTest = testSuite.find(t => t.id === runningLiveTestId);
    if (!activeTest) {
      isRunningTestRef.current = false;
      return;
    }

    let isSubscribed = true;
    isRunningTestRef.current = true;
    startTimeRef.current = Date.now();
    setTestSuite(prev => prev.map(t => t.id === runningLiveTestId ? { ...t, status: 'running', message: undefined } : t));

    let lastPc = -1;
    let stablePcCount = 0;

    const checkInterval = setInterval(() => {
      if (!isSubscribed) return;

      const core = emulatorInstance.current;
      if (!core || core.id !== activeTest.coreId) return;

      if (activeTest.coreId === 'snes') {
        const snesInstance = (core as SnesEmulatorCore).emulator;
        const vram = snesInstance['ppu'].vram;
        const result = checkSnesResult(vram);
        if (result === 'PASS') {
          setTestSuite(prev => prev.map(t => t.id === runningLiveTestId ? { ...t, status: 'passed' } : t));
          setRunningLiveTestId(null);
          isRunningTestRef.current = false;
        } else if (result === 'FAIL') {
          setTestSuite(prev => prev.map(t => t.id === runningLiveTestId ? { ...t, status: 'failed', message: 'VRAM reported FAIL' } : t));
          setRunningLiveTestId(null);
          isRunningTestRef.current = false;
        } else {
          // Check for blank screen (from finishTest) OR stuck Program Counter (from forever loop)
          const ppu = snesInstance['ppu'];
          const currentPc = snesInstance['cpu'].pc;
          const isBlanked = (ppu.screenDisplay & 0x80) !== 0;

          if (currentPc === lastPc) {
            stablePcCount++;
          } else {
            lastPc = currentPc;
            stablePcCount = 0;
          }

          if (Date.now() - startTimeRef.current > 1500 && (isBlanked || stablePcCount >= 10)) {
            setTestSuite(prev => prev.map(t => t.id === runningLiveTestId ? { ...t, status: 'passed' } : t));
            setRunningLiveTestId(null);
            isRunningTestRef.current = false;
          }
        }
      } else if (activeTest.coreId === 'nes') {
        const nesInstance = core as NesEmulatorCore;
        const result = checkNesResult(nesInstance.bus);
        if (result === 'PASS') {
          setTestSuite(prev => prev.map(t => t.id === runningLiveTestId ? { ...t, status: 'passed' } : t));
          setRunningLiveTestId(null);
          isRunningTestRef.current = false;
        } else if (result.startsWith('FAIL')) {
          setTestSuite(prev => prev.map(t => t.id === runningLiveTestId ? { ...t, status: 'failed', message: result } : t));
          setRunningLiveTestId(null);
          isRunningTestRef.current = false;
        }
      } else if (activeTest.coreId === 'gb' || activeTest.coreId === 'gbc') {
        const gbInstance = core as GbEmulatorCore;
        const gbOutput = gbInstance.serialLog;
        if (gbOutput.toLowerCase().includes('passed') || gbOutput.toLowerCase().includes('success')) {
          setTestSuite(prev => prev.map(t => t.id === runningLiveTestId ? { ...t, status: 'passed' } : t));
          setRunningLiveTestId(null);
          isRunningTestRef.current = false;
        } else if (gbOutput.toLowerCase().includes('failed')) {
          const statusMsg = gbOutput.split('\n').filter(l => l.toLowerCase().includes('fail')).join(' ') || 'Serial failure';
          setTestSuite(prev => prev.map(t => t.id === runningLiveTestId ? { ...t, status: 'failed', message: statusMsg } : t));
          setRunningLiveTestId(null);
          isRunningTestRef.current = false;
        }
      }
    }, 100);

    return () => {
      isSubscribed = false;
      clearInterval(checkInterval);
      isRunningTestRef.current = false;
    };
  }, [runningLiveTestId]);

  const runAllTests = async () => {
    setIsRunningAllTests(true);
    isRunningTestRef.current = true;

    // Filter tests to run only those matching the active core
    const activeTestsToRun = TEST_ROM_LIST.filter(t => {
      if (activeCoreId === 'gb' || activeCoreId === 'gbc') {
        return t.coreId === 'gb' || t.coreId === 'gbc';
      }
      return t.coreId === activeCoreId;
    });

    // Reset status for these specific tests in the suite
    setTestSuite(prev => prev.map(t => {
      const isMatch = (activeCoreId === 'gb' || activeCoreId === 'gbc') ? (t.coreId === 'gb' || t.coreId === 'gbc') : t.coreId === activeCoreId;
      return isMatch ? { ...t, status: 'pending' as const, message: undefined } : t;
    }));

    for (let i = 0; i < activeTestsToRun.length; i++) {
      const test = activeTestsToRun[i];
      setTestSuite(prev => prev.map(t => t.id === test.id ? { ...t, status: 'running' as const } : t));

      try {
        const response = await fetch(test.path);
        if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
        const buffer = await response.arrayBuffer();

        setActiveCoreId(test.coreId);
        await new Promise(r => setTimeout(r, 150));

        const core = emulatorInstance.current;
        if (!core || core.id !== test.coreId) {
          await new Promise(r => setTimeout(r, 200));
        }

        const targetCore = emulatorInstance.current;
        if (!targetCore) throw new Error('Failed to initialize active core');

        await targetCore.loadRom(buffer);
        await targetCore.reset();
        targetCore.disableAudio();

        setEmulatorState(prev => ({
          ...prev,
          romName: test.path.split('/').pop() || test.name,
          romSize: `${(buffer.byteLength / 1024).toFixed(0)} KB`,
          romInfo: {
            title: test.name.toUpperCase(),
            mapper: test.coreId.toUpperCase() + ' TEST',
            version: '1.0',
            checksum: 'TEST'
          },
          isRunning: true
        }));

        let passed = false;
        let statusMsg = '';
        const maxTimeout = 8000;
        const startTime = Date.now();
        let lastPc = -1;
        let stablePcCount = 0;

        while (Date.now() - startTime < maxTimeout) {
          await new Promise(r => setTimeout(r, 100));
          
          const currentCore = emulatorInstance.current;
          if (!currentCore || currentCore.id !== test.coreId) continue;

          if (test.coreId === 'snes') {
            const snesInstance = (currentCore as SnesEmulatorCore).emulator;
            const vram = snesInstance['ppu'].vram;
            const result = checkSnesResult(vram);
            if (result === 'PASS') { passed = true; break; }
            else if (result === 'FAIL') { passed = false; statusMsg = 'VRAM reported FAIL'; break; }
            else {
              const ppu = snesInstance['ppu'];
              const currentPc = snesInstance['cpu'].pc;
              const isBlanked = (ppu.screenDisplay & 0x80) !== 0;

              if (currentPc === lastPc) {
                stablePcCount++;
              } else {
                lastPc = currentPc;
                stablePcCount = 0;
              }

              if (Date.now() - startTime > 1500 && (isBlanked || stablePcCount >= 10)) {
                passed = true;
                break;
              }
            }
          } else if (test.coreId === 'nes') {
            const nesInstance = currentCore as NesEmulatorCore;
            const result = checkNesResult(nesInstance.bus);
            if (result === 'PASS') { passed = true; break; }
            else if (result.startsWith('FAIL')) { passed = false; statusMsg = result; break; }
          } else if (test.coreId === 'gb' || test.coreId === 'gbc') {
            const gbInstance = currentCore as GbEmulatorCore;
            const gbOutput = gbInstance.serialLog;
            if (gbOutput.toLowerCase().includes('passed') || gbOutput.toLowerCase().includes('success')) {
              passed = true;
              break;
            } else if (gbOutput.toLowerCase().includes('failed')) {
              passed = false;
              statusMsg = gbOutput.split('\n').filter(l => l.toLowerCase().includes('fail')).join(' ') || 'Serial failure';
              break;
            }
          }
        }

        if (!passed && !statusMsg && (test.coreId === 'gb' || test.coreId === 'gbc')) {
          const gbInstance = emulatorInstance.current as GbEmulatorCore;
          const gbOutput = gbInstance?.serialLog || '';
          if (gbOutput.toLowerCase().includes('passed') || gbOutput.toLowerCase().includes('success')) {
            passed = true;
          } else {
            statusMsg = gbOutput.trim().substring(0, 80) || 'Timeout';
          }
        } else if (!passed && !statusMsg) {
          statusMsg = 'Timeout';
        }

        setTestSuite(prev => prev.map(t => t.id === test.id ? {
          ...t,
          status: passed ? 'passed' : 'failed',
          message: statusMsg || undefined
        } : t));

      } catch (err: any) {
        setTestSuite(prev => prev.map(t => t.id === test.id ? {
          ...t,
          status: 'failed',
          message: err.message || 'Error occurred'
        } : t));
      }

      await new Promise(r => setTimeout(r, 500));
    }

    isRunningTestRef.current = false;
    setIsRunningAllTests(false);
  };
  const [emulatorState, setEmulatorState] = useState<EmulatorState>({
    romName: 'Loading...',
    romSize: '0 KB',
    romInfo: {
      title: '',
      mapper: '',
      version: '',
      checksum: ''
    },
    isRunning: false,
    fps: 60,
    speedMultiplier: 1,
    audioEnabled: localStorage.getItem('retro_station_default_audio') !== 'false',
    audioVolume: parseFloat(localStorage.getItem('retro_station_default_volume') || '0.35'),
    audioTempo: 1.0,
    isScreenBlank: false,
    bgMode: 1,
    screenDisplay: 0x80,
    cpuState: {
      a: 0, x: 0, y: 0, s: 0x1FF, d: 0, db: 0, pb: 0, pc: 0x8000, p: 0x30, e: 1
    },
    disassemblyList: [],
    oamList: [],
    cgramList: [],
    vramPage: 0,
    hexOffset: 0x0000,
    hexData: [],
    saveSlots: [null, null, null]
  });

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [footerOpen, setFooterOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aspectStretch, setAspectStretch] = useState(() => parseInt(localStorage.getItem('retro_station_default_aspect') || '0'));
  const stationRef = useRef<HTMLDivElement>(null);
  const savedPanelState = useRef({ left: true, right: true, footer: true });
  const [footerHeight, setFooterHeight] = useState(200);
  const [leftWidth, setLeftWidth] = useState(400);
  const [rightWidth, setRightWidth] = useState(400);
  const [enableAutosave, setEnableAutosave] = useState(() => localStorage.getItem('retro_station_enable_autosave') !== 'false');
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const leftDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const rightDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'cpu' | 'vram' | 'cgram' | 'oam' | 'hex'>('cpu');
  const [showKeyMapper, setShowKeyMapper] = useState(false);
  const [showExporter, setShowExporter] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isScreenBlank, setIsScreenBlank] = useState<boolean>(false);
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vramCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const emulatorInstance = useRef<EmulatorCore | null>(null);
  const inputHandlerRef = useRef<any>(null);
  const lastFrameTime = useRef<number>(0);
  
  // TAS / Input Automation States
  const automationStateRef = useRef<'idle' | 'recording' | 'playing'>('idle');
  const recordedInputsRef = useRef<Array<{ timestamp: number; input: number }>>([]);
  const recordedScreenshotsRef = useRef<Array<{ timestamp: number; uid: string }>>([]);
  const playbackInputIndexRef = useRef<number>(0);
  const accumulatedGameTimeRef = useRef<number>(0);

  const [automationUIState, setAutomationUIState] = useState<'idle' | 'recording' | 'playing'>('idle');
  const [recordedUIFrameCount, setRecordedUIFrameCount] = useState(0);
  const [playbackUIIndex, setPlaybackUIIndex] = useState(0);

  // Debug Save Path Setting
  const [savePath, setSavePath] = useState<string>(() => localStorage.getItem('retro_station_save_path') || '');

  // MediaRecorder for Video recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [theme, setTheme] = useState<ThemeId>(() => (localStorage.getItem('retro_station_theme') as ThemeId) || 'crt');
  const [pixelated, setPixelated] = useState(() => localStorage.getItem('retro_station_pixelated') === 'true');
  const [sliderConfigs, setSliderConfigs] = useState({
    speed: { min: 0.25, max: 5.0, step: 0.05 },
    volume: { min: 0.0, max: 1.0, step: 0.01 },
    tempo: { min: 0.25, max: 3.0, step: 0.05 },
    aspect: { min: 0, max: 100, step: 1 }
  });

  const speedMultiplierRef = useRef(1);
  useEffect(() => {
    speedMultiplierRef.current = emulatorState.speedMultiplier;
  }, [emulatorState.speedMultiplier]);

  useEffect(() => {
    const saved = localStorage.getItem('retro_station_slider_configs');
    if (saved) {
      try {
        setSliderConfigs(JSON.parse(saved));
      } catch (e) {
        console.warn('Failed to parse saved slider configs', e);
      }
    }
  }, []);

  const saveSliderConfigs = (newConfigs: typeof sliderConfigs) => {
    setSliderConfigs(newConfigs);
    localStorage.setItem('retro_station_slider_configs', JSON.stringify(newConfigs));
  };

  const resetSliderConfigs = () => {
    const defaults = {
      speed: { min: 0.25, max: 5.0, step: 0.05 },
      volume: { min: 0.0, max: 1.0, step: 0.01 },
      tempo: { min: 0.25, max: 3.0, step: 0.05 },
      aspect: { min: 0, max: 100, step: 1 }
    };
    saveSliderConfigs(defaults);
    
    setEmulatorState(prev => ({
      ...prev,
      speedMultiplier: Math.max(defaults.speed.min, Math.min(defaults.speed.max, prev.speedMultiplier)),
      audioVolume: Math.max(defaults.volume.min, Math.min(defaults.volume.max, prev.audioVolume)),
      audioTempo: Math.max(defaults.tempo.min, Math.min(defaults.tempo.max, prev.audioTempo))
    }));
    setAspectStretch(prev => Math.max(defaults.aspect.min, Math.min(defaults.aspect.max, prev)));
  };
  const uploadedFileRef = useRef<File | null>(null);
  const isRunningRef = useRef<boolean>(false);
  const crtFrameRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 480, h: 420 });

  const dbRef = useRef<RetroStationDB | null>(null);

  const loadSavedSlotsInfo = async (coreId: string) => {
    if (!dbRef.current) return;
    const slots = [null, null, null];
    for (let i = 0; i < 3; i++) {
      const state = await dbRef.current.getSlot(coreId, i);
      if (state) {
        slots[i] = true as any;
      }
    }
    setEmulatorState(prev => ({ ...prev, saveSlots: slots }));
  };

  const triggerAutosave = async () => {
    if (!enableAutosave) return;
    if (!emulatorInstance.current || !dbRef.current) return;
    try {
      const state = await emulatorInstance.current.createSaveState();
      await dbRef.current.saveAutosave(activeCoreId, state);
      console.log('Autosaved state for core:', activeCoreId);
    } catch (e) {
      console.warn('Failed to auto-save state:', e);
    }
  };

  // Initialize the emulator core and load database / settings
  useEffect(() => {
    // Register all available cores
    emulatorManager.registerCore(EmulatorCoreFactory.createSnesCore());
    emulatorManager.registerCore(EmulatorCoreFactory.createNesCore());
    emulatorManager.registerCore(EmulatorCoreFactory.createGbcCore());
    emulatorManager.registerCore(EmulatorCoreFactory.createGbaCore());
    
    // Initialize input handler
    const handler = new InputHandler();
    handler.attach();
    inputHandlerRef.current = handler;

    // Initialize database
    const db = new RetroStationDB();
    db.init().then(async () => {
      dbRef.current = db;
      
      const lastCore = await db.getSetting('lastPlayedCore') || 'snes';
      const lastRom = await db.getRom(lastCore);
      
      setActiveCoreId(lastCore);
      
      if (lastRom) {
        const currentCore = emulatorManager.getCoreById(lastCore);
        if (currentCore) {
          emulatorInstance.current = currentCore;
          await currentCore.loadRom(lastRom.data);
          
          const autosaveState = await db.getAutosave(lastCore);
          if (autosaveState) {
            try {
              await currentCore.loadSaveState(autosaveState);
              console.log('Restored from autosave state');
            } catch (e) {
              console.warn('Failed to restore autosave state', e);
            }
          }
          
          setEmulatorState(prev => ({
            ...prev,
            romName: lastRom.name,
            romSize: lastRom.size,
            romInfo: {
              title: lastRom.title,
              mapper: lastRom.mapper,
              version: lastRom.version,
              checksum: lastRom.checksum
            },
            isRunning: true
          }));
          await loadSavedSlotsInfo(lastCore);
        }
      } else {
        // Fallback to default ROM
        await loadDefaultRom(lastCore);
        const currentCore = emulatorManager.getCoreById(lastCore);
        if (currentCore) {
          emulatorInstance.current = currentCore;
          const autosaveState = await db.getAutosave(lastCore);
          if (autosaveState) {
            try {
              await currentCore.loadSaveState(autosaveState);
              console.log('Restored (default ROM) from autosave state');
              setEmulatorState(prev => ({ ...prev, isRunning: true }));
            } catch (e) {
              console.warn('Failed to restore autosave state', e);
            }
          }
        }
        await loadSavedSlotsInfo(lastCore);
      }
    }).catch(err => {
      console.error('Failed to initialize RetroStationDB:', err);
      // Fallback
      setActiveCoreId('snes');
      emulatorInstance.current = emulatorManager.getCoreById('snes');
      loadDefaultRom('snes');
    });
    
    return () => {
      handler.detach();
      emulatorManager.destroyAll();
    };
  }, []);

  const lastCoreIdRef = useRef<string>('snes');

  // Switch active emulator core
  useEffect(() => {
    if (isRunningTestRef.current) {
      const newCore = emulatorManager.getCoreById(activeCoreId);
      if (newCore) {
        emulatorInstance.current = newCore;
      }
      return;
    }

    if (!emulatorManager) return;
    
    const newCore = emulatorManager.getCoreById(activeCoreId);
    if (!newCore) return;
    
    // Auto-save previous core if running
    const prevCoreId = lastCoreIdRef.current;
    const prevCore = emulatorManager.getCoreById(prevCoreId);
    if (enableAutosave && dbRef.current && prevCore && emulatorState.isRunning && prevCoreId !== activeCoreId) {
      prevCore.createSaveState().then(state => {
        dbRef.current?.saveAutosave(prevCoreId, state);
        console.log('Auto-saved previous core:', prevCoreId);
      }).catch(e => console.warn('Auto-save failed:', e));
    }
    
    lastCoreIdRef.current = activeCoreId;
    dbRef.current?.setSetting('lastPlayedCore', activeCoreId);
    
    // Check if audio was enabled before switching
    const wasAudioEnabled = emulatorState.audioEnabled;
    
    // Stop current core
    if (emulatorInstance.current) {
      emulatorInstance.current.disableAudio();
      emulatorInstance.current.setSpeedMultiplier(1);
    }
    
    // Set new core
    emulatorInstance.current = newCore;
    
    // Reset UI state (preserve wasAudioEnabled!)
    setEmulatorState(prev => ({
      ...prev,
      romName: 'Loading...',
      romSize: '0 KB',
      romInfo: {
        title: '',
        mapper: '',
        version: '',
        checksum: ''
      },
      isRunning: false,
      fps: 60,
      speedMultiplier: 1,
      audioEnabled: wasAudioEnabled,
      audioVolume: prev.audioVolume,
      audioTempo: 1.0,
      isScreenBlank: false,
      bgMode: activeCoreId === 'snes' ? 1 : 0,
      screenDisplay: activeCoreId === 'snes' ? 0x80 : 0x00,
      cpuState: activeCoreId === 'snes' ? {
        a: 0, x: 0, y: 0, s: 0x1FF, d: 0, db: 0, pb: 0, pc: 0x8000, p: 0x30, e: 1
      } : activeCoreId === 'nes' ? {
        a: 0, x: 0, y: 0, pc: 0, stkp: 0, status: 0, cycles: 0
      } : {
        af: 0, bc: 0, de: 0, hl: 0, pc: 0, sp: 0, cycles: 0
      },
      disassemblyList: [],
      oamList: [],
      cgramList: [],
      vramPage: 0,
      hexOffset: 0x0000,
      hexData: [],
      saveSlots: [null, null, null]
    }));
    
    // Load last played ROM or default ROM for this core
    (async () => {
      if (!dbRef.current) return;
      const lastRom = await dbRef.current.getRom(activeCoreId);
      if (lastRom) {
        await newCore.loadRom(lastRom.data);
        const autosaveState = await dbRef.current.getAutosave(activeCoreId);
        if (autosaveState) {
          try {
            await newCore.loadSaveState(autosaveState);
            console.log('Restored new core from autosave state');
          } catch (e) {
            console.warn('Failed to restore autosave state', e);
          }
        }
        
        setEmulatorState(prev => ({
          ...prev,
          romName: lastRom.name,
          romSize: lastRom.size,
          romInfo: {
            title: lastRom.title,
            mapper: lastRom.mapper,
            version: lastRom.version,
            checksum: lastRom.checksum
          },
          isRunning: true
        }));
      } else {
        await loadDefaultRom(activeCoreId);
        const autosaveState = await dbRef.current.getAutosave(activeCoreId);
        if (autosaveState) {
          try {
            await newCore.loadSaveState(autosaveState);
            console.log('Restored new core (default ROM) from autosave state');
            setEmulatorState(prev => ({ ...prev, isRunning: true }));
          } catch (e) {
            console.warn('Failed to restore autosave state', e);
          }
        }
      }
      await loadSavedSlotsInfo(activeCoreId);
      
      // If audio was enabled previously, resume it after ROM loads
      if (wasAudioEnabled) {
        newCore.enableAudio().catch(() => {});
      }
    })();
  }, [activeCoreId]);

  // Listen for fullscreen changes (covers Escape key exit)
  useEffect(() => {
    const handler = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
      if (!isFs && stationRef.current) {
        stationRef.current.classList.remove('fullscreen');
        if (savedPanelState.current) {
          setLeftOpen(savedPanelState.current.left);
          setRightOpen(savedPanelState.current.right);
          setFooterOpen(savedPanelState.current.footer);
        }
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Measure CRT frame container size for linear stretch
  useEffect(() => {
    const el = crtFrameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Suspend/resume audio on tab visibility or window focus changes
  useEffect(() => {
    const handleInactive = () => {
      if (emulatorInstance.current) {
        emulatorInstance.current.disableAudio();
        triggerAutosave();
      }
    };
    
    const handleActive = () => {
      if (emulatorState.audioEnabled && emulatorInstance.current && emulatorState.isRunning) {
        emulatorInstance.current.enableAudio().catch(() => {});
      }
    };
    
    const handleVisibility = () => {
      if (document.hidden) {
        handleInactive();
      } else {
        handleActive();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleInactive);
    window.addEventListener('focus', handleActive);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleInactive);
      window.removeEventListener('focus', handleActive);
    };
  }, [emulatorState.audioEnabled, emulatorState.isRunning, activeCoreId]);

  // Robust document-level interaction audio auto-resumer
  useEffect(() => {
    const resumeAudio = () => {
      if (emulatorInstance.current && emulatorState.isRunning && emulatorState.audioEnabled) {
        emulatorInstance.current.enableAudio().catch(() => {});
        document.removeEventListener('click', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
      }
    };
    document.addEventListener('click', resumeAudio);
    document.addEventListener('keydown', resumeAudio);
    return () => {
      document.removeEventListener('click', resumeAudio);
      document.removeEventListener('keydown', resumeAudio);
    };
  }, [emulatorState.isRunning, emulatorState.audioEnabled]);

  // Main render loop
  useEffect(() => {
    if (!emulatorInstance.current || !emulatorManager) return;
    
    if (!emulatorState.isRunning) return;
    
    isRunningRef.current = true;
    
    let lastTime = performance.now();
    let frameAccumulator = 0;
    let debugFrameCounter = 0;
    
    const loop = async (timestamp: number) => {
      if (!isRunningRef.current) return;
      const emulator = emulatorInstance.current;
      if (!emulator) return;
      (window as any).emulator = emulator;
      
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      
      // Limit delta to avoid spiral of death (e.g. background tab)
      const actualDelta = Math.min(delta, 100.0);
      
      const targetFps = activeCoreId === 'gb' || activeCoreId === 'gbc' ? 59.7 : 60.098;
      const frameInterval = 1000 / targetFps;
      
      try {
        const controllerState = inputHandlerRef.current.getController1State();
        let lastFrameResult = null;
        
        // All cores run synchronously on the main thread (zero microtask yields)
        const speedMultiplier = speedMultiplierRef.current;
        frameAccumulator += actualDelta * speedMultiplier;
        
        let framesRun = 0;
        const maxFramesRun = Math.max(4, Math.ceil(4 * speedMultiplier));
        while (frameAccumulator >= frameInterval && framesRun < maxFramesRun) {
          let activeInput = controllerState;
          
          if (automationStateRef.current === 'playing') {
            while (playbackInputIndexRef.current < recordedInputsRef.current.length && 
                   recordedInputsRef.current[playbackInputIndexRef.current].timestamp <= accumulatedGameTimeRef.current) {
              playbackInputIndexRef.current++;
            }
            const activeIndex = Math.max(0, playbackInputIndexRef.current - 1);
            if (activeIndex < recordedInputsRef.current.length) {
              activeInput = recordedInputsRef.current[activeIndex].input;
            }
            if (playbackInputIndexRef.current >= recordedInputsRef.current.length) {
              automationStateRef.current = 'idle';
              setAutomationUIState('idle');
            }
          } else if (automationStateRef.current === 'recording') {
            recordedInputsRef.current.push({
              timestamp: accumulatedGameTimeRef.current,
              input: controllerState
            });
          }

          const res = emulator.runFrame(activeInput);
          lastFrameResult = res instanceof Promise ? await res : res;
          frameAccumulator -= frameInterval;
          framesRun++;
          debugFrameCounter++;
          
          accumulatedGameTimeRef.current += frameInterval;
        }

        if (automationStateRef.current === 'recording') {
          setRecordedUIFrameCount(recordedInputsRef.current.length);
        } else if (automationStateRef.current === 'playing') {
          setPlaybackUIIndex(Math.min(playbackInputIndexRef.current, recordedInputsRef.current.length));
        }
        
        if (lastFrameResult) {
          const { w, h } = getCoreDimensions(activeCoreId);
          if (mainCanvasRef.current) {
            const ctx = mainCanvasRef.current.getContext('2d')!;
            const imgData = ctx.createImageData(w, h);
            const pixelBuffer = new Uint32Array(imgData.data.buffer);
            if (pixelBuffer.length === lastFrameResult.pixels.length) {
              pixelBuffer.set(lastFrameResult.pixels);
            }
            ctx.putImageData(imgData, 0, 0);
          }
          
          setIsScreenBlank(lastFrameResult.frameStartBlank);
          
          // Update FPS state and debugger info occasionally (approx 30 frames)
          if (debugFrameCounter >= 30) {
            setEmulatorState(prev => ({ ...prev, fps: Math.round(1000 / Math.max(1, delta)) }));
            debugFrameCounter = 0;
            
            const snapshot = await emulator.getDebugSnapshot();
            setEmulatorState(prev => ({
              ...prev,
              cpuState: snapshot.cpu,
              isScreenBlank: snapshot.isScreenBlank,
              bgMode: snapshot.bgMode,
              screenDisplay: snapshot.screenDisplay,
              disassemblyList: snapshot.disassembly,
              oamList: snapshot.oam,
              cgramList: snapshot.cgram,
              hexData: snapshot.hexData
            }));
          }
        }
      } catch (err) {
        console.error('Emulation error:', err);
      }
      
      requestAnimationFrame(loop);
    };
    
    requestAnimationFrame(loop);
    
    return () => {
      isRunningRef.current = false;
    };
  }, [emulatorState.isRunning, activeCoreId]);

  // Handle ROM upload
  const handleRomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Auto-save before loading a new ROM
    if (emulatorInstance.current && emulatorState.isRunning) {
      triggerAutosave();
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      try {
        await emulatorInstance.current?.loadRom(buffer);
        uploadedFileRef.current = file;
        
        // Save ROM to IndexedDB!
        if (dbRef.current) {
          const romName = file.name;
          const romSize = `${(buffer.byteLength / 1024).toFixed(0)} KB`;
          const saved: SavedRom = {
            data: buffer,
            name: romName,
            size: romSize,
            title: file.name,
            mapper: 'Unknown',
            version: '',
            checksum: ''
          };
          await dbRef.current.saveRom(activeCoreId, saved);
          await dbRef.current.setSetting('lastPlayedCore', activeCoreId);
          // Clear any previous autosave state for this core on a new ROM upload
          await dbRef.current.clearAutosave(activeCoreId);
        }

        const header = (emulatorInstance.current as any)?.getRomHeader?.();
        setEmulatorState(prev => ({
          ...prev,
          romName: file.name,
          romSize: `${(buffer.byteLength / 1024).toFixed(0)} KB`,
          romInfo: {
            title: header?.title || file.name,
            mapper: header?.mapper || 'Unknown',
            version: header?.version || '',
            checksum: header?.checksum || ''
          }
        }));
        setEmulatorState(prev => ({ ...prev, isRunning: true }));
        await loadSavedSlotsInfo(activeCoreId);
      } catch (err) {
        alert('Error parsing ROM file header.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Load default ROM
  const loadDefaultRom = async (coreId: string) => {
    const currentCore = emulatorManager.getCoreById(coreId);
    if (!currentCore) return;
    
    if (emulatorInstance.current !== currentCore) return;
    
    let path = '';
    let romName = '';
    let romSize = '';
    let title = '';
    let mapper = '';
    let version = '';
    let checksum = '';
    
    if (coreId === 'snes') {
      path = '/emulator/retro-station/sample.sfc';
      romName = 'sample.sfc';
      romSize = '2048 KB';
      title = 'THE JUNGLE BOOK';
      mapper = 'LoROM';
      version = '1.0';
      checksum = '0xD4EA';
    } else if (coreId === 'nes') {
      path = '/emulator/retro-station/Jungle Book, The (USA).nes';
      romName = 'Jungle Book, The (USA).nes';
      romSize = '256 KB';
      title = 'THE JUNGLE BOOK';
      mapper = 'MMC3';
      version = '1.0';
      checksum = '0x1234';
    } else if (coreId === 'gbc') {
      path = '/emulator/retro-station/Spider-Man 2 - The Sinister Six (USA, Europe).gbc';
      romName = 'Spiderman2.gbc';
      romSize = '1024 KB';
      title = 'SPIDER-MAN 2';
      mapper = 'MBC5';
      version = '1.0';
      checksum = '0x9ABC';
    } else if (coreId === 'gba') {
      path = '/emulator/retro-station/suite.gba';
      romName = 'suite.gba';
      romSize = '524 KB';
      title = 'GBA TEST SUITE';
      mapper = 'GBA';
      version = '1.0';
      checksum = 'N/A';
    }
    
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Failed to load ${romName}`);
      const buffer = await response.arrayBuffer();
      
      if (emulatorInstance.current !== currentCore) return;
      await currentCore.loadRom(buffer);
      
      if (emulatorInstance.current !== currentCore) return;
      setEmulatorState(prev => ({
        ...prev,
        romName,
        romSize,
        romInfo: { title, mapper, version, checksum }
      }));
    } catch (err) {
      console.error('Error loading default ROM:', err);
    }
  };

  const togglePlay = () => {
    if (!emulatorInstance.current) return;
    
    if (emulatorState.isRunning) {
      setEmulatorState(prev => ({ ...prev, isRunning: false }));
    } else {
      setEmulatorState(prev => ({ ...prev, isRunning: true }));
    }
  };

  const toggleAudio = async () => {
    if (!emulatorInstance.current) return;
    
    if (emulatorState.audioEnabled) {
      emulatorInstance.current.disableAudio();
      setEmulatorState(prev => ({ ...prev, audioEnabled: false }));
    } else {
      await emulatorInstance.current.enableAudio();
      setEmulatorState(prev => ({ ...prev, audioEnabled: true }));
    }
  };

  const changeAudioVolume = (volume: number) => {
    setEmulatorState(prev => ({ ...prev, audioVolume: volume }));
    if (emulatorInstance.current) {
      emulatorInstance.current.setAudioVolume(volume);
    }
  };

  const changeAudioTempo = (tempo: number) => {
    const clamped = Math.round(tempo * 100) / 100;
    setEmulatorState(prev => ({ ...prev, audioTempo: clamped }));
    if (emulatorInstance.current) {
      emulatorInstance.current.setAudioTempo(clamped);
    }
  };

  const resetEmulator = async () => {
    if (!emulatorInstance.current) return;
    await emulatorInstance.current.reset();
    setEmulatorState(prev => ({
      ...prev,
      isRunning: false,
      cpuState: {
        a: 0, x: 0, y: 0, s: 0x1FF, d: 0, db: 0, pb: 0, pc: 0x8000, p: 0x30, e: 1
      },
      disassemblyList: [],
      oamList: [],
      cgramList: [],
      hexData: []
    }));
    
    if (mainCanvasRef.current) {
      const ctx = mainCanvasRef.current.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 256, 224);
    }
  };

  const clearDatabaseHistory = async () => {
    if (confirm("Are you sure you want to clear your ROM database history and all saved state slots? This action cannot be undone.")) {
      if (dbRef.current) {
        try {
          await dbRef.current.clearAllData();
          localStorage.clear();
          alert("Database cleared successfully. Reloading the page to apply.");
          window.location.reload();
        } catch (e) {
          console.error("Failed to clear database", e);
          alert("Failed to clear database.");
        }
      }
    }
  };

  const stepInstruction = async () => {
    if (!emulatorInstance.current) return;
    
    try {
      const controllerState = inputHandlerRef.current.getController1State();
      const targetFps = activeCoreId === 'gb' || activeCoreId === 'gbc' ? 59.7 : 60.098;
      const frameInterval = 1000 / targetFps;
      let activeInput = controllerState;
      
      if (automationStateRef.current === 'playing') {
        while (playbackInputIndexRef.current < recordedInputsRef.current.length && 
               recordedInputsRef.current[playbackInputIndexRef.current].timestamp <= accumulatedGameTimeRef.current) {
          playbackInputIndexRef.current++;
        }
        const activeIndex = Math.max(0, playbackInputIndexRef.current - 1);
        if (activeIndex < recordedInputsRef.current.length) {
          activeInput = recordedInputsRef.current[activeIndex].input;
        }
        if (playbackInputIndexRef.current >= recordedInputsRef.current.length) {
          automationStateRef.current = 'idle';
          setAutomationUIState('idle');
        }
        setPlaybackUIIndex(Math.min(playbackInputIndexRef.current, recordedInputsRef.current.length));
      } else if (automationStateRef.current === 'recording') {
        recordedInputsRef.current.push({
          timestamp: accumulatedGameTimeRef.current,
          input: controllerState
        });
        setRecordedUIFrameCount(recordedInputsRef.current.length);
      }

      accumulatedGameTimeRef.current += frameInterval;

      const frame = await emulatorInstance.current.runFrame(activeInput);
      
      if (mainCanvasRef.current) {
        const ctx = mainCanvasRef.current.getContext('2d')!;
        const imgData = ctx.createImageData(256, 224);
        const pixelBuffer = new Uint32Array(imgData.data.buffer);
        pixelBuffer.set(frame.pixels);
        ctx.putImageData(imgData, 0, 0);
      }
      
      const snapshot = await emulatorInstance.current.getDebugSnapshot();
      setEmulatorState(prev => ({
        ...prev,
        cpuState: snapshot.cpu,
        isScreenBlank: snapshot.isScreenBlank,
        bgMode: snapshot.bgMode,
        screenDisplay: snapshot.screenDisplay,
        disassemblyList: snapshot.disassembly,
        oamList: snapshot.oam,
        cgramList: snapshot.cgram,
        hexData: snapshot.hexData
      }));
    } catch (err) {
      console.error('Step error:', err);
    }
  };

  const startRecordingInputs = async () => {
    recordedInputsRef.current = [];
    recordedScreenshotsRef.current = [];
    playbackInputIndexRef.current = 0;
    accumulatedGameTimeRef.current = 0;
    setRecordedUIFrameCount(0);
    setPlaybackUIIndex(0);

    // Reset the emulator before starting to ensure a consistent initial state!
    await resetEmulator();

    // Auto-play the emulator
    setEmulatorState(prev => ({ ...prev, isRunning: true }));

    // Start canvas video recording
    if (mainCanvasRef.current) {
      const stream = mainCanvasRef.current.captureStream(60);
      recordedChunksRef.current = [];
      try {
        const options = { mimeType: 'video/webm;codecs=vp9' };
        const recorder = new MediaRecorder(stream, options);
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };
        recorder.start(100);
        mediaRecorderRef.current = recorder;
      } catch (err) {
        console.warn("MediaRecorder VP9 failed, fallback to default", err);
        try {
          const recorder = new MediaRecorder(stream);
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              recordedChunksRef.current.push(event.data);
            }
          };
          recorder.start(100);
          mediaRecorderRef.current = recorder;
        } catch (e2) {
          console.error("Failed to start MediaRecorder", e2);
        }
      }
    }

    automationStateRef.current = 'recording';
    setAutomationUIState('recording');
  };

  const stopRecordingInputs = () => {
    if (automationStateRef.current === 'recording') {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        setTimeout(() => {
          const videoBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          saveRecordedVideo(videoBlob);
        }, 200);
      }
      saveRecordedInputsJSON();
    }
    automationStateRef.current = 'idle';
    setAutomationUIState('idle');
  };

  const saveRecordedInputsJSON = async () => {
    const payload = {
      coreId: activeCoreId,
      romName: emulatorState.romName,
      inputs: recordedInputsRef.current,
      screenshots: recordedScreenshotsRef.current
    };
    const filename = `${activeCoreId}-input-recording.json`;
    const content = JSON.stringify(payload, null, 2);
    
    if (savePath) {
      try {
        const res = await fetch('/api/save-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, content, savePath })
        });
        const result = await res.json();
        if (result.success) {
          console.log("TAS JSON saved to host:", result.path);
        } else {
          console.error("Failed to save TAS JSON to host:", result.error);
        }
      } catch (err) {
        console.error("Error saving TAS JSON:", err);
      }
    } else {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const saveRecordedVideo = async (blob: Blob) => {
    const filename = `${activeCoreId}-gameplay-recording.webm`;
    if (savePath) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        try {
          const res = await fetch('/api/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, dataUrl, savePath })
          });
          const result = await res.json();
          if (result.success) {
            console.log("Gameplay video saved to host:", result.path);
          } else {
            console.error("Failed to save gameplay video to host:", result.error);
          }
        } catch (err) {
          console.error("Error saving gameplay video:", err);
        }
      };
      reader.readAsDataURL(blob);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const captureScreenshotDuringRecording = async () => {
    if (!mainCanvasRef.current || automationStateRef.current !== 'recording') return;
    
    const timestamp = accumulatedGameTimeRef.current;
    const uid = `snap_${Math.floor(timestamp)}_${Math.floor(Math.random() * 1000)}`;
    const dataUrl = mainCanvasRef.current.toDataURL('image/png');
    const filename = `${uid}.png`;
    
    recordedScreenshotsRef.current.push({ timestamp, uid });
    
    if (savePath) {
      try {
        const res = await fetch('/api/save-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, dataUrl, savePath })
        });
        const result = await res.json();
        if (result.success) {
          console.log("Screenshot saved to host:", result.path);
        } else {
          console.error("Failed to save screenshot to host:", result.error);
        }
      } catch (err) {
        console.error("Error saving screenshot:", err);
      }
    } else {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();
    }
  };

  const triggerPlayInputs = () => {
    document.getElementById('tas-upload')?.click();
  };

  const handleTASUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const payload = JSON.parse(event.target?.result as string);
        let inputs: any[] = [];
        if (Array.isArray(payload)) {
          inputs = payload;
        } else if (payload && Array.isArray(payload.inputs)) {
          inputs = payload.inputs;
        }
        
        if (inputs.length > 0) {
          recordedInputsRef.current = inputs;
          setRecordedUIFrameCount(inputs.length);
          playbackInputIndexRef.current = 0;
          accumulatedGameTimeRef.current = 0;
          setPlaybackUIIndex(0);
          
          await resetEmulator();
          
          automationStateRef.current = 'playing';
          setAutomationUIState('playing');
          
          setEmulatorState(prev => ({ ...prev, isRunning: true }));
        } else {
          alert('Invalid TAS recording file structure.');
        }
      } catch (err) {
        alert('Error parsing TAS file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const saveState = async (slotIdx: number) => {
    if (!emulatorInstance.current || !dbRef.current) return;
    const state = await emulatorInstance.current.createSaveState();
    await dbRef.current.saveSlot(activeCoreId, slotIdx, state);
    const newSlots = [...emulatorState.saveSlots];
    newSlots[slotIdx] = true as any;
    setEmulatorState(prev => ({ ...prev, saveSlots: newSlots }));
  };

  const loadState = async (slotIdx: number) => {
    if (!emulatorInstance.current || !dbRef.current) return;
    const state = await dbRef.current.getSlot(activeCoreId, slotIdx);
    if (!state) return;
    await emulatorInstance.current.loadSaveState(state);
    
    // Update UI state
    const snapshot = await emulatorInstance.current.getDebugSnapshot();
    setEmulatorState(prev => ({
      ...prev,
      cpuState: snapshot.cpu,
      isScreenBlank: snapshot.isScreenBlank,
      bgMode: snapshot.bgMode,
      screenDisplay: snapshot.screenDisplay,
      disassemblyList: snapshot.disassembly,
      oamList: snapshot.oam,
      cgramList: snapshot.cgram,
      hexData: snapshot.hexData
    }));
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      savedPanelState.current = { left: leftOpen, right: rightOpen, footer: footerOpen };
      setLeftOpen(false);
      setRightOpen(false);
      try {
        await stationRef.current?.requestFullscreen();
        stationRef.current?.classList.add('fullscreen');
      } catch (err) {
        console.warn('Fullscreen request failed:', err);
      }
    } else {
      await document.exitFullscreen();
      stationRef.current?.classList.remove('fullscreen');
      if (savedPanelState.current) {
        setLeftOpen(savedPanelState.current.left);
        setRightOpen(savedPanelState.current.right);
        setFooterOpen(savedPanelState.current.footer);
      }
    }
  };

  const handleFooterDragStart = (e: React.MouseEvent) => {
    dragRef.current = { startY: e.clientY, startH: footerHeight };
    document.addEventListener('mousemove', handleFooterDragMove);
    document.addEventListener('mouseup', handleFooterDragEnd);
    e.preventDefault();
  };

  const handleFooterDragMove = (e: MouseEvent) => {
    if (!dragRef.current) return;
    setFooterHeight(Math.max(30, Math.min(600, dragRef.current.startH + (dragRef.current.startY - e.clientY))));
  };

  const handleFooterDragEnd = () => {
    dragRef.current = null;
    document.removeEventListener('mousemove', handleFooterDragMove);
    document.removeEventListener('mouseup', handleFooterDragEnd);
  };

  const handleLeftDragStart = (e: React.MouseEvent) => {
    leftDragRef.current = { startX: e.clientX, startW: leftWidth };
    document.addEventListener('mousemove', handleLeftDragMove);
    document.addEventListener('mouseup', handleLeftDragEnd);
    e.preventDefault();
  };

  const handleLeftDragMove = (e: MouseEvent) => {
    if (!leftDragRef.current) return;
    const newWidth = leftDragRef.current.startW + (e.clientX - leftDragRef.current.startX);
    setLeftWidth(Math.max(160, Math.min(500, newWidth)));
  };

  const handleLeftDragEnd = () => {
    leftDragRef.current = null;
    document.removeEventListener('mousemove', handleLeftDragMove);
    document.removeEventListener('mouseup', handleLeftDragEnd);
  };

  const handleRightDragStart = (e: React.MouseEvent) => {
    rightDragRef.current = { startX: e.clientX, startW: rightWidth };
    document.addEventListener('mousemove', handleRightDragMove);
    document.addEventListener('mouseup', handleRightDragEnd);
    e.preventDefault();
  };

  const handleRightDragMove = (e: MouseEvent) => {
    if (!rightDragRef.current) return;
    const newWidth = rightDragRef.current.startW - (e.clientX - rightDragRef.current.startX);
    setRightWidth(Math.max(180, Math.min(800, newWidth)));
  };

  const handleRightDragEnd = () => {
    rightDragRef.current = null;
    document.removeEventListener('mousemove', handleRightDragMove);
    document.removeEventListener('mouseup', handleRightDragEnd);
  };

  const renderFlagBadge = (flag: number, label: string) => {
    const p = emulatorState.cpuState?.p ?? 0;
    const active = (p & flag) !== 0;
    return (
      <span className={`flag-badge ${active ? 'on' : 'off'}`}>{label}</span>
    );
  };

  const a = 'var(--accent)';
  const amber = 'var(--accent-amber)';

  const handleThemeChange = (newTheme: ThemeId) => {
    setTheme(newTheme);
    localStorage.setItem('retro_station_theme', newTheme);
  };

  const handlePixelatedChange = () => {
    const next = !pixelated;
    setPixelated(next);
    localStorage.setItem('retro_station_pixelated', String(next));
  };

  const I = pixelated ? {
    Play: PixelPlay, Pause: PixelPause, RotateCcw: PixelRotateCcw, SkipForward: PixelSkipForward,
    Settings: PixelSettings, X: PixelX, Check: PixelCheck,
    PanelLeft: PixelPanelLeft, PanelRight: PixelPanelRight, Upload: PixelUpload,
    Maximize: PixelMaximize, Minimize: PixelMinimize,
    Cpu: PixelCpu, RefreshCw: PixelRefreshCw, AlertCircle: PixelAlertCircle,
    Monitor: PixelMonitor,
  } : { Play, Pause, RotateCcw, SkipForward, Settings, X, Check, PanelLeft, PanelRight, Upload, Maximize, Minimize, Cpu, RefreshCw, AlertCircle, Monitor };

  return (
    <div className={`retro-station theme-${theme}${pixelated ? ' pixelated-mode' : ''} ${!leftOpen && !rightOpen && !footerOpen ? 'fullscreen' : ''}`} ref={stationRef}>
      {/* ── Header ── */}
      <header className="retro-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="retro-header-title">
            Retro-Suit<span> v0.3</span>
          </span>
          <select 
            value={activeCoreId} 
            onChange={(e) => setActiveCoreId(e.target.value)}
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid #2a2a4a',
              borderRadius: 4,
              color: a,
              fontSize: 10,
              fontFamily: 'inherit',
              padding: '2px 6px',
              cursor: 'pointer'
            }}
          >
            <option value="snes">SNES (Super Nintendo)</option>
            <option value="nes">NES (Nintendo)</option>
            <option value="gbc">GB / GBC (Game Boy / Color)</option>
            <option value="gba">GBA (Game Boy Advance)</option>
          </select>
          <span className={`retro-led ${emulatorState.isRunning && !emulatorState.isScreenBlank ? 'green' : emulatorState.isRunning ? 'amber' : 'off'}`} />
        </div>
        <div className="retro-header-right">
          <button onClick={() => setLeftOpen(!leftOpen)} className="header-toggle" title="Toggle left sidebar">
            <I.PanelLeft size={12} />
          </button>
          <button onClick={() => setRightOpen(!rightOpen)} className="header-toggle" title="Toggle right sidebar">
            <I.PanelRight size={12} />
          </button>
          <button onClick={toggleFullscreen} className="header-toggle" title="Toggle fullscreen">
            {isFullscreen ? <I.Minimize size={12} /> : <I.Maximize size={12} />}
          </button>
        </div>
      </header>

      {/* ── Body: 3-Column Layout ── */}
      <div className="retro-body">
        {/* ── LEFT SIDEBAR ── */}
        {leftOpen && <aside className="retro-sidebar" style={{ width: leftWidth, position: 'relative' }}>
          <div className="sidebar-drag-handle-left" onMouseDown={handleLeftDragStart} />
          {/* ROM Info */}
          <div className="retro-panel">
            <div className="retro-panel-title">ROM INFO</div>
            <div className="stat-row"><span className="stat-label">File</span><span className="stat-value">{emulatorState.romName}</span></div>
            <div className="stat-row"><span className="stat-label">Title</span><span className="stat-value">{emulatorState.romInfo.title}</span></div>
            <div className="stat-row"><span className="stat-label">Mapper</span><span className="stat-value">{emulatorState.romInfo.mapper}</span></div>
            <div className="stat-row"><span className="stat-label">Size</span><span className="stat-value">{emulatorState.romSize}</span></div>
            <div className="stat-row"><span className="stat-label">Checksum</span><span className="stat-value">{emulatorState.romInfo.checksum}</span></div>
            <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
              <button onClick={() => document.getElementById('rom-upload')?.click()} style={{ flex: 1, fontSize: 9, padding: '3px 0', border: '1px solid #2a2a4a', borderRadius: 3, background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: 'inherit' }}>
                <I.Upload size={12} />
                LOAD ROM
              </button>
              <input id="rom-upload" type="file" accept=".sfc,.smc,.nes,.gb,.gbc,.gba" style={{ display: 'none' }} onChange={handleRomUpload} />
            </div>
            <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
              <button onClick={() => loadDefaultRom(activeCoreId)} style={{ flex: 1, fontSize: 9, padding: '4px 0', border: '1px solid #2a2a4a', borderRadius: 3, background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'inherit' }}>
                LOAD DEFAULT ROM
              </button>
            </div>
          </div>

          {/* Input Automation / TAS Panel */}
          <div className="retro-panel">
            <div className="retro-panel-title">INPUT AUTOMATION & TAS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {automationUIState === 'idle' && (
                  <button 
                    onClick={startRecordingInputs} 
                    style={{ flex: 1, fontSize: 9, padding: '4px 0', border: '1px solid #ff4444', borderRadius: 3, background: 'transparent', color: '#ff4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: 'inherit' }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4444' }}></span>
                    RECORD
                  </button>
                )}
                {automationUIState !== 'idle' && (
                  <button 
                    onClick={stopRecordingInputs} 
                    style={{ flex: 1, fontSize: 9, padding: '4px 0', border: '1px solid var(--accent)', borderRadius: 3, background: 'transparent', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: 'inherit' }}
                  >
                    <span style={{ width: 6, height: 6, background: 'var(--accent)' }}></span>
                    STOP
                  </button>
                )}
                {automationUIState === 'recording' && (
                  <button 
                    onClick={captureScreenshotDuringRecording} 
                    style={{ flex: 1, fontSize: 9, padding: '4px 0', border: '1px solid #44aacc', borderRadius: 3, background: 'transparent', color: '#44aacc', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: 'inherit' }}
                  >
                    <ImageIcon size={10} style={{ color: '#44aacc' }} />
                    SNAP
                  </button>
                )}
                <button 
                  onClick={triggerPlayInputs} 
                  disabled={automationUIState !== 'idle'} 
                  style={{ flex: 1, fontSize: 9, padding: '4px 0', border: '1px solid #44cc44', borderRadius: 3, background: 'transparent', color: '#44cc44', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, opacity: automationUIState !== 'idle' ? 0.4 : 1, fontFamily: 'inherit' }}
                >
                  <I.Play size={10} style={{ color: '#44cc44' }} />
                  PLAY FILE
                </button>
                <input id="tas-upload" type="file" accept=".json" style={{ display: 'none' }} onChange={handleTASUpload} />
              </div>
              <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span>Status: <strong style={{ color: automationUIState === 'recording' ? '#ff4444' : automationUIState === 'playing' ? '#44cc44' : 'var(--text-dim)' }}>{automationUIState.toUpperCase()}</strong></span>
                {automationUIState === 'recording' && <span>Frames: {recordedUIFrameCount}</span>}
                {automationUIState === 'playing' && <span>Frame: {playbackUIIndex} / {recordedUIFrameCount}</span>}
              </div>
            </div>
          </div>

          {/* Diagnostics / Test Suite Panel */}
          <div className="retro-panel">
            <style>{`
              @keyframes test-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
              .test-spinner {
                animation: test-spin 1.5s linear infinite;
              }
              .test-item-row {
                transition: all 0.2s ease;
              }
              .test-item-row:hover {
                background: rgba(0, 255, 170, 0.08) !important;
                border-color: rgba(0, 255, 170, 0.3) !important;
              }
            `}</style>
            <div className="retro-panel-title">DIAGNOSTICS & TESTS</div>
            
            <button 
              onClick={runAllTests} 
              disabled={isRunningAllTests}
              style={{
                width: '100%',
                fontSize: 9,
                fontWeight: 'bold',
                padding: '5px 0',
                border: '1px solid #2a2a4a',
                borderRadius: 4,
                background: isRunningAllTests ? 'rgba(42,42,74,0.3)' : 'rgba(0,180,120,0.1)',
                color: isRunningAllTests ? '#666680' : 'var(--accent-success)',
                cursor: isRunningAllTests ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                boxShadow: isRunningAllTests ? 'none' : '0 0 8px rgba(0,255,170,0.1)',
                fontFamily: 'inherit',
                transition: 'all 0.2s ease',
                textShadow: isRunningAllTests ? 'none' : '0 0 4px rgba(0,255,170,0.3)'
              }}
            >
              {isRunningAllTests ? (
                <>
                  <I.RefreshCw size={11} className="test-spinner" />
                  RUNNING TESTS...
                </>
              ) : (
                <>
                  <I.Cpu size={11} />
                  RUN ALL TESTS
                </>
              )}
            </button>

            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
              {testSuite
                .filter(test => {
                  if (activeCoreId === 'gb' || activeCoreId === 'gbc') {
                    return test.coreId === 'gb' || test.coreId === 'gbc';
                  }
                  return test.coreId === activeCoreId;
                })
                .map((test) => {
                let statusIcon = <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1px solid #4a4a6a', background: 'transparent' }} />;
                
                if (test.status === 'running') {
                  statusIcon = <I.RefreshCw size={11} className="test-spinner" style={{ color: 'var(--accent-warning)' }} />;
                } else if (test.status === 'passed') {
                  statusIcon = <I.Check size={11} style={{ color: 'var(--accent-success)' }} />;
                } else if (test.status === 'failed') {
                  statusIcon = <I.AlertCircle size={11} style={{ color: 'var(--accent-error)' }} />;
                }

                const isInteractable = !isRunningAllTests && !runningLiveTestId;

                return (
                  <div 
                    key={test.id} 
                    className={isInteractable ? "test-item-row" : ""}
                    onClick={() => {
                      if (isInteractable) {
                        loadAndRunTestLive(test);
                        setRunningLiveTestId(test.id);
                      }
                    }}
                    title={isInteractable ? "Click to run this test ROM live on the screen" : "Test run in progress"}
                    style={{
                      padding: '4px 6px',
                      background: 'rgba(10,10,30,0.6)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 4,
                      cursor: isInteractable ? 'pointer' : 'not-allowed'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 9, color: '#e0e0f0', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {test.name}
                      </span>
                      <span style={{ fontSize: 7, color: '#606080', textTransform: 'uppercase', fontFamily: 'inherit' }}>
                        Core: {test.coreId}
                      </span>
                      {test.message && (
                        <span style={{ fontSize: 7, color: 'var(--accent-error)', fontFamily: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={test.message}>
                          {test.message}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      {statusIcon}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CPU Registers */}
          <div className="retro-panel">
            <div className="retro-panel-title">CPU REGISTERS</div>
            {activeCoreId === 'snes' && (
              <>
                <div className="reg-grid">
                  <div className="reg-item"><span className="reg-label">A</span><span className="reg-value">{(emulatorState.cpuState?.a ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                  <div className="reg-item"><span className="reg-label">X</span><span className="reg-value">{(emulatorState.cpuState?.x ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                  <div className="reg-item"><span className="reg-label">Y</span><span className="reg-value">{(emulatorState.cpuState?.y ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                  <div className="reg-item"><span className="reg-label">PC</span><span className="reg-value pink">{(emulatorState.cpuState?.pc ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                  <div className="reg-item"><span className="reg-label">SP</span><span className="reg-value amber">{(emulatorState.cpuState?.s ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                  <div className="reg-item"><span className="reg-label">DP</span><span className="reg-value">{(emulatorState.cpuState?.d ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                </div>
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                  {renderFlagBadge(0x80, 'N')}
                  {renderFlagBadge(0x40, 'V')}
                  {renderFlagBadge(0x20, 'M')}
                  {renderFlagBadge(0x10, 'X')}
                  {renderFlagBadge(0x08, 'D')}
                  {renderFlagBadge(0x04, 'I')}
                  {renderFlagBadge(0x02, 'Z')}
                  {renderFlagBadge(0x01, 'C')}
                </div>
                <div style={{ marginTop: 4, fontSize: 9, color: 'var(--text-dim)' }}>
                  {emulatorState.cpuState?.e === 1 ? '6502 EMULATION' : '65C816 NATIVE'}
                </div>
              </>
            )}
            {activeCoreId === 'nes' && (
              <div className="reg-grid">
                <div className="reg-item"><span className="reg-label">A</span><span className="reg-value">{(emulatorState.cpuState?.a ?? 0).toString(16).toUpperCase().padStart(2, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">X</span><span className="reg-value">{(emulatorState.cpuState?.x ?? 0).toString(16).toUpperCase().padStart(2, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">Y</span><span className="reg-value">{(emulatorState.cpuState?.y ?? 0).toString(16).toUpperCase().padStart(2, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">PC</span><span className="reg-value pink">{(emulatorState.cpuState?.pc ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">SP</span><span className="reg-value amber">{(emulatorState.cpuState?.stkp ?? 0).toString(16).toUpperCase().padStart(2, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">SR</span><span className="reg-value">{(emulatorState.cpuState?.status ?? 0).toString(16).toUpperCase().padStart(2, '0')}</span></div>
              </div>
            )}
            {(activeCoreId === 'gb' || activeCoreId === 'gbc') && (
              <div className="reg-grid">
                <div className="reg-item"><span className="reg-label">AF</span><span className="reg-value">{(emulatorState.cpuState?.af ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">BC</span><span className="reg-value">{(emulatorState.cpuState?.bc ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">DE</span><span className="reg-value">{(emulatorState.cpuState?.de ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">HL</span><span className="reg-value">{(emulatorState.cpuState?.hl ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">PC</span><span className="reg-value pink">{(emulatorState.cpuState?.pc ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">SP</span><span className="reg-value amber">{(emulatorState.cpuState?.sp ?? 0).toString(16).toUpperCase().padStart(4, '0')}</span></div>
              </div>
            )}
            {activeCoreId === 'gba' && (
              <div className="reg-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                <div className="reg-item"><span className="reg-label">R0</span><span className="reg-value">{(emulatorState.cpuState?.r0 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R1</span><span className="reg-value">{(emulatorState.cpuState?.r1 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R2</span><span className="reg-value">{(emulatorState.cpuState?.r2 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R3</span><span className="reg-value">{(emulatorState.cpuState?.r3 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R4</span><span className="reg-value">{(emulatorState.cpuState?.r4 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R5</span><span className="reg-value">{(emulatorState.cpuState?.r5 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R6</span><span className="reg-value">{(emulatorState.cpuState?.r6 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R7</span><span className="reg-value">{(emulatorState.cpuState?.r7 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R8</span><span className="reg-value">{(emulatorState.cpuState?.r8 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R9</span><span className="reg-value">{(emulatorState.cpuState?.r9 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R10</span><span className="reg-value">{(emulatorState.cpuState?.r10 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R11</span><span className="reg-value">{(emulatorState.cpuState?.r11 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">R12</span><span className="reg-value">{(emulatorState.cpuState?.r12 ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">SP</span><span className="reg-value amber">{(emulatorState.cpuState?.sp ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item"><span className="reg-label">LR</span><span className="reg-value">{(emulatorState.cpuState?.lr ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item" style={{ gridColumn: 'span 3' }}><span className="reg-label">PC</span><span className="reg-value pink">{(emulatorState.cpuState?.pc ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
                <div className="reg-item" style={{ gridColumn: 'span 3' }}><span className="reg-label">CPSR</span><span className="reg-value">{(emulatorState.cpuState?.cpsr ?? 0).toString(16).toUpperCase().padStart(8, '0')}</span></div>
              </div>
            )}
          </div>

          {/* Controller */}
          <div className="retro-panel">
            <div className="retro-panel-title">CONTROLLER 1</div>
            <div className="controller-hud">
              {['z', 'x', 'a', 's', 'q', 'e', 'shift', 'enter', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].map((key, idx) => {
                const active = inputHandlerRef.current?.isKeyDown(key) ?? false;
                return (
                  <kbd key={idx} className={`key-badge ${active ? 'active' : ''}`}>
                    {key === 'arrowup' ? '↑' : key === 'arrowdown' ? '↓' : key === 'arrowleft' ? '←' : key === 'arrowright' ? '→' : key === 'enter' ? '↵' : key === 'shift' ? '⇧' : key.charAt(0).toUpperCase()}
                  </kbd>
                );
              })}
            </div>
          </div>
        </aside>}

        {/* ── CENTER: GAME SCREEN + TRANSPORT ── */}
        <main className="retro-main">
          {/* CRT Monitor */}
          <div className="crt-frame" ref={crtFrameRef}>
            <div className="crt-screen" style={(() => {
              const { w: nw, h: nh } = getCoreDimensions(activeCoreId);
              const s = Math.min(aspectStretch / 100, 1);
              if (s <= 0) return { aspectRatio: `${nw}/${nh}`, height: '100%', width: 'auto', maxWidth: '100%' };
              if (s >= 0.99) return { aspectRatio: 'unset', width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%' };
              const origW = containerSize.h * nw / nh;
              const w = origW + (containerSize.w - origW) * s;
              const ar = w / containerSize.h;
              return { aspectRatio: `${ar}`, height: '100%', width: 'auto', maxWidth: '100%' };
            })()}>
              <canvas
                ref={mainCanvasRef}
                width={getCoreDimensions(activeCoreId).w}
                height={getCoreDimensions(activeCoreId).h}
                className="pixelated"
                style={{ background: '#000' }}
              />
              <div className="scanlines" />
            </div>
            <div className="crt-power-led">
              <span className={`retro-led ${emulatorState.isRunning ? 'green' : 'off'}`} />
              POWER
            </div>
            {emulatorState.isScreenBlank && (
              <div style={{
                position: 'absolute', bottom: 8, right: 8,
                background: 'rgba(0,0,0,0.7)', zIndex: 20, borderRadius: 4, padding: '3px 8px',
                fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase',
                pointerEvents: 'none'
              }}>
                blank
              </div>
            )}
          </div>

          {/* Transport */}
          <div className="transport-bar">
            <button onClick={togglePlay} className={`transport-btn ${!emulatorState.isRunning ? 'primary' : ''}`}>
              {emulatorState.isRunning ? <I.Pause size={12} /> : <I.Play size={12} />}
              {emulatorState.isRunning ? 'PAUSE' : 'PLAY'}
            </button>
            <button onClick={resetEmulator} className="transport-btn danger">
              <I.RotateCcw size={11} />
              RESET
            </button>
            <button onClick={stepInstruction} disabled={emulatorState.isRunning} className="transport-btn" style={{ opacity: emulatorState.isRunning ? 0.3 : 1 }}>
              <I.SkipForward size={11} />
              STEP
            </button>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 4 }}>SPD</span>
            <span style={{ fontSize: 9, color: 'var(--text-dim)', minWidth: 28, textAlign: 'center' }}>{emulatorState.speedMultiplier.toFixed(2)}x</span>
            <input type="range"
              min={sliderConfigs.speed.min}
              max={sliderConfigs.speed.max}
              step={sliderConfigs.speed.step}
              value={emulatorState.speedMultiplier}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setEmulatorState(prev => ({ ...prev, speedMultiplier: val }));
                if (emulatorInstance.current) {
                  emulatorInstance.current.setSpeedMultiplier(val);
                }
              }}
              style={{ width: 50, accentColor: a }} />
            <div style={{ width: 1, height: 14, background: 'var(--border-subtle)', margin: '0 3px' }} />
            <button onClick={toggleAudio} className="transport-btn" style={{ color: emulatorState.audioEnabled ? a : 'var(--text-dim)' }}>
              {emulatorState.audioEnabled ? 'AUD ON' : 'AUD OFF'}
            </button>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 4 }}>VOL</span>
            <input type="range"
              min={sliderConfigs.volume.min}
              max={sliderConfigs.volume.max}
              step={sliderConfigs.volume.step}
              value={emulatorState.audioVolume}
              onChange={(e) => changeAudioVolume(parseFloat(e.target.value))}
              style={{ width: 40, accentColor: a }} />
            <span style={{ fontSize: 9, color: 'var(--text-dim)', minWidth: 20, textAlign: 'right' }}>{Math.round(emulatorState.audioVolume * 100)}%</span>
            <div style={{ width: 1, height: 14, background: 'var(--border-subtle)', margin: '0 6px' }} />
            <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>ASPECT</span>
            <input type="range"
              min={sliderConfigs.aspect.min}
              max={sliderConfigs.aspect.max}
              step={sliderConfigs.aspect.step}
              value={aspectStretch}
              onChange={(e) => setAspectStretch(parseInt(e.target.value))}
              style={{ width: 60, accentColor: 'var(--accent)', verticalAlign: 'middle' }} />
            <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 30, textAlign: 'left' }}>
              {aspectStretch === 0 ? '4:3' : aspectStretch >= 98 ? 'Fill' : `${aspectStretch}%`}
            </span>
            <div style={{ width: 1, height: 14, background: 'var(--border-subtle)', margin: '0 6px' }} />
            <button onClick={() => {
              if (footerOpen) {
                if (!leftOpen && !rightOpen) {
                  setFooterOpen(false);
                } else {
                  setLeftOpen(false);
                  setRightOpen(false);
                  setFooterOpen(false);
                }
              } else {
                setLeftOpen(true);
                setRightOpen(true);
                setFooterOpen(true);
              }
            }}
              className="transport-btn" title="Toggle panels" style={{ fontSize: 10, padding: '2px 6px' }}>
              {leftOpen || rightOpen || footerOpen ? '⊟' : '⊞'}
            </button>
          </div>
        </main>

        {/* ── RIGHT SIDEBAR ── */}
        {rightOpen && <aside className="retro-sidebar retro-sidebar-right" style={{ width: rightWidth, position: 'relative' }}>
          <div className="sidebar-drag-handle-right" onMouseDown={handleRightDragStart} />
          {/* Debug tabs */}
          <div className="retro-panel" style={{ flex: 1, display: 'flex', flexDirection: 'row-reverse', minHeight: 0, padding: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0', borderLeft: '1px solid var(--border-color)', flexShrink: 0, width: 36, overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable' }}>
              {(['cpu', 'vram', 'cgram', 'oam', 'hex'] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  style={{
                    writingMode: 'vertical-lr',
                    padding: '2px 4px', fontSize: 11, lineHeight: 1.2,
                    background: activeTab === tab ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                    border: 'none',
                    color: activeTab === tab ? 'var(--accent)' : 'var(--text-dim)',
                    cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                  }}>
                  {tab === 'cpu' ? 'DISASSEMBLY' : tab === 'vram' ? 'VRAM' : tab === 'cgram' ? 'CGRAM' : tab === 'oam' ? 'OAM' : 'HEX'}
                </button>
              ))}
            </div>
            <div className="retro-tab-content" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 6 }}>
              {/* Disassembly */}
              {(activeTab === 'cpu') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {emulatorState.disassemblyList.map((item, idx) => (
                    <div key={idx} className={`disasm-line ${item.isCurrent ? 'active' : ''}`}>
                      {item.isCurrent && <span className="arrow">▶</span>}
                      <span className="addr">
                        {emulatorState.cpuState.pb.toString(16).toUpperCase().padStart(2, '0')}:{item.address.toString(16).toUpperCase().padStart(4, '0')}
                      </span>
                      <span className="mnemonic">{item.disassembly}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* VRAM */}
              {activeTab === 'vram' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ background: '#000', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border-color)', alignSelf: 'center' }}>
                    <canvas ref={vramCanvasRef} width={128} height={128} className="pixelated" style={{ width: 128, height: 128 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                    {[0, 1, 2, 3].map((page) => (
                      <button key={page} onClick={() => {
                        setEmulatorState(prev => ({ ...prev, vramPage: page }));
                      }}
                        style={{
                          padding: '3px 8px', fontSize: 9, border: '1px solid #2a2a4a', borderRadius: 3,
                          background: emulatorState.vramPage === page ? 'rgba(74,246,38,0.1)' : 'transparent',
                          color: emulatorState.vramPage === page ? a : 'var(--text-dim)', cursor: 'pointer', fontFamily: 'inherit'
                        }}>
                        P{page}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center' }}>
                    Offset: {(emulatorState.vramPage * 0x1000).toString(16).toUpperCase()} · 4bpp · 16×16
                  </div>
                </div>
              )}

              {/* CGRAM */}
              {activeTab === 'cgram' && (
                <div>
                  <div className="palette-grid">
                    {emulatorState.cgramList.map((color, idx) => {
                      const r = (color & 0x1F) << 3;
                      const g = ((color >> 5) & 0x1F) << 3;
                      const b = ((color >> 10) & 0x1F) << 3;
                      return <div key={idx} className="palette-swatch" style={{ background: `rgb(${r},${g},${b})` }} title={`#${idx}: 0x${color.toString(16).toUpperCase()}`} />;
                    })}
                  </div>
                </div>
              )}

              {/* OAM */}
              {activeTab === 'oam' && (
                <div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                        <th style={{ padding: '2px 4px' }}>ID</th>
                        <th style={{ padding: '2px 4px' }}>X</th>
                        <th style={{ padding: '2px 4px' }}>Y</th>
                        <th style={{ padding: '2px 4px' }}>Tile</th>
                        <th style={{ padding: '2px 4px' }}>Pal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {emulatorState.oamList.map((sprite) => {
                        const palIdx = (sprite.attr >> 1) & 7;
                        const visible = sprite.y < 224 && sprite.x > -16 && sprite.x < 256;
                        return (
                          <tr key={sprite.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', color: visible ? 'var(--text-primary)' : 'var(--text-very-muted)' }}>
                            <td style={{ padding: '2px 4px', fontWeight: 700 }}>{sprite.id}</td>
                            <td style={{ padding: '2px 4px' }}>{sprite.x}</td>
                            <td style={{ padding: '2px 4px' }}>{sprite.y}</td>
                            <td style={{ padding: '2px 4px', fontFamily: 'inherit' }}>${sprite.tile.toString(16).toUpperCase().padStart(2, '0')}</td>
                            <td style={{ padding: '2px 4px' }}>Pal {palIdx}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* HEX */}
              {activeTab === 'hex' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 4 }}>
                    <input type="number" step={128} value={emulatorState.hexOffset} min={0} max={128 * 1024 - 128}
                      onChange={(e) => setEmulatorState(prev => ({ ...prev, hexOffset: Math.max(0, parseInt(e.target.value)) }))}
                      style={{ width: 60, background: 'var(--bg-panel)', border: '1px solid #2a2a4a', borderRadius: 3, padding: '2px 4px', fontSize: 9, color: 'var(--text-primary)', fontFamily: 'inherit', textAlign: 'center' }} />
                  </div>
                  <div className="hex-viewer" style={{ fontSize: 9 }}>
                    {Array.from({ length: 8 }).map((_, rowIndex) => {
                      const rowOffset = emulatorState.hexOffset + (rowIndex * 16);
                      return (
                        <div key={rowIndex} className="hex-row">
                          <span className="hex-offset">{rowOffset.toString(16).toUpperCase().padStart(6, '0')}</span>
                          <div className="hex-bytes">
                            {Array.from({ length: 16 }).map((_, colIndex) => {
                              const byteVal = emulatorState.hexData[rowIndex * 16 + colIndex] || 0;
                              return <span key={colIndex} className="hex-byte">{byteVal.toString(16).toUpperCase().padStart(2, '0')}</span>;
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* PPU State + Save Slots */}
          <div className="retro-panel" style={{ flexShrink: 0 }}>
            <div className="retro-panel-title">PPU</div>
            <div className="stat-row"><span className="stat-label">Mode</span><span className="stat-value green">BG{emulatorState.bgMode}</span></div>
            <div className="stat-row"><span className="stat-label">Blank</span><span className={`stat-value ${emulatorState.isScreenBlank ? 'amber' : 'green'}`}>{emulatorState.isScreenBlank ? 'YES' : 'NO'}</span></div>
            <div className="stat-row"><span className="stat-label">Bright</span><span className="stat-value">{emulatorState.screenDisplay & 0x0F}</span></div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              {[0, 1, 2].map((slotIdx) => {
                const slot = emulatorState.saveSlots[slotIdx];
                return (
                  <div key={slotIdx} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 7, color: 'var(--text-muted)', marginBottom: 1 }}>S{slotIdx + 1}</div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button onClick={() => saveState(slotIdx)} style={{ flex: 1, fontSize: 7, padding: '1px 0', border: '1px solid #2a2a4a', borderRadius: 2, background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'inherit' }}>S</button>
                      <button onClick={() => loadState(slotIdx)} disabled={!slot} style={{ flex: 1, fontSize: 7, padding: '1px 0', border: '1px solid #2a2a4a', borderRadius: 2, background: 'transparent', color: slot ? 'var(--text-dim)' : 'var(--text-very-muted)', cursor: slot ? 'pointer' : 'default', fontFamily: 'inherit' }}>L</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>}
      </div>

      {/* Fullscreen exit button (floating) */}
      {isFullscreen && (
        <button onClick={toggleFullscreen}
          style={{
            position: 'fixed', top: 12, right: 12, zIndex: 10000,
            background: 'rgba(0,0,0,0.7)', border: '1px solid #2a2a4a',
            borderRadius: 6, color: 'var(--text-primary)', cursor: 'pointer',
            padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11, fontFamily: 'inherit',
            backdropFilter: 'blur(8px)'
          }}>
          <I.X size={14} />
          EXIT FULLSCREEN
        </button>
      )}

      {/* ── FOOTER: Info bar only ── */}
      {footerOpen && <footer className="retro-footer" style={{ flexShrink: 0 }}>
        <div className="footer-drag-handle" onMouseDown={handleFooterDragStart} />
        <div className="retro-bottom-bar">
          <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emulatorState.romInfo.title || 'No ROM loaded'}</span>
          <span style={{ color: 'var(--text-very-muted)' }}>|</span>
          <span>{emulatorState.romInfo.mapper} · {emulatorState.romSize}</span>
          <span style={{ color: 'var(--text-very-muted)' }}>|</span>
          <span style={{ fontSize: 12 }}>{emulatorState.fps} FPS</span>
          <span style={{ color: 'var(--text-very-muted)' }}>|</span>
          <span style={{ fontSize: 12, color: emulatorState.isScreenBlank ? amber : a }}>{emulatorState.isScreenBlank ? 'BLANK' : 'ACTIVE'}</span>
          <div className="transport-spacer" />
          <button onClick={() => { setShowExporter(!showExporter); setShowKeyMapper(false); }} className="header-toggle" style={{ marginRight: 6 }} title="Export sprites/audio">
            EXPORT{showExporter ? ' ▲' : ' ▼'}
          </button>
          <button onClick={() => { setShowKeyMapper(!showKeyMapper); setShowExporter(false); }} className="header-toggle" title="Keyboard mapping">
            KEY{showKeyMapper ? ' ▲' : ' ▼'}
          </button>
          <button onClick={() => { setShowSettings(!showSettings); setShowExporter(false); setShowKeyMapper(false); }} className="header-toggle" title="Settings Menu">
            SETTINGS{showSettings ? ' ▲' : ' ▼'}
          </button>
        </div>
        {showExporter && (
          <div style={{ borderTop: '1px solid var(--border-color)', padding: 12, background: 'var(--bg-panel)', height: 280, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ExporterPanel core={emulatorInstance.current} />
          </div>
        )}
        {showKeyMapper && (
          <div style={{ borderTop: '1px solid var(--border-color)', padding: 12, background: 'var(--bg-panel)' }}>
            <KeyMapper inputHandler={inputHandlerRef.current} />
          </div>
        )}
      </footer>}

        {showSettings && (
          <div style={{ borderTop: '1px solid var(--border-color)', padding: 16, background: 'var(--bg-panel)', maxHeight: 400, overflowY: 'auto', fontFamily: 'var(--font-ui)' }}>
            <div className="settings-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 10, marginBottom: 15 }}>
              <h3 className="settings-title" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <I.Settings size={14} />
                STATION CONFIGURATION
              </h3>
            </div>

            <div className="settings-section-title" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>General Preferences</div>
            <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div className="settings-row" style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600, margin: 0 }}>Enable Audio by Default</label>
                <input type="checkbox" checked={localStorage.getItem('retro_station_default_audio') !== 'false'}
                  onChange={(e) => {
                    localStorage.setItem('retro_station_default_audio', String(e.target.checked));
                    setSliderConfigs(prev => ({ ...prev }));
                  }} 
                  style={{ cursor: 'pointer' }} />
              </div>
              
              <div className="sidebar-drag-handle-left" style={{ display: 'none' }} />
              
              <div className="settings-row" style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600, margin: 0 }}>Enable Autosave Feature</label>
                <input type="checkbox" checked={enableAutosave}
                  onChange={(e) => {
                    setEnableAutosave(e.target.checked);
                    localStorage.setItem('retro_station_enable_autosave', String(e.target.checked));
                  }} 
                  style={{ cursor: 'pointer' }} />
              </div>

              <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Default Volume</label>
                <input className="settings-input" type="number" min={0} max={1} step={0.05}
                  value={parseFloat(localStorage.getItem('retro_station_default_volume') || '0.35')}
                  onChange={(e) => {
                    localStorage.setItem('retro_station_default_volume', e.target.value);
                    setSliderConfigs(prev => ({ ...prev }));
                  }} />
              </div>

              <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Default Aspect (%)</label>
                <input className="settings-input" type="number" min={0} max={100} step={5}
                  value={parseInt(localStorage.getItem('retro_station_default_aspect') || '0')}
                  onChange={(e) => {
                    localStorage.setItem('retro_station_default_aspect', e.target.value);
                    setSliderConfigs(prev => ({ ...prev }));
                  }} />
              </div>
            </div>

            <div className="settings-section-title" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>UI Theme</div>
            <div className="theme-picker" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 16 }}>
              {(Object.entries(THEMES) as [ThemeId, typeof THEMES['crt']][]).map(([id, t]) => (
                <button key={id} className={`theme-option ${theme === id ? 'active' : ''}`} onClick={() => handleThemeChange(id)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 6px', border: `2px solid ${theme === id ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: 6, background: 'var(--bg-panel)', cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit', color: 'var(--text-primary)' }}>
                  <div className="theme-swatch" style={{ width: '100%', height: 36, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', border: '1px solid rgba(0,0,0,0.3)', background: `linear-gradient(135deg, ${t.swatch[0]} 0%, ${t.swatch[0]} 50%, ${t.swatch[1]} 100%)` }}>
                    <span style={{ color: t.swatch[1] }}>{'◉'}</span>
                  </div>
                  <span className="theme-label" style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, textAlign: 'center', color: theme === id ? 'var(--accent)' : 'var(--text-dim)' }}>{t.name}</span>
                </button>
              ))}
            </div>

            <div className="settings-section-title" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Display</div>
            <div className="settings-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={pixelated} onChange={handlePixelatedChange} style={{ accentColor: a }} />
                Pixelated Mode (low-res retro look)
              </label>
            </div>

            <div className="settings-section-title" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Speed Multiplier Limits</div>
            <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Min Speed</label>
                <input className="settings-input" type="number" step={0.05} value={sliderConfigs.speed.min}
                  onChange={(e) => saveSliderConfigs({
                    ...sliderConfigs,
                    speed: { ...sliderConfigs.speed, min: parseFloat(e.target.value) || 0.05 }
                  })} />
              </div>
              <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Max Speed</label>
                <input className="settings-input" type="number" step={0.05} value={sliderConfigs.speed.max}
                  onChange={(e) => saveSliderConfigs({
                    ...sliderConfigs,
                    speed: { ...sliderConfigs.speed, max: parseFloat(e.target.value) || 10.0 }
                  })} />
              </div>
            </div>

            <div className="settings-section-title" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Volume Limits</div>
            <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Min Volume</label>
                <input className="settings-input" type="number" step={0.01} value={sliderConfigs.volume.min}
                  onChange={(e) => saveSliderConfigs({
                    ...sliderConfigs,
                    volume: { ...sliderConfigs.volume, min: parseFloat(e.target.value) || 0.0 }
                  })} />
              </div>
              <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Max Volume</label>
                <input className="settings-input" type="number" step={0.01} value={sliderConfigs.volume.max}
                  onChange={(e) => saveSliderConfigs({
                    ...sliderConfigs,
                    volume: { ...sliderConfigs.volume, max: parseFloat(e.target.value) || 1.0 }
                  })} />
              </div>
            </div>

            <div className="settings-section-title" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Tempo Limits</div>
            <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Min Tempo</label>
                <input className="settings-input" type="number" step={0.05} value={sliderConfigs.tempo.min}
                  onChange={(e) => saveSliderConfigs({
                    ...sliderConfigs,
                    tempo: { ...sliderConfigs.tempo, min: parseFloat(e.target.value) || 0.05 }
                  })} />
              </div>
              <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Max Tempo</label>
                <input className="settings-input" type="number" step={0.05} value={sliderConfigs.tempo.max}
                  onChange={(e) => saveSliderConfigs({
                    ...sliderConfigs,
                    tempo: { ...sliderConfigs.tempo, max: parseFloat(e.target.value) || 10.0 }
                  })} />
              </div>
            </div>

            <div className="settings-section-title" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Aspect Stretch Limits</div>
            <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Min Aspect</label>
                <input className="settings-input" type="number" step={1} value={sliderConfigs.aspect.min}
                  onChange={(e) => saveSliderConfigs({
                    ...sliderConfigs,
                    aspect: { ...sliderConfigs.aspect, min: parseInt(e.target.value) || 0 }
                  })} />
              </div>
              <div className="settings-row" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>Max Aspect</label>
                <input className="settings-input" type="number" step={1} value={sliderConfigs.aspect.max}
                  onChange={(e) => saveSliderConfigs({
                    ...sliderConfigs,
                    aspect: { ...sliderConfigs.aspect, max: parseInt(e.target.value) || 100 }
                  })} />
              </div>
            </div>

            <div className="settings-section-title" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Debug / Automation Settings</div>
            <div className="settings-grid" style={{ gridTemplateColumns: '1fr', gap: 12, marginBottom: 16 }}>
              <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <label className="settings-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 2 }}>Host Local Save Path</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input 
                    className="settings-input" 
                    type="text" 
                    placeholder="e.g. c:/Users/Priya singh/dev/ai-dev/emulators/snes/public/debug/" 
                    value={savePath}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSavePath(val);
                      localStorage.setItem('retro_station_save_path', val);
                    }} 
                    style={{ flex: 1, fontFamily: 'inherit', fontSize: 10 }}
                  />
                  <button 
                    className="btn-secondary" 
                    onClick={() => {
                      const defaultPath = 'c:/Users/Priya singh/dev/ai-dev/emulators/snes/public/debug/';
                      setSavePath(defaultPath);
                      localStorage.setItem('retro_station_save_path', defaultPath);
                    }}
                    style={{ fontSize: 9, padding: '0 8px', height: 'auto' }}
                  >
                    Set Default
                  </button>
                </div>
                <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                  If set, screenshots, JSON inputs, and gameplay WebM videos will save directly to this path on your host filesystem. Leave empty to fallback to standard browser downloads.
                </span>
              </div>
            </div>

            <div className="settings-actions" style={{ flexWrap: 'wrap', gap: 6, display: 'flex' }}>
              <button className="btn-secondary" style={{ borderColor: 'color-mix(in srgb, var(--accent-danger) 50%, transparent)', color: 'var(--accent-pink)' }} onClick={clearDatabaseHistory}>
                CLEAR ALL DB DATA
              </button>
              <button className="btn-secondary" onClick={resetSliderConfigs}>
                RESET LIMITS
              </button>
              <button className="btn-primary" onClick={() => setShowSettings(false)}>
                CLOSE
              </button>
            </div>
          </div>
        )}
    </div>
  );
}