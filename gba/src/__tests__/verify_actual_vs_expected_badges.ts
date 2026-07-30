import { GBA } from '../core/gba.js';
import { saveBufferAsPng } from './png_encoder.js';
import * as fs from 'fs';
import * as path from 'path';

export const VIDEO_SUBTESTS = [
  { id: 1, name: "Basic Mode 3", menuDowns: 0 },
  { id: 2, name: "Basic Mode 4", menuDowns: 1 },
  { id: 3, name: "Degenerate OBJ transforms", menuDowns: 2 },
  { id: 4, name: "Layer toggle", menuDowns: 3 },
  { id: 5, name: "Layer toggle 2", menuDowns: 4 },
  { id: 6, name: "OAM Update Delay", menuDowns: 5 },
  { id: 7, name: "Window offscreen reset", menuDowns: 6 }
];

function findPath(relPath: string): string {
  const candidates = [
    path.resolve(relPath),
    path.resolve(`gba/${relPath}`),
    path.resolve(`../${relPath}`)
  ];
  return candidates.find(p => fs.existsSync(p)) || path.resolve(relPath);
}

const biosPath = findPath('public/roms/test/gba_bios.bin');
const romPath = findPath('public/roms/test/suite.gba');
const screenshotsDir = findPath('public/debug/screenshots');

const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

const keyReleased = 0x03FF;
const keyAPressed = 0x03FF & ~1;
const keyDownPressed = 0x03FF & ~0x0080;
const keyLeftPressed = 0x03FF & ~0x0020;
const keyRightPressed = 0x03FF & ~0x0010;

console.log("\n==========================================================================");
console.log(" VERIFYING ACTUAL (\"Actual\" badge) vs EXPECTED (\"Expected\" badge) SCREENS");
console.log("==========================================================================\n");

for (const sub of VIDEO_SUBTESTS) {
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

  // Navigate to Video category (Category 13)
  for (let i = 0; i < 13; i++) press(keyDownPressed);
  press(keyAPressed);

  // Navigate to specific video subtest
  for (let i = 0; i < sub.menuDowns; i++) press(keyDownPressed);
  press(keyAPressed);

  for (let f = 0; f < 30; f++) gba.runFrame();

  // 1. Press LEFT to view Actual screen (with "Actual" text badge at bottom)
  press(keyLeftPressed);
  for (let f = 0; f < 30; f++) gba.runFrame();
  gba.ppu.renderFrame();
  const actualBuffer = Uint32Array.from(gba.ppu.framebuffer);

  // 2. Press RIGHT to view Expected screen (with "Expected" text badge at bottom)
  press(keyRightPressed);
  for (let f = 0; f < 30; f++) gba.runFrame();
  gba.ppu.renderFrame();
  const expectedBuffer = Uint32Array.from(gba.ppu.framebuffer);

  // Analyze Canvas Parity (y < 144)
  let canvasMatches = 0;
  let canvasTotal = 0;
  let firstCanvasMismatch: { x: number; y: number; actual: string; expected: string } | null = null;

  for (let y = 0; y < 144; y++) {
    for (let x = 0; x < 240; x++) {
      if (sub.id === 7 && x >= 120 && y < 80) continue; // Subtest 7 menu overlay skip
      canvasTotal++;
      const idx = y * 240 + x;
      if (actualBuffer[idx] === expectedBuffer[idx]) {
        canvasMatches++;
      } else if (!firstCanvasMismatch) {
        firstCanvasMismatch = {
          x, y,
          actual: `0x${actualBuffer[idx].toString(16).padStart(8, '0')}`,
          expected: `0x${expectedBuffer[idx].toString(16).padStart(8, '0')}`
        };
      }
    }
  }

  // Analyze Badge Difference (y >= 144)
  let badgeMatches = 0;
  let badgeTotal = 0;
  for (let y = 144; y < 160; y++) {
    for (let x = 0; x < 240; x++) {
      badgeTotal++;
      const idx = y * 240 + x;
      if (actualBuffer[idx] === expectedBuffer[idx]) {
        badgeMatches++;
      }
    }
  }

  const canvasMatchRate = (canvasMatches / canvasTotal) * 100;
  const isCanvasPass = canvasMatches === canvasTotal;

  console.log(`Subtest #${sub.id} ("${sub.name}"):`);
  console.log(`  Top Graphics Canvas (y < 144): ${canvasMatches} / ${canvasTotal} (${canvasMatchRate.toFixed(2)}%) ${isCanvasPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Bottom Text Badge  (y >= 144): ${badgeMatches} / ${badgeTotal} pixels identical (Differs due to "Actual" vs "Expected" text)`);
  if (!isCanvasPass && firstCanvasMismatch) {
    console.log(`  ❌ First Top Canvas Mismatch at (x:${firstCanvasMismatch.x}, y:${firstCanvasMismatch.y}) -> Actual: ${firstCanvasMismatch.actual} vs Expected: ${firstCanvasMismatch.expected}`);
  }

  // Create Diff Buffer for full screen visualization
  const diffBuffer = new Uint32Array(240 * 160);
  for (let i = 0; i < 240 * 160; i++) {
    const y = Math.floor(i / 240);
    if (y < 144) {
      if (actualBuffer[i] === expectedBuffer[i]) {
        diffBuffer[i] = actualBuffer[i];
      } else {
        diffBuffer[i] = 0xFF0000FF; // Highlight top graphics mismatch in bright RED
      }
    } else {
      // Bottom badge region show actual text
      diffBuffer[i] = actualBuffer[i];
    }
  }

  // Save Screenshots to gba/public/debug/screenshots/
  const actualPngPath = path.join(screenshotsDir, `video_subtest_${sub.id.toString().padStart(2, '0')}_actual_badge.png`);
  const expectedPngPath = path.join(screenshotsDir, `video_subtest_${sub.id.toString().padStart(2, '0')}_expected_badge.png`);
  const diffPngPath = path.join(screenshotsDir, `video_subtest_${sub.id.toString().padStart(2, '0')}_canvas_diff.png`);

  saveBufferAsPng(240, 160, actualBuffer, actualPngPath);
  saveBufferAsPng(240, 160, expectedBuffer, expectedPngPath);
  saveBufferAsPng(240, 160, diffBuffer, diffPngPath);

  console.log(`  Saved Actual   PNG: ${actualPngPath}`);
  console.log(`  Saved Expected PNG: ${expectedPngPath}`);
  console.log(`  Saved Canvas Diff : ${diffPngPath}`);
  console.log("--------------------------------------------------------------------------");
}
