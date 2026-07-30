import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

const biosPath = path.resolve('gba/public/roms/test/gba_bios.bin');
const romPath = path.resolve('gba/public/roms/test/suite.gba');

const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

for (const subId of [1, 2]) {
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

  for (let i = 0; i < subId - 1; i++) press(keyDownPressed);
  press(keyAPressed);

  for (let f = 0; f < 60; f++) gba.runFrame();

  const pa = gba.mem.readIO16(0x20); // BG2PA
  const pb = gba.mem.readIO16(0x22); // BG2PB
  const pc = gba.mem.readIO16(0x24); // BG2PC
  const pd = gba.mem.readIO16(0x26); // BG2PD
  const x = gba.mem.readIO32(0x28);  // BG2X
  const y = gba.mem.readIO32(0x2c);  // BG2Y

  console.log(`=== Subtest #${subId} BG2 Affine Params ===`);
  console.log(`PA: 0x${pa.toString(16)}, PB: 0x${pb.toString(16)}, PC: 0x${pc.toString(16)}, PD: 0x${pd.toString(16)}`);
  console.log(`X: 0x${x.toString(16)}, Y: 0x${y.toString(16)}`);
}
