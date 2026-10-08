// Per-pixel probe of scanline 100: what does renderPixel compute vs what lands in the FB?
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const bus = new Bus();
bus.insertCartridge(new Cartridge(ROM.buffer.slice(ROM.byteOffset, ROM.byteOffset + ROM.byteLength)));
bus.reset();
for (let f = 0; f < 120; f++) bus.runFrame();

const tia = bus.tia as any;

// Run one more frame, capturing PF state timeline for scanlines 96..104
const timeline = new Map<number, { cl: number; pf0: number; pf1: number; pf2: number; ctrlpf: number }[]>();
const origClock = tia.clock.bind(tia);
tia.clock = function () {
    // called once per 3 color clocks; capture BEFORE advancing
    const sl = this.scanline, cl = this.pixelClock;
    if (sl >= 96 && sl <= 104) {
        if (!timeline.has(sl)) timeline.set(sl, []);
        timeline.get(sl)!.push({ cl, pf0: this.pf0, pf1: this.pf1, pf2: this.pf2, ctrlpf: this.ctrlpf });
    }
    origClock();
};
bus.runFrame();
tia.clock = origClock;

// FB row for scanline 100: which x are non-background?
const fb: Uint32Array = tia.framebuffer;
const W = 160;
for (const sl of [98, 100, 102]) {
    const row = fb.slice(sl * W, sl * W + W);
    // background color = most common color in row
    const counts = new Map<number, number>();
    for (const px of row) counts.set(px, (counts.get(px) || 0) + 1);
    const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    let runs = '';
    let cur = row[0] !== bg, start = 0;
    for (let x = 1; x <= W; x++) {
        const on = x < W && row[x] !== bg;
        if (on !== cur) {
            if (cur) runs += `${start}-${x - 1} `;
            cur = on; start = x;
        }
    }
    console.log(`sl${sl} bg=#${bg.toString(16).padStart(8)} non-bg runs: ${runs || 'NONE'}`);
}

// PF register changes during scanline 100
const tl = timeline.get(100)!;
let prev = '';
for (const s of tl) {
    const key = `${s.pf0},${s.pf1},${s.pf2},${s.ctrlpf}`;
    if (key !== prev) {
        console.log(`cl${String(s.cl).padStart(3)} x=${String(s.cl - 68).padStart(3)} pf0=${s.pf0.toString(16).padStart(2)} pf1=${s.pf1.toString(16).padStart(2)} pf2=${s.pf2.toString(16).padStart(2)} ctrlpf=${s.ctrlpf}`);
        prev = key;
    }
}
