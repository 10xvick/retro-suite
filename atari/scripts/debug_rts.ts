// Trace instructions 700-790 to see how we got to fc44 with empty stack.
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
const log: string[] = [];

while (!(bus.tia as any).frameComplete && instrCount < 30000) {
    if (cpu.cycles === 0) {
        const pc = cpu.pc;
        const op = bus.read(pc);
        if (instrCount >= 755 && instrCount <= 782) {
            log.push(`#${String(instrCount).padStart(4)} PC=${pc.toString(16).padStart(4,'0')} op=${op.toString(16).padStart(2,'0')} A=${cpu.a.toString(16).padStart(2,'0')} X=${cpu.x.toString(16).padStart(2,'0')} Y=${cpu.y.toString(16).padStart(2,'0')} SP=${cpu.sp.toString(16).padStart(2,'0')}`);
        }
        if (instrCount > 782) break;
        instrCount++;
    }
    cpu.clock();
    bus.clock();
}
console.log(log.join('\n'));
