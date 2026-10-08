// Measure: CPU cycles per game frame, timer writes, and section cycle budgets
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const bus = new Bus();
bus.insertCartridge(new Cartridge(ROM.buffer.slice(ROM.byteOffset, ROM.byteOffset + ROM.byteLength)));
bus.reset();
for (let f = 0; f < 60; f++) bus.runFrame();

const tia = bus.tia as any;
const pia = (bus as any).pia;
let cyclesAtFrameStart = bus.cpu.totalCycles;
const periods: number[] = [];
const timerWrites: string[] = [];
let prevVsync = 0;

const origWrite = tia.write.bind(tia);
tia.write = function (addr: number, data: number) {
    const a = addr & 0x3F;
    if (a === 0x00 && data !== 0 && prevVsync === 0) {
        periods.push(bus.cpu.totalCycles - cyclesAtFrameStart);
        cyclesAtFrameStart = bus.cpu.totalCycles;
    }
    prevVsync = (a === 0x00) ? data : prevVsync;
    origWrite(addr, data);
};
const origPiaWrite = pia.write.bind(pia);
pia.write = function (addr: number, data: number) {
    const a = addr & 0x2F7;
    if (a >= 0x294 && a <= 0x297) timerWrites.push(`timer write ${'addr ' + a.toString(16)} = ${data} @ sl=${tia.scanline} cycles=${bus.cpu.totalCycles}`);
    origPiaWrite(addr, data);
};

for (let f = 0; f < 8; f++) bus.runFrame();
console.log('CPU cycles per game frame:', periods.join(', '));
console.log('  (262 lines =', 262 * 76, 'cycles; 264 lines =', 264 * 76, ')');
console.log('timer writes:', timerWrites.slice(0, 6).join(' | ') || 'NONE');
console.log('timerInterval:', pia.timerInterval, 'timerCounter:', pia.timerCounter, 'INTIM:', pia.read(0x284));
