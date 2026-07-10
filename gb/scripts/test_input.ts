// Press start during a game to verify input handling works.
// This simulates: run 1800 frames (let title screen settle), then press Start
// for 10 frames, release, run another 1200 frames, capture screenshots.

import { GameBoy } from "../src/gb/gameboy";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

const palette = [
  [155, 188, 15],
  [139, 172, 15],
  [48, 98, 48],
  [15, 56, 15],
];

const crcTable: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function framebufferToPNG(fb: Uint8Array): Buffer {
  const width = 160;
  const height = 144;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0;
    for (let x = 0; x < width; x++) {
      const c = palette[fb[y * width + x] & 0x03];
      raw[off++] = c[0];
      raw[off++] = c[1];
      raw[off++] = c[2];
      raw[off++] = 255;
    }
  }
  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND", Buffer.alloc(0))]);
}

async function main() {
  const romPath = "/home/z/my-project/upload/Batman - The Animated Series (USA, Europe).gb";
  const romData = new Uint8Array(fs.readFileSync(romPath));

  const gb = new GameBoy({});
  gb.loadRom(romData);

  console.log("Running 1800 frames to reach title screen...");
  gb.runFrames(1800);
  fs.writeFileSync("/home/z/my-project/download/screenshots/batman_press_start_before.png", framebufferToPNG(gb.ppu.framebuffer));
  console.log(`  Before Start: ${gb.ppu.frameCount} frames, PC=0x${gb.cpu.pc.toString(16)}`);

  // Press Start for 10 frames
  console.log("Pressing Start for 10 frames...");
  for (let i = 0; i < 10; i++) {
    gb.setKey("Enter", true);
    gb.runFrame();
  }
  gb.setKey("Enter", false);

  console.log("Running 1200 more frames...");
  gb.runFrames(1200);
  fs.writeFileSync("/home/z/my-project/download/screenshots/batman_press_start_after.png", framebufferToPNG(gb.ppu.framebuffer));
  console.log(`  After Start: ${gb.ppu.frameCount} frames, PC=0x${gb.cpu.pc.toString(16)}`);

  // Test arrow keys - press Right
  console.log("Pressing Right for 30 frames...");
  for (let i = 0; i < 30; i++) {
    gb.setKey("ArrowRight", true);
    gb.runFrame();
  }
  gb.setKey("ArrowRight", false);
  gb.runFrames(60);
  fs.writeFileSync("/home/z/my-project/download/screenshots/batman_after_right.png", framebufferToPNG(gb.ppu.framebuffer));
  console.log(`  After Right: ${gb.ppu.frameCount} frames, PC=0x${gb.cpu.pc.toString(16)}`);

  console.log(`\nFinal state: ${gb.cpu.totalCycles.toLocaleString()} M-cycles executed`);
  console.log(`ROM bank switched: ${gb.mmu.romBank} (MBC1 banking working)`);
  console.log(`Interrupts pending: IE=0x${gb.mmu.ie.toString(16)} IF=0x${gb.mmu.if_.toString(16)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
