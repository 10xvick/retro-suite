import { Bus } from './nes/bus';
import { CPU } from './nes/cpu';
import { PPU } from './nes/ppu';
import { Cartridge } from './nes/cartridge';
import { Mapper0 } from './nes/mappers';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

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

function savePNG(frameBuffer: number[], width: number, height: number, filepath: string) {
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
      rawData[destIdx++] = (color >> 16) & 0xFF; // R
      rawData[destIdx++] = (color >> 8) & 0xFF;  // G
      rawData[destIdx++] = color & 0xFF;         // B
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

async function runBlarggTest(romName: string) {
  const romPath = path.join(process.cwd(), 'public/nes-test-roms/instr_test-v5', romName);
  console.log(`=== Running Blargg Test: ${romName} ===`);

  if (!fs.existsSync(romPath)) {
    console.error(`ROM file not found: ${romPath}`);
    return;
  }

  const romBuffer = fs.readFileSync(romPath);

  const bus = new Bus();
  const ppu = new PPU();
  const cpu = new CPU(bus);
  bus.connect(cpu, ppu);

  const cart = new Cartridge(romBuffer.buffer);
  bus.insertCartridge(cart);

  cpu.reset();
  ppu.reset();

  const mapper = cart.mapper as Mapper0;
  // Initialize Blargg test signature area
  // Address 0x6000: status code (0x80 = running, 0x00 = success, >0x00 = error)
  // Address 0x6004: start of output text
  // Clear the RAM first
  for (let i = 0; i < 8192; i++) {
    mapper.cpuWrite(0x6000 + i, 0);
  }

  let cycles = 0;
  const maxCycles = 50000000; // Limit to 50M cycles to prevent infinite loops

  let testStarted = false;
  let lastOutput = "";

  while (cycles < maxCycles) {
    // Clock the CPU and PPU
    for (let p = 0; p < 3; p++) {
      ppu.clock();
    }
    cpu.clock();
    bus.apu.clock();
    cycles++;

    // Read status from 0x6000
    const status = bus.cpuRead(0x6000);

    // Blargg tests will set status to 0x80 when starting
    if (status === 0x80) {
      testStarted = true;
    }

    if (testStarted && status !== 0x80) {
      // Test finished!
      // Read output text from 0x6004 onwards
      let outputText = "";
      let addr = 0x6004;
      while (true) {
        const char = bus.cpuRead(addr);
        if (char === 0) break;
        outputText += String.fromCharCode(char);
        addr++;
      }

      console.log(`\nTest output:`);
      console.log(outputText.trim());

      // Save PPU frame buffer as PNG image
      const pngPath = path.join(process.cwd(), 'nes_test_output.png');
      savePNG(ppu.frameBuffer, 256, 240, pngPath);
      console.log(`Saved screenshot to ${pngPath}`);

      if (status === 0x00) {
        console.log(`\n[SUCCESS] Test ${romName} PASSED!`);
        return true;
      } else {
        console.error(`\n[FAILURE] Test ${romName} FAILED with status code: 0x${status.toString(16).toUpperCase()}`);
        return false;
      }
    }

    // Periodically print progress if we see text output changes
    if (cycles % 100000 === 0) {
      let outputText = "";
      let addr = 0x6004;
      while (true) {
        const char = bus.cpuRead(addr);
        if (char === 0) break;
        outputText += String.fromCharCode(char);
        addr++;
      }
      if (outputText !== lastOutput && outputText.length > 0) {
        console.log(`Progress: ${outputText.trim()}`);
        lastOutput = outputText;
      }
    }
  }

  console.error(`\n[TIMEOUT] Test ${romName} timed out after ${maxCycles} cycles.`);
  return false;
}

async function runAll() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const target = args[0];
    const fullPath = path.isAbsolute(target) ? target : path.resolve(process.cwd(), 'public/nes-test-roms/instr_test-v5', target);
    
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const files = fs.readdirSync(fullPath)
        .filter(file => file.endsWith('.nes'))
        .sort();
      
      console.log(`Found ${files.length} test ROMs in directory. Running all...`);
      const results: { [key: string]: boolean } = {};
      let passedCount = 0;

      for (const file of files) {
        const relativeRomPath = path.relative(path.join(process.cwd(), 'public/nes-test-roms/instr_test-v5'), path.join(fullPath, file));
        const success = await runBlarggTest(relativeRomPath);
        results[file] = success;
        if (success) passedCount++;
      }

      console.log(`\n=== Final Scorecard ===`);
      for (const file of files) {
        console.log(`${file}: ${results[file] ? 'PASSED' : 'FAILED'}`);
      }
      console.log(`\nPassed ${passedCount}/${files.length} tests.`);
    } else {
      await runBlarggTest(target);
    }
  } else {
    const singlesDir = path.join(process.cwd(), 'public/nes-test-roms/instr_test-v5/rom_singles');
    if (!fs.existsSync(singlesDir)) {
      console.error(`Singles directory not found: ${singlesDir}`);
      return;
    }

    const files = fs.readdirSync(singlesDir)
      .filter(file => file.endsWith('.nes'))
      .sort();

    console.log(`Found ${files.length} Blargg test ROMs. Running all...`);
    const results: { [key: string]: boolean } = {};
    let passedCount = 0;

    for (const file of files) {
      const success = await runBlarggTest(path.join('rom_singles', file));
      results[file] = success;
      if (success) passedCount++;
    }

    console.log(`\n=== Final Scorecard ===`);
    for (const file of files) {
      console.log(`${file}: ${results[file] ? 'PASSED' : 'FAILED'}`);
    }
    console.log(`\nPassed ${passedCount}/${files.length} tests.`);
  }
}

runAll().catch(console.error);
