// Capture a sequence of frames across the attract cycle to find broken screens
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const bus = new Bus();
bus.insertCartridge(new Cartridge(ROM.buffer.slice(ROM.byteOffset, ROM.byteOffset + ROM.byteLength)));
bus.reset();

const W = 160, H = 192;
function savePPM(name: string, fb: Uint32Array) {
    const ppm = Buffer.alloc(15 + W * H * 3);
    ppm.write(`P6\n${W} ${H}\n255\n`, 0);
    let o = 15;
    for (let i = 0; i < W * H; i++) {
        ppm[o++] = (fb[i] >> 16) & 0xFF;
        ppm[o++] = (fb[i] >> 8) & 0xFF;
        ppm[o++] = fb[i] & 0xFF;
    }
    fs.writeFileSync(`/home/vishal/dev/emulator/retro-suite/atari/testout/${name}.ppm`, ppm);
}

// Capture every 20 frames for the first 400 frames (~6.6 seconds)
const tia = bus.tia as any;
for (let f = 0; f <= 400; f++) {
    bus.runFrame();
    if (f % 40 === 0) {
        savePPM(`seq_${String(f).padStart(3, '0')}`, tia.framebuffer.slice(0, W * H));
        console.log(`frame ${f}: bcol=${tia.bcol.toString(16)} pfcol=${tia.pfcol.toString(16)} p0=${tia.p0col.toString(16)} p1=${tia.p1col.toString(16)} grp0=${tia.grp0Active} grp1=${tia.grp1Active} nusiz0=${tia.nusiz0} nusiz1=${tia.nusiz1} pc=${bus.cpu.pc.toString(16)}`);
    }
}
