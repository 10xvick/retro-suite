import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

const biosPath = path.resolve('gba/public/roms/test/gba_bios.bin');
const romPath = path.resolve('gba/public/roms/test/suite.gba');

const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

const keyReleased = 0x03FF;
const keyAPressed = 0x03FF & ~1;
const keyDownPressed = 0x03FF & ~0x0080;

console.log("=== DEEP INSPECT SUBTEST 6 ===");

// 1. Live Subtest 6
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
for (let i = 0; i < 5; i++) press(keyDownPressed); // Subtest 6 is index 5 (0-based)

// Capture OAM state before and after press A on Subtest 6
console.log("Live OAM entry 0 before Subtest 6 execution:");
console.log("  Attr0:", gbaLive.mem.oam[0] | (gbaLive.mem.oam[1] << 8));
console.log("  Attr1:", gbaLive.mem.oam[2] | (gbaLive.mem.oam[3] << 8));
console.log("  Attr2:", gbaLive.mem.oam[4] | (gbaLive.mem.oam[5] << 8));

press(keyAPressed);
for (let f = 0; f < 60; f++) gbaLive.runFrame();

console.log("\nLive DISPCNT after Subtest 6:", `0x${gbaLive.ppu.dispcnt.toString(16)}`);
console.log("Live OAM entries for Subtest 6:");
for (let i = 0; i < 5; i++) {
  const a0 = gbaLive.mem.oam[i * 8] | (gbaLive.mem.oam[i * 8 + 1] << 8);
  const a1 = gbaLive.mem.oam[i * 8 + 2] | (gbaLive.mem.oam[i * 8 + 3] << 8);
  const a2 = gbaLive.mem.oam[i * 8 + 4] | (gbaLive.mem.oam[i * 8 + 5] << 8);
  console.log(`  Sprite ${i}: attr0=0x${a0.toString(16)}, attr1=0x${a1.toString(16)}, attr2=0x${a2.toString(16)}`);
}

// 2. Direct Subtest 6
const gbaDirect = new GBA();
gbaDirect.loadBios(bios);
gbaDirect.loadCart(cart);
gbaDirect.reset();
gbaDirect.directBoot();

for (let f = 0; f < 60; f++) gbaDirect.runFrame();

// Set DISPCNT to 0x1140 as live menu does, then run setup & render
gbaDirect.mem.writeIO16(0x0, 0x1140);

const sub6 = { setup: 0x0800bc05, render: 0x0800b949 };
gbaDirect.cpu.r[14] = 0x08000100;
gbaDirect.cpu.cpsr = (gbaDirect.cpu.cpsr & ~0x20) | ((sub6.setup & 1) ? 0x20 : 0);
gbaDirect.cpu.r[15] = sub6.setup & ~1;
for (let s = 0; s < 200000; s++) {
  gbaDirect.cpu.step();
  if (gbaDirect.cpu.r[15] === 0x08000100) break;
}

gbaDirect.cpu.r[14] = 0x08000100;
gbaDirect.cpu.cpsr = (gbaDirect.cpu.cpsr & ~0x20) | ((sub6.render & 1) ? 0x20 : 0);
gbaDirect.cpu.r[15] = sub6.render & ~1;
for (let s = 0; s < 200000; s++) {
  gbaDirect.cpu.step();
  if (gbaDirect.cpu.r[15] === 0x08000100) break;
}

console.log("\nDirect DISPCNT after Subtest 6 (with DISPCNT pre-set to 0x1140):", `0x${gbaDirect.ppu.dispcnt.toString(16)}`);
console.log("Direct OAM entries for Subtest 6:");
for (let i = 0; i < 5; i++) {
  const a0 = gbaDirect.mem.oam[i * 8] | (gbaDirect.mem.oam[i * 8 + 1] << 8);
  const a1 = gbaDirect.mem.oam[i * 8 + 2] | (gbaDirect.mem.oam[i * 8 + 3] << 8);
  const a2 = gbaDirect.mem.oam[i * 8 + 4] | (gbaDirect.mem.oam[i * 8 + 5] << 8);
  console.log(`  Sprite ${i}: attr0=0x${a0.toString(16)}, attr1=0x${a1.toString(16)}, attr2=0x${a2.toString(16)}`);
}

// Compare live vs direct framebuffers when DISPCNT is set to 0x1140
gbaLive.ppu.renderFrame();
gbaDirect.ppu.renderFrame();
const liveFb = new Uint32Array(gbaLive.ppu.framebuffer);
const directFb = new Uint32Array(gbaDirect.ppu.framebuffer);

let diffs = 0;
let firstDiff: any = null;
for (let y = 0; y < 160; y++) {
  for (let x = 0; x < 240; x++) {
    const idx = y * 240 + x;
    if (liveFb[idx] !== directFb[idx]) {
      diffs++;
      if (!firstDiff) {
        firstDiff = { x, y, live: `0x${liveFb[idx].toString(16)}`, direct: `0x${directFb[idx].toString(16)}` };
      }
    }
  }
}
console.log(`\nWhen DISPCNT=0x1140 in direct, diffs between Live & Direct: ${diffs} / 38400`);
if (firstDiff) {
  console.log(`  First diff at (x=${firstDiff.x}, y=${firstDiff.y}): live=${firstDiff.live}, direct=${firstDiff.direct}`);
}
