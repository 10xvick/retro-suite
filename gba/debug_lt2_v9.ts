// Direct HBlank timing analysis: what IS dispcntHistory at end of frame vs what it should be
import { GBA } from './src/core/gba.js';
import { IO } from './src/core/memory.js';
import * as fs from 'fs';

const bios = new Uint8Array(fs.readFileSync('public/roms/test/gba_bios.bin'));
const cart = new Uint8Array(fs.readFileSync('public/roms/test/suite.gba'));

const keyReleased    = 0x03FF;
const keyAPressed    = keyReleased & ~1;
const keyDownPressed = keyReleased & ~0x0080;
const keyLeftPressed = keyReleased & ~0x0020;
const keyRightPressed = keyReleased & ~0x0010;

const gba = new GBA();
gba.loadBios(bios);
gba.loadCart(cart);
gba.reset();
gba.directBoot();

const press = (k: number) => {
  gba.mem.setKeyInput(k);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
};

// Navigate
for (let f = 0; f < 60; f++) gba.runFrame();
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);
for (let f = 0; f < 30; f++) gba.runFrame();

// Press LEFT (actual view)
press(keyLeftPressed);

// Track DISPCNT at very specific points: at HBlank entry for each scanline
// Monkey-patch gba.ts scanline logic via dispcntHistory
// The test runs for 30 frames, let's look at a specific frame

// Re-run 5 more frames and examine dispcntHistory at END of each
console.log('=== Tracking dispcntHistory[0..19] for 5 actual-view frames ===');
for (let f = 0; f < 5; f++) {
  gba.runFrame();
  const h = Array.from((gba.ppu as any).dispcntHistory).slice(0, 20);
  console.log(`Frame ${f}: [${h.map((v: any) => '0x'+v.toString(16))}]`);
}

// Now press RIGHT and do same
press(keyRightPressed);
console.log('\n=== Expected (RIGHT) view dispcntHistory[0..19] ===');
for (let f = 0; f < 5; f++) {
  gba.runFrame();
  const h = Array.from((gba.ppu as any).dispcntHistory).slice(0, 20);
  console.log(`Frame ${f}: [${h.map((v: any) => '0x'+v.toString(16))}]`);
}

// Key question: does the expected view ALWAYS have 0x1140 for all lines?
// If so, the ROM's "expected" output is statically rendered with BG0 always on
// The "actual" output shows BG0 toggling -- which is by design of the test
// So the test MUST generate the same final image in both cases for a correct emulator
// That means the HBlank toggle pattern in "actual" must produce the SAME image as static 0x1140

// The test compares what the HARDWARE would display (with BG0 on/off per scanline)
// vs what the ROM software renders as the "golden" output.
// If the hardware test is "layer toggle 2", the actual display should show alternating bands
// and the expected should show the same alternating bands.

// Let's check: on real hardware, what does 0x1040 (BG0 off) render?
// BG0 shows backdrop color. 0x1140 shows BG0 tile map.
// The test expects that BECAUSE of HBlank timing, BG0 should be ON for specific scanlines.

// The POINT of the test is: the ROM writes DISPCNT BEFORE the scanline renders (during H-Draw),
// so the HBlank flip should only affect the NEXT scanline.
// If our emulator renders using the CORRECT timing, BG0 is off only for lines where 
// it was written off BEFORE H-Draw ended.

// What "expected" shows: the ROM knows which lines SHOULD have BG0 on/off.
// The software-rendered reference shows specific bands.
// If all expected lines = 0x1140, then ALL lines should have BG0 on.

// This means: the ROM's TOGGLE code, when run on real HW, results in BG0 being ON
// for every scanline. The emulator incorrectly has BG0 off for some lines.
