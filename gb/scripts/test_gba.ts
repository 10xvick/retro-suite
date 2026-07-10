// Test GBA emulator with Metal Slug Advance ROM.
import { GBA } from "../src/gba/gba";
import * as fs from "fs";
import * as zlib from "zlib";

const romPath = "/home/z/my-project/upload/1840 - Metal Slug Advance (E)(TRSI).gba";
const rom = new Uint8Array(fs.readFileSync(romPath));
console.log(`ROM size: ${rom.length} bytes (${(rom.length/1024/1024).toFixed(1)} MB)`);
console.log(`Title: "${rom.slice(0xA0, 0xAC).toString("ascii")}"`);

const gba = new GBA({});

let frameCount = 0;
let totalCycles = 0;
let errorCount = 0;

try {
  // Load BIOS first
  const biosPath = "/home/z/my-project/upload/gba_bios.bin";
  if (fs.existsSync(biosPath)) {
    const bios = new Uint8Array(fs.readFileSync(biosPath));
    gba.loadBios(bios);
    console.log(`BIOS loaded: ${bios.length} bytes`);
  } else {
    console.log("WARNING: No BIOS found, skipping BIOS load");
  }
  gba.loadRom(rom);
  console.log("ROM loaded, CPU reset");

  // Run 60 frames
  for (let i = 0; i < 60; i++) {
    gba.runFrame();
    frameCount++;
    totalCycles = gba.cpu.totalCycles;
    if (i % 10 === 9) {
      console.log(`Frame ${i+1}: PC=0x${(gba.cpu.pc >>> 0).toString(16).padStart(8,"0")} thumb=${gba.cpu.thumb} cycles=${totalCycles.toLocaleString()}`);
    }
  }

  // Check framebuffer
  const fb = gba.ppu.framebuffer;
  let nonWhite = 0;
  let nonBlack = 0;
  for (let i = 0; i < fb.length; i += 4) {
    if (fb[i] !== 0xFF || fb[i+1] !== 0xFF || fb[i+2] !== 0xFF) nonWhite++;
    if (fb[i] !== 0 || fb[i+1] !== 0 || fb[i+2] !== 0) nonBlack++;
  }
  console.log(`\nFramebuffer: ${nonWhite} non-white, ${nonBlack} non-black / ${240*160} pixels`);

  // Save framebuffer as PNG
  const pngBuffer = framebufferToPNG(fb);
  fs.writeFileSync("/home/z/my-project/download/screenshots/gba_test.png", pngBuffer);
  console.log("Saved screenshot: download/screenshots/gba_test.png");

} catch (e) {
  console.error(`Error at frame ${frameCount}:`, e);
  errorCount++;
}

console.log(`\nFinal: ${frameCount} frames, ${totalCycles.toLocaleString()} cycles, ${errorCount} errors`);

function framebufferToPNG(fb: Uint8Array): Buffer {
  const width = 240, height = 160;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      raw[off++] = fb[idx];
      raw[off++] = fb[idx+1];
      raw[off++] = fb[idx+2];
      raw[off++] = fb[idx+3];
    }
  }
  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
