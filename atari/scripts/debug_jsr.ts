// At instr 781: JSR $FBF4 (op=20). Check target bytes and JSR impl.
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
        if (instrCount === 781) {
            const pc = cpu.pc;
            console.log(`JSR at ${pc.toString(16)}: operand bytes = ${bus.read(pc+1).toString(16)} ${bus.read(pc+2).toString(16)}`);
            console.log(`target FBF4 first bytes: ${bus.read(0xFBF4).toString(16)} ${bus.read(0xFBF5).toString(16)} ${bus.read(0xFBF6).toString(16)}`);
            console.log(`SP before JSR: ${cpu.sp.toString(16)}`);
        }
        if (instrCount === 782) {
            console.log(`after JSR: PC=${cpu.pc.toString(16)} SP=${cpu.sp.toString(16)}`);
            break;
        }
        instrCount++;
    }
    cpu.clock();
    bus.clock();
}
