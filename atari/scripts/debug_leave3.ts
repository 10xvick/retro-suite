// Broader: log every PC transition where new PC < 0xF000 (and not a valid RAM/stack op target).
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();
const cpu = bus.cpu as any;

(bus.tia as any).frameComplete = false;
let instrCount = 0;
let prev: any = null;
let found = 0;

while (!(bus.tia as any).frameComplete && instrCount < 30000) {
    if (cpu.cycles === 0) {
        const pc = cpu.pc;
        if (prev && pc < 0xF000 && prev.pc >= 0xF000) {
            console.log(`>>> ${prev.pc.toString(16).padStart(4,'0')} op=${prev.op.toString(16).padStart(2,'0')} -> ${pc.toString(16).padStart(4,'0')} | A=${prev.a.toString(16)} X=${prev.x.toString(16)} SP=${prev.sp.toString(16)} S=${cpu.status.toString(16)}`);
            if (++found >= 6) break;
        }
        prev = { pc, op: bus.read(pc), a: cpu.a, x: cpu.x, y: cpu.y, sp: cpu.sp };
        instrCount++;
    }
    cpu.clock();
    bus.clock();
}
console.log('done, total', instrCount);
