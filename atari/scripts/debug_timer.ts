// Loop: LDA $0284 (INTIM timer); BNE back. Timer never reaches 0 => stuck.
// Check PIA timer behavior: game wrote TIM64T earlier? Trace timer writes.
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();

const pia = bus.pia as any;
const origWrite = pia.write.bind(pia);
pia.write = (addr: number, data: number) => {
    const a = addr & 0x3FF;
    if (a >= 0x04 && a <= 0x07 || (a >= 0x14 && a <= 0x17)) {
        console.log(`timer write @${a.toString(16)} data=${data.toString(16)} interval set`);
    }
    origWrite(addr, data);
};
const origRead = pia.read.bind(pia);
pia.read = (addr: number) => {
    const v = origRead(addr);
    if ((addr & 0x3FF) === 0x284 % 0x400 || (addr & 0xFF) === 0x84) {
        // INTIM read
    }
    return v;
};

bus.joystick = 0;
bus.runFrame();
console.log('after frame1: timer=', pia.timer, 'interval=', pia.timerInterval, 'enabled=', pia.timerEnabled, 'int=', pia.timerInterrupt);
