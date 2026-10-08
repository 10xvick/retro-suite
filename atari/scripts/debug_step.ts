// Debug: single-step the exact Pac-Man init sequence and check each op.

import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();
const cpu = bus.cpu as any;

console.log('status after reset: 0x' + cpu.status.toString(16), '(D flag set?', !!(cpu.status & 0x08) + ')');

// Step through and print every instruction completion (cycles back to 0)
let lastPc = -1;
for (let i = 0; i < 20000 && i < 500000; i++) {
    cpu.clock();
    if (cpu.cycles === 0 && cpu.pc !== lastPc) {
        // Instruction boundary
        const op = bus.read((lastPc = cpu.pc));
        if (i < 400) {
            console.log(
                `t=${String(i).padStart(4)} PC=${cpu.pc.toString(16).padStart(4,'0')} next_op=${op.toString(16).padStart(2,'0')} ` +
                `A=${cpu.a.toString(16).padStart(2,'0')} X=${cpu.x.toString(16).padStart(2,'0')} SP=${cpu.sp.toString(16).padStart(2,'0')} S=0x${cpu.status.toString(16)}`
            );
        }
    }
    if (i > 300 && cpu.pc === 0xf00d) break;
}
