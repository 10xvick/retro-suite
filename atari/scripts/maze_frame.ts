// Find a maze-kernel frame (many PF writes) and dump THAT frame's FB to PNG
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const bus = new Bus();
bus.insertCartridge(new Cartridge(ROM.buffer.slice(ROM.byteOffset, ROM.byteOffset + ROM.byteLength)));
bus.reset();

const tia = bus.tia as any;
let pfWritesThisFrame = 0;
const origWrite = tia.write.bind(tia);
tia.write = function (addr: number, data: number) {
    const a = addr & 0x3F;
    if ((a >= 0x0D && a <= 0x0F) || a === 0x0A) pfWritesThisFrame++;
    origWrite(addr, data);
};

let best = 0, bestFrame = 0;
const FBS: Map<number, Uint32Array> = new Map();
for (let f = 0; f < 180; f++) {
    pfWritesThisFrame = 0;
    bus.runFrame();
    if (pfWritesThisFrame > best) {
        best = pfWritesThisFrame;
        bestFrame = f;
        FBS.set(f, tia.framebuffer.slice());
    }
}
tia.write = origWrite;
console.log('max PF-write frame:', bestFrame, 'with', best, 'PF writes');

const fb = FBS.get(bestFrame)!;
const W = 160, H = 192;
const ppm = Buffer.alloc(15 + W * H * 3);
ppm.write(`P6\n${W} ${H}\n255\n`, 0);
let o = 15;
for (let i = 0; i < W * H; i++) {
    ppm[o++] = (fb[i] >> 16) & 0xFF;
    ppm[o++] = (fb[i] >> 8) & 0xFF;
    ppm[o++] = fb[i] & 0xFF;
}
fs.writeFileSync('/home/vishal/dev/emulator/retro-suite/atari/testout/maze_frame.ppm', ppm);

// Also dump wall runs on a few lines of the maze frame
for (const sl of [60, 100, 140]) {
    const row = fb.slice(sl * W, sl * W + W);
    const counts = new Map<number, number>();
    for (const px of row) counts.set(px, (counts.get(px) || 0) + 1);
    const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    let runs = '', cur = row[0] !== bg, start = 0;
    for (let x = 1; x <= W; x++) {
        const on = x < W && row[x] !== bg;
        if (on !== cur) { if (cur) runs += `${start}-${x - 1} `; cur = on; start = x; }
    }
    console.log(`sl${sl} runs: ${runs || 'NONE'}`);
}
