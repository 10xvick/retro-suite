// Kernel trace: log TIA register writes with (scanline, pixelClock) positions
// for one frame, plus a text rendering of the playfield to see the maze shape.
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const bus = new Bus();
bus.insertCartridge(new Cartridge(ROM.buffer.slice(ROM.byteOffset, ROM.byteOffset + ROM.byteLength)));
bus.reset();

// Warm up: 60 frames of attract mode
for (let f = 0; f < 60; f++) bus.runFrame();

// Trace one frame
const tia = bus.tia as any;
const origWrite = tia.write.bind(tia);
const log: string[] = [];
let inFrame = false;
tia.write = function (addr: number, data: number) {
    if (addr === 0x02) { /* VSYNC */ }
    // frame boundary marker via VSYNC write at scanline 0
    log.push(`sl${String((this as any).scanline).padStart(3)} cl${String((this as any).pixelClock).padStart(3)} w ${addr.toString(16).padStart(2)}=${data.toString(16).padStart(2)}`);
    origWrite(addr, data);
};

bus.runFrame();
tia.write = origWrite;

// Summarize: writes per scanline, and PF register write positions on a mid screen line
const perLine = new Map<number, number>();
for (const l of log) {
    const m = l.match(/sl\s*(\d+)/)!;
    perLine.set(+m[1], (perLine.get(+m[1]) || 0) + 1);
}
const lines = [...perLine.keys()].sort((a, b) => a - b);
console.log('scanlines with writes:', lines.length, 'range', lines[0], '-', lines[lines.length - 1]);
console.log('total writes:', log.length);

// Show writes on a few representative scanlines
for (const sl of [10, 40, 70, 96, 100, 150, 190]) {
    const sel = log.filter(l => l.startsWith(`sl${String(sl).padStart(3)}`) || l.match(/sl\s*(\d+)/)?.[1] === String(sl));
    if (sel.length) console.log(`--- sl${sl} (${sel.length} writes) ---\n` + sel.slice(0, 14).join('\n'));
}

// Text-render playfield for scanlines 40..60 from framebuffer colors
const fb = tia.framebuffer as Uint32Array;
const W = 160;
const rowChars: string[] = [];
for (const y of [30, 50, 96, 140]) {
    let row = '';
    for (let x = 0; x < W; x += 2) {
        const px = fb[y * W + x];
        const r = (px >> 16) & 0xFF, g = (px >> 8) & 0xFF, b = px & 0xFF;
        row += (r > 100 && g > 100 && b < 100) ? '#' : (r < 40 && g < 40 && b < 40) ? '.' : (b > 150) ? '@' : (r > 150 && b > 150) ? '%' : 'o';
    }
    rowChars.push(`y=${y}: ${row}`);
}
console.log(rowChars.join('\n'));
