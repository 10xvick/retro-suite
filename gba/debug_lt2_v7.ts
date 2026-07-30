// Track DISPCNT writes/reads during ACTUAL VIEW (after pressing LEFT)
import { GBA } from './src/core/gba.js';
import { IO } from './src/core/memory.js';
import * as fs from 'fs';

const bios = new Uint8Array(fs.readFileSync('public/roms/test/gba_bios.bin'));
const cart = new Uint8Array(fs.readFileSync('public/roms/test/suite.gba'));

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
const CYCLES_PER_FRAME = CYCLES_PER_LINE * 228;

interface Ev { cycle: number; addr: number; val: number; pc: number; type: 'W'|'R'; }
const events: Ev[] = [];

const mem = gba.mem as any;
const origWrite16 = mem.write16?.bind(mem);
mem.write16 = function(addr: number, val: number) {
  if (addr === 0x04000000) {
    events.push({ cycle: gba.cycles, addr, val, pc: gba.cpu.r[15], type: 'W' });
  }
  return origWrite16(addr, val);
};
const origRead16 = mem.read16?.bind(mem);
mem.read16 = function(addr: number): number {
  const r = origRead16(addr);
  if (addr === 0x04000000) {
    events.push({ cycle: gba.cycles, addr, val: r, pc: gba.cpu.r[15], type: 'R' });
  }
  return r;
};

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

// Navigate to Layer toggle 2 (subtest 5 of category 13)
for (let f = 0; f < 60; f++) gba.runFrame();
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);

// Run 30 test frames
for (let f = 0; f < 30; f++) gba.runFrame();

// Press LEFT (actual view)
events.length = 0;
const viewStart = gba.cycles;
gba.mem.setKeyInput(keyLeftPressed);
for (let f = 0; f < 2; f++) gba.runFrame();  // first 2 frames of actual view
gba.mem.setKeyInput(keyReleased);

// Annotate
function annotate(e: Ev) {
  const abs = e.cycle - viewStart;
  const frame = Math.floor(abs / CYCLES_PER_FRAME);
  const cycleInFrame = abs % CYCLES_PER_FRAME;
  const scanline = Math.floor(cycleInFrame / CYCLES_PER_LINE);
  const cycleInLine = cycleInFrame % CYCLES_PER_LINE;
  const phase = cycleInLine < 960 ? 'HDraw' : 'HBlnk';
  return { ...e, frame, scanline, cycleInLine, phase };
}

const annotated = events.map(annotate);

// Show all DISPCNT writes in actual view
const writes = annotated.filter(e => e.type === 'W');
console.log(`=== DISPCNT writes during ACTUAL VIEW (first 2 frames): ${writes.length} total ===`);
writes.slice(0, 50).forEach(e =>
  console.log(`  frame=${e.frame} line=${e.scanline} cy=${e.cycleInLine} [${e.phase}] val=0x${e.val.toString(16).padStart(4,'0')} PC=0x${e.pc.toString(16).padStart(8,'0')}`)
);

// Show reads
const reads = annotated.filter(e => e.type === 'R');
console.log(`\n=== DISPCNT reads during ACTUAL VIEW (first 2 frames): ${reads.length} total ===`);
reads.slice(0, 20).forEach(e =>
  console.log(`  frame=${e.frame} line=${e.scanline} cy=${e.cycleInLine} [${e.phase}] val=0x${e.val.toString(16).padStart(4,'0')} PC=0x${e.pc.toString(16).padStart(8,'0')}`)
);

// After these frames, what's DISPCNT?
console.log(`\nDISPCNT after actual view frames: 0x${(gba.mem as any).ioView.getUint16(0, true).toString(16)}`);
console.log(`Last 5 writes:`, writes.slice(-5).map(e => `line=${e.scanline} val=0x${e.val.toString(16).padStart(4,'0')} PC=0x${e.pc.toString(16).padStart(8,'0')}`));
