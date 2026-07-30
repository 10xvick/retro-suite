// Track DISPSTAT writes to find VCount trigger values and HBlank enable
import { GBA } from './src/core/gba.js';
import { IO } from './src/core/memory.js';
import * as fs from 'fs';

const bios = new Uint8Array(fs.readFileSync('public/roms/test/gba_bios.bin'));
const cart = new Uint8Array(fs.readFileSync('public/roms/test/suite.gba'));

const keyReleased    = 0x03FF;
const keyAPressed    = keyReleased & ~1;
const keyDownPressed = keyReleased & ~0x0080;

const gba = new GBA();
gba.loadBios(bios);
gba.loadCart(cart);
gba.reset();
gba.directBoot();

const CYCLES_PER_LINE = 1232;

interface Ev { cycle: number; addr: number; val: number; pc: number; type: 'W'|'R'; }
const events: Ev[] = [];

const mem = gba.mem as any;
const origWrite16 = mem.write16?.bind(mem);
mem.write16 = function(addr: number, val: number) {
  if (addr === 0x04000000 || addr === 0x04000004 || addr === 0x04000208 || addr === 0x04000200) {
    events.push({ cycle: gba.cycles, addr, val, pc: gba.cpu.r[15], type: 'W' });
  }
  return origWrite16(addr, val);
};

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

for (let f = 0; f < 60; f++) gba.runFrame();
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);

// Run 3 test frames and analyze
events.length = 0;
const frameStart = gba.cycles;
for (let f = 0; f < 3; f++) gba.runFrame();

const CYCLES_PER_FRAME = CYCLES_PER_LINE * 228;
const ev1 = events.map(e => {
  const abs = e.cycle - frameStart;
  const frame = Math.floor(abs / CYCLES_PER_FRAME);
  const cycleInFrame = abs % CYCLES_PER_FRAME;
  const scanline = Math.floor(cycleInFrame / CYCLES_PER_LINE);
  const cycleInLine = cycleInFrame % CYCLES_PER_LINE;
  const phase = cycleInLine < 960 ? 'HDraw' : 'HBlnk';
  return { ...e, frame, scanline, cycleInLine, phase };
});

// Show DISPSTAT writes to understand IRQ enable and VCount trigger
const dispstatWrites = ev1.filter(e => e.addr === 0x04000004);
console.log('=== DISPSTAT writes (unique values by PC) ===');
const dsPcMap = new Map<string, Set<number>>();
for (const e of dispstatWrites) {
  const key = `0x${e.pc.toString(16).padStart(8,'0')}`;
  if (!dsPcMap.has(key)) dsPcMap.set(key, new Set());
  dsPcMap.get(key)!.add(e.val);
}
for (const [pc, vals] of dsPcMap) {
  console.log(`  PC=${pc}: [${[...vals].map(v=>'0x'+v.toString(16).padStart(8,'0')).join(', ')}]`);
}

// Show first 20 DISPSTAT writes per frame 0
const frame0ds = dispstatWrites.filter(e => e.frame === 0);
console.log(`\nFrame 0 DISPSTAT writes (first 30):`);
frame0ds.slice(0, 30).forEach(e =>
  console.log(`  line=${e.scanline} cy=${e.cycleInLine} [${e.phase}] val=0x${e.val.toString(16).padStart(8,'0')} PC=0x${e.pc.toString(16).padStart(8,'0')}`)
);

// Show DISPCNT writes for frame 0
const dispcntWrites = ev1.filter(e => e.addr === 0x04000000 && e.frame === 0);
console.log(`\nFrame 0 DISPCNT writes:`);
dispcntWrites.forEach(e =>
  console.log(`  line=${e.scanline} cy=${e.cycleInLine} [${e.phase}] val=0x${e.val.toString(16).padStart(4,'0')} PC=0x${e.pc.toString(16).padStart(8,'0')}`)
);

// IME/IE writes
const imeWrites = ev1.filter(e => (e.addr === 0x04000208 || e.addr === 0x04000200) && e.frame === 0);
console.log(`\nFrame 0 IME/IE writes:`);
imeWrites.slice(0,10).forEach(e =>
  console.log(`  addr=0x${e.addr.toString(16)} line=${e.scanline} val=0x${e.val.toString(16).padStart(4,'0')} PC=0x${e.pc.toString(16).padStart(8,'0')}`)
);
