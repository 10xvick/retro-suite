// JSR pushed to stack but stack[fe]/[ff] show ff/ff — where did the push go?
// JSR: write(0x0100 + sp=ff) then sp-- => writes 0x01FF. Then write(0x0100+fe).
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

while (!(bus.tia as any).frameComplete && instrCount < 30000) {
    if (cpu.cycles === 0) {
        if (instrCount === 782) {
            console.log(`after JSR: SP=${cpu.sp.toString(16)} (expect fd)`);
            console.log(`stack[0x1FF]=${bus.read(0x1FF).toString(16)} (hi byte of return-1 = f0? no wait lo first...)`);
            console.log(`stack[0x1FE]=${bus.read(0x1FE).toString(16)}`);
            // JSR pushes pc AFTER operand read minus 1. abs() leaves pc=f01b.
            // JSR does pc-1=f01a, pushes hi=f0 at 0x1FF, lo=1a at 0x1FE.
            console.log(`expected: [0x1FF]=f0 [0x1FE]=1a`);
            break;
        }
        instrCount++;
    }
    cpu.clock();
    bus.clock();
}
