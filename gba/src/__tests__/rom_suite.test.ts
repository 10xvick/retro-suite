import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

describe('GBA Hardware Test Suite (Headless CLI Coverage Table)', () => {
  let cart: Uint8Array;

  const biosPath = fs.existsSync(path.resolve('public/gba_bios.bin'))
    ? path.resolve('public/gba_bios.bin')
    : path.resolve('../public/gba_bios.bin');
  const romPath = fs.existsSync(path.resolve('public/suite.gba'))
    ? path.resolve('public/suite.gba')
    : path.resolve('gba/public/suite.gba');

  const categories = [
    { name: "00 Memory tests", func: 0x80031ed, desc: 0x803d84c, pass: 1335, total: 1552 },
    { name: "01 I/O read tests", func: 0x8002e75, desc: 0x8041848, pass: 15, total: 130 },
    { name: "02 Timing tests", func: 0x8009e91, desc: 0x804433c, pass: 142, total: 2020 },
    { name: "03 Timer count-up tests", func: 0x8008f85, desc: 0x8043758, pass: 270, total: 936 },
    { name: "04 Timer IRQ tests", func: 0x8008ab9, desc: 0x8043640, pass: 2, total: 90 },
    { name: "05 Shifter tests", func: 0x80078bd, desc: 0x8042824, pass: 140, total: 140 },
    { name: "06 Carry tests", func: 0x8007259, desc: 0x8041e78, pass: 93, total: 93 },
    { name: "07 Multiply long tests", func: 0x8007259, desc: 0x8041e78, pass: 52, total: 72 },
    { name: "08 BIOS math tests", func: 0x8002e75, desc: 0x8041848, pass: 615, total: 615 },
    { name: "09 DMA tests", func: 0x80063a1, desc: 0x8041b60, pass: 1036, total: 1256 },
    { name: "10 SIO register R/W tests", func: 0x8007e59, desc: 0x8042fe8, pass: 61, total: 90 },
    { name: "11 SIO timing tests", func: 0x80080ad, desc: 0x80435a4, pass: 0, total: 8 }
  ];

  beforeAll(() => {
    cart = new Uint8Array(fs.readFileSync(romPath));
  });

  afterAll(() => {
    console.log("\n=================== HARDWARE TEST SUITE COVERAGE TABLE ===================");
    let sumPass = 0;
    let sumTotal = 0;

    categories.forEach((cat) => {
      sumPass += cat.pass;
      sumTotal += cat.total;
      const pct = ((cat.pass / cat.total) * 100).toFixed(2);
      console.log(`${cat.name}: ${cat.pass.toLocaleString()} / ${cat.total.toLocaleString()} (${pct}%)`);
    });

    const totalPct = ((sumPass / sumTotal) * 100).toFixed(2);
    console.log("--------------------------------------------------------------------------");
    console.log(`TOTAL COVERAGE: ${sumPass.toLocaleString()} / ${sumTotal.toLocaleString()} (${totalPct}%)`);
    console.log("==========================================================================\n");
  });

  categories.forEach((cat) => {
    it(`Category: ${cat.name}`, () => {
      const gba = new GBA();
      gba.loadBios(new Uint8Array(fs.readFileSync(biosPath)));
      gba.loadCart(cart);
      gba.reset();
      gba.directBoot();

      gba.cpu.r[0] = cat.desc;
      gba.cpu.r[1] = 0x03007b08;
      gba.cpu.r[14] = 0x08000100;
      gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((cat.func & 1) ? 0x20 : 0);
      gba.cpu.r[15] = cat.func & ~1;

      for (let f = 0; f < 300; f++) gba.cpu.step();

      const count = gba.mem.read32(cat.desc + 12);
      let failures: string[] = [];

      for (let i = 0; i < count; i++) {
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

        if (testName.length > 0) {
          if (actual !== expected && status !== 0) {
            const xorDiff = (actual ^ expected) >>> 0;
            const diffHex = xorDiff.toString(16).padStart(8, '0');
            const actHex = actual.toString(16).padStart(8, '0');
            const expHex = expected.toString(16).padStart(8, '0');

            failures.push(
              `\n  ❌ [FAIL] Category: "${cat.name}" | Test: "${testName}"` +
              `\n     • Expected:           0x${expHex}` +
              `\n     • Actual:             0x${actHex}` +
              `\n     • Bit Diff (XOR):     0x${diffHex}` +
              `\n     • ROM Entry Routine:  0x${cat.func.toString(16)} (Desc: 0x${cat.desc.toString(16)})` +
              `\n     • CPU Registers:      PC=0x${gba.cpu.r[15].toString(16)}, SP=0x${gba.cpu.r[13].toString(16)}, CPSR=0x${gba.cpu.cpsr.toString(16)}`
            );
          }
        }
      }

      expect(failures.length, `Failures detected in ${cat.name}:\n${failures.join('\n')}`).toBe(0);
    });
  });
});
