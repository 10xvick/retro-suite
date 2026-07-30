// Enhanced debug for Layer toggle 2 - track DISPCNT writes during test execution
// Run: npx tsx debug_lt2_v2.ts
import { GBA } from './src/core/gba.js';
import { Memory, IO } from './src/core/memory.js';
import * as fs from 'fs';

const biosPath = 'public/roms/test/gba_bios.bin';
const romPath  = 'public/roms/test/suite.gba';
const CANVAS_WIDTH = 240;
const CANVAS_HEIGHT = 144;

const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

const keyReleased    = 0x03FF;
const keyAPressed    = keyReleased & ~1;
const keyDownPressed = keyReleased & ~0x0080;
const keyLeftPressed = keyReleased & ~0x0020;
const keyRightPressed= keyReleased & ~0x0010;

const gba = new GBA();
gba.loadBios(bios);
gba.loadCart(cart);
gba.reset();
gba.directBoot();

// Track all DISPCNT writes  
const dispcntWrites: Array<{cycle: number, val: number, pc: number}> = [];
const origWrite16 = gba.mem.write16.bind(gba.mem);
(gba.mem as any).write16 = function(addr: number, val: number) {
  if ((addr & 0xFFFFFF) === 0x4000000) {
    dispcntWrites.push({cycle: gba.cycles, val, pc: (gba as any).cpu.r[15]});
  }
  return origWrite16(addr, val);
};

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

// Boot
for (let f = 0; f < 60; f++) gba.runFrame();
// Navigate to Cat 13
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);
// Navigate to subtest #5
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);

// Clear write tracking before the actual test
dispcntWrites.length = 0;
const startCycle = gba.cycles;

// Run 30 frames (the test execution)
for (let f = 0; f < 30; f++) gba.runFrame();

console.log(`=== DISPCNT writes during 30 test frames (${dispcntWrites.length} writes) ===`);
// Show first and last 20 writes
const first = dispcntWrites.slice(0, 15);
const last = dispcntWrites.slice(-15);
first.forEach(w => console.log(`  cycle+${w.cycle-startCycle}: 0x${w.val.toString(16).padStart(4,'0')} from PC=0x${w.pc.toString(16).padStart(8,'0')}`));
if (dispcntWrites.length > 30) console.log(`  ... ${dispcntWrites.length - 30} more writes ...`);
last.forEach(w => console.log(`  cycle+${w.cycle-startCycle}: 0x${w.val.toString(16).padStart(4,'0')} from PC=0x${w.pc.toString(16).padStart(8,'0')}`));

// Get unique DISPCNT values written
const uniqueVals = [...new Set(dispcntWrites.map(w => w.val))];
console.log('\nUnique DISPCNT values written:', uniqueVals.map(v => '0x'+v.toString(16).padStart(4,'0')).join(', '));

console.log('\n=== DISPCNT at end of 30 test frames ===');
console.log('DISPCNT:', '0x'+gba.ppu.dispcnt.toString(16).padStart(4,'0'));

// Press LEFT and track writes during display
dispcntWrites.length = 0;
press(keyLeftPressed);
const leftStartCycle = gba.cycles;

for (let f = 0; f < 30; f++) gba.runFrame();

console.log(`\n=== DISPCNT writes during LEFT display (${dispcntWrites.length} writes) ===`);
const leftFirst = dispcntWrites.slice(0, 20);
leftFirst.forEach(w => console.log(`  cycle+${w.cycle-leftStartCycle}: 0x${w.val.toString(16).padStart(4,'0')} from PC=0x${w.pc.toString(16).padStart(8,'0')}`));
if (dispcntWrites.length > 20) console.log(`  ... ${dispcntWrites.length - 20} more`);

const actualBuffer = Uint32Array.from(gba.ppu.framebuffer);
console.log('\nActual pixels y=3:', Array.from({length:8}, (_,x) => '0x'+actualBuffer[3*CANVAS_WIDTH+x].toString(16).padStart(8,'0')).join(' '));
