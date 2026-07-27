import { describe, it, expect, beforeAll } from 'vitest';
import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

export const VIDEO_SUBTESTS = [
  { id: 1, name: "Window offscreen reset", setup: 0x0800bc05, render: 0x0800b949 },
  { id: 2, name: "Basic Mode 3",            setup: 0x0800a5c9, render: 0x0800a659 },
  { id: 3, name: "Basic Mode 4",            setup: 0x0800a5c9, render: 0x0800a965 },
  { id: 4, name: "Degenerate OBJ transforms",setup: 0x0800aba5, render: 0x0800b4d9 },
  { id: 5, name: "Layer toggle",             setup: 0x0800bb39, render: 0x0800b0bd },
  { id: 6, name: "Layer toggle 2",           setup: 0x0800ba69, render: 0x0800bc05 },
  { id: 7, name: "OAM Update Delay",        setup: 0x0800b949, render: 0x0800ae55 }
];

describe('GBA Hardware Test Category: 13 Video tests', () => {
  let biosPath: string;
  let romPath: string;

  beforeAll(() => {
    biosPath = fs.existsSync(path.resolve('public/roms/test/gba_bios.bin'))
      ? path.resolve('public/roms/test/gba_bios.bin')
      : path.resolve('public/gba_bios.bin');
    romPath = fs.existsSync(path.resolve('public/roms/test/suite.gba'))
      ? path.resolve('public/roms/test/suite.gba')
      : path.resolve('public/suite.gba');
  });

  it('13 Video tests (Live PPU vs Golden Reference Parity)', () => {
    const bios = new Uint8Array(fs.readFileSync(biosPath));
    const cart = new Uint8Array(fs.readFileSync(romPath));

    const CANVAS_WIDTH = 240;
    const CANVAS_HEIGHT = 144; // Exclude bottom 16 scanlines of UI text badge
    const TOTAL_CANVAS_PIXELS = CANVAS_WIDTH * CANVAS_HEIGHT; // 34,560 pixels

    let totalPassedSubtests = 0;
    const subtestReports: any[] = [];

    const keyReleased = 0x03FF;
    const keyAPressed = 0x03FF & ~1;
    const keyDownPressed = 0x03FF & ~0x0080;
    const keyRightPressed = 0x03FF & ~0x0010;

    for (const sub of VIDEO_SUBTESTS) {
      // 1. Capture Live Actual PPU Render
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
      press(keyAPressed);
      for (let i = 0; i < sub.id - 1; i++) press(keyDownPressed);
      press(keyAPressed);

      for (let f = 0; f < 10; f++) gba.runFrame();
      const liveBuffer = new Uint32Array(gba.ppu.framebuffer);

      // 2. Capture Expected Golden Reference Render (toggle view with RIGHT)
      press(keyRightPressed);
      for (let f = 0; f < 10; f++) gba.runFrame();
      const goldenBuffer = new Uint32Array(gba.ppu.framebuffer);

      // 3. Compare Canvas Pixel Matrix (y: 0..143)
      let matchingPixels = 0;
      let firstMismatch: { x: number; y: number; actual: string; expected: string } | null = null;

      for (let y = 0; y < CANVAS_HEIGHT; y++) {
        for (let x = 0; x < CANVAS_WIDTH; x++) {
          const idx = y * CANVAS_WIDTH + x;
          const a = liveBuffer[idx];
          const e = goldenBuffer[idx];

          if (a === e) {
            matchingPixels++;
          } else if (!firstMismatch) {
            firstMismatch = {
              x, y,
              actual: `0x${a.toString(16).padStart(8, '0')}`,
              expected: `0x${e.toString(16).padStart(8, '0')}`
            };
          }
        }
      }

      const matchRate = (matchingPixels / TOTAL_CANVAS_PIXELS) * 100;
      const isPass = matchingPixels === TOTAL_CANVAS_PIXELS;
      if (isPass) totalPassedSubtests++;

      subtestReports.push({
        id: sub.id,
        name: sub.name,
        matchingPixels,
        totalPixels: TOTAL_CANVAS_PIXELS,
        matchRate,
        isPass,
        firstMismatch
      });
    }

    console.log("\n==========================================================================");
    console.log(" CATEGORY: 13 Video tests (Live PPU vs Golden Reference Matrix)");
    console.log("==========================================================================");
    subtestReports.forEach(r => {
      const mark = r.isPass ? "✅ [PASS]" : "❌ [FAIL]";
      console.log(`${mark} Subtest #${r.id} ("${r.name}")`);
      console.log(`   | Canvas Pixel Match: ${r.matchingPixels} / ${r.totalPixels} (${r.matchRate.toFixed(2)}%)`);
      if (!r.isPass && r.firstMismatch) {
        console.log(`   | First Mismatch at (x:${r.firstMismatch.x}, y:${r.firstMismatch.y}) -> Live PPU: ${r.firstMismatch.actual} vs Golden: ${r.firstMismatch.expected}`);
      }
      console.log("--------------------------------------------------------------------------");
    });

    console.log(`TOTAL VIDEO SUBTESTS : 7`);
    console.log(`PASSED               : ${totalPassedSubtests} / 7 (${((totalPassedSubtests/7)*100).toFixed(2)}%)`);
    console.log(`FAILED               : ${7 - totalPassedSubtests} / 7`);
    console.log("==========================================================================\n");

    expect(totalPassedSubtests).toBe(7);
  }, 120000);
});
