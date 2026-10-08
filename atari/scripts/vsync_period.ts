// Measure game frame period: scanlines between VSYNC rising edges, WSYNC count,
// and per-section line counts to find where 5 extra lines come from.
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const bus = new Bus();
bus.insertCartridge(new Cartridge(ROM.buffer.slice(ROM.byteOffset, ROM.byteOffset + ROM.byteLength)));
bus.reset();
for (let f = 0; f < 60; f++) bus.runFrame();

const tia = bus.tia as any;
let prevVsync = 0;
let linesSinceVsync = 0;
const periods: number[] = [];
let wsyncsThisFrame = 0;
const wsyncsPerFrame: number[] = [];
let haltedLines = 0;

// Hook tia.clock to count scanlines and detect VSYNC edges
const origClock = tia.clock.bind(tia);
tia.clock = function () {
    // called once per CPU cycle (3 color clocks); detect scanline wrap
    const before = this.pixelClock;
    origClock();
    if (this.pixelClock < before || (before > 225 && this.pixelClock === 0)) {
        // scanline ended
        linesSinceVsync++;
        if (prevVsync === 0 && this.vsync !== 0) {
            if (linesSinceVsync > 100) periods.push(linesSinceVsync);
            wsyncsPerFrame.push(wsyncsThisFrame);
            wsyncsThisFrame = 0;
            linesSinceVsync = 0;
        }
        prevVsync = this.vsync;
    }
    // count WSYNC strobes
    if (this.wsyncRequested && !this._lastWsync) wsyncsThisFrame++;
    this._lastWsync = this.wsyncRequested;
};

for (let f = 0; f < 10; f++) bus.runFrame();
tia.clock = origClock;

console.log('VSYNC-to-VSYNC periods (scanlines):', periods.join(', '));
console.log('WSYNCs per game frame:', wsyncsPerFrame.join(', '));
console.log('expected: 262 lines, ~262 WSYNCs (WSYNC every line) or fewer if some lines are loop-timed');
