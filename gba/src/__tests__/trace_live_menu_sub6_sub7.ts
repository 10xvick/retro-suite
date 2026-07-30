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

function traceLiveSubtest(subId: number) {
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
  
  // Track IO writes during A press
  let ioWrites: string[] = [];
  const origWrite16 = gba.mem.writeIO16.bind(gba.mem);
  gba.mem.writeIO16 = (off: number, val: number) => {
    if (off === 0x0 || off === 0x40 || off === 0x42 || off === 0x44 || off === 0x46 || off === 0x48 || off === 0x4a) {
      ioWrites.push(`IO 0x${off.toString(16)} = 0x${val.toString(16)} (pc=0x${gba.cpu.r[15].toString(16)})`);
    }
    origWrite16(off, val);
  };

  press(keyAPressed);
  for (let f = 0; f < 60; f++) gba.runFrame();

  console.log(`\n=== LIVE SUBTEST ${subId} IO WRITES ===`);
  ioWrites.forEach(w => console.log("  ", w));

  console.log("FINAL PPU REGISTERS:");
  console.log("  DISPCNT:", `0x${gba.ppu.dispcnt.toString(16)}`);
  console.log("  WIN0H:  ", `0x${gba.mem.read16(0x4000040).toString(16)}`);
  console.log("  WIN1H:  ", `0x${gba.mem.read16(0x4000042).toString(16)}`);
  console.log("  WIN0V:  ", `0x${gba.mem.read16(0x4000044).toString(16)}`);
  console.log("  WIN1V:  ", `0x${gba.mem.read16(0x4000046).toString(16)}`);
  console.log("  WININ:  ", `0x${gba.mem.read16(0x4000048).toString(16)}`);
  console.log("  WINOUT: ", `0x${gba.mem.read16(0x400004a).toString(16)}`);
  console.log("  win0InY:", gba.ppu.win0InY, "win1InY:", gba.ppu.win1InY);

  return gba;
}

traceLiveSubtest(6);
traceLiveSubtest(7);
