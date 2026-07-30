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
const keyLeftPressed = 0x03FF & ~0x0020;
const keyRightPressed = 0x03FF & ~0x0010;

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

for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed); // Enter Subtest 1

for (let f = 0; f < 30; f++) gba.runFrame();

console.log("=== INSPECTING KEY PRESS BEHAVIOR IN SUBTEST 1 ===");
console.log("Initial DISPCNT:", `0x${gba.ppu.dispcnt.toString(16)}`);

console.log("Pressing LEFT...");
press(keyLeftPressed);
for (let f = 0; f < 30; f++) gba.runFrame();
console.log("After LEFT DISPCNT:", `0x${gba.ppu.dispcnt.toString(16)}`);

console.log("Pressing RIGHT...");
press(keyRightPressed);
for (let f = 0; f < 30; f++) gba.runFrame();
console.log("After RIGHT DISPCNT:", `0x${gba.ppu.dispcnt.toString(16)}`);
