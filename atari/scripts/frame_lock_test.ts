// Frame-lock test: track the maze's top wall row across consecutive frames.
// If the frame boundary isn't locked to VSYNC, the row drifts every frame (rolling).
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const bus = new Bus();
bus.insertCartridge(new Cartridge(ROM.buffer.slice(ROM.byteOffset, ROM.byteOffset + ROM.byteLength)));
bus.reset();
for (let f = 0; f < 120; f++) bus.runFrame();

const tia = bus.tia as any;
const W = 160;
const topRows: number[] = [];
for (let f = 0; f < 12; f++) {
    bus.runFrame();
    const fb: Uint32Array = tia.framebuffer;
    // First scanline (y in 30..120) with a long horizontal wall run (>30 px of same non-bg color)
    let top = -1;
    for (let y = 30; y < 120 && top < 0; y++) {
        const row = fb.slice(y * W, y * W + W);
        const counts = new Map<number, number>();
        for (const px of row) counts.set(px, (counts.get(px) || 0) + 1);
        const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        let run = 0, best = 0;
        for (let x = 0; x < W; x++) {
            run = row[x] !== bg ? run + 1 : 0;
            best = Math.max(best, run);
        }
        if (best > 30) top = y;
    }
    topRows.push(top);
    console.log(`frame ${f}: maze top wall row = ${top}, scanline=${tia.scanline}, vsync=${tia.vsync}`);
}
const locked = topRows.every(r => r === topRows[0]);
console.log(locked ? 'FRAME-LOCK: PASS (stable)' : 'FRAME-LOCK: FAIL (rolling)');
process.exit(locked ? 0 : 1);
