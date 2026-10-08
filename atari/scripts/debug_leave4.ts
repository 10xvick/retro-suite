// After stack fix: where does execution go now? Any bad transitions?
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();
const cpu = bus.cpu as any;

for (let f = 1; f <= 3; f++) {
    bus.joystick = 0;
    bus.runFrame();
    let nonBlack = 0;
    for (let i = 0; i < 160*192; i++) if ((bus.tia.framebuffer[i] & 0xFFFFFF) !== 0) nonBlack++;
    console.log(`frame ${f}: nonBlack=${nonBlack} PC=${cpu.pc.toString(16)} SP=${cpu.sp.toString(16)} scanline=${bus.tia.scanline} bcol=${bus.tia.bcol.toString(16)}`);
}
