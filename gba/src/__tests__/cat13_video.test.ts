import { describe, it, expect, beforeAll } from 'vitest';
import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

// Exact ROM Descriptor Table Order from 0x080472c8 in suite.gba
export const VIDEO_SUBTESTS = [
  { id: 1, name: "Basic Mode 3",             setup: 0x0800a5c9, render: 0x0800a659 },
  { id: 2, name: "Basic Mode 4",             setup: 0x0800a5c9, render: 0x0800a965 },
  { id: 3, name: "Degenerate OBJ transforms", setup: 0x0800b639, render: 0x0800aba5 },
  { id: 4, name: "Layer toggle",              setup: 0x0800b4d9, render: 0x0800bb39 },
  { id: 5, name: "Layer toggle 2",            setup: 0x0800b0bd, render: 0x0800ba69 },
  { id: 6, name: "OAM Update Delay",         setup: 0x0800bc05, render: 0x0800b949 },
  { id: 7, name: "Window offscreen reset",    setup: 0x0800ae55, render: 0x0800adbd }
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

  it('13 Video tests (True Unblanked PPU Pixel Parity)', () => {
    const bios = new Uint8Array(fs.readFileSync(biosPath));
    const cart = new Uint8Array(fs.readFileSync(romPath));

    const CANVAS_WIDTH = 240;
    const CANVAS_HEIGHT = 144;
    const TOTAL_CANVAS_PIXELS = CANVAS_WIDTH * CANVAS_HEIGHT;

    let totalPassedSubtests = 0;
    const subtestReports: any[] = [];

    const keyReleased = 0x03FF;
    const keyAPressed = 0x03FF & ~1;
    const keyDownPressed = 0x03FF & ~0x0080;
    const keyRightPressed = 0x03FF & ~0x0010;

    for (const sub of VIDEO_SUBTESTS) {
      // 1. Direct routine execution for reference buffer (Subtests 1..3)
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
      const directBuffer = new Uint32Array(gbaRef.ppu.framebuffer);

      // 2. Interactive menu execution for live buffer (Subtests 1..7)
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

      for (let i = 0; i < sub.id - 1; i++) press(keyDownPressed);
      press(keyAPressed);

      for (let f = 0; f < 60; f++) gbaLive.runFrame();
      const liveDispcnt = gbaLive.ppu.dispcnt;
      const liveBuffer = new Uint32Array(gbaLive.ppu.framebuffer);

      // Toggle to Golden Reference view (RIGHT button) for Subtests 4..7
      press(keyRightPressed);
      for (let f = 0; f < 60; f++) gbaLive.runFrame();
      const goldMenuBuffer = new Uint32Array(gbaLive.ppu.framebuffer);

      const targetRefBuffer = sub.id <= 3 ? directBuffer : goldMenuBuffer;

      const isForcedBlank = (liveDispcnt & 0x80) !== 0;
      let matchingPixels = 0;
      let evaluatedPixels = 0;
      let firstMismatch: { x: number; y: number; actual: string; expected: string } | null = null;

      if (!isForcedBlank) {
        for (let y = 0; y < CANVAS_HEIGHT; y++) {
          for (let x = 0; x < CANVAS_WIDTH; x++) {
            // For Subtest 7, the Golden toggle view inserts a 120x80 text label in top-right corner
            if (sub.id === 7 && x >= 120 && y < 80) continue;

            evaluatedPixels++;
            const idx = y * CANVAS_WIDTH + x;
            const a = liveBuffer[idx];
            const e = targetRefBuffer[idx];

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
      }

      const matchRate = isForcedBlank || evaluatedPixels === 0 ? 0 : (matchingPixels / evaluatedPixels) * 100;
      const isPass = !isForcedBlank && matchingPixels === evaluatedPixels;
      if (isPass) totalPassedSubtests++;

      subtestReports.push({
        id: sub.id,
        name: sub.name,
        dispcnt: `0x${liveDispcnt.toString(16).padStart(4, '0')}`,
        isForcedBlank,
        matchingPixels,
        totalPixels: evaluatedPixels,
        matchRate,
        isPass,
        firstMismatch
      });
    }

    console.log("\n==========================================================================");
    console.log(" CATEGORY: 13 Video tests (True Unblanked PPU Pixel Parity)");
    console.log("==========================================================================");
    subtestReports.forEach(r => {
      const mark = r.isPass ? "✅ [PASS]" : "❌ [FAIL]";
      console.log(`${mark} Subtest #${r.id} ("${r.name}") | DISPCNT: ${r.dispcnt} ${r.isForcedBlank ? "[FORCED BLANK]" : ""}`);
      console.log(`   | Canvas Pixel Match: ${r.matchingPixels} / ${r.totalPixels} (${r.matchRate.toFixed(2)}%)`);
      if (!r.isPass && r.firstMismatch) {
        console.log(`   | First Mismatch at (x:${r.firstMismatch.x}, y:${r.firstMismatch.y}) -> Live PPU: ${r.firstMismatch.actual} vs Ref: ${r.firstMismatch.expected}`);
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
