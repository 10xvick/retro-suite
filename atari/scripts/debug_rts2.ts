// After JSR at f018: SP=fd, stack[ff]=f017 lo? Check what RTS at fc44 pops.
// JSR pushed PC-1 = f01a? Let's verify: abs() set pc=f01a after reading operand.
// JSR pushes pc-1 = f019. RTS pops -> +1 = f01a. Correct would return to f01b!
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
        const pc = cpu.pc;
        if (instrCount === 781) {
            console.log(`JSR @ ${pc.toString(16)} — operand read will leave pc=${(pc+3).toString(16)}`);
        }
        if (instrCount === 782) {
            console.log(`JSR done: PC=${cpu.pc.toString(16)} SP=${cpu.sp.toString(16)}`);
            console.log(`stack[fe]=${bus.read(0x01FE).toString(16)} stack[ff]=${bus.read(0x01FF).toString(16)}`);
            console.log(`expected return addr on stack: ${((pc+2))} then RTS adds 1 => ${pc+3}`);
            break;
        }
        instrCount++;
    }
    cpu.clock();
    bus.clock();
}
