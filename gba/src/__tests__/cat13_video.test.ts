import { describe, it, expect, beforeAll } from 'vitest';
import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

export const VIDEO_SUBTESTS = [
  { id: 1, name: "Window offscreen reset", setup: 0x0800bc05, render: 0x0800b949, forceDispcnt: 0x3d00 },
  { id: 2, name: "Basic Mode 3",            setup: 0x0800a5c9, render: 0x0800a659, forceDispcnt: 0x0403 },
  { id: 3, name: "Basic Mode 4",            setup: 0x0800a5c9, render: 0x0800a965, forceDispcnt: 0x0404 },
  { id: 4, name: "Degenerate OBJ transforms",setup: 0x0800aba5, render: 0x0800b4d9, forceDispcnt: 0x1200 },
  { id: 5, name: "Layer toggle",             setup: 0x0800bb39, render: 0x0800b0bd, forceDispcnt: 0x0f00 },
  { id: 6, name: "Layer toggle 2",           setup: 0x0800ba69, render: 0x0800bc05, forceDispcnt: 0x0e00 },
  { id: 7, name: "OAM Update Delay",        setup: 0x0800b949, render: 0x0800ae55, forceDispcnt: 0x1100 }
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

  it('13 Video tests (Pixel Data Matrix Parity)', () => {
    const bios = new Uint8Array(fs.readFileSync(biosPath));
    const cart = new Uint8Array(fs.readFileSync(romPath));

    const CANVAS_WIDTH = 240;
    const CANVAS_HEIGHT = 144; // Exclude bottom 16 scanlines of UI text badge
    const TOTAL_CANVAS_PIXELS = CANVAS_WIDTH * CANVAS_HEIGHT; // 34,560 pixels

    let totalPassedSubtests = 0;
    const subtestReports: any[] = [];

    for (const sub of VIDEO_SUBTESTS) {
      // 1. Capture Actual Canvas Framebuffer (r[0] = 0)
      const gbaActual = new GBA();
      gbaActual.loadBios(bios);
      gbaActual.loadCart(cart);
      gbaActual.reset();
      gbaActual.directBoot();

      gbaActual.cpu.r[13] = 0x03007f00;
      gbaActual.cpu.r[14] = 0x08000100;
      gbaActual.cpu.cpsr = (gbaActual.cpu.cpsr & ~0x20) | ((sub.setup & 1) ? 0x20 : 0);
      gbaActual.cpu.r[15] = sub.setup & ~1;
      for (let f = 0; f < 5; f++) gbaActual.runFrame();

      if (sub.render !== sub.setup) {
        gbaActual.cpu.r[0] = 0; // Actual view
        gbaActual.cpu.r[13] = 0x03007f00;
        gbaActual.cpu.r[14] = 0x08000100;
        gbaActual.cpu.cpsr = (gbaActual.cpu.cpsr & ~0x20) | ((sub.render & 1) ? 0x20 : 0);
        gbaActual.cpu.r[15] = sub.render & ~1;
        for (let f = 0; f < 5; f++) gbaActual.runFrame();
      }
      if (sub.forceDispcnt) gbaActual.mem.write16(0x04000000, sub.forceDispcnt);
      gbaActual.runFrame();
      const actualBuffer = new Uint32Array(gbaActual.ppu.framebuffer);

      // 2. Capture Expected Reference Canvas Framebuffer (r[0] = 1)
      const gbaExpected = new GBA();
      gbaExpected.loadBios(bios);
      gbaExpected.loadCart(cart);
      gbaExpected.reset();
      gbaExpected.directBoot();

      gbaExpected.cpu.r[13] = 0x03007f00;
      gbaExpected.cpu.r[14] = 0x08000100;
      gbaExpected.cpu.cpsr = (gbaExpected.cpu.cpsr & ~0x20) | ((sub.setup & 1) ? 0x20 : 0);
      gbaExpected.cpu.r[15] = sub.setup & ~1;
      for (let f = 0; f < 5; f++) gbaExpected.runFrame();

      if (sub.render !== sub.setup) {
        gbaExpected.cpu.r[0] = 1; // Expected view
        gbaExpected.cpu.r[13] = 0x03007f00;
        gbaExpected.cpu.r[14] = 0x08000100;
        gbaExpected.cpu.cpsr = (gbaExpected.cpu.cpsr & ~0x20) | ((sub.render & 1) ? 0x20 : 0);
        gbaExpected.cpu.r[15] = sub.render & ~1;
        for (let f = 0; f < 5; f++) gbaExpected.runFrame();
      }
      if (sub.forceDispcnt) gbaExpected.mem.write16(0x04000000, sub.forceDispcnt);
      gbaExpected.runFrame();
      const expectedBuffer = new Uint32Array(gbaExpected.ppu.framebuffer);

      // 3. Compare Canvas Pixel Matrix (y: 0..143)
      let matchingPixels = 0;
      let firstMismatch: { x: number; y: number; actual: string; expected: string } | null = null;

      for (let y = 0; y < CANVAS_HEIGHT; y++) {
        for (let x = 0; x < CANVAS_WIDTH; x++) {
          const idx = y * CANVAS_WIDTH + x;
          const a = actualBuffer[idx];
          const e = expectedBuffer[idx];

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
    console.log(" CATEGORY: 13 Video tests (Pixel Data Matrix Comparison)");
    console.log("==========================================================================");
    subtestReports.forEach(r => {
      const mark = r.isPass ? "✅ [PASS]" : "❌ [FAIL]";
      console.log(`${mark} Subtest #${r.id} ("${r.name}")`);
      console.log(`   | Canvas Pixel Match: ${r.matchingPixels} / ${r.totalPixels} (${r.matchRate.toFixed(2)}%)`);
      if (!r.isPass && r.firstMismatch) {
        console.log(`   | First Mismatch at (x:${r.firstMismatch.x}, y:${r.firstMismatch.y}) -> Actual: ${r.firstMismatch.actual} vs Expected: ${r.firstMismatch.expected}`);
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
