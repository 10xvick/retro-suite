// Frame 2 shows ZERO writes — CPU stuck. Trace where.
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();

// frame 1
bus.joystick = 0;
bus.runFrame();

// frame 2 with trace
const cpu = bus.cpu as any;
(bus.tia as any).frameComplete = false;
let instr = 0;
const pcs = new Map<number, number>();
while (!(bus.tia as any).frameComplete && instr < 40000) {
    if (cpu.cycles === 0) {
        pcs.set(cpu.pc, (pcs.get(cpu.pc) || 0) + 1);
        instr++;
    }
    cpu.clock();
    bus.clock();
}
console.log('frame2 instructions:', instr);
console.log('top PCs:', [...pcs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([p,c])=>`0x${p.toString(16)}:${c}`).join(' '));
