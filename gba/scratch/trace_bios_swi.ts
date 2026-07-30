import { GBA } from '../src/core/gba';
import { IO } from '../src/core/memory';
import * as fs from 'fs';

const bios = fs.readFileSync('public/roms/test/gba_bios.bin');
const cart = fs.readFileSync('public/roms/test/suite.gba');

const gba = new GBA();
gba.loadBios(bios);
gba.loadCart(cart);
gba.reset();
gba.directBoot();

let swiHit = false;
let traceCount = 0;

const origException = gba.cpu.exception.bind(gba.cpu);
gba.cpu.exception = function(addr: number, mode: number, thumb: boolean) {
  if (addr === 0x08) { // SWI
    const num = this.T ? (gba.mem.read8(this.r[15] - 2)) : (gba.mem.read32(this.r[15] - 4) & 0xffffff);
    if (num === 0x04 || num === 0x05) { // IntrWait or VBlankIntrWait
      if (!swiHit) {
        swiHit = true;
        console.log(`IntrWait/VBlankIntrWait called! num=0x${num.toString(16)} arg0=${this.r[0].toString(16)} arg1=${this.r[1].toString(16)}`);
      }
    }
  }
  origException(addr, mode, thumb);
};

const origStep = gba.cpu.step.bind(gba.cpu);
gba.cpu.step = function() {
  if (swiHit && traceCount < 50) {
    console.log(`PC: ${this.r[15].toString(16)} cpsr: ${this.cpsr.toString(16)} r0=${this.r[0].toString(16)} r1=${this.r[1].toString(16)} r2=${this.r[2].toString(16)}`);
    traceCount++;
  }
  return origStep();
};

console.log("Running...");
while (!swiHit) {
  gba.runFrame();
}
// Run a few more steps to trace the SWI
for(let i=0; i<100; i++) gba.cpu.step();
