// Debug: find the JMP/BRK that sends us to $0040.

import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();
const cpu = bus.cpu as any;

(bus.tia as any).frameComplete = false;
let instrCount = 0;
let prev: any = null;

while (!(bus.tia as any).frameComplete && instrCount < 30000) {
    if (cpu.cycles === 0) {
        const pc = cpu.pc;
        const op = bus.read(pc);
        // Log instructions right before we end up at 0040 or in f000-f01a range
        if (prev && (pc === 0x0040 || pc === 0x000d)) {
            console.log(`>>> landed at ${pc.toString(16).padStart(4,'0')} after: PC=${prev.pc.toString(16).padStart(4,'0')} op=${prev.op.toString(16).padStart(2,'0')} A=${prev.a.toString(16)} X=${prev.x.toString(16)} SP=${prev.sp.toString(16)}`);
            if (instrCount > 960) break;
        }
        prev = { pc, op, a: cpu.a, x: cpu.x, y: cpu.y, sp: cpu.sp };
        instrCount++;
    }
    cpu.clock();
    bus.clock();
}
console.log('done at instr', instrCount);
