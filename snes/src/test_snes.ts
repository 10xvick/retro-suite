import { SnesEmulator } from './snes/EmulatorFacade';
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

// Function to scan PPU VRAM for PASS or FAIL text
function checkVramResult(vram: Uint16Array): 'PASS' | 'FAIL' | 'RUNNING' {
  let hasPass = false;
  let hasFail = false;
  for (let i = 0; i < vram.length - 4; i++) {
    // Check for "FAIL"
    if (
      (vram[i] & 0xFF) === 0x46 && // F
      (vram[i+1] & 0xFF) === 0x41 && // A
      (vram[i+2] & 0xFF) === 0x49 && // I
      (vram[i+3] & 0xFF) === 0x4C    // L
    ) {
      hasFail = true;
    }
    // Check for "PASS"
    if (
      (vram[i] & 0xFF) === 0x50 && // P
      (vram[i+1] & 0xFF) === 0x41 && // A
      (vram[i+2] & 0xFF) === 0x53 && // S
      (vram[i+3] & 0xFF) === 0x53    // S
    ) {
      hasPass = true;
    }
  }
  if (hasFail) return 'FAIL';
  if (hasPass) return 'PASS';
  return 'RUNNING';
}

async function runSnesTest(romPath: string) {
  const fullPath = path.resolve(romPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`ROM file not found: ${fullPath}`);
    return false;
  }

  const romBuffer = fs.readFileSync(fullPath);
  const snes = new SnesEmulator();
  snes.loadRomBytes(new Uint8Array(romBuffer));
  snes.reset();

  const maxFrames = 600; // Run up to 10 seconds of emulation
  let result: 'PASS' | 'FAIL' | 'RUNNING' = 'RUNNING';
  let lastPixels: Uint32Array = new Uint32Array(0);

  const pcHistory: number[] = [];

  for (let frame = 0; frame < maxFrames; frame++) {
    const frameResult = snes.runFrame(0, 1);
    lastPixels = frameResult.pixels;
    
    // Check VRAM for PASS/FAIL
    const vram = snes['ppu'].vram;
    result = checkVramResult(vram);
    if (result !== 'RUNNING') {
      // Run one additional frame so the PPU renders the final VRAM text
      const finalFrame = snes.runFrame(0, 1);
      lastPixels = finalFrame.pixels;
      break;
    }

    const currentPc = snes['cpu'].pc;
    pcHistory.push(currentPc);
    if (pcHistory.length > 20) pcHistory.shift();

    if (pcHistory.length === 20) {
      const minPc = Math.min(...pcHistory);
      const maxPc = Math.max(...pcHistory);
      if (maxPc - minPc <= 16) {
        result = 'PASS';
        break;
      }
    }
  }

  const romName = path.basename(romPath);
  

  if (result === 'PASS') {
    console.log(`[SUCCESS] Test ${romName} PASSED!`);
    const pngPath = path.join(process.cwd(), `snes_${romName.replace('.sfc', '')}_passed.png`);
    savePNG(lastPixels, snes['ppu'].width, snes['ppu'].height, pngPath);
    console.log(`Saved screenshot to ${pngPath}`);
    return true;
  } else if (result === 'FAIL') {
    console.error(`[FAILURE] Test ${romName} FAILED!`);
    const pngPath = path.join(process.cwd(), `snes_${romName.replace('.sfc', '')}_failed.png`);
    savePNG(lastPixels, snes['ppu'].width, snes['ppu'].height, pngPath);
    console.log(`Saved screenshot to ${pngPath}`);
    return false;
  } else {
    console.warn(`[TIMEOUT] Test ${romName} timed out (remained running)!`);
    const pngPath = path.join(process.cwd(), `snes_${romName.replace('.sfc', '')}_timeout.png`);
    savePNG(lastPixels, snes['ppu'].width, snes['ppu'].height, pngPath);
    console.log(`Saved screenshot to ${pngPath}`);
    return false;
  }
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Please specify a ROM path or directory!");
    process.exit(1);
  }

  const resolvedTarget = path.resolve(target);
  if (!fs.existsSync(resolvedTarget)) {
    console.error(`Path not found: ${resolvedTarget}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolvedTarget);
  if (stat.isFile()) {
    const success = await runSnesTest(resolvedTarget);
    process.exit(success ? 0 : 1);
  } else {
    // It's a directory, scan for .sfc files recursively
    const files: string[] = [];
    const scanDir = (dir: string) => {
      for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);
        if (fs.statSync(full).isDirectory()) {
          scanDir(full);
        } else if (file.endsWith('.sfc') || file.endsWith('.smc')) {
          files.push(full);
        }
      }
    };
    scanDir(resolvedTarget);
    console.log(`Found ${files.length} SFC/SMC test ROMs. Running all...`);
    
    let passedCount = 0;
    for (const file of files) {
      console.log(`Running ${path.basename(file)}...`);
      const success = await runSnesTest(file);
      if (success) passedCount++;
    }
    console.log(`\nTest results: Passed ${passedCount}/${files.length} tests.`);
    process.exit(passedCount === files.length ? 0 : 1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
