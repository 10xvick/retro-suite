// Direct test: write to 0x1FF via bus, read it back.
import { Bus } from '../src/atari/bus';
const bus = new Bus();
bus.write(0x01FF, 0xAB);
console.log('write 0x01FF=AB, read back:', bus.read(0x01FF).toString(16));
bus.write(0x0180, 0xCD);
console.log('write 0x0180=CD, read back:', bus.read(0x0180).toString(16));
bus.write(0x0080, 0xEE);
console.log('write 0x0080=EE, read back:', bus.read(0x0080).toString(16));
