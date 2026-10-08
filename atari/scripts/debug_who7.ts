// INTIM reads 7 but pia.timer=0?? The read path: switch(addr&0x3F) case 0x04
// returns this.timer & 0xFF = 0. But we see 7! So the game is NOT reading 0x284.
// It must be reading something else that returns 7. Trace actual read addresses.
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();

const origRead = bus.read.bind(bus);
const reads = new Map<number, number>();
bus.read = (addr: number) => {
    const a = addr & 0x1FFF;
    if (a < 0x40 || (a >= 0x280 && a < 0x2A0)) {
        reads.set(a, (reads.get(a) || 0) + 1);
    }
    return origRead(addr);
};

// run to the stuck loop: run frame 1 fully first
bus.joystick = 0;
bus.runFrame();

// now trace frame 2's reads
reads.clear();
(bus.tia as any).frameComplete = false;
const cpu = bus.cpu as any;
let instr = 0;
while (!(bus.tia as any).frameComplete && instr < 40000) {
    cpu.clock();
    bus.clock();
    instr++;
}
console.log('read addresses in stuck loop:');
for (const [a, c] of [...reads.entries()].sort((x,y)=>y[1]-x[1]).slice(0,10)) {
    console.log(`  0x${a.toString(16).padStart(3,'0')}: ${c} reads`);
}
