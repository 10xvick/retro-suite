// Trace sprite/PF state per scanline on the intro screen (frame 40)
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const bus = new Bus();
bus.insertCartridge(new Cartridge(ROM.buffer.slice(ROM.byteOffset, ROM.byteOffset + ROM.byteLength)));
bus.reset();
for (let f = 0; f < 40; f++) bus.runFrame();

const tia = bus.tia as any;
// Per-scanline snapshot of registers at scanline end
const snaps = new Map<number, string>();
const origClock = tia.clock.bind(tia);
tia.clock = function () {
    const before = this.pixelClock;
    origClock();
    if (this.pixelClock < before) { // scanline wrapped
        snaps.set(this.scanline, `grp0=${(this.grp0Active||0).toString(2).padStart(8,'0')} grp1=${(this.grp1Active||0).toString(2).padStart(8,'0')} nusiz0=${this.nusiz0.toString(2).padStart(6,'0')} nusiz1=${this.nusiz1.toString(2).padStart(6,'0')} p0=${this.posP0} p1=${this.posP1} pf0=${(this.pf0||0).toString(16).padStart(2)} pf1=${(this.pf1||0).toString(16).padStart(2)} pf2=${(this.pf2||0).toString(16).padStart(2)} ctrlpf=${this.ctrlpf.toString(2).padStart(8,'0')}`);
    }
};
bus.runFrame();
tia.clock = origClock;

// Print scanlines 40..120 (where the intro content lives)
for (const [sl, s] of [...snaps.entries()].sort((a, b) => a[0] - b[0])) {
    if (sl >= 40 && sl <= 120 && sl % 4 === 0) console.log(`sl${String(sl).padStart(3)} ${s}`);
}
