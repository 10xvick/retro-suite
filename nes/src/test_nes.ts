import { Bus } from './nes/bus';
import { CPU } from './nes/cpu';
import { PPU } from './nes/ppu';
import { Cartridge } from './nes/cartridge';
import * as fs from 'fs';
import * as path from 'path';

async function testNes() {
  const romPath = path.join(process.cwd(), 'public/nes-test-roms/other/nestest.nes');
  const logPath = path.join(process.cwd(), 'public/nes-test-roms/other/nestest.log');

  const romBuffer = fs.readFileSync(romPath);
  const logContent = fs.readFileSync(logPath, 'utf-8');
  const logLines = logContent.split('\n').filter(line => line.trim().length > 0);

  const bus = new Bus();
  const ppu = new PPU();
  const cpu = new CPU(bus);
  bus.connect(cpu, ppu);

  const cart = new Cartridge(romBuffer.buffer);
  bus.insertCartridge(cart);

  // Setup CPU for nestest automation mode
  cpu.pc = 0xC000;
  cpu.a = 0x00;
  cpu.x = 0x00;
  cpu.y = 0x00;
  cpu.status = 0x24;
  cpu.stkp = 0xFD;
  cpu.cycles = 0;

  let totalCycles = 7; // nestest starts at cycle 7
  let lineCount = 0;

  // Regex to parse: PC, A, X, Y, P, SP, CYC
  // Example: C000  4C F5 C5  JMP $C5F5                       A:00 X:00 Y:00 P:24 SP:FD PPU:  0, 21 CYC:7
  const regex = /^([0-9A-F]{4}).*A:([0-9A-F]{2}) X:([0-9A-F]{2}) Y:([0-9A-F]{2}) P:([0-9A-F]{2}) SP:([0-9A-F]{2}).*CYC:(\d+)/i;

  for (const line of logLines) {
    lineCount++;
    const match = line.match(regex);
    if (!match) {
      console.warn(`Line ${lineCount}: Could not parse log line: ${line}`);
      continue;
    }

    const expectedPc = parseInt(match[1], 16);
    const expectedA = parseInt(match[2], 16);
    const expectedX = parseInt(match[3], 16);
    const expectedY = parseInt(match[4], 16);
    const expectedP = parseInt(match[5], 16);
    const expectedSp = parseInt(match[6], 16);
    const expectedCyc = parseInt(match[7], 10);

    // Verify state before executing instruction
    const actualPc = cpu.pc;
    const actualA = cpu.a;
    const actualX = cpu.x;
    const actualY = cpu.y;
    const actualP = cpu.status;
    const actualSp = cpu.stkp;
    const actualCyc = totalCycles;

    let mismatch = false;
    let message = `Line ${lineCount}:\n`;
    
    if (actualPc !== expectedPc) {
      mismatch = true;
      message += `  PC: expected 0x${expectedPc.toString(16).toUpperCase()}, got 0x${actualPc.toString(16).toUpperCase()}\n`;
    }
    if (actualA !== expectedA) {
      mismatch = true;
      message += `  A: expected 0x${expectedA.toString(16).toUpperCase()}, got 0x${actualA.toString(16).toUpperCase()}\n`;
    }
    if (actualX !== expectedX) {
      mismatch = true;
      message += `  X: expected 0x${expectedX.toString(16).toUpperCase()}, got 0x${actualX.toString(16).toUpperCase()}\n`;
    }
    if (actualY !== expectedY) {
      mismatch = true;
      message += `  Y: expected 0x${expectedY.toString(16).toUpperCase()}, got 0x${actualY.toString(16).toUpperCase()}\n`;
    }
    if (actualP !== expectedP) {
      mismatch = true;
      message += `  P: expected 0x${expectedP.toString(16).toUpperCase()}, got 0x${actualP.toString(16).toUpperCase()}\n`;
    }
    if (actualSp !== expectedSp) {
      mismatch = true;
      message += `  SP: expected 0x${expectedSp.toString(16).toUpperCase()}, got 0x${actualSp.toString(16).toUpperCase()}\n`;
    }
    if (actualCyc !== expectedCyc) {
      mismatch = true;
      message += `  CYC: expected ${expectedCyc}, got ${actualCyc}\n`;
    }

    if (mismatch) {
      console.error(`\nMismatch found!`);
      console.error(message);
      console.error(`Log line: ${line.trim()}`);
      process.exit(1);
    }

    // Run the single instruction
    // Call clock() once to read opcode and start instruction
    cpu.clock();
    let instructionCycles = 1;

    // Keep ticking while the instruction is in progress (cpu.cycles > 0)
    while (cpu.cycles > 0) {
      cpu.clock();
      instructionCycles++;
    }

    totalCycles += instructionCycles;
  }

  console.log(`\nAll ${lineCount} instructions matched nestest.log successfully!`);
}

testNes().catch(console.error);
