// Game reads INTIM at $0284. pia.read(0x284): addr&0x3FF=0x284, &0x80=0 -> 
// switch(0x284 & 0x3F = 0x04) -> INTIM. OK that works.
// But wait: game wrote timer? "timer write" log printed nothing in frame1!
// So the loop at f0c5 waits for INTIM==0 but nobody started the timer... 
// OR the game is waiting for VSYNC count via RAM. Let's watch reads of 0x284.
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();

const pia = bus.pia as any;
let intimReads = 0;
const origRead = pia.read.bind(pia);
pia.read = (addr: number) => {
    const v = origRead(addr);
    if ((addr & 0x3FF) === 0x284) {
        if (intimReads < 5 || intimReads % 1000 === 0) console.log(`INTIM read #${intimReads}: value=${v.toString(16)} timer=${pia.timer} enabled=${pia.timerEnabled}`);
        intimReads++;
    }
    return v;
};

bus.joystick = 0;
bus.runFrame();
console.log('total INTIM reads frame1:', intimReads);
