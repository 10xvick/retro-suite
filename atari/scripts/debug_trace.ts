// Debug: trace what the CPU does on the Pac-Man ROM for a few hundred cycles.

import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();

const cpu = bus.cpu as any;
console.log('reset PC:', '0x' + cpu.pc.toString(16).padStart(4, '0'));
console.log('reset vector from cart:', '0x' + (cart.read(0x1FFC) | (cart.read(0x1FFD) << 8)).toString(16).padStart(4, '0'));

for (let i = 0; i < 40; i++) {
    const pc = cpu.pc;
    const op = bus.read(pc);
    const before = { a: cpu.a, x: cpu.x, y: cpu.y, sp: cpu.sp };
    cpu.clock();
    console.log(
        `${String(i).padStart(2)}  PC=${pc.toString(16).padStart(4, '0')} op=${op.toString(16).padStart(2, '0')} ` +
        `A=${before.a.toString(16).padStart(2, '0')} X=${before.x.toString(16).padStart(2, '0')} Y=${before.y.toString(16).padStart(2, '0')} SP=${before.sp.toString(16).padStart(2, '0')} ` +
        `-> PC=${cpu.pc.toString(16).padStart(4, '0')} wsync=${cpu.wsyncHalt} scanline=${bus.tia.scanline}`
    );
}
