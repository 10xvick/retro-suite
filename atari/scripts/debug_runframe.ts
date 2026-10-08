// Debug: run exactly like bus.runFrame does, but log every instruction with
// PC, op, and where it lands. Stop after N instructions.

import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();
const cpu = bus.cpu as any;

// Manually replicate runFrame's loop but with tracing
(bus.tia as any).frameComplete = false;
let instrCount = 0;
let lastPc = -1;
const trace: string[] = [];

while (!(bus.tia as any).frameComplete && instrCount < 30000) {
    // instruction boundary detection: cycles==0 means about to fetch
    if (cpu.cycles === 0) {
        const pc = cpu.pc;
        const op = bus.read(pc);
        if (trace.length < 60 || (op === 0x4C || op === 0x6C || op === 0x40 || op === 0x00)) {
            trace.push(`#${String(instrCount).padStart(5)} PC=${pc.toString(16).padStart(4,'0')} op=${op.toString(16).padStart(2,'0')} A=${cpu.a.toString(16).padStart(2,'0')} X=${cpu.x.toString(16).padStart(2,'0')} Y=${cpu.y.toString(16).padStart(2,'0')} SP=${cpu.sp.toString(16).padStart(2,'0')}`);
        }
        lastPc = pc;
        instrCount++;
    }
    cpu.clock();
    bus.clock();
}

console.log(trace.slice(0, 80).join('\n'));
console.log('...');
console.log(`total instructions: ${instrCount}, frameComplete=${(bus.tia as any).frameComplete}, final PC=0x${cpu.pc.toString(16)}, scanline=${(bus.tia as any).scanline}`);
