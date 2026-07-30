import { GBA } from '../src/core/gba';
import * as fs from 'fs';
import { performance } from 'perf_hooks';

const bios = fs.readFileSync('public/roms/test/gba_bios.bin');
const cart = fs.readFileSync('public/roms/test/suite.gba');

const gba = new GBA();
gba.loadBios(bios);
gba.loadCart(cart);
gba.reset();
gba.directBoot();

const start = performance.now();
let frames = 0;
while (frames < 450) {
  gba.runFrame();
  frames++;
}
const end = performance.now();
console.log(`Executed ${frames} frames in ${(end - start).toFixed(2)} ms.`);
