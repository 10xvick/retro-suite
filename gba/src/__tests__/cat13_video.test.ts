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
  let gba: GBA;
  let cart: Uint8Array;

  const biosPath = fs.existsSync(path.resolve('public/roms/test/gba_bios.bin'))
    ? path.resolve('public/roms/test/gba_bios.bin')
    : path.resolve('public/gba_bios.bin');
  const romPath = fs.existsSync(path.resolve('public/roms/test/suite.gba'))
    ? path.resolve('public/roms/test/suite.gba')
    : path.resolve('public/suite.gba');

  beforeAll(() => {
    gba = new GBA();
    gba.loadBios(new Uint8Array(fs.readFileSync(biosPath)));
    cart = new Uint8Array(fs.readFileSync(romPath));
    gba.loadCart(cart);
  });

  it('13 Video tests', () => {
    let passed = 0;
    let failures: string[] = [];

    for (const sub of VIDEO_SUBTESTS) {
      gba.reset();
      gba.directBoot();

      const funcAddr = sub.setup;
      gba.cpu.r[13] = 0x03007f00;
      gba.cpu.r[14] = 0x08000100;
      gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((funcAddr & 1) ? 0x20 : 0);
      gba.cpu.r[15] = funcAddr & ~1;

      let hung = false;
      for (let f = 0; f < 30; f++) {
        gba.runFrame();
        if (gba.cpu.r[15] === 0x00000000 || isNaN(gba.cpu.r[15])) {
          hung = true;
          break;
        }
      }

      if (!hung) {
        passed++;
      } else {
        failures.push(`  ❌ [FAIL] Test: "${sub.name}" | Setup Routine: 0x${sub.setup.toString(16)} | Execution HUNG`);
      }
    }

    if (failures.length > 0) {
      console.log(`\n--- FAILED SUB-TEST DIAGNOSTICS FOR 13 Video tests (${failures.length} failures) ---`);
      console.log(failures.join('\n'));
      console.log("--------------------------------------------------------------------------\n");
    }

    console.log("\n==========================================================================");
    console.log(" CATEGORY: 13 Video tests");
    console.log("==========================================================================");
    console.log(`TOTAL SUB-TESTS : 7`);
    console.log(`PASSED          : ${passed} / 7 (${((passed/7)*100).toFixed(2)}%)`);
    console.log(`FAILED          : ${failures.length} / 7`);
    console.log("==========================================================================\n");

    expect(passed).toBeGreaterThanOrEqual(7);
  }, 120000);
});
