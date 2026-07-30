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

function traceSubtestDispatch(subId: number) {
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

  for (let i = 0; i < subId - 1; i++) press(keyDownPressed);

  // Hook BL / BLX calls or function calls when A is pressed
  let functionsCalled: { pc: number; lr: number; r0: number; r1: number; r2: number; r3: number }[] = [];
  
  // Track execution during subtest launch
  gba.mem.setKeyInput(keyAPressed);
  for (let s = 0; s < 500000; s++) {
    const pc = gba.cpu.r[15];
    // Check if PC is in subtest setup/render address ranges (0x0800a000 .. 0x0800c000)
    if (pc >= 0x0800a000 && pc <= 0x0800c000) {
      if (functionsCalled.length === 0 || functionsCalled[functionsCalled.length - 1].pc !== pc) {
        functionsCalled.push({
          pc,
          lr: gba.cpu.r[14],
          r0: gba.cpu.r[0],
          r1: gba.cpu.r[1],
          r2: gba.cpu.r[2],
          r3: gba.cpu.r[3]
        });
      }
    }
    gba.cpu.step();
  }

  console.log(`\n=== FUNCTIONS CALLED IN RANGE 0x0800a000-0x0800c000 FOR SUBTEST ${subId} ===`);
  // Print unique initial entry points
  const entryPCs = new Set<number>();
  functionsCalled.forEach(f => {
    if (!entryPCs.has(f.pc)) {
      entryPCs.add(f.pc);
      console.log(`  PC: 0x${f.pc.toString(16)}, LR: 0x${f.lr.toString(16)}, r0: 0x${f.r0.toString(16)}, r1: 0x${f.r1.toString(16)}`);
    }
  });
}

traceSubtestDispatch(6);
traceSubtestDispatch(7);
