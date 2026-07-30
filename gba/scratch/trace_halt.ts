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

const origException = gba.cpu.exception.bind(gba.cpu);
gba.cpu.exception = function(addr: number, mode: number, thumb: boolean) {
  if (addr === 0x08) {
    const num = this.T ? (gba.mem.read8(this.r[15] - 2)) : (gba.mem.read32(this.r[15] - 4) & 0xffffff);
    if (num === 0x05) {
      if (!swiHit) {
        swiHit = true;
        console.log(`VBlankIntrWait called!`);
      }
    }
  }
  origException(addr, mode, thumb);
};

let prevHalted = false;
let haltCount = 0;

const origRunFrame = gba.runFrame.bind(gba);
gba.runFrame = function() {
  origRunFrame();
  if (swiHit && haltCount < 50) {
    const ie = this.mem.readIO16(IO.IE);
    const ifl = this.mem.readIO16(IO.IF);
    console.log(`Frame end: halted=${this.mem.halted} IE=${ie.toString(16)} IF=${ifl.toString(16)}`);
    haltCount++;
  }
};

console.log("Running...");
while (haltCount < 50) {
  gba.runFrame();
}
