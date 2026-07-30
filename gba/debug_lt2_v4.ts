// debug_lt2_v4: cycle-precise DISPCNT write tracking per scanline
import { GBA } from './src/core/gba.js';
import { IO } from './src/core/memory.js';
import * as fs from 'fs';

const biosPath = 'public/roms/test/gba_bios.bin';
const romPath  = 'public/roms/test/suite.gba';
const CANVAS_WIDTH = 240;

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

// CYCLES_PER_LINE and VISIBLE_LINES constants
const CYCLES_PER_LINE = 1232;
const VISIBLE_LINES = 160;

// We need to track cycles within a scanline. Instrument writeIO16.
const mem = gba.mem as any;
let scanlineCycleStart = 0;  // total cycles at start of current scanline
let currentScanline = 0;

// Track writes: {scanline, cycleInLine, val, pc}
const writes: Array<{scanline: number, cycleInLine: number, val: number, pc: number}> = [];

const origWriteIO16 = mem.writeIO16?.bind(mem);
mem.writeIO16 = function(off: number, val: number) {
  if (off === 0x000) { // DISPCNT
    const cycle = gba.cycles - scanlineCycleStart;
    writes.push({scanline: currentScanline, cycleInLine: cycle, val, pc: gba.cpu.r[15]});
  }
  return origWriteIO16(off, val);
};

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

// Patch runFrame to track scanline cycle starts
// We'll instead run frame manually with per-scanline tracking
// But that's complex — let's instead track via cycle counter reset approach

// Boot + navigate
for (let f = 0; f < 60; f++) gba.runFrame();
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);

// Clear and track next frame
writes.length = 0;

// Patch gba.ts runFrame loop - we need to intercept per-scanline
// Since we can't easily patch the private loop, we'll use a different approach:
// Track writes per frame and deduce timing from known cycle budget
// 
// Instead, let's hook tickTimers to track scan position
// Or: after one frame, analyze which writes fall in the HBlank boundary

// Run one frame and analyze  
const cyclesBefore = gba.cycles;
gba.runFrame();
const cyclesAfter = gba.cycles;
const cyclesThisFrame = cyclesAfter - cyclesBefore;

console.log(`Frame cycles: ${cyclesThisFrame} (expected ${CYCLES_PER_LINE * 228} = ${CYCLES_PER_LINE * 228})`);
console.log(`Total DISPCNT writes this frame: ${writes.length}`);
console.log('\nUnique DISPCNT values:', [...new Set(writes.map(w => '0x'+w.val.toString(16).padStart(4,'0')))].join(', '));

// Analyze: group writes by "estimated scanline" based on cycle position
// Since we don't know exact scanline boundaries, use VCOUNT reading
// Instead: group by cycle ranges (every CYCLES_PER_LINE = 1232 cycles)
const writesPerScanline: Map<number, Array<{cycleInLine: number, val: number, pc: number}>> = new Map();
for (const w of writes) {
  const cycleInFrame = (w.cycleInLine - (cyclesBefore - cyclesBefore)); // relative
  // We don't have per-scanline cycle start, so group by N*CYCLES_PER_LINE
  // This is approximate since we reset after each frame
  const approxScanline = Math.floor((w.cycleInLine) / CYCLES_PER_LINE) % 228;
  if (!writesPerScanline.has(approxScanline)) writesPerScanline.set(approxScanline, []);
  writesPerScanline.get(approxScanline)!.push({
    cycleInLine: (w.cycleInLine) % CYCLES_PER_LINE,
    val: w.val,
    pc: w.pc
  });
}

// Print first 10 estimated scanlines
console.log('\nEstimated write timing per scanline:');
for (let sl = 0; sl < Math.min(15, VISIBLE_LINES); sl++) {
  const ws = writesPerScanline.get(sl) || [];
  if (ws.length > 0) {
    console.log(`  scanline ~${sl}:`);
    ws.slice(0, 5).forEach(w =>
      console.log(`    cycle ${w.cycleInLine} (${w.cycleInLine < 960 ? 'H-DRAW' : 'HBLANK'}) val=0x${w.val.toString(16).padStart(4,'0')} PC=0x${w.pc.toString(16).padStart(8,'0')}`)
    );
  }
}

// Better approach: print ABSOLUTE cycle offsets from frame start for first 30 writes
console.log('\nFirst 20 DISPCNT writes (absolute cycles since frame start):');
const frameCycleStart = cyclesBefore;
for (let i = 0; i < Math.min(20, writes.length); i++) {
  const w = writes[i];
  const absFromFrame = w.cycleInLine - frameCycleStart;
  console.log(`  #${i} abs_cycle=${absFromFrame} scanline~${Math.floor(absFromFrame/CYCLES_PER_LINE)} cycle_in_line~${absFromFrame%CYCLES_PER_LINE} (${absFromFrame%CYCLES_PER_LINE < 960?'H-DRAW':'HBLANK'}) val=0x${w.val.toString(16).padStart(4,'0')} PC=0x${w.pc.toString(16).padStart(8,'0')}`);
}

// Key question: what is DISPCNT at cycle 960 of line 3?
// Writes before cycle 960 of line 3 = writes with abs_cycle in [3*1232, 3*1232+959]
const line3Start = 3 * CYCLES_PER_LINE;
const line3HBlankStart = line3Start + 960;
const line3End = line3Start + CYCLES_PER_LINE;
const line3Writes = writes.filter(w => {
  const abs = w.cycleInLine - frameCycleStart;
  return abs >= line3Start && abs < line3End;
});
console.log(`\nLine 3 DISPCNT writes (abs cycles ${line3Start}-${line3End-1}):`);
line3Writes.forEach(w => {
  const abs = w.cycleInLine - frameCycleStart;
  const cyc = abs - line3Start;
  console.log(`  cycle_in_line=${cyc} (${cyc < 960 ? 'H-DRAW' : 'HBLANK'}) val=0x${w.val.toString(16).padStart(4,'0')} PC=0x${w.pc.toString(16).padStart(8,'0')}`);
});
const atHBlankStart = writes.filter(w => {
  const abs = w.cycleInLine - frameCycleStart;
  return abs < line3HBlankStart;
});
const lastBeforeHBlank = atHBlankStart.filter(w => {
  const abs = w.cycleInLine - frameCycleStart;
  return abs >= line3Start;
});
if (lastBeforeHBlank.length > 0) {
  const last = lastBeforeHBlank[lastBeforeHBlank.length - 1];
  console.log(`Last write BEFORE 960-cycle mark on line 3: 0x${last.val.toString(16).padStart(4,'0')} PC=0x${last.pc.toString(16).padStart(8,'0')}`);
} else {
  console.log('No writes before 960-cycle mark on line 3 (CPU was halted during H-Draw)');
}
