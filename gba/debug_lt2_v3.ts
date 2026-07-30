// Enhanced debug v3 - correct address intercept for DISPCNT
import { GBA } from './src/core/gba.js';
import { IO } from './src/core/memory.js';
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

// Hook writeIO on Memory object (DISPCNT is IO offset 0x000)
const dispcntWrites: Array<{frameNum: number, val: number, pc: number, path: string}> = [];
let frameNum = 0;

// Intercept the writeIO internal method  
const mem = gba.mem as any;
const origWriteIO = mem.writeIO?.bind(mem);
if (origWriteIO) {
  mem.writeIO = function(off: number, val: number, size: number) {
    // DISPCNT at IO offset 0x000 (2 bytes)
    if (off === 0x000 || (off === 0x000 && size >= 2)) {
      const mask = size === 1 ? 0xFF : size === 2 ? 0xFFFF : 0xFFFFFFFF;
      const dispcntVal = val & 0xFFFF;
      dispcntWrites.push({frameNum, val: dispcntVal, pc: gba.cpu.r[15], path: `writeIO(off=${off.toString(16)},size=${size})`});
    }
    return origWriteIO(off, val, size);
  };
} else {
  console.log('WARNING: writeIO not interceptable (might be private)');
}

// Also hook writeIO16 (public method used from gba.ts)
const origWriteIO16 = mem.writeIO16?.bind(mem);
if (origWriteIO16) {
  mem.writeIO16 = function(off: number, val: number) {
    if (off === 0x000) {
      dispcntWrites.push({frameNum, val, pc: gba.cpu.r[15], path: `writeIO16(0x${off.toString(16)})`});
    }
    return origWriteIO16(off, val);
  };
}

// Also hook write16 and write32 to catch CPU writes
const origWrite16 = mem.write16?.bind(mem);
if (origWrite16) {
  mem.write16 = function(addr: number, val: number) {
    if (addr === 0x04000000) {
      dispcntWrites.push({frameNum, val, pc: gba.cpu.r[15], path: `write16(0x${addr.toString(16)})`});
    }
    return origWrite16(addr, val);
  };
}

const origWrite32 = mem.write32?.bind(mem);
if (origWrite32) {
  mem.write32 = function(addr: number, val: number) {
    if (addr === 0x04000000 || addr === 0x04000001 || addr === 0x03FFFFFF) {
      dispcntWrites.push({frameNum, val: val & 0xFFFF, pc: gba.cpu.r[15], path: `write32(0x${addr.toString(16)})`});
    }
    return origWrite32(addr, val);
  };
}

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) { gba.runFrame(); frameNum++; }
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) { gba.runFrame(); frameNum++; }
};

// Boot + navigate
for (let f = 0; f < 60; f++) { gba.runFrame(); frameNum++; }
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);

// Clear and run 30 test frames
dispcntWrites.length = 0;
frameNum = 0;
for (let f = 0; f < 30; f++) { gba.runFrame(); frameNum++; }

console.log(`=== DISPCNT writes in 30 test frames: ${dispcntWrites.length} ===`);
dispcntWrites.slice(0, 30).forEach(w =>
  console.log(`  frame=${w.frameNum} PC=0x${w.pc.toString(16).padStart(8,'0')} val=0x${w.val.toString(16).padStart(4,'0')} via ${w.path}`)
);
if (dispcntWrites.length > 30) console.log(`  ... ${dispcntWrites.length - 30} more`);

const uniqueVals = [...new Set(dispcntWrites.map(w => '0x'+w.val.toString(16).padStart(4,'0')))];
console.log('Unique DISPCNT values:', uniqueVals.join(', '));
console.log('Final DISPCNT:', '0x'+gba.ppu.dispcnt.toString(16).padStart(4,'0'));

// Press LEFT
dispcntWrites.length = 0;
frameNum = 0;
press(keyLeftPressed);
for (let f = 0; f < 30; f++) { gba.runFrame(); frameNum++; }

const actualBuffer = Uint32Array.from(gba.ppu.framebuffer);
console.log(`\n=== DISPCNT writes in LEFT display: ${dispcntWrites.length} ===`);
dispcntWrites.slice(0, 20).forEach(w =>
  console.log(`  frame=${w.frameNum} PC=0x${w.pc.toString(16).padStart(8,'0')} val=0x${w.val.toString(16).padStart(4,'0')} via ${w.path}`)
);
const uniqueValsLeft = [...new Set(dispcntWrites.map(w => '0x'+w.val.toString(16).padStart(4,'0')))];
console.log('Unique DISPCNT values in LEFT mode:', uniqueValsLeft.join(', '));
console.log('dispcntHistory[0..5]:', Array.from({length:6}, (_,i) => '0x'+gba.ppu.dispcntHistory[i].toString(16).padStart(4,'0')).join(' '));
console.log('Actual y=3:', Array.from({length:6}, (_,x) => '0x'+actualBuffer[3*CANVAS_WIDTH+x].toString(16).padStart(8,'0')).join(' '));
