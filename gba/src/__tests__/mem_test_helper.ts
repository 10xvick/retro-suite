import { GBA } from '../core/gba';

export const MEM_SUBTESTS = [
  { key: "01", name: "ROM load", func: 0x80031ed, desc: 0x803d84c, count: 239 },
  { key: "02", name: "ROM out-of-bounds load", func: 0x80031d9, desc: 0x803dbf4, count: 86 },
  { key: "03", name: "IWRAM load", func: 0x80031c5, desc: 0x803ddc8, count: 190 },
  { key: "04", name: "IWRAM mirror load", func: 0x80031ad, desc: 0x803df9c, count: 190 },
  { key: "05", name: "EWRAM load", func: 0x8003199, desc: 0x803e518, count: 206 },
  { key: "06", name: "EWRAM mirror load", func: 0x8003181, desc: 0x803e6ec, count: 206 },
  { name: "Palette load", func: 0x8003139, desc: 0x803ec68, count: 234 },
  { name: "Palette mirror load", func: 0x80030ed, desc: 0x803ee3c, count: 234 }
];

export interface MemTestResult {
  name: string;
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export function runMemorySubtest(
  gba: GBA,
  cart: Uint8Array,
  sub: typeof MEM_SUBTESTS[number],
  printDiagnostics: boolean
): MemTestResult {
  gba.reset();
  gba.directBoot();

  // Clear the output buffer at 0x03007b08
  for (let offset = 0; offset < sub.count * 16; offset += 4) {
    gba.mem.write32(0x03007b08 + offset, 0);
  }

  gba.cpu.r[0] = sub.desc;
  gba.cpu.r[1] = 0x03007b08;
  gba.cpu.r[14] = 0x08000100;
  gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((sub.func & 1) ? 0x20 : 0);
  gba.cpu.r[15] = sub.func & ~1;

  let frames = 0;
  const maxFrames = 150;
  while (frames < maxFrames) {
    gba.runFrame();
    frames++;
  }

  let failures: string[] = [];

  for (let i = 0; i < sub.count; i++) {
    const resBase = 0x03007b08 + i * 16;
    const strAddr = gba.mem.read32(resBase);
    const actual = gba.mem.read32(resBase + 4);
    const expected = gba.mem.read32(resBase + 8);
    const status = gba.mem.read32(resBase + 12);

    if (actual !== expected && status !== 0) {
      let testName = "";
      if (strAddr >= 0x08000000 && strAddr < 0x080c0000) {
        let p = strAddr - 0x08000000;
        while (p < cart.length && cart[p] !== 0 && testName.length < 30) {
          testName += String.fromCharCode(cart[p]);
          p++;
        }
      }
      if (!testName) testName = `Subtest #${i + 1}`;

      if (printDiagnostics) {
        const xorDiff = (actual ^ expected) >>> 0;
        const diffHex = xorDiff.toString(16).padStart(8, '0');
        failures.push(
          `  ❌ [FAIL] Subtest #${i + 1} ("${testName}")` +
          ` | Expected: 0x${expected.toString(16).padStart(8, '0')}` +
          ` | Actual: 0x${actual.toString(16).padStart(8, '0')}` +
          ` | Bit Diff (XOR): 0x${diffHex}` +
          ` | Routine: 0x${sub.func.toString(16)} (Desc: 0x${sub.desc.toString(16)})`
        );
      } else {
        failures.push(`❌ ${testName}`);
      }
    }
  }

  const failed = failures.length;
  return {
    name: sub.name,
    total: sub.count,
    passed: sub.count - failed,
    failed,
    failures
  };
}
