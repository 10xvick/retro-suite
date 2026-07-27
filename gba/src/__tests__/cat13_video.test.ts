import { describe, it, expect, beforeAll } from 'vitest';
import { GBA } from '../core/gba.js';
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

describe('GBA Hardware Test Category: 13 Video tests', () => {
  let biosPath: string;
  let romPath: string;

  beforeAll(() => {
    biosPath = [
      path.resolve('gba/public/roms/test/gba_bios.bin'),
      path.resolve('public/roms/test/gba_bios.bin'),
      path.resolve('public/gba_bios.bin')
    ].find(p => fs.existsSync(p)) || path.resolve('public/gba_bios.bin');

    romPath = [
      path.resolve('gba/public/roms/test/suite.gba'),
      path.resolve('public/roms/test/suite.gba'),
      path.resolve('public/suite.gba')
    ].find(p => fs.existsSync(p)) || path.resolve('public/suite.gba');
  });

  it('13 Video tests (True Actual vs Expected Golden Reference Parity)', () => {
    const bios = new Uint8Array(fs.readFileSync(biosPath));
    const cart = new Uint8Array(fs.readFileSync(romPath));

    const CANVAS_WIDTH = 240;
    const CANVAS_HEIGHT = 144;

    let totalPassedSubtests = 0;
    const subtestReports: any[] = [];

    const keyReleased = 0x03FF;
    const keyAPressed = 0x03FF & ~1;
    const keyDownPressed = 0x03FF & ~0x0080;
    const keyLeftPressed = 0x03FF & ~0x0020;
    const keyRightPressed = 0x03FF & ~0x0010;

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

      // Navigate to Category 13 (Video)
      for (let i = 0; i < 13; i++) press(keyDownPressed);
      press(keyAPressed);

      // Select specific subtest
      for (let i = 0; i < sub.menuDowns; i++) press(keyDownPressed);
      press(keyAPressed);

      for (let f = 0; f < 30; f++) gba.runFrame();

      // 1. Press LEFT to view Actual PPU output
      press(keyLeftPressed);
      for (let f = 0; f < 30; f++) gba.runFrame();
      gba.ppu.renderFrame();
      const actualBuffer = Uint32Array.from(gba.ppu.framebuffer);

      // 2. Press RIGHT to view Expected Golden Reference output
      press(keyRightPressed);
      for (let f = 0; f < 30; f++) gba.runFrame();
      gba.ppu.renderFrame();
      const expectedBuffer = Uint32Array.from(gba.ppu.framebuffer);

      let matchingPixels = 0;
      let evaluatedPixels = 0;
      let firstMismatch: { x: number; y: number; actual: string; expected: string } | null = null;

      for (let y = 0; y < CANVAS_HEIGHT; y++) {
        for (let x = 0; x < CANVAS_WIDTH; x++) {
          if (sub.id === 7 && x >= 120 && y < 80) continue; // Subtest 7 text overlay skip

          evaluatedPixels++;
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

      const matchRate = (matchingPixels / evaluatedPixels) * 100;
      const isPass = matchingPixels === evaluatedPixels;
      if (isPass) totalPassedSubtests++;

      subtestReports.push({
        id: sub.id,
        name: sub.name,
        dispcnt: `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`,
        matchingPixels,
        totalPixels: evaluatedPixels,
        matchRate,
        isPass,
        firstMismatch
      });
    }

    console.log("\n==========================================================================");
    console.log(" CATEGORY: 13 Video tests (True Actual vs Expected Golden Reference Parity)");
    console.log("==========================================================================");
    subtestReports.forEach(r => {
      const mark = r.isPass ? "✅ [PASS]" : "❌ [FAIL]";
      console.log(`${mark} Subtest #${r.id} ("${r.name}") | DISPCNT: ${r.dispcnt}`);
      console.log(`   | Canvas Pixel Match: ${r.matchingPixels} / ${r.totalPixels} (${r.matchRate.toFixed(2)}%)`);
      if (!r.isPass && r.firstMismatch) {
        console.log(`   | First Canvas Mismatch at (x:${r.firstMismatch.x}, y:${r.firstMismatch.y}) -> Actual: ${r.firstMismatch.actual} vs Expected: ${r.firstMismatch.expected}`);
      }
      console.log("--------------------------------------------------------------------------");
    });

    console.log(`TOTAL VIDEO SUBTESTS : 7`);
    console.log(`PASSED               : ${totalPassedSubtests} / 7 (${((totalPassedSubtests/7)*100).toFixed(2)}%)`);
    console.log(`FAILED               : ${7 - totalPassedSubtests} / 7`);
    console.log("==========================================================================\n");

    expect(totalPassedSubtests).toBe(7);
  }, 300000);
});
