// Section trace: scanline positions of kernel milestones across a frame
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const bus = new Bus();
bus.insertCartridge(new Cartridge(ROM.buffer.slice(ROM.byteOffset, ROM.byteOffset + ROM.byteLength)));
bus.reset();
for (let f = 0; f < 60; f++) bus.runFrame();

const tia = bus.tia as any;
const events: string[] = [];
let lastSl = -1;
const origWrite = tia.write.bind(tia);
tia.write = function (addr: number, data: number) {
    const a = addr & 0x3F;
    const sl = this.scanline;
    if (a === 0x00 && data !== 0) events.push(`VSYNC-on  sl=${sl}`);
    if (a === 0x00 && data === 0 && events.length && !events[events.length - 1].startsWith('VSYNC-off'))
        events.push(`VSYNC-off sl=${sl}`);
    if (a === 0x01) events.push(`VBLANK=${data} sl=${sl}`);
    if (a >= 0x0B && a <= 0x0D && events[events.length - 1] !== 'first-PF') {
        events.push(`first-PF-write sl=${sl} (reg ${a.toString(16)})`);
    }
    origWrite(addr, data);
};

// Also log INTIM reads with scanline
const pia = (bus as any).pia;
const origPiaRead = pia.read.bind(pia);
pia.read = function (addr: number) {
    const v = origPiaRead(addr);
    if ((addr & 0x3F) === 0x04 || (addr & 0x297) === 0x284) {
        // INTIM read — log only occasionally (first 3 per frame)
        if (!events.some(e => e.startsWith(`INTIM sl=${tia.scanline}`)) && events.filter(e => e.startsWith('INTIM')).length < 40) {
            events.push(`INTIM sl=${tia.scanline} cl=${tia.pixelClock} -> ${v}`);
        }
    }
    return v;
};

bus.runFrame();
tia.write = origWrite;
pia.read = origPiaRead;
console.log(events.join('\n'));
