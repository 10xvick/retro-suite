import { readFileSync } from 'fs';
import { Disassembler } from './src/emulator/Disassembler.js';
import { Bus } from './src/emulator/Bus.js';
import { PPU } from './src/emulator/PPU.js';
import { Cartridge } from './src/emulator/Cartridge.js';

// Mock Vite Env
global.import = { meta: { env: { DEV: true } } };

try {
  const romPath = './public/sample.sfc';
  const bytes = new Uint8Array(readFileSync(romPath));
  const ppu = new PPU();
  const bus = new Bus(ppu);
  const cartridge = new Cartridge(bytes);
  bus.loadCartridge(cartridge);

  console.log('Cartridge header details:');
  console.log(JSON.stringify(cartridge.header, null, 2));

  console.log('\nDisassembly starting from $80:8000:');
  let pc = 0x8000;
  let bank = 0x80;
  let acc8 = true;
  let index8 = true;

  for (let i = 0; i < 150; i++) {
    const opcode = bus.readByte(bank, pc);
    // Mimic CPU state change
    if (opcode === 0xFB) {
      // XCE
      console.log(`$${bank.toString(16).toUpperCase()}:${pc.toString(16).toUpperCase().padStart(4, '0')}: XCE (Switching to Native Mode)`);
      acc8 = false;
      index8 = false;
      pc += 1;
      continue;
    }
    if (opcode === 0xC2) {
      // REP
      const mask = bus.readByte(bank, pc + 1);
      if (mask & 0x20) acc8 = false;
      if (mask & 0x10) index8 = false;
    }
    if (opcode === 0xE2) {
      // SEP
      const mask = bus.readByte(bank, pc + 1);
      if (mask & 0x20) acc8 = true;
      if (mask & 0x10) index8 = true;
    }

    const res = Disassembler.disassemble(bus, bank, pc, acc8, index8);
    console.log(`$${bank.toString(16).toUpperCase()}:${pc.toString(16).toUpperCase().padStart(4, '0')}: ${res.disassembly} (bytes: ${res.bytesUsed}, acc8: ${acc8}, idx8: ${index8})`);
    
    // If it's a JML, update PC
    if (opcode === 0x5C) {
      const addr = bus.readWord(bank, pc + 1);
      const bnk = bus.readByte(bank, pc + 3);
      console.log(`>> JUMPING TO $${bnk.toString(16).toUpperCase()}:${addr.toString(16).toUpperCase()}`);
      bank = bnk;
      pc = addr;
      continue;
    }

    pc += res.bytesUsed;
  }
} catch (err) {
  console.error('Error running disassembly:', err);
}
