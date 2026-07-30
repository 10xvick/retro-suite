/**
 * Debug: Trace DISPCNT writes + history during display frame for cat13 sub4/sub5.
 * Navigation matches cat13_video.test.ts exactly.
 */
import { describe, it } from 'vitest';
import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

function runSubtest(subtestMenuDowns: number) {
  const biosPath = ['gba/public/roms/test/gba_bios.bin', 'public/roms/test/gba_bios.bin']
    .map(p => path.resolve(p)).find(p => fs.existsSync(p))!;
  const romPath = ['gba/public/roms/test/suite.gba', 'public/roms/test/suite.gba']
    .map(p => path.resolve(p)).find(p => fs.existsSync(p))!;

  const bios = new Uint8Array(fs.readFileSync(biosPath));
  const cart = new Uint8Array(fs.readFileSync(romPath));

  const gba = new GBA();
  gba.loadBios(bios);
  gba.loadCart(cart);
  gba.reset();
  gba.directBoot();

  // Track writes with elapsed info
  interface WriteRecord { line: number; val: number; hblank: number; budget: number }
  const writes: WriteRecord[] = [];
  let tracing = false;
  let currentBudget = 0;

  // Hook into budget via a proxy on gba
  const origRunFrame = gba.runFrame.bind(gba);
  
  gba.mem.dispcntWriteCallback = (val, vcount, dispstat) => {
    if (!tracing) return;
    const line = (gba as any).scanline ?? -1;
    const budget = gba.scanlineBudget;
    writes.push({ line, val, hblank: (dispstat >> 1) & 1, budget });
  };

  const keyReleased    = 0x03FF;
  const keyAPressed    = 0x03FF & ~1;
  const keyDownPressed = 0x03FF & ~0x0080;
  const keyLeftPressed = 0x03FF & ~0x0020;

  const press = (k: number) => {
    gba.mem.setKeyInput(k);
    for (let f = 0; f < 8; f++) gba.runFrame();
    gba.mem.setKeyInput(keyReleased);
    for (let f = 0; f < 8; f++) gba.runFrame();
  };

  for (let f = 0; f < 60; f++) gba.runFrame();
  for (let i = 0; i < 13; i++) press(keyDownPressed);
  press(keyAPressed);
  for (let i = 0; i < subtestMenuDowns; i++) press(keyDownPressed);
  press(keyAPressed);
  for (let f = 0; f < 30; f++) gba.runFrame();
  press(keyLeftPressed);

  // Trace the display frames
  tracing = true;
  writes.length = 0;
  for (let f = 0; f < 3; f++) gba.runFrame();
  tracing = false;

  // Get dispcntHistory for the tested lines
  const hist = gba.ppu.dispcntHistory;
  return { 
    writes: writes.slice(0, 500), 
    totalWrites: writes.length,
    hist65to115: Array.from(hist).slice(65, 115),
    hist0to10: Array.from(hist).slice(0, 11),
  };
}

describe('Debug DISPCNT trace (cat13) v2', { timeout: 300_000 }, () => {
  it('sub4 layer toggle — full dispcntHistory around toggle lines', () => {
    const r = runSubtest(3);

    console.log('\n=== Sub4 dispcntHistory[0..10] ===');
    r.hist0to10.forEach((v, i) =>
      console.log(`  [${String(i).padStart(3)}]=0x${v.toString(16).padStart(4,'0')}`)
    );

    console.log('\n=== Sub4 dispcntHistory[65..114] ===');
    r.hist65to115.forEach((v, i) =>
      console.log(`  [${String(i+65).padStart(3)}]=0x${v.toString(16).padStart(4,'0')}`)
    );

    console.log(`\n=== Sub4 DISPCNT writes: ${r.totalWrites} total ===`);
    // Show unique writes (deduplicated by frame)
    const seen = new Set<string>();
    r.writes.forEach(w => {
      const k = `${w.line}:${w.val}:${w.budget}`;
      if (!seen.has(k)) {
        seen.add(k);
        const elapsed = 1232 - w.budget;
        console.log(
          `  line=${String(w.line).padStart(3)} val=0x${w.val.toString(16).padStart(4,'0')}` +
          ` hblank=${w.hblank} elapsed=${elapsed} budget=${w.budget}`
        );
      }
    });
  });

  it('sub5 layer toggle 2 — dispcntHistory[0..30] + writes', () => {
    const r = runSubtest(4);

    console.log('\n=== Sub5 dispcntHistory[0..10] ===');
    r.hist0to10.forEach((v, i) =>
      console.log(`  [${String(i).padStart(3)}]=0x${v.toString(16).padStart(4,'0')}`)
    );

    console.log(`\n=== Sub5 DISPCNT writes: ${r.totalWrites} (showing up to 40 unique) ===`);
    const seen = new Set<string>();
    let count = 0;
    r.writes.forEach(w => {
      if (count >= 40) return;
      const k = `${w.line}:${w.val}:${w.budget}`;
      if (!seen.has(k)) {
        seen.add(k);
        const elapsed = 1232 - w.budget;
        console.log(
          `  line=${String(w.line).padStart(3)} val=0x${w.val.toString(16).padStart(4,'0')}` +
          ` hblank=${w.hblank} elapsed=${elapsed} budget=${w.budget}`
        );
        count++;
      }
    });
  });
});
