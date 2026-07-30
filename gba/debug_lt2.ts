// Debug "Layer toggle 2" (subtest #5) in cat13_video.test.ts
// Run: npx tsx debug_lt2.ts

import { GBA } from './src/core/gba.js';
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

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

// Boot to menu
for (let f = 0; f < 60; f++) gba.runFrame();

// Navigate to Cat 13 (Video)
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);

// Navigate to subtest #5 (4 downs)
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);

// Run 30 frames
for (let f = 0; f < 30; f++) gba.runFrame();

// Press LEFT → actual view → run 30 frames
press(keyLeftPressed);
for (let f = 0; f < 30; f++) gba.runFrame();

const actualBuffer = Uint32Array.from(gba.ppu.framebuffer);

console.log('=== ACTUAL VIEW STATE ===');
console.log('DISPCNT:', '0x' + gba.ppu.dispcnt.toString(16).padStart(4,'0'));
const bg0cntA = (gba.mem as any).readIO16(0x08);
const bg1cntA = (gba.mem as any).readIO16(0x0a);
console.log('BG0CNT:', '0x' + bg0cntA.toString(16));
console.log('BG1CNT:', '0x' + bg1cntA.toString(16));
console.log('palette[0]:', '0x' + ((gba.mem as any).palette[0] | ((gba.mem as any).palette[1] << 8)).toString(16).padStart(4,'0'));
if (gba.ppu.dispcntHistory) {
  console.log('dispcntHistory[0..7]:', Array.from({length:8}, (_,i) =>
    '0x'+gba.ppu.dispcntHistory[i].toString(16).padStart(4,'0')).join(' '));
}

console.log('\nActual pixels y=0..5 (first 8 cols):');
for (let y = 0; y <= 5; y++) {
  const row = Array.from({length:8}, (_,x) =>
    '0x'+actualBuffer[y*CANVAS_WIDTH+x].toString(16).padStart(8,'0'));
  console.log(`  y=${y}: ${row.join(' ')}`);
}

// Press RIGHT → expected view → run 30 frames
press(keyRightPressed);
for (let f = 0; f < 30; f++) gba.runFrame();

const expectedBuffer = Uint32Array.from(gba.ppu.framebuffer);

console.log('\n=== EXPECTED VIEW STATE ===');
console.log('DISPCNT:', '0x' + gba.ppu.dispcnt.toString(16).padStart(4,'0'));
if (gba.ppu.dispcntHistory) {
  console.log('dispcntHistory[0..7]:', Array.from({length:8}, (_,i) =>
    '0x'+gba.ppu.dispcntHistory[i].toString(16).padStart(4,'0')).join(' '));
}

console.log('\nExpected pixels y=0..5 (first 8 cols):');
for (let y = 0; y <= 5; y++) {
  const row = Array.from({length:8}, (_,x) =>
    '0x'+expectedBuffer[y*CANVAS_WIDTH+x].toString(16).padStart(8,'0'));
  console.log(`  y=${y}: ${row.join(' ')}`);
}

// Count mismatches
let mismatches = 0;
let firstMismatch: {x:number,y:number} | null = null;
for (let y = 0; y < CANVAS_HEIGHT; y++) {
  for (let x = 0; x < CANVAS_WIDTH; x++) {
    if (actualBuffer[y*CANVAS_WIDTH+x] !== expectedBuffer[y*CANVAS_WIDTH+x]) {
      mismatches++;
      if (!firstMismatch) firstMismatch = {x, y};
    }
  }
}
console.log(`\nTotal mismatches: ${mismatches} / ${CANVAS_WIDTH*CANVAS_HEIGHT}`);
if (firstMismatch) console.log(`First: (${firstMismatch.x}, ${firstMismatch.y})`);
