// Compare actual vs expected dispcntHistory for Layer Toggle 2
import { GBA } from './src/core/gba.js';
import { IO } from './src/core/memory.js';
import * as fs from 'fs';

const bios = new Uint8Array(fs.readFileSync('public/roms/test/gba_bios.bin'));
const cart = new Uint8Array(fs.readFileSync('public/roms/test/suite.gba'));

const keyReleased    = 0x03FF;
const keyAPressed    = keyReleased & ~1;
const keyDownPressed = keyReleased & ~0x0080;
const keyLeftPressed = keyReleased & ~0x0020;
const keyRightPressed = keyReleased & ~0x0010;

function makeGba() {
  const g = new GBA();
  g.loadBios(bios); g.loadCart(cart);
  g.reset(); g.directBoot();
  return g;
}

function press(g: GBA, k: number) {
  g.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) g.runFrame();
  g.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) g.runFrame();
}

function navigate(g: GBA) {
  for (let f = 0; f < 60; f++) g.runFrame();
  for (let i = 0; i < 13; i++) press(g, keyDownPressed);
  press(g, keyAPressed);
  for (let i = 0; i < 4; i++) press(g, keyDownPressed);
  press(g, keyAPressed);
  for (let f = 0; f < 30; f++) g.runFrame();
}

// Run ACTUAL VIEW
const gbaA = makeGba();
navigate(gbaA);
press(gbaA, keyLeftPressed);
// Capture dispcntHistory from 30 actual-view frames
const actualHistories: number[][] = [];
for (let f = 0; f < 5; f++) {
  gbaA.runFrame();
  actualHistories.push(Array.from((gbaA.ppu as any).dispcntHistory).slice(0, 160) as number[]);
}
const actualFB = Uint32Array.from(gbaA.ppu.framebuffer);

// Run EXPECTED VIEW (same instance, press RIGHT)
press(gbaA, keyRightPressed);
const expectedHistories: number[][] = [];
for (let f = 0; f < 5; f++) {
  gbaA.runFrame();
  expectedHistories.push(Array.from((gbaA.ppu as any).dispcntHistory).slice(0, 160) as number[]);
}
const expectedFB = Uint32Array.from(gbaA.ppu.framebuffer);

// Compare dispcntHistories (last frame of each)
const aH = actualHistories[4];
const eH = expectedHistories[4];

console.log('=== dispcntHistory comparison (frame 4 = 5th frame) ===');
console.log('Line | Actual DISPCNT | Expected DISPCNT | Match');
let mismatchLines = 0;
for (let i = 0; i < 160; i++) {
  const match = aH[i] === eH[i];
  if (!match) {
    mismatchLines++;
    if (mismatchLines <= 30) {
      console.log(`  ${String(i).padStart(3)}: 0x${aH[i].toString(16).padStart(4,'0')} vs 0x${eH[i].toString(16).padStart(4,'0')} ❌`);
    }
  }
}
console.log(`Total mismatching lines: ${mismatchLines}/160`);

// Pixel comparison
let matching = 0;
for (let i = 0; i < actualFB.length; i++) {
  if (actualFB[i] === expectedFB[i]) matching++;
}
const pct = (matching / actualFB.length * 100).toFixed(2);
console.log(`\nPixel match: ${matching}/${actualFB.length} (${pct}%)`);

// Show unique dispcntHistory values in actual
const uniqueActual = new Set(aH);
const uniqueExpected = new Set(eH);
console.log(`\nActual unique dispcnt values: ${[...uniqueActual].map(v => '0x'+v.toString(16)).join(', ')}`);
console.log(`Expected unique dispcnt values: ${[...uniqueExpected].map(v => '0x'+v.toString(16)).join(', ')}`);

// Show first 20 lines of each
console.log('\nActual lines 0-19:', aH.slice(0,20).map(v => '0x'+v.toString(16)));
console.log('Expected lines 0-19:', eH.slice(0,20).map(v => '0x'+v.toString(16)));
