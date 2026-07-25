import { describe, it, expect, beforeAll } from 'vitest';
import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

describe('GBA Hardware Test Category: 00 Memory tests', () => {
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

  it('00 Memory tests', () => {
    gba.reset();
    gba.directBoot();

    // Execute category routine
    const catEntry = 0x080024f5;
    gba.cpu.r[0] = 0;
    gba.cpu.r[14] = 0x08000100;
    gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((catEntry & 1) ? 0x20 : 0);
    gba.cpu.r[15] = catEntry & ~1;

    for (let frame = 0; frame < 60; frame++) {
      for (let cycles = 0; cycles < 280896; cycles += 4) {
        gba.cpu.step();
      }
    }

    const totalSubtests = 1552;
    let failures: string[] = [];

    for (let i = 0; i < totalSubtests; i++) {
      const resBase = 0x03007b08 + i * 16;
      const strAddr = gba.mem.read32(resBase);
      const actual = gba.mem.read32(resBase + 4);
      const expected = gba.mem.read32(resBase + 8);
      const status = gba.mem.read32(resBase + 12);

      let testName = "";
      if (strAddr >= 0x08000000 && strAddr < 0x080c0000) {
        let p = strAddr - 0x08000000;
        while (p < cart.length && cart[p] !== 0 && testName.length < 30) {
          testName += String.fromCharCode(cart[p]);
          p++;
        }
      }
      if (!testName) testName = `Subtest #${i + 1}`;

      if (actual !== expected && status !== 0) {
        const xorDiff = (actual ^ expected) >>> 0;
        const diffHex = xorDiff.toString(16).padStart(8, '0');
        const actHex = actual.toString(16).padStart(8, '0');
        const expHex = expected.toString(16).padStart(8, '0');

        failures.push(
          `\n  ❌ [FAIL] Category: "00 Memory tests" | Test: "${testName}"` +
          `\n     • Expected:           0x${expHex}` +
          `\n     • Actual:             0x${actHex}` +
          `\n     • Bit Diff (XOR):     0x${diffHex}` +
          `\n     • ROM Entry Routine:  0x80031ed (Desc: 0x803d84c)` +
          `\n     • CPU Registers:      PC=0x${gba.cpu.r[15].toString(16)}, SP=0x${gba.cpu.r[13].toString(16)}, CPSR=0x${gba.cpu.cpsr.toString(16)}`
        );
      }
    }

    const failedCount = failures.length;
    const passedCount = totalSubtests - failedCount;
    const passPct = totalSubtests > 0 ? ((passedCount / totalSubtests) * 100).toFixed(2) : "0.00";

    console.log(`\n==========================================================================`);
    console.log(` CATEGORY: 00 Memory tests`);
    console.log(` TOTAL SUB-TESTS : ${totalSubtests.toLocaleString()}`);
    console.log(` PASSED          : ${passedCount.toLocaleString()} / ${totalSubtests.toLocaleString()} (${passPct}%)`);
    console.log(` FAILED          : ${failedCount.toLocaleString()} / ${totalSubtests.toLocaleString()}`);
    console.log(`==========================================================================\n`);

    expect(failures.length, `Failures detected in 00 Memory tests:
${failures.join('\n')}`).toBe(0);
  });
});
