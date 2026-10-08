// CPU spins at f0c5/f0c8. What's there? Probably waiting for timer/RAM value.
import * as fs from 'fs';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
const bus = new Bus();
bus.insertCartridge(cart);
bus.reset();
bus.joystick = 0;
bus.runFrame();

console.log('bytes f0c0-f0d0:', [...Array(16)].map((_,i)=>bus.read(0xF0C0+i).toString(16).padStart(2,'0')).join(' '));
// disassemble roughly: print op at f0c5 and f0c8
console.log('op@f0c5:', bus.read(0xF0C5).toString(16), 'operand:', bus.read(0xF0C6).toString(16));
console.log('op@f0c8:', bus.read(0xF0C8).toString(16));
