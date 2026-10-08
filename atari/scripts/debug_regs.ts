// PC stable at f0c8 — is it stuck in a loop? Dump TIA writes per frame now.
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();

for (let f = 1; f <= 2; f++) {
    const tia = bus.tia as any;
    const origWrite = tia.write.bind(tia);
    const counts = new Map<number, number>();
    tia.write = (addr: number, data: number) => {
        const a = addr & 0x3F;
        if (counts.has(a)) counts.set(a, counts.get(a)! + 1);
        else counts.set(a, 1);
        origWrite(addr, data);
    };
    bus.joystick = 0;
    bus.runFrame();
    tia.write = origWrite;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`frame ${f}:`, sorted.map(([a, c]) => `0x${a.toString(16)}:${c}`).join(' '));
}
