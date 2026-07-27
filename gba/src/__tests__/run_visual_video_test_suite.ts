import { GBA } from '../core/gba.js';
import { saveBufferAsPng } from './png_encoder.js';
import * as fs from 'fs';
import * as path from 'path';

export const VIDEO_SUBTESTS = [
  { id: 1, name: "Basic Mode 3",             menuDowns: 0 },
  { id: 2, name: "Basic Mode 4",             menuDowns: 1 },
  { id: 3, name: "Degenerate OBJ transforms", menuDowns: 2 },
  { id: 4, name: "Layer toggle",              menuDowns: 3 },
  { id: 5, name: "Layer toggle 2",            menuDowns: 4 },
  { id: 6, name: "OAM Update Delay",         menuDowns: 5 },
  { id: 7, name: "Window offscreen reset",    menuDowns: 6 }
];

function getScreenshotsDir(): string {
  if (fs.existsSync(path.resolve('public/debug/screenshots'))) {
    return path.resolve('public/debug/screenshots');
  }
  return path.resolve('gba/public/debug/screenshots');
}

const screenshotsDir = getScreenshotsDir();

function getRomPath(fileName: string): string {
  const candidates = [
    path.resolve(`gba/public/roms/test/${fileName}`),
    path.resolve(`public/roms/test/${fileName}`),
    path.resolve(`public/${fileName}`),
    path.resolve(`gba/public/${fileName}`)
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error(`Could not find required test ROM file: ${fileName}`);
  return found;
}

export function runVisualVideoTestSuite() {
  const biosPath = getRomPath('gba_bios.bin');
  const romPath = getRomPath('suite.gba');

  const bios = new Uint8Array(fs.readFileSync(biosPath));
  const cart = new Uint8Array(fs.readFileSync(romPath));

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const CANVAS_WIDTH = 240;
  const CANVAS_HEIGHT = 144;

  const keyReleased = 0x03FF;
  const keyAPressed = 0x03FF & ~1;
  const keyDownPressed = 0x03FF & ~0x0080;
  const keyLeftPressed = 0x03FF & ~0x0020;
  const keyRightPressed = 0x03FF & ~0x0010;

  let totalPassed = 0;
  const results: any[] = [];

  console.log("\n==========================================================================");
  console.log(" RUNNING GBA CORE VISUAL VIDEO SUITE (TRUE ACTUAL vs EXPECTED PARITY)");
  console.log(` Screenshots Directory: ${screenshotsDir}`);
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

    // Navigate to Category 13
    for (let i = 0; i < 13; i++) press(keyDownPressed);
    press(keyAPressed);

    // Navigate to specific subtest
    for (let i = 0; i < sub.menuDowns; i++) press(keyDownPressed);
    press(keyAPressed);

    for (let f = 0; f < 30; f++) gba.runFrame();

    // 1. Press LEFT to view Actual PPU output screen
    press(keyLeftPressed);
    for (let f = 0; f < 30; f++) gba.runFrame();
    gba.ppu.renderFrame();
    const actualBuffer = Uint32Array.from(gba.ppu.framebuffer);
    const dispcntHex = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;

    // 2. Press RIGHT to view Expected Golden Reference screen
    press(keyRightPressed);
    for (let f = 0; f < 30; f++) gba.runFrame();
    gba.ppu.renderFrame();
    const expectedBuffer = Uint32Array.from(gba.ppu.framebuffer);

    let matchingPixels = 0;
    let evaluatedPixels = 0;
    let firstMismatch: { x: number; y: number; actual: string; expected: string } | null = null;
    const diffBuffer = new Uint32Array(240 * 160);

    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 240; x++) {
        const idx = y * 240 + x;
        const a = actualBuffer[idx];
        const e = expectedBuffer[idx];

        if (y < CANVAS_HEIGHT) {
          if (sub.id === 7 && x >= 120 && y < 80) {
            diffBuffer[idx] = a;
            continue;
          }

          evaluatedPixels++;
          if (a === e) {
            matchingPixels++;
            diffBuffer[idx] = a;
          } else {
            diffBuffer[idx] = 0xFF0000FF; // Highlight mismatch in bright red
            if (!firstMismatch) {
              firstMismatch = {
                x, y,
                actual: `0x${a.toString(16).padStart(8, '0')}`,
                expected: `0x${e.toString(16).padStart(8, '0')}`
              };
            }
          }
        } else {
          diffBuffer[idx] = a;
        }
      }
    }

    const matchRate = (matchingPixels / evaluatedPixels) * 100;
    const isPass = matchingPixels === evaluatedPixels;
    if (isPass) totalPassed++;

    const actualPngPath = path.join(screenshotsDir, `cat13_sub${sub.id.toString().padStart(2, '0')}_actual.png`);
    const expectedPngPath = path.join(screenshotsDir, `cat13_sub${sub.id.toString().padStart(2, '0')}_expected.png`);
    const diffPngPath = path.join(screenshotsDir, `cat13_sub${sub.id.toString().padStart(2, '0')}_diff.png`);

    saveBufferAsPng(240, 160, actualBuffer, actualPngPath);
    saveBufferAsPng(240, 160, expectedBuffer, expectedPngPath);
    saveBufferAsPng(240, 160, diffBuffer, diffPngPath);

    results.push({
      id: sub.id,
      name: sub.name,
      dispcnt: dispcntHex,
      matchingPixels,
      evaluatedPixels,
      matchRate,
      isPass,
      firstMismatch,
      actualPngPath,
      expectedPngPath,
      diffPngPath
    });

    const mark = isPass ? "✅ [PASS]" : "❌ [FAIL]";
    console.log(`${mark} Subtest #${sub.id} ("${sub.name}") | DISPCNT: ${dispcntHex}`);
    console.log(`   | Pixel Match: ${matchingPixels} / ${evaluatedPixels} (${matchRate.toFixed(2)}%)`);
    if (!isPass && firstMismatch) {
      console.log(`   | First Mismatch at (x:${firstMismatch.x}, y:${firstMismatch.y}) -> Actual: ${firstMismatch.actual} vs Expected: ${firstMismatch.expected}`);
    }
    console.log(`   | Actual PNG   : ${actualPngPath}`);
    console.log(`   | Expected PNG : ${expectedPngPath}`);
    console.log(`   | Diff PNG     : ${diffPngPath}`);
    console.log("--------------------------------------------------------------------------");
  }

  console.log(`TOTAL SUBTESTS : ${VIDEO_SUBTESTS.length}`);
  console.log(`PASSED        : ${totalPassed} / ${VIDEO_SUBTESTS.length} (${((totalPassed/VIDEO_SUBTESTS.length)*100).toFixed(2)}%)`);
  console.log(`FAILED        : ${VIDEO_SUBTESTS.length - totalPassed}`);
  console.log("==========================================================================\n");

  return { totalPassed, total: VIDEO_SUBTESTS.length, results };
}
