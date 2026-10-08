import * as fs from 'fs';
import { Cartridge } from '../src/atari/cartridge';

const rom = fs.readFileSync('/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26');
const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
console.log('size:', rom.length, 'mapper:', cart.mapper);
// 4K: addr & 0x0FFF. Vectors at $FFFC/$FFFD -> index 0xFFC/0xFFD
const v = (a: number) => cart.read(a) | (cart.read(a + 1) << 8);
console.log('NMI :', '0x' + v(0x1FFA).toString(16));
console.log('RST :', '0x' + v(0x1FFC).toString(16));
console.log('IRQ :', '0x' + v(0x1FFE).toString(16));
console.log('bytes at FFFC-FFFD:', rom[0xFFC].toString(16), rom[0xFFD].toString(16));
console.log('first bytes:', [...rom.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join(' '));
