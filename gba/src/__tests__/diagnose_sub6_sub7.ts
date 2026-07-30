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
const keyRightPressed = 0x03FF & ~0x0010;

function runLive(subId: number) {
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

  // Navigate to category 13 (Video tests)
  for (let i = 0; i < 13; i++) press(keyDownPressed);
  press(keyAPressed);

  // Navigate to subtest
  for (let i = 0; i < subId - 1; i++) press(keyDownPressed);
  press(keyAPressed);

  for (let f = 0; f < 60; f++) gba.runFrame();

  return gba;
}

function runDirect(sub: { id: number; setup: number; render: number }) {
  const gba = new GBA();
  gba.loadBios(bios);
  gba.loadCart(cart);
  gba.reset();
  gba.directBoot();

  for (let f = 0; f < 60; f++) gba.runFrame();

  gba.cpu.r[14] = 0x08000100;
  gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((sub.setup & 1) ? 0x20 : 0);
  gba.cpu.r[15] = sub.setup & ~1;
  for (let s = 0; s < 200000; s++) {
    gba.cpu.step();
    if (gba.cpu.r[15] === 0x08000100) break;
  }

  gba.cpu.r[14] = 0x08000100;
  gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((sub.render & 1) ? 0x20 : 0);
  gba.cpu.r[15] = sub.render & ~1;
  for (let s = 0; s < 200000; s++) {
    gba.cpu.step();
    if (gba.cpu.r[15] === 0x08000100) break;
  }

  return gba;
}

const VIDEO_SUBTESTS = [
  { id: 6, name: "OAM Update Delay", setup: 0x0800bc05, render: 0x0800b949 },
  { id: 7, name: "Window offscreen reset", setup: 0x0800ae55, render: 0x0800adbd }
];

console.log("=== DIAGNOSING SUBTEST 6 AND SUBTEST 7 ===");

for (const sub of VIDEO_SUBTESTS) {
  console.log(`\n================ SUBTEST #${sub.id}: ${sub.name} ================`);
  const liveGBA = runLive(sub.id);
  const directGBA = runDirect(sub);

  liveGBA.ppu.renderFrame();
  directGBA.ppu.renderFrame();

  const liveFb = new Uint32Array(liveGBA.ppu.framebuffer);
  const directFb = new Uint32Array(directGBA.ppu.framebuffer);

  // Compare DISPCNT and IO registers
  console.log("LIVE DISPCNT:  ", `0x${liveGBA.ppu.dispcnt.toString(16)}`);
  console.log("DIRECT DISPCNT:", `0x${directGBA.ppu.dispcnt.toString(16)}`);

  console.log("LIVE WIN0H:    ", `0x${liveGBA.mem.read16(0x4000040).toString(16)}`, "DIRECT:", `0x${directGBA.mem.read16(0x4000040).toString(16)}`);
  console.log("LIVE WIN1H:    ", `0x${liveGBA.mem.read16(0x4000042).toString(16)}`, "DIRECT:", `0x${directGBA.mem.read16(0x4000042).toString(16)}`);
  console.log("LIVE WIN0V:    ", `0x${liveGBA.mem.read16(0x4000044).toString(16)}`, "DIRECT:", `0x${directGBA.mem.read16(0x4000044).toString(16)}`);
  console.log("LIVE WIN1V:    ", `0x${liveGBA.mem.read16(0x4000046).toString(16)}`, "DIRECT:", `0x${directGBA.mem.read16(0x4000046).toString(16)}`);
  console.log("LIVE WININ:    ", `0x${liveGBA.mem.read16(0x4000048).toString(16)}`, "DIRECT:", `0x${directGBA.mem.read16(0x4000048).toString(16)}`);
  console.log("LIVE WINOUT:   ", `0x${liveGBA.mem.read16(0x400004a).toString(16)}`, "DIRECT:", `0x${directGBA.mem.read16(0x400004a).toString(16)}`);

  console.log("LIVE win0InY:  ", liveGBA.ppu.win0InY, "DIRECT win0InY:", directGBA.ppu.win0InY);
  console.log("LIVE win1InY:  ", liveGBA.ppu.win1InY, "DIRECT win1InY:", directGBA.ppu.win1InY);

  // Find first mismatch
  let diffCount = 0;
  let firstDiff: any = null;
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 240; x++) {
      const idx = y * 240 + x;
      if (liveFb[idx] !== directFb[idx]) {
        diffCount++;
        if (!firstDiff) {
          firstDiff = {
            x, y,
            live: `0x${liveFb[idx].toString(16).padStart(8, '0')}`,
            direct: `0x${directFb[idx].toString(16).padStart(8, '0')}`
          };
        }
      }
    }
  }

  console.log(`Diff count: ${diffCount} / ${240*160}`);
  if (firstDiff) {
    console.log(`First Diff at (x=${firstDiff.x}, y=${firstDiff.y}): live=${firstDiff.live}, direct=${firstDiff.direct}`);
  }
}
