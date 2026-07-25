import { describe, it, expect, beforeAll } from 'vitest';
import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

describe('GBA Hardware Test Category: 08 BIOS math tests', () => {
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

  it('08 BIOS math tests', () => {
    gba.reset();
    gba.directBoot();

    const catEntry = 0x080024f5;
    gba.cpu.r[0] = 8;
    gba.cpu.r[1] = 0x03007b08;
    gba.cpu.r[14] = 0x08000100;
    gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((catEntry & 1) ? 0x20 : 0);
    gba.cpu.r[15] = catEntry & ~1;

    for (let f = 0; f < 300; f++) {
      gba.runFrame();
      if (gba.cpu.r[15] === 0x08000100) break;
    }

    const total = 615;
    let passed = 0;
    let failures: string[] = [];

    for (let i = 0; i < total; i++) {
      const resBase = 0x03007b08 + i * 16;
      const strAddr = gba.mem.read32(resBase);
      const actual = gba.mem.read32(resBase + 4);
      const expected = gba.mem.read32(resBase + 8);
      const status = gba.mem.read32(resBase + 12);

      if (actual === expected && status === 0) {
        passed++;
      } else {
        let testName = "";
        if (strAddr >= 0x08000000 && strAddr < 0x080c0000) {
          let p = strAddr - 0x08000000;
          while (p < cart.length && cart[p] !== 0 && testName.length < 50) {
            testName += String.fromCharCode(cart[p]);
            p++;
          }
        }
        if (!testName) testName = `Subtest #${i + 1}`;
        failures.push(`  ❌ [FAIL] Test: "${testName}" | Expected: 0x${expected.toString(16).padStart(8, '0')} | Actual: 0x${actual.toString(16).padStart(8, '0')}`);
      }
    }

    if (failures.length > 0) {
      console.log(`\n--- FAILED SUB-TEST DIAGNOSTICS FOR 08 BIOS math tests (${failures.length} failures) ---`);
      console.log(failures.join('\n'));
      console.log("--------------------------------------------------------------------------\n");
    }

    console.log("\n==========================================================================");
    console.log(" CATEGORY: 08 BIOS math tests");
    console.log("==========================================================================");
    console.log(`TOTAL SUB-TESTS : ${total}`);
    console.log(`PASSED          : ${passed} / ${total} (${((passed/total)*100).toFixed(2)}%)`);
    console.log(`FAILED          : ${failures.length} / ${total}`);
    console.log("==========================================================================\n");

    expect(passed).toBeGreaterThanOrEqual(603);
  }, 120000);
});
