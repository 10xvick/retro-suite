import { GBA } from '../core/gba.js';
import { saveBufferAsPng } from './png_encoder.js';
import * as fs from 'fs';
import * as path from 'path';

const biosPath = path.resolve('gba/public/roms/test/gba_bios.bin');
const romPath = path.resolve('gba/public/roms/test/suite.gba');

const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

const VIDEO_SUBTESTS = [
  { id: 1, name: "Basic Mode 3",             setup: 0x0800a5c9, render: 0x0800a659, menuDowns: 0 },
  { id: 2, name: "Basic Mode 4",             setup: 0x0800a5c9, render: 0x0800a965, menuDowns: 1 },
  { id: 3, name: "Degenerate OBJ transforms", setup: 0x0800b639, render: 0x0800aba5, menuDowns: 2 },
  { id: 4, name: "Layer toggle",              setup: 0x0800b4d9, render: 0x0800bb39, menuDowns: 3 },
  { id: 5, name: "Layer toggle 2",            setup: 0x0800b0bd, render: 0x0800ba69, menuDowns: 4 },
  { id: 6, name: "OAM Update Delay",         setup: 0x0800bc05, render: 0x0800b949, menuDowns: 5 },
  { id: 7, name: "Window offscreen reset",    setup: 0x0800ae55, render: 0x0800adbd, menuDowns: 6 }
];

const artifactDir = `C:\\Users\\Priya singh\\.gemini\\antigravity\\brain\\5de04d41-642a-4685-8a1d-5a40cdba0c64`;

const keyReleased = 0x03FF;
const keyAPressed = 0x03FF & ~1;
const keyDownPressed = 0x03FF & ~0x0080;
const keyLeftPressed = 0x03FF & ~0x0020;

console.log("=== GENERATING DISTINCT ACTUAL (Actual Badge) vs EXPECTED (Expected Badge) PAIRS ===");

for (const sub of VIDEO_SUBTESTS) {
  // A) Render Live Graphics View (press LEFT if needed or run setup+render with BG0 text overlay)
  const gbaLive = new GBA();
  gbaLive.loadBios(bios);
  gbaLive.loadCart(cart);
  gbaLive.reset();
  gbaLive.directBoot();

  for (let f = 0; f < 60; f++) gbaLive.runFrame();

  const press = (k: number) => {
    gbaLive.mem.setKeyInput(k);
    for (let f = 0; f < 8; f++) gbaLive.runFrame();
    gbaLive.mem.setKeyInput(keyReleased);
    for (let f = 0; f < 8; f++) gbaLive.runFrame();
  };

  for (let i = 0; i < 13; i++) press(keyDownPressed);
  press(keyAPressed);

  for (let i = 0; i < sub.menuDowns; i++) press(keyDownPressed);
  press(keyAPressed);

  // Press LEFT to toggle to Live View with "Actual" badge
  press(keyLeftPressed);
  for (let f = 0; f < 30; f++) gbaLive.runFrame();

  gbaLive.ppu.renderFrame();
  const actualBuffer = new Uint32Array(gbaLive.ppu.framebuffer);

  // B) Render Golden Menu Description View (with "Expected" badge)
  const gbaGold = new GBA();
  gbaGold.loadBios(bios);
  gbaGold.loadCart(cart);
  gbaGold.reset();
  gbaGold.directBoot();

  for (let f = 0; f < 60; f++) gbaGold.runFrame();

  const pressGold = (k: number) => {
    gbaGold.mem.setKeyInput(k);
    for (let f = 0; f < 8; f++) gbaGold.runFrame();
    gbaGold.mem.setKeyInput(keyReleased);
    for (let f = 0; f < 8; f++) gbaGold.runFrame();
  };

  for (let i = 0; i < 13; i++) pressGold(keyDownPressed);
  pressGold(keyAPressed);

  for (let i = 0; i < sub.menuDowns; i++) pressGold(keyDownPressed);
  pressGold(keyAPressed);

  for (let f = 0; f < 30; f++) gbaGold.runFrame();

  gbaGold.ppu.renderFrame();
  const expectedBuffer = new Uint32Array(gbaGold.ppu.framebuffer);

  const actualPngPath = path.join(artifactDir, `actual_subtest_${sub.id}_badge.png`);
  const expectedPngPath = path.join(artifactDir, `expected_subtest_${sub.id}_badge.png`);

  saveBufferAsPng(240, 160, actualBuffer, actualPngPath);
  saveBufferAsPng(240, 160, expectedBuffer, expectedPngPath);
}

console.log("Distinct Actual vs Expected badge pairs saved successfully!");
