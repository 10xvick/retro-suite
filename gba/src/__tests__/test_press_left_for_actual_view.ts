import { GBA } from '../core/gba.js';
import { saveBufferAsPng } from './png_encoder.js';
import * as fs from 'fs';
import * as path from 'path';

const biosPath = path.resolve('gba/public/roms/test/gba_bios.bin');
const romPath = path.resolve('gba/public/roms/test/suite.gba');

const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

const artifactDir = `C:\\Users\\Priya singh\\.gemini\\antigravity\\brain\\5de04d41-642a-4685-8a1d-5a40cdba0c64`;

const keyReleased = 0x03FF;
const keyAPressed = 0x03FF & ~1;
const keyDownPressed = 0x03FF & ~0x0080;
const keyLeftPressed = 0x03FF & ~0x0020;
const keyRightPressed = 0x03FF & ~0x0010;

const gba = new GBA();
gba.loadBios(bios);
gba.loadCart(cart);
gba.reset();
gba.directBoot();

for (let f = 0; f < 60; f++) gba.runFrame();

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed); // Enter Subtest 1

for (let f = 0; f < 30; f++) gba.runFrame();

// 1. Press LEFT to view Actual screen (with "Actual" text badge at bottom)
press(keyLeftPressed);
for (let f = 0; f < 30; f++) gba.runFrame();
gba.ppu.renderFrame();
const actualViewBuffer = new Uint32Array(gba.ppu.framebuffer);

// 2. Press RIGHT to view Expected screen (with "Expected" text badge at bottom)
press(keyRightPressed);
for (let f = 0; f < 30; f++) gba.runFrame();
gba.ppu.renderFrame();
const expectedViewBuffer = new Uint32Array(gba.ppu.framebuffer);

console.log("=== TESTING PRESS LEFT FOR ACTUAL VIEW IN SUBTEST 1 ===");
console.log("Actual View DISPCNT:", `0x${gba.ppu.dispcnt.toString(16)}`);

const actualPngPath = path.join(artifactDir, `actual_subtest_1_with_actual_text.png`);
const expectedPngPath = path.join(artifactDir, `expected_subtest_1_with_expected_text.png`);

saveBufferAsPng(240, 160, actualViewBuffer, actualPngPath);
saveBufferAsPng(240, 160, expectedViewBuffer, expectedPngPath);
