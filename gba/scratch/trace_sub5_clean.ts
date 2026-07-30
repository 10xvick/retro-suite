import fs from "fs";
import { GBA } from "../src/core/gba";

const gba = new GBA();
const bios = fs.readFileSync("public/gba_bios.bin");
const rom = fs.readFileSync("public/roms/test/suite.gba");
gba.loadBios(bios);
gba.loadCart(rom);

let dispcntLogs: string[] = [];
let isExpected = false;
let oldWrite = gba.mem.writeIO.bind(gba.mem);
gba.mem.writeIO = function(addr: number, val: number, size: any) {
  if (addr === 0x00 || addr === 0x01 || (addr >= 0xB0 && addr <= 0xDF)) {
    const msg = `writeIO size=${size} val=0x${val.toString(16)} at addr=${addr.toString(16)} scanline=${gba.scanline} cyc=${gba.cycles} PC=0x${gba.cpu.r[15].toString(16)}`;
    dispcntLogs.push(msg);
  }
  oldWrite(addr, val, size);
};

let oldWrite16 = gba.mem.writeIO16.bind(gba.mem);
gba.mem.writeIO16 = function(addr: number, val: number) {
  if (addr === 0x00) {
    const msg = `DISPCNT write val=0x${val.toString(16)} at scanline=${gba.scanline} cyc=${gba.cycles} PC=0x${gba.cpu.r[15].toString(16)}`;
    dispcntLogs.push(msg);
  }
  oldWrite16(addr, val);
};

const keyDownPressed = 0x037F;
const keyAPressed = 0x03FE;
const keyLeftPressed = 0x03DF;
const keyRightPressed = 0x03EF;
const keyReleased = 0x03FF;

function press(keyMask: number) {
  gba.mem.setKeyInput(keyMask);
  for (let f = 0; f < 8; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 8; f++) gba.runFrame();
}

console.log("Waiting for BIOS to boot...");
for (let f = 0; f < 300; f++) gba.runFrame();

console.log("Navigating to Category 13...");
for (let i = 0; i < 13; i++) press(keyDownPressed);
press(keyAPressed);

console.log("Navigating to 'Layer toggle 2'...");
for (let i = 0; i < 4; i++) press(keyDownPressed);
press(keyAPressed);

console.log("Running Subtest 5 actual frames...");
let actualFrames: Uint32Array[] = [];
for (let f = 0; f < 200; f++) {
  gba.runFrame();
  actualFrames.push(Uint32Array.from(gba.ppu.framebuffer));
}
fs.writeFileSync('scratch/dispcnt_writes_actual.txt', dispcntLogs.join('\n'));

dispcntLogs = [];
isExpected = true;
console.log("Running Subtest 5 expected frames...");
press(keyRightPressed);
let expectedFrames: Uint32Array[] = [];
for (let f = 0; f < 200; f++) {
  gba.runFrame();
  expectedFrames.push(Uint32Array.from(gba.ppu.framebuffer));
}
fs.writeFileSync('scratch/dispcnt_writes_expected.txt', dispcntLogs.join('\n'));

const expectedBuffer = expectedFrames[199];

console.log("Checking which actual frame matches expectedBuffer...");
let matchedFrame = -1;
for (let f = 0; f < 200; f++) {
  let match = true;
  for (let i = 0; i < 240 * 160; i++) {
    if (actualFrames[f][i] !== expectedBuffer[i]) {
      match = false;
      break;
    }
  }
  if (match) {
    matchedFrame = f;
    break;
  }
}
console.log(`Matched frame: ${matchedFrame}`);

let fails = 0;
for (let y = 0; y < 160; y++) {
  for (let x = 0; x < 240; x++) {
    const idx = y * 240 + x;
    const a = actualFrames[199][idx];
    const e = expectedBuffer[idx];
    if (a !== e) {
      fails++;
      if (fails <= 10) console.log(`Diff at ${x},${y}: expected ${e.toString(16)} got ${a.toString(16)}`);
    }
  }
}
console.log(`Test finished! Fails: ${fails}`);
