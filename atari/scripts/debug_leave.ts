// Debug: trace the exact window where PC leaves $F0xx into zero page.

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
let lastWasF = false;
let count = 0;

while (!(bus.tia as any).frameComplete && instrCount < 30000) {
    if (cpu.cycles === 0) {
        const pc = cpu.pc;
        const op = bus.read(pc);
        if (pc >= 0xF000 && pc <= 0xF01A) {
            lastWasF = true;
            count = 0;
        } else if (lastWasF) {
            console.log(`#${String(instrCount).padStart(5)} LEFT ROM: PC=${pc.toString(16).padStart(4,'0')} op=${op.toString(16).padStart(2,'0')} A=${cpu.a.toString(16).padStart(2,'0')} X=${cpu.x.toString(16).padStart(2,'0')} Y=${cpu.y.toString(16).padStart(2,'0')} SP=${cpu.sp.toString(16).padStart(2,'0')} S=${cpu.status.toString(16)}`);
            if (++count > 12) { lastWasF = false; }
        }
        instrCount++;
    }
    cpu.clock();
    bus.clock();
}
console.log('done, instrs:', instrCount);
