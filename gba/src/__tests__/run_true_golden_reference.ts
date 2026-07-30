import { GBA } from '../core/gba.js';
import { saveBufferAsPng } from './png_encoder.js';
import * as fs from 'fs';
import * as path from 'path';

const biosPath = path.resolve('gba/public/roms/test/gba_bios.bin');
const romPath = path.resolve('gba/public/roms/test/suite.gba');

const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

const subtests = [
  { id: 1, name: "Basic Mode 3", setup: 0x0800a7b5, render: 0x0800a7dd },
  { id: 2, name: "Basic Mode 4", setup: 0x0800a891, render: 0x0800a8bd },
  { id: 3, name: "Degenerate OBJ transforms", setup: 0x0800a94d, render: 0x0800a975 },
  { id: 4, name: "Layer toggle", setup: 0x0800aa61, render: 0x0800a8bd },
  { id: 5, name: "Layer toggle 2", setup: 0x0800ab95, render: 0x0800a8bd },
  { id: 6, name: "OAM Update Delay", setup: 0x0800ac71, render: 0x0800a8bd },
  { id: 7, name: "Window offscreen reset", setup: 0x0800ae55, render: 0x0800adbd },
];

const artifactDir = `C:\\Users\\Priya singh\\.gemini\\antigravity\\brain\\5de04d41-642a-4685-8a1d-5a40cdba0c64`;

console.log("=== UNBLANKED GOLDEN REFERENCE ANALYSIS ===");

for (const sub of subtests) {
  const gba = new GBA();
  gba.loadBios(bios);
  gba.loadCart(cart);
  gba.reset();
  gba.directBoot();

  for (let f = 0; f < 60; f++) gba.runFrame();

  // Run setup()
  gba.cpu.r[14] = 0x08000100;
  gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((sub.setup & 1) ? 0x20 : 0);
  gba.cpu.r[15] = sub.setup & ~1;
  for (let s = 0; s < 200000; s++) {
    gba.cpu.step();
    if (gba.cpu.r[15] === 0x08000100) break;
  }

  // Run render()
  gba.cpu.r[14] = 0x08000100;
  gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((sub.render & 1) ? 0x20 : 0);
  gba.cpu.r[15] = sub.render & ~1;
  for (let s = 0; s < 200000; s++) {
    gba.cpu.step();
    if (gba.cpu.r[15] === 0x08000100) break;
  }

  // Run main loop for 10 frames to unblank DISPCNT!
  for (let f = 0; f < 10; f++) gba.runFrame();

  gba.ppu.renderFrame();
  const fb = new Uint32Array(gba.ppu.framebuffer);

  const pngPath = path.join(artifactDir, `expected_subtest_${sub.id}_unblanked.png`);
  saveBufferAsPng(240, 160, fb, pngPath);

  console.log(`Subtest #${sub.id} ("${sub.name}") Unblanked Golden DISPCNT: 0x${gba.ppu.dispcnt.toString(16)} -> ${pngPath}`);
}
