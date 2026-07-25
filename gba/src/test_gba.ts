import { GBA } from './core/gba';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

// CRC32 helper for PNG encoding
function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function savePNG(frameBuffer: Uint32Array, width: number, height: number, filepath: string) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method
  
  const rawData = Buffer.alloc(height * (1 + width * 3));
  let destIdx = 0;
  for (let y = 0; y < height; y++) {
    rawData[destIdx++] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const color = frameBuffer[y * width + x];
      rawData[destIdx++] = color & 0xFF;         // R
      rawData[destIdx++] = (color >> 8) & 0xFF;  // G
      rawData[destIdx++] = (color >> 16) & 0xFF; // B
    }
  }
  
  const compressed = zlib.deflateSync(rawData);
  
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  
  const pngData = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  fs.writeFileSync(filepath, pngData);
}

function hasRedPixels(frameBuffer: Uint32Array): boolean {
  for (let i = 0; i < frameBuffer.length; i++) {
    const color = frameBuffer[i];
    const r = color & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = (color >> 16) & 0xFF;
    // Pure or dominant red text check (active test failures are red)
    if (r > 200 && g < 50 && b < 50) {
      return true;
    }
  }
  return false;
}

const CATEGORIES = [
  "Memory tests",
  "I/O read tests",
  "Timing tests",
  "Timer count-up tests",
  "Timer IRQ tests",
  "Shifter tests",
  "Carry tests",
  "Multiply long tests",
  "BIOS math tests",
  "DMA tests",
  "SIO register RW tests",
  "SIO timing tests",
  "Misc edge case tests",
  "Video tests"
];

function isSolidColor(fb: Uint32Array): boolean {
  const first = fb[0];
  for (let i = 1; i < fb.length; i += 13) {
    if (fb[i] !== first) return false;
  }
  return true;
}

function runUntilIdle(gba: GBA, maxFrames: number): number {
  // Run at least 300 frames initially to let the test load and complete execution
  for (let f = 0; f < 300; f++) gba.runFrame();

  let lastHash = 0;
  let idleCount = 0;
  let frames = 300;
  
  const getFbHash = (fb: Uint32Array) => {
    let hash = 0;
    for (let i = 0; i < fb.length; i += 7) {
      hash = (hash * 31 + fb[i]) | 0;
    }
    return hash;
  };

  for (; frames < maxFrames; frames++) {
    gba.runFrame();
    const fb = gba.ppu.framebuffer;
    const currentHash = getFbHash(fb);
    const solid = isSolidColor(fb);
    if (currentHash === lastHash && !solid) {
      idleCount++;
      if (idleCount >= 120) {
        break; // static screen for 120 consecutive frames (2 seconds of emulation time)
      }
    } else {
      idleCount = 0;
      lastHash = currentHash;
    }
  }
  return frames;
}

export async function runGbaTest(idx: number, gba: GBA): Promise<boolean> {
  const categoryName = CATEGORIES[idx];
  console.log(`\n--------------------------------------------`);
  console.log(`Running GBA Test Suite: ${categoryName}...`);

  // Reset and Boot GBA core
  gba.reset();
  gba.directBoot();
  if (idx === 7) {
    gba.cpu.enableTracing = true;
  }

  // Wait 60 frames for menu to load
  for (let f = 0; f < 60; f++) gba.runFrame();

  // Press Down key `idx` times (active low, down is bit 7)
  const keyReleased = 0x03FF;
  const keyDownPressed = 0x03FF & ~(1 << 7);
  for (let i = 0; i < idx; i++) {
    gba.mem.setKeyInput(keyDownPressed);
    for (let f = 0; f < 8; f++) gba.runFrame();
    gba.mem.setKeyInput(keyReleased);
    for (let f = 0; f < 8; f++) gba.runFrame();
  }

  // Press A key to run all tests in the selected category (active low, A is bit 0)
  const keyAPressed = 0x03FF & ~(1 << 0);
  gba.mem.setKeyInput(keyAPressed);
  for (let f = 0; f < 10; f++) gba.runFrame();
  gba.mem.setKeyInput(keyReleased);
  for (let f = 0; f < 10; f++) gba.runFrame();

  // Wait for the test to complete (run until screen becomes static or max 2400 frames)
  const ranFrames = runUntilIdle(gba, 2400);
  console.log(`Test executed for ${ranFrames} frames before stabilizing.`);



  // Check framebuffer for failures (red pixels)
  const width = 240;
  const height = 160;
  const frameBuffer = gba.ppu.framebuffer;

  // Video tests (last one) requires visual observation, skip failed pixel assertion
  const isVideoTest = (idx === CATEGORIES.length - 1);
  const failed = isVideoTest ? false : hasRedPixels(frameBuffer);

  const cleanName = categoryName.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
  const screenshotsDir = path.join(process.cwd(), 'gba', 'public', 'debug', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  if (isVideoTest) {
    const pngPath = path.join(screenshotsDir, `gba_${cleanName}_visual.png`);
    savePNG(frameBuffer, width, height, pngPath);
    console.log(`[VISUAL] Saved screenshot to ${pngPath} for manual verification.`);
    return true;
  } else if (failed) {
    console.error(`[FAILURE] GBA Test ${categoryName} FAILED!`);
    const pngPath = path.join(screenshotsDir, `gba_${cleanName}_failed.png`);
    savePNG(frameBuffer, width, height, pngPath);
    console.log(`Saved screenshot to ${pngPath}`);
    return false;
  } else {
    console.log(`[SUCCESS] GBA Test ${categoryName} PASSED!`);
    const pngPath = path.join(screenshotsDir, `gba_${cleanName}_passed.png`);
    savePNG(frameBuffer, width, height, pngPath);
    console.log(`Saved screenshot to ${pngPath}`);
    return true;
  }
}

async function main() {
  const biosPath = path.resolve('public/gba_bios.bin');
  const romPath = path.resolve('gba/public/suite.gba');

  if (!fs.existsSync(biosPath)) {
    console.error(`BIOS not found: ${biosPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(romPath)) {
    console.error(`ROM not found: ${romPath}`);
    process.exit(1);
  }

  const biosBytes = fs.readFileSync(biosPath);
  const romBytes = fs.readFileSync(romPath);



  const gba = new GBA();
  gba.loadBios(new Uint8Array(biosBytes));
  gba.loadCart(new Uint8Array(romBytes));

  let passedCount = 0;
  const targetIdxArg = process.argv[2];
  
  if (targetIdxArg !== undefined) {
    const targetIdx = parseInt(targetIdxArg, 10);
    if (isNaN(targetIdx) || targetIdx < 0 || targetIdx >= CATEGORIES.length) {
      console.error(`Invalid test category index. Valid options: 0 to ${CATEGORIES.length - 1}`);
      process.exit(1);
    }
    const success = await runGbaTest(targetIdx, gba);
    process.exit(success ? 0 : 1);
  } else {
    console.log(`Running all GBA test suite categories...`);
    for (let idx = 0; idx < CATEGORIES.length; idx++) {
      const success = await runGbaTest(idx, gba);
      if (success) passedCount++;
    }
    console.log(`\n============================================`);
    console.log(`GBA Test Suite Results: ${passedCount}/${CATEGORIES.length} passed.`);
    const totalAutomated = CATEGORIES.length - 1;
    const passedAutomated = passedCount - 1; // subtract 1 for video test
    process.exit(passedAutomated === totalAutomated ? 0 : 1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
