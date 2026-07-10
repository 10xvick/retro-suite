// Headless test harness - runs the emulator against a ROM for N frames
// and dumps a framebuffer snapshot to a PNG using zlib, plus a serial-output log.
// Used to verify the emulator works without a browser.

import { GameBoy } from "../src/gb/gameboy";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

function framebufferToPPM(fb: Uint8Array): string {
  // PPM is a simple RGB image format - PIL/GIMP can read it
  // Framebuffer is RGBA32
  let s = "P3\n160 144\n255\n";
  for (let y = 0; y < 144; y++) {
    let line = "";
    for (let x = 0; x < 160; x++) {
      const fbIdx = (y * 160 + x) * 4;
      line += `${fb[fbIdx]} ${fb[fbIdx + 1]} ${fb[fbIdx + 2]} `;
    }
    s += line.trimEnd() + "\n";
  }
  return s;
}

// CRC32 lookup table (lazy init)
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

  // Build raw image data with filter byte (0) per scanline
  // Framebuffer is now RGBA32 (4 bytes per pixel)
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const fbIdx = (y * width + x) * 4;
      raw[off++] = fb[fbIdx] || 0;       // R
      raw[off++] = fb[fbIdx + 1] || 0;   // G
      raw[off++] = fb[fbIdx + 2] || 0;   // B
      raw[off++] = 255;                   // A (force opaque - PPU stashes priority in alpha)
    }
  }

  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression: zlib
  ihdr[11] = 0;  // filter method
  ihdr[12] = 0;  // interlace: none

  const ihdrChunk = pngChunk("IHDR", ihdr);
  const idatChunk = pngChunk("IDAT", compressed);
  const iendChunk = pngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function bufferToAscii(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) {
    if (b === 0) break;
    if (b >= 0x20 && b < 0x7F) s += String.fromCharCode(b);
    else s += ".";
  }
  return s;
}

async function runTest(romPath: string, frames: number, outputPath: string) {
  console.log(`\n=== Testing ${romPath} (${frames} frames) ===`);

  const romData = new Uint8Array(fs.readFileSync(romPath));
  console.log(`ROM size: ${romData.length} bytes`);
  console.log(`Title: "${bufferToAscii(romData.slice(0x134, 0x144))}"`);
  console.log(`Cart type: 0x${romData[0x147].toString(16)}`);
  console.log(`ROM size code: 0x${romData[0x148].toString(16)}`);
  const cgbFlag = romData[0x143];
  const modeStr = cgbFlag === 0xC0 ? "CGB-only" : cgbFlag === 0x80 ? "CGB-compatible" : "DMG";
  console.log(`CGB flag: 0x${cgbFlag.toString(16)} (${modeStr})`);

  let lastSerial = "";
  const serialLog: string[] = [];

  const gb = new GameBoy({
    onSerialByte: (b) => {
      const ch = b === 0x0A ? "\n" : (b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : "");
      if (ch) {
        lastSerial += ch;
        if (b === 0x0A) {
          const trimmed = lastSerial.trimEnd();
          if (trimmed.length > 0) {
            serialLog.push(trimmed);
            console.log("[Serial]", trimmed);
          }
          lastSerial = "";
        }
      }
    }
  });

  gb.loadRom(romData);

  // Run frames, capturing periodic snapshots
  const start = Date.now();
  const snapshotFrames = [60, 180, 600, 1200, 1800, 3000, 5000, 10000, frames].filter((f) => f <= frames);
  let snapshotIdx = 0;

  for (let i = 0; i < frames; i++) {
    gb.runFrame();
    if (snapshotIdx < snapshotFrames.length && i + 1 === snapshotFrames[snapshotIdx]) {
      const base = outputPath.replace(/\.png$/, `_${i + 1}f`);
      fs.writeFileSync(base + ".png", framebufferToPNG(gb.ppu.framebuffer));
      fs.writeFileSync(base + ".ppm", framebufferToPPM(gb.ppu.framebuffer));
      console.log(`  Snapshot @ ${i + 1} frames: ${base}.png  (M-cycles: ${gb.cpu.totalCycles.toLocaleString()})`);
      snapshotIdx++;
    }
  }
  const elapsed = Date.now() - start;

  console.log(`\nFinal state:`);
  console.log(`  Total M-cycles: ${gb.cpu.totalCycles.toLocaleString()}`);
  console.log(`  PC: 0x${gb.cpu.pc.toString(16).padStart(4, "0")}`);
  console.log(`  AF: 0x${gb.cpu.af.toString(16).padStart(4, "0")}`);
  console.log(`  BC: 0x${gb.cpu.bc.toString(16).padStart(4, "0")}`);
  console.log(`  DE: 0x${gb.cpu.de.toString(16).padStart(4, "0")}`);
  console.log(`  HL: 0x${gb.cpu.hl.toString(16).padStart(4, "0")}`);
  console.log(`  SP: 0x${gb.cpu.sp.toString(16).padStart(4, "0")}`);
  console.log(`  ROM bank: ${gb.mmu.romBank}`);
  console.log(`  Halted: ${gb.cpu.halted}  Stopped: ${gb.cpu.stopped}`);
  console.log(`  Time: ${elapsed}ms  (${(frames / (elapsed / 1000)).toFixed(1)} fps emulation speed)`);
  console.log(`  Serial output lines: ${serialLog.length}`);

  // Save final PNG
  fs.writeFileSync(outputPath, framebufferToPNG(gb.ppu.framebuffer));
  console.log(`  Final snapshot: ${outputPath}`);

  // Save serial log
  const logPath = outputPath.replace(/\.png$/, "_serial.log");
  fs.writeFileSync(logPath, serialLog.join("\n"));
  console.log(`  Serial log: ${logPath}`);

  // Sanity check: did the CPU get stuck?
  const pcStuck = gb.cpu.pc === 0x0100 && gb.cpu.totalCycles < 1000;
  if (pcStuck) {
    console.log(`  [!] CPU appears stuck at PC=0x0100 (only ${gb.cpu.totalCycles} cycles)`);
    return false;
  } else {
    console.log(`  [OK] CPU executed ${gb.cpu.totalCycles.toLocaleString()} M-cycles successfully`);
    return true;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: npx tsx scripts/headless_test.ts <rom-path> <output-png> [frames]");
    process.exit(1);
  }
  const romPath = args[0];
  const outputPath = args[1];
  const frames = args[2] ? parseInt(args[2]) : 600;

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const ok = await runTest(romPath, frames, outputPath);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
