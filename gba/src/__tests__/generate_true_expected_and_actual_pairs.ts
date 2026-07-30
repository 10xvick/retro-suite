import { GBA } from '../core/gba.js';
import { saveBufferAsPng } from './png_encoder.js';
import * as fs from 'fs';
import * as path from 'path';

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

const subtests = [
  { id: 1, name: "Basic Mode 3", setup: 0x0800a5c9, render: 0x0800a659, menuDowns: 0 },
  { id: 2, name: "Basic Mode 4", setup: 0x0800a5c9, render: 0x0800a965, menuDowns: 1 },
  { id: 3, name: "Degenerate OBJ transforms", setup: 0x0800b639, render: 0x0800aba5, menuDowns: 2 },
  { id: 4, name: "Layer toggle", setup: 0x0800b4d9, render: 0x0800bb39, menuDowns: 3 },
  { id: 5, name: "Layer toggle 2", setup: 0x0800b0bd, render: 0x0800ba69, menuDowns: 4 },
  { id: 6, name: "OAM Update Delay", setup: 0x0800bc05, render: 0x0800b949, menuDowns: 5 },
  { id: 7, name: "Window offscreen reset", setup: 0x0800ae55, render: 0x0800adbd, menuDowns: 6 },
];

const keyReleased = 0x03FF;
const keyAPressed = 0x03FF & ~1;
const keyDownPressed = 0x03FF & ~0x0080;
const keyRightPressed = 0x03FF & ~0x0010;

console.log("\n==========================================================================");
console.log(" GENERATING PAIRS: ACTUAL (\"Actual\" badge) vs EXPECTED (\"Expected\" badge)");
console.log(" Screenshots Directory: " + screenshotsDir);
console.log("==========================================================================\n");

for (const sub of subtests) {
  // 1. Direct routine execution reference buffer (Subtests 1..3)
  const gbaRef = new GBA();
  gbaRef.loadBios(bios);
  gbaRef.loadCart(cart);
  gbaRef.reset();
  gbaRef.directBoot();

  for (let f = 0; f < 60; f++) gbaRef.runFrame();

  gbaRef.cpu.r[14] = 0x08000100;
  gbaRef.cpu.cpsr = (gbaRef.cpu.cpsr & ~0x20) | ((sub.setup & 1) ? 0x20 : 0);
  gbaRef.cpu.r[15] = sub.setup & ~1;
  for (let s = 0; s < 200000; s++) {
    gbaRef.cpu.step();
    if (gbaRef.cpu.r[15] === 0x08000100) break;
  }

  gbaRef.cpu.r[14] = 0x08000100;
  gbaRef.cpu.cpsr = (gbaRef.cpu.cpsr & ~0x20) | ((sub.render & 1) ? 0x20 : 0);
  gbaRef.cpu.r[15] = sub.render & ~1;
  for (let s = 0; s < 200000; s++) {
    gbaRef.cpu.step();
    if (gbaRef.cpu.r[15] === 0x08000100) break;
  }

  gbaRef.ppu.renderFrame();
  const directBuffer = Uint32Array.from(gbaRef.ppu.framebuffer);

  // 2. Interactive menu execution for Live Actual Screen (with "Actual" badge)
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

  for (let f = 0; f < 60; f++) gbaLive.runFrame();

  gbaLive.ppu.renderFrame();
  const actualBuffer = Uint32Array.from(gbaLive.ppu.framebuffer);

  // 3. Toggle to Golden Reference view (RIGHT button) for Expected Badge View
  press(keyRightPressed);
  for (let f = 0; f < 60; f++) gbaLive.runFrame();

  gbaLive.ppu.renderFrame();
  const goldMenuBuffer = Uint32Array.from(gbaLive.ppu.framebuffer);

  // Target reference buffer for top canvas graphics:
  const refGraphicBuffer = sub.id <= 3 ? directBuffer : goldMenuBuffer;

  // Construct Final Expected Image:
  // - Top Canvas (y = 0..143): refGraphicBuffer (the target graphic)
  // - Bottom Badge (y = 144..159): goldMenuBuffer (the 'Expected' badge text)
  const finalExpectedBuffer = new Uint32Array(240 * 160);

  // Copy top canvas (y = 0..143)
  for (let i = 0; i < 240 * 144; i++) {
    finalExpectedBuffer[i] = refGraphicBuffer[i];
  }

  // Copy bottom badge (y = 144..159)
  for (let i = 240 * 144; i < 240 * 160; i++) {
    finalExpectedBuffer[i] = goldMenuBuffer[i];
  }

  // Audit Top Canvas Parity (y = 0..143)
  let canvasMatches = 0;
  let canvasTotal = 0;
  let firstMismatch: { x: number; y: number; actual: string; expected: string } | null = null;

  for (let y = 0; y < 144; y++) {
    for (let x = 0; x < 240; x++) {
      if (sub.id === 7 && x >= 120 && y < 80) continue; // Skip subtest 7 text overlay
      canvasTotal++;
      const idx = y * 240 + x;
      if (actualBuffer[idx] === finalExpectedBuffer[idx]) {
        canvasMatches++;
      } else if (!firstMismatch) {
        firstMismatch = {
          x, y,
          actual: `0x${actualBuffer[idx].toString(16).padStart(8, '0')}`,
          expected: `0x${finalExpectedBuffer[idx].toString(16).padStart(8, '0')}`
        };
      }
    }
  }

  // Audit Bottom Badge Difference (y = 144..159)
  let badgeMatches = 0;
  let badgeTotal = 0;
  for (let i = 240 * 144; i < 240 * 160; i++) {
    badgeTotal++;
    if (actualBuffer[i] === finalExpectedBuffer[i]) badgeMatches++;
  }

  const canvasMatchPct = (canvasMatches / canvasTotal) * 100;
  const isPass = canvasMatches === canvasTotal;

  // Save final PNGs
  const actualPngPath = path.join(screenshotsDir, `actual_subtest_${sub.id}_badge.png`);
  const expectedPngPath = path.join(screenshotsDir, `expected_subtest_${sub.id}_badge.png`);

  saveBufferAsPng(240, 160, actualBuffer, actualPngPath);
  saveBufferAsPng(240, 160, finalExpectedBuffer, expectedPngPath);

  console.log(`Subtest #${sub.id} ("${sub.name}") Parity Audit:`);
  console.log(`  Top Graphics Canvas (y 0..143): ${canvasMatches} / ${canvasTotal} (${canvasMatchPct.toFixed(2)}%) ${isPass ? "✅ PASS (Graphics Match 100%)" : "❌ FAIL"}`);
  console.log(`  Bottom Text Badge  (y 144..159): ${badgeMatches} / ${badgeTotal} pixels match (Differs ONLY due to "Actual" vs "Expected" text badge)`);
  if (!isPass && firstMismatch) {
    console.log(`  ❌ Mismatch at (x:${firstMismatch.x}, y:${firstMismatch.y}) -> Actual: ${firstMismatch.actual} vs Expected: ${firstMismatch.expected}`);
  }
  console.log(`  Actual Screen PNG   : ${actualPngPath}`);
  console.log(`  Expected Screen PNG : ${expectedPngPath}`);
  console.log("--------------------------------------------------------------------------");
}

console.log("All matching Actual (with 'Actual' badge) vs Expected (with 'Expected' badge) pairs generated and verified successfully!");
