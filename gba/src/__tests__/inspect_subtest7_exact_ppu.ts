import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

const biosPath = path.resolve('gba/public/roms/test/gba_bios.bin');
const romPath = path.resolve('gba/public/roms/test/suite.gba');

const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

const gba = new GBA();
gba.loadBios(bios);
gba.loadCart(cart);
gba.reset();
gba.directBoot();

for (let f = 0; f < 60; f++) gba.runFrame();

const keyReleased = 0x03FF;
const keyAPressed = 0x03FF & ~1;
const keyDownPressed = 0x03FF & ~0x0080;

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);

// Subtest 7 (press DOWN 6 times)
for (let i = 0; i < 6; i++) press(keyDownPressed);
press(keyAPressed);

for (let f = 0; f < 60; f++) gba.runFrame();

console.log("=== SUBTEST 7 ACTUAL LIVE HARDWARE REGISTERS ===");
console.log("DISPCNT:", `0x${gba.mem.read16(0x04000000).toString(16)}`);
console.log("WIN0H:  ", `0x${gba.mem.read16(0x04000040).toString(16)}`);
console.log("WIN1H:  ", `0x${gba.mem.read16(0x04000042).toString(16)}`);
console.log("WIN0V:  ", `0x${gba.mem.read16(0x04000044).toString(16)}`);
console.log("WIN1V:  ", `0x${gba.mem.read16(0x04000046).toString(16)}`);
console.log("WININ:  ", `0x${gba.mem.read16(0x04000048).toString(16)}`);
console.log("WINOUT: ", `0x${gba.mem.read16(0x0400004a).toString(16)}`);

// Inspect framebuffer pixels at the 4 quadrants
const fb = new Uint32Array(gba.ppu.framebuffer);

const topLeft = fb[10 * 240 + 10];      // Top-Left (x=10, y=10)
const topRight = fb[10 * 240 + 180];     // Top-Right (x=180, y=10)
const bottomLeft = fb[100 * 240 + 10];   // Bottom-Left (x=10, y=100)
const bottomRight = fb[100 * 240 + 180]; // Bottom-Right (x=180, y=100)

console.log("\n=== PIXEL COLORS AT 4 QUADRANTS ===");
console.log("Top-Left (x=10, y=10):    ", `0x${topLeft.toString(16)}`, topLeft === 0xffffffff ? "(WHITE)" : "(PATTERN)");
console.log("Top-Right (x=180, y=10):  ", `0x${topRight.toString(16)}`, topRight === 0xffffffff ? "(WHITE)" : "(PATTERN)");
console.log("Bottom-Left (x=10, y=100): ", `0x${bottomLeft.toString(16)}`, bottomLeft === 0xffffffff ? "(WHITE)" : "(PATTERN)");
console.log("Bottom-Right (x=180, y=100):", `0x${bottomRight.toString(16)}`, bottomRight === 0xffffffff ? "(WHITE)" : "(PATTERN)");
