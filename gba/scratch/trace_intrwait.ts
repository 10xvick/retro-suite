import { GBA } from '../src/core/gba';
import { IO } from '../src/core/memory';
import * as fs from 'fs';

const bios = fs.readFileSync('public/roms/test/gba_bios.bin');
const cart = fs.readFileSync('public/roms/test/suite.gba');

const gba = new GBA();
gba.loadBios(bios);
gba.loadCart(cart);
gba.reset();
gba.directBoot();

for (let f = 0; f < 60; f++) gba.runFrame();

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(0x3FF);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

for (let i = 0; i < 13; i++) press(0x0080); // DOWN
press(0x0001); // A

for (let i = 0; i < 4; i++) press(0x0080); // DOWN for Subtest 5
press(0x0001); // A

for (let f = 0; f < 30; f++) {
  gba.runFrame();
}

console.log("-- Test should be running now! --");

for (let f = 0; f < 30; f++) {
  gba.runFrame();
}

let tracing = false;
let startCycle = 0;

gba.mem.writeIO16 = function(off: number, val: number) {
  if (off === IO.DISPCNT && this.timerIndexForOff === undefined) {
    console.log(`DISPCNT write val=0x${val.toString(16)} at line=${gba.scanline} cyc=${gba.cycles}`);
  }
  Object.getPrototypeOf(this).writeIO16.call(this, off, val);
}

const origStep = gba.cpu.step.bind(gba.cpu);
gba.cpu.step = function() {
  const pc = this.r[15];
  if (pc === 0x18) { // IRQ vector
    console.log(`IRQ triggered at line ${gba.scanline} cyc=${gba.cycles}`);
  }
  return origStep();
};

console.log("-- Start 1 frame --");
gba.runFrame();
