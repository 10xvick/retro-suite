import * as fs from 'fs';
import { Disassembler } from './src/emulator/core/Disassembler';
import { CPU } from './src/emulator/core/CPU';
import { Bus } from './src/emulator/core/Bus';
import { Cartridge } from './src/emulator/core/Cartridge';
import { PPU } from './src/emulator/graphics/PPU';
import { ApuPortBridge } from './src/emulator/audio/ApuPortBridge';

const romData = fs.readFileSync('public/sample.sfc');
const cartridge = new Cartridge(new Uint8Array(romData));
const bus = new Bus(new PPU(), new ApuPortBridge());
bus.loadCartridge(cartridge);

console.log('NMI:', bus.readWord(0, 0xFFEA).toString(16));
console.log('RESET:', bus.readWord(0, 0xFFFC).toString(16));
console.log('IRQ/BRK:', bus.readWord(0, 0xFFEE).toString(16));
