// Render current attract-mode framebuffer to PNG for visual inspection
import * as fs from 'fs';
import * as path from 'path';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const bus = new Bus();
bus.insertCartridge(new Cartridge(new Cartridge(ROM.buffer.slice(ROM.byteOffset, ROM.byteOffset + ROM.byteLength)).rom.buffer as ArrayBuffer));
bus.reset();
for (let f = 0; f < 120; f++) bus.runFrame();

const tia = bus.tia as any;
const fb: Uint32Array = tia.framebuffer;
const W = 160, H = 192;
const ppm = Buffer.alloc(15 + W * H * 3);
ppm.write(`P6\n${W} ${H}\n255\n`, 0);
let o = 15;
for (let i = 0; i < W * H; i++) {
    ppm[o++] = (fb[i] >> 16) & 0xFF;
    ppm[o++] = (fb[i] >> 8) & 0xFF;
    ppm[o++] = fb[i] & 0xFF;
}
fs.writeFileSync('/home/vishal/dev/emulator/retro-suite/atari/testout/trace_frame.ppm', ppm);
console.log('registers: bcol=' + tia.bcol.toString(16), 'pfcol=' + tia.pfcol.toString(16),
    'p0=' + tia.p0col.toString(16), 'p1=' + tia.p1col.toString(16),
    'posP0=' + tia.posP0, 'posP1=' + tia.posP1, 'nusiz0=' + tia.nusiz0.toString(2), 'nusiz1=' + tia.nusiz1.toString(2),
    'grp0=' + tia.grp0.toString(2), 'grp1=' + tia.grp1.toString(2), 'pc=' + bus.cpu.pc.toString(16));
