// Debug: run bus.runFrame() and inspect TIA state after each frame.

import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();

for (let f = 1; f <= 5; f++) {
    const t0 = Date.now();
    bus.joystick = 0;
    bus.runFrame();
    const dt = Date.now() - t0;
    const tia = bus.tia as any;
    let nonBlack = 0;
    for (let i = 0; i < 160 * 192; i++) if ((tia.framebuffer[i] & 0xFFFFFF) !== 0) nonBlack++;
    console.log(
        `frame ${f}: ${dt}ms nonBlack=${nonBlack} scanline=${tia.scanline} ` +
        `bcol=${tia.bcol.toString(16)} pfcol=${tia.pfcol.toString(16)} vblank=${tia.vblank} ` +
        `pc=${(bus.cpu as any).pc.toString(16)}`
    );
}
