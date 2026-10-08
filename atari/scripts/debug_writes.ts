// Debug: dump TIA register writes during frame 1 to see what the game programs.

import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();

const tia = bus.tia as any;
const origWrite = tia.write.bind(tia);
const counts = new Map<string, number>();
const samples = new Map<string, number>();
tia.write = (addr: number, data: number) => {
    const key = '0x' + (addr & 0x3F).toString(16).padStart(2, '0');
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!samples.has(key)) samples.set(key, data);
    if ((addr & 0x3F) === 0x02) {
        // WSYNC write: log scanline progression
        if ((samples.get('__wsync_scanlines') || 0) < 5) {
            console.log(`WSYNC at scanline ${tia.scanline}`);
            samples.set('__wsync_scanlines', (samples.get('__wsync_scanlines') || 0) + 1);
        }
    }
    origWrite(addr, data);
};

bus.joystick = 0;
bus.runFrame();
console.log('\nTIA register writes in frame 1:');
for (const [k, v] of [...counts.entries()].sort()) {
    console.log(`  reg ${k}: ${v} writes, first data=0x${(samples.get(k) || 0).toString(16)}`);
}
console.log(`\nfinal: scanline=${tia.scanline} bcol=${tia.bcol.toString(16)} pfcol=${tia.pfcol.toString(16)} p0col=${tia.p0col.toString(16)} vblank=${tia.vblank}`);
