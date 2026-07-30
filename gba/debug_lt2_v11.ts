// Focus: what is the handler table, and what does the ISR actually call?
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

for (let f = 0; f < 60; f++) gba.runFrame();
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);

// Track WHAT THE ISR READS as VCOUNT at entry
const isrEntries: {line: number, r2: number, r3: number, frame: number}[] = [];
let frameCount = 0;

// Hook the ISR entry: PC=0x0800afec is where ISR starts
// We can't hook PC directly, but we can watch for when the ISR dispatch happens
// Instead: let's hook memory writes more carefully - track WHAT toggle is called with

// Track all toggle inputs (r3 at 0x0800aef0 = toggle function entry)
const toggleCalls: {frame: number, line: number, r3: number, action: string}[] = [];

// The toggle function is at 0x0800aef0
// We need to know what r3 is when it's called
// Simplest: hook the DISPCNT write AND track what the VCOUNT IO says at that moment

const writes: {line: number, vcount: number, val: number, pc: number}[] = [];
const origW = gba.mem.write16.bind(gba.mem);
gba.mem.write16 = (addr: number, val: number) => {
  if (addr === 0x04000000) {
    const vcount = gba.mem.readIO16(IO.VCOUNT);
    writes.push({ line: vcount, vcount, val, pc: (gba.cpu as any).r[15] ?? 0 });
  }
  origW(addr, val);
};

for (let f = 0; f < 2; f++) {
  gba.runFrame();
  frameCount++;
}

// Print write pattern for frame 1
console.log('=== DISPCNT writes (frame 1-2, only splits where VCOUNT changes mid-ISR) ===');
for (let i = 0; i < writes.length - 1; i++) {
  const curr = writes[i];
  const next = writes[i+1];
  if (next.vcount !== curr.vcount && next.vcount === curr.vcount + 1) {
    // The VCOUNT changed between write i and write i+1
    console.log(`[SPLIT] write ${i}: VCOUNT=${curr.vcount} val=0x${curr.val.toString(16)} pc=0x${curr.pc.toString(16)}`);
    console.log(`        write ${i+1}: VCOUNT=${next.vcount} val=0x${next.val.toString(16)} pc=0x${next.pc.toString(16)}`);
    // Show context
    const prev = i > 0 ? writes[i-1] : null;
    if (prev) console.log(`        write ${i-1}: VCOUNT=${prev.vcount} val=0x${prev.val.toString(16)} pc=0x${prev.pc.toString(16)}`);
  }
}

// Key question: when does VCOUNT change during the ISR?
// VCOUNT should ONLY change at the START of each scanline's iteration in gba.ts
// If the ISR spans the scanline boundary, VCOUNT changes mid-ISR

// Now read the handler table
console.log('\n=== Handler table at 0x80472c8 ===');
for (let i = 0; i <= 6; i++) {
  const base = 0x80472c8 + i * 12;
  const fnAddr = gba.mem.read32(base);
  const d1 = gba.mem.read32(base + 4);
  const d2 = gba.mem.read32(base + 8);
  console.log(`  [${i}] fn=0x${fnAddr.toString(16).padStart(8,'0')} d1=0x${d1.toString(16).padStart(8,'0')} d2=0x${d2.toString(16).padStart(8,'0')}`);
}

// Disassemble handler for subtest 4 (0-indexed)
// Need to figure out: what is r3 at ISR entry? It's the subtest index in user mode.
// The main loop has r3 = subtest_index. For layer toggle 2, that's probably 4 or 5.
// Let's check by looking at the function pointer loaded for r3=4 vs r3=5
for (let r3 = 0; r3 <= 6; r3++) {
  const base = 0x80472c8 + r3 * 12;
  const fn = gba.mem.read32(base) & ~1; // clear THUMB bit
  // Read 20 halfwords from the function
  const words: string[] = [];
  for (let i = 0; i < 20; i++) {
    words.push(gba.mem.read16(fn + i*2).toString(16).padStart(4,'0'));
  }
  console.log(`  Handler[${r3}] at 0x${fn.toString(16)}: ${words.join(' ')}`);
}

// Also check IWRAM for test result storage
console.log('\n=== IWRAM scan (non-zero, non-0xdeadbeef) ===');
for (let addr = 0x03000000; addr < 0x03008000; addr += 4) {
  const v = gba.mem.read32(addr);
  if (v !== 0 && v !== 0xFFFFFFFF && v !== 0xDEADBEEF && v !== 0x03000000) {
    const txt = `0x${addr.toString(16)}: 0x${v.toString(16).padStart(8,'0')}`;
    // Only print addresses that look like test results (small positive integers or DISPCNT values)
    if (v < 1000 || v === 0x1040 || v === 0x1140 || (v >= 0x08000000 && v < 0x0a000000)) {
      console.log('  ' + txt);
    }
  }
}

// What about EWRAM?
console.log('\n=== EWRAM scan (non-zero) ===');
for (let addr = 0x02000000; addr < 0x02008000; addr += 4) {
  const v = gba.mem.read32(addr);
  if (v !== 0 && v !== 0xFFFFFFFF) {
    if (v < 1000 || v === 0x1040 || v === 0x1140 || (v >= 0x08000000 && v < 0x0a000000)) {
      console.log(`  0x${addr.toString(16)}: 0x${v.toString(16).padStart(8,'0')}`);
    }
  }
}
