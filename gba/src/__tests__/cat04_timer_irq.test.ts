import { describe, it, expect, beforeAll } from 'vitest';
import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

describe('GBA Hardware Test Category: 04 Timer IRQ tests', () => {
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

  it('04 Timer IRQ tests', () => {
    gba.reset();
    gba.directBoot();

    gba.cpu.r[0] = 0x8043640;
    gba.cpu.r[1] = 0x03007b08;
    gba.cpu.r[14] = 0x08000100;
    gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((0x8008ab9 & 1) ? 0x20 : 0);
    gba.cpu.r[15] = 0x8008ab9 & ~1;

    for (let f = 0; f < 300; f++) gba.cpu.step();

    const count = gba.mem.read32(0x8043640 + 12);
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
            `\n  ❌ [FAIL] Category: "04 Timer IRQ tests" | Test: "${testName}"` +
            `\n     • Expected:           0x${expHex}` +
            `\n     • Actual:             0x${actHex}` +
            `\n     • Bit Diff (XOR):     0x${diffHex}` +
            `\n     • ROM Entry Routine:  0x8008ab9 (Desc: 0x8043640)` +
            `\n     • CPU Registers:      PC=0x${gba.cpu.r[15].toString(16)}, SP=0x${gba.cpu.r[13].toString(16)}, CPSR=0x${gba.cpu.cpsr.toString(16)}`
          );
        }
      }
    }

    expect(failures.length, `Failures detected in 04 Timer IRQ tests:
${failures.join('\n')}`).toBe(0);
  });
});
