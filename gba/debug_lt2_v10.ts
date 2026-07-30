// Disassemble the ISR code after 0x0800affe to find the accumulation mechanism
// and trace what DISPCNT values the test sees during test frames
import { GBA } from './src/core/gba.js';
import { IO } from './src/core/memory.js';
import * as fs from 'fs';

const bios = new Uint8Array(fs.readFileSync('public/roms/test/gba_bios.bin'));
const cart = new Uint8Array(fs.readFileSync('public/roms/test/suite.gba'));

const gba = new GBA();
gba.loadBios(bios);
gba.loadCart(cart);
gba.reset();
gba.directBoot();

const keyReleased     = 0x03FF;
const keyDownPressed  = keyReleased & ~0x0080;
const keyAPressed     = keyReleased & ~1;

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

// Navigate to subtest 5 (Layer toggle 2)
for (let f = 0; f < 60; f++) gba.runFrame();
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);
// Now in subtest 5 - running TEST frames (30 frames before LEFT/RIGHT)
// Wait for the test to complete
for (let f = 0; f < 30; f++) gba.runFrame();

// ----- Hook: trace DISPCNT writes AND all PC-level info during the next frame -----
const writes: {frame:number, line:number, cy:number, val:number, pc:number}[] = [];
const origWrite16 = gba.mem.write16.bind(gba.mem);
gba.mem.write16 = (addr: number, val: number) => {
  if (addr === 0x04000000) {
    // Capture context
    const line = gba.mem.readIO16(IO.VCOUNT);
    // Approximate cycle via budget (not directly accessible, so just mark frame/line)
    writes.push({ frame: 0, line, cy: -1, val, pc: (gba.cpu as any).r[15] ?? 0 });
  }
  origWrite16(addr, val);
};

// Run ONE test frame while tracking
gba.runFrame();

console.log(`=== DISPCNT writes during 1 test frame (${writes.length} total) ===`);
for (const w of writes) {
  console.log(`  line=${w.line.toString().padStart(3)} val=0x${w.val.toString(16).padStart(4,'0')} pc=0x${w.pc.toString(16)}`);
}

// Now read IWRAM at key offsets to find the test result
// The ISR at 0x0800afec checks r3 (subtest index) and loads a fn ptr from 0x80472c8
// Accumulator is likely in IWRAM (0x03000000 range)
// Let's dump IWRAM 0x03000000-0x03000100 in 4-byte words
console.log('\n=== IWRAM 0x03000000-0x03000100 ===');
for (let addr = 0x03000000; addr < 0x03000100; addr += 4) {
  const v = gba.mem.read32(addr);
  if (v !== 0 && v !== 0xFFFFFFFF) {
    console.log(`  [0x${addr.toString(16)}] = 0x${v.toString(16).padStart(8,'0')}`);
  }
}

// Also read the ISR vector
const isrAddr = gba.mem.read32(0x03FFFFFC);
console.log(`\nUser ISR address: 0x${isrAddr.toString(16)}`);

// Read the handler table at 0x80472c8 (subtest index * 12 bytes each)
// r3 is the subtest index. For "Layer toggle 2", what's the subtest index?
// From the ISR: r3 comes from user mode - it must be a persistent register
// Let's read the table entries
console.log('\n=== Handler table at 0x80472c8 (entries 0-6, 12 bytes each) ===');
for (let i = 0; i <= 6; i++) {
  const base = 0x80472c8 + i * 12;
  const w0 = gba.mem.read32(base);
  const w1 = gba.mem.read32(base + 4);
  const w2 = gba.mem.read32(base + 8);
  console.log(`  [${i}] fn=0x${w0.toString(16)} data1=0x${w1.toString(16)} data2=0x${w2.toString(16)}`);
}

// Disassemble the ISR from 0x0800b000 to 0x0800b060
// (ARM THUMB code after the handler table lookup at 0x0800affe)
console.log('\n=== ROM bytes 0x0800b000-0x0800b060 (raw) ===');
for (let addr = 0x0800b000; addr < 0x0800b060; addr += 2) {
  const half = gba.mem.read16(addr);
  process.stdout.write(`${addr.toString(16)}: ${half.toString(16).padStart(4,'0')}  `);
}
console.log('');
