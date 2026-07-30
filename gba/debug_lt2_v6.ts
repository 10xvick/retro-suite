// debug_lt2_v6: track DISPCNT reads to find what the ROM computes as the test result
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

interface WR { cycle: number; val: number; pc: number; type: 'W'|'R'; }
const events: WR[] = [];

const mem = gba.mem as any;
// Hook write16
const origWrite16 = mem.write16?.bind(mem);
mem.write16 = function(addr: number, val: number) {
  if (addr === 0x04000000) events.push({ cycle: gba.cycles, val, pc: gba.cpu.r[15], type: 'W' });
  return origWrite16(addr, val);
};
// Hook read16
const origRead16 = mem.read16?.bind(mem);
mem.read16 = function(addr: number): number {
  const result = origRead16(addr);
  if (addr === 0x04000000) events.push({ cycle: gba.cycles, val: result, pc: gba.cpu.r[15], type: 'R' });
  return result;
};
// Also hook read8 since some code reads byte at 0x04000000 or 0x04000001
const origRead8 = mem.read8?.bind(mem);
mem.read8 = function(addr: number): number {
  const result = origRead8(addr);
  if (addr === 0x04000000 || addr === 0x04000001) events.push({ cycle: gba.cycles, val: result, pc: gba.cpu.r[15], type: 'R' });
  return result;
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

// === RUN 30 TEST FRAMES ===
events.length = 0;
const testStart = gba.cycles;
for (let f = 0; f < 30; f++) gba.runFrame();
const testEnd = gba.cycles;

const testDuration = testEnd - testStart;
const testEvents = events.filter(e => e.cycle >= testStart && e.cycle < testEnd);

// Annotate with frame and scanline
const annotated = testEvents.map(e => {
  const absFromStart = e.cycle - testStart;
  const totalLines = 228;
  const cyclesPerFrame = CYCLES_PER_LINE * totalLines;
  const frame = Math.floor(absFromStart / cyclesPerFrame);
  const cycleInFrame = absFromStart % cyclesPerFrame;
  const scanline = Math.floor(cycleInFrame / CYCLES_PER_LINE);
  const cycleInLine = cycleInFrame % CYCLES_PER_LINE;
  const phase = cycleInLine < 960 ? 'HDraw' : 'HBlank';
  return { ...e, frame, scanline, cycleInLine, phase };
});

// Show READS from DISPCNT (these reveal what the ROM computes as the result)
const reads = annotated.filter(e => e.type === 'R');
console.log(`=== DISPCNT READS during 30 test frames: ${reads.length} ===`);
reads.slice(0, 40).forEach(r =>
  console.log(`  frame=${r.frame} line=${r.scanline} cycle=${r.cycleInLine} [${r.phase}] val=0x${r.val.toString(16).padStart(4,'0')} PC=0x${r.pc.toString(16).padStart(8,'0')}`)
);

// Show all WRITES (to see the progression)
const writes = annotated.filter(e => e.type === 'W');
console.log(`\n=== DISPCNT WRITES during 30 test frames: ${writes.length} ===`);
writes.slice(0, 20).forEach(w =>
  console.log(`  frame=${w.frame} line=${w.scanline} cycle=${w.cycleInLine} [${w.phase}] val=0x${w.val.toString(16).padStart(4,'0')} PC=0x${w.pc.toString(16).padStart(8,'0')}`)
);

// Summary: which DISPCNT values were READ at each unique PC?
const readPCs = new Map<string, {count: number, vals: Set<number>}>();
for (const r of reads) {
  const key = `0x${r.pc.toString(16).padStart(8,'0')}`;
  if (!readPCs.has(key)) readPCs.set(key, {count: 0, vals: new Set()});
  const entry = readPCs.get(key)!;
  entry.count++;
  entry.vals.add(r.val);
}
console.log('\n=== DISPCNT read locations (PC) and values seen ===');
for (const [pc, info] of readPCs) {
  console.log(`  PC=${pc} x${info.count}: [${[...info.vals].map(v=>'0x'+v.toString(16).padStart(4,'0')).join(', ')}]`);
}

// Specifically: show last 5 reads before the end of test frames
console.log('\n=== Last 10 DISPCNT reads of test phase ===');
reads.slice(-10).forEach(r =>
  console.log(`  frame=${r.frame} line=${r.scanline} [${r.phase}] val=0x${r.val.toString(16).padStart(4,'0')} PC=0x${r.pc.toString(16).padStart(8,'0')}`)
);
