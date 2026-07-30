import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

const biosPath = path.resolve('gba/public/roms/test/gba_bios.bin');
const romPath = path.resolve('gba/public/roms/test/suite.gba');

const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

const VIDEO_SUBTESTS = [
  { id: 1, name: "Basic Mode 3" },
  { id: 2, name: "Basic Mode 4" },
  { id: 3, name: "Degenerate OBJ transforms" },
  { id: 4, name: "Layer toggle" },
  { id: 5, name: "Layer toggle 2" },
  { id: 6, name: "OAM Update Delay" },
  { id: 7, name: "Window offscreen reset" }
];

const keyReleased = 0x03FF;
const keyAPressed = 0x03FF & ~1;
const keyDownPressed = 0x03FF & ~0x0080;

for (const sub of VIDEO_SUBTESTS) {
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
  press(keyAPressed);

  for (let i = 0; i < sub.id - 1; i++) press(keyDownPressed);
  press(keyAPressed);

  for (let f = 0; f < 60; f++) gba.runFrame();

  // Read memory around 0x03007b08 and 0x03000000..0x03007fff
  const resBase = 0x03007b08 + (sub.id - 1) * 16;
  const strAddr = gba.mem.read32(resBase);
  const actual = gba.mem.read32(resBase + 4);
  const expected = gba.mem.read32(resBase + 8);
  const status = gba.mem.read32(resBase + 12);

  console.log(`Subtest #${sub.id} ("${sub.name}") -> RAM [0x${resBase.toString(16)}]: strAddr=0x${strAddr.toString(16)}, actual=0x${actual.toString(16)}, expected=0x${expected.toString(16)}, status=${status}`);
}
