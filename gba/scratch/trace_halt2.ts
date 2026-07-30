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
      }
    }
  }
  origException(addr, mode, thumb);
};

let haltCount = 0;

const origStep = gba.cpu.step.bind(gba.cpu);
let instrsInFrame = 0;
gba.cpu.step = function() {
  const ret = origStep();
  if (swiHit) {
    if (!this.mem.halted) {
      instrsInFrame++;
    }
  }
  return ret;
};

const origRunFrame = gba.runFrame.bind(gba);
gba.runFrame = function() {
  instrsInFrame = 0;
  origRunFrame();
  if (swiHit && haltCount < 50) {
    console.log(`Frame end: halted=${this.mem.halted} instrsExecutedWhenNotHalted=${instrsInFrame}`);
    haltCount++;
  }
};

console.log("Running...");
while (haltCount < 50) {
  gba.runFrame();
}
