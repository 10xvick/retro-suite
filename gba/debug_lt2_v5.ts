// debug_lt2_v5: cycle-precise DISPCNT timing via write16 hook
import { GBA } from './src/core/gba.js';
import { IO } from './src/core/memory.js';
import * as fs from 'fs';

const biosPath = 'public/roms/test/gba_bios.bin';
const romPath  = 'public/roms/test/suite.gba';
const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

const keyReleased    = 0x03FF;
const keyAPressed    = keyReleased & ~1;
const keyDownPressed = keyReleased & ~0x0080;
const keyLeftPressed = keyReleased & ~0x0020;

const gba = new GBA();
gba.loadBios(bios);
gba.loadCart(cart);
gba.reset();
gba.directBoot();

const CYCLES_PER_LINE = 1232;

interface Write { cycle: number; val: number; pc: number; }
const writes: Write[] = [];

// Hook write16 (CPU path for DISPCNT writes)
const mem = gba.mem as any;
const origWrite16 = mem.write16?.bind(mem);
mem.write16 = function(addr: number, val: number) {
  if (addr === 0x04000000) {
    writes.push({ cycle: gba.cycles, val, pc: gba.cpu.r[15] });
  }
  return origWrite16(addr, val);
};

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

// Boot + navigate to Layer toggle 2
for (let f = 0; f < 60; f++) gba.runFrame();
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);

// Run exactly 1 test frame and analyze
writes.length = 0;
const frameStart = gba.cycles;
gba.runFrame();

console.log(`Total DISPCNT writes in 1 test frame: ${writes.length}`);

// Compute per-write timing
const timed = writes.map(w => {
  const abs = w.cycle - frameStart;
  const scanline = Math.floor(abs / CYCLES_PER_LINE);
  const cycleInLine = abs % CYCLES_PER_LINE;
  const phase = cycleInLine < 960 ? 'H-DRAW' : 'HBlank';
  return { scanline, cycleInLine, phase, val: w.val, pc: w.pc };
});

// Print per scanline breakdown (first 12 visible lines)
console.log('\nDISPCNT writes per scanline (first 12 lines):');
for (let sl = 0; sl < 12; sl++) {
  const ws = timed.filter(t => t.scanline === sl);
  if (ws.length > 0) {
    console.log(`  line ${sl}:`);
    ws.forEach(w =>
      console.log(`    cycle ${w.cycleInLine} [${w.phase}] val=0x${w.val.toString(16).padStart(4,'0')} PC=0x${w.pc.toString(16).padStart(8,'0')}`)
    );
  } else {
    console.log(`  line ${sl}: (no writes — CPU halted)`);
  }
}

// For each line, what's DISPCNT at cycle 960 (HBlank start)?
console.log('\nDISPCNT at HBlank start (cycle 960) per line:');
for (let sl = 0; sl < 12; sl++) {
  // All writes BEFORE the 960-mark of this scanline
  const before = timed.filter(t => t.scanline === sl && t.cycleInLine < 960);
  const allBefore = timed.filter(t => t.scanline < sl); // from previous lines
  
  let dispcntAtHBlank = 0x0000; // initial (reset)
  // Last write before this scanline's HBlank
  const relevantWrites = [...allBefore, ...before];
  if (relevantWrites.length > 0) {
    dispcntAtHBlank = relevantWrites[relevantWrites.length - 1].val;
  }
  
  const afterWrites = timed.filter(t => t.scanline === sl && t.cycleInLine >= 960);
  const dispcntAtEndHBlank = afterWrites.length > 0 ? afterWrites[afterWrites.length - 1].val : dispcntAtHBlank;
  
  console.log(`  line ${sl}: @HBlank=0x${dispcntAtHBlank.toString(16).padStart(4,'0')} after-HBlank=0x${dispcntAtEndHBlank.toString(16).padStart(4,'0')}`);
}
