import { GBA } from '../core/gba.js';
import * as fs from 'fs';
import * as path from 'path';

const biosPath = path.resolve('gba/public/roms/test/gba_bios.bin');
const romPath = path.resolve('gba/public/roms/test/suite.gba');

const bios = new Uint8Array(fs.readFileSync(biosPath));
const cart = new Uint8Array(fs.readFileSync(romPath));

function traceRoutine(name: string, addr: number) {
  const gba = new GBA();
  gba.loadBios(bios);
  gba.loadCart(cart);
  gba.reset();
  gba.directBoot();

  for (let f = 0; f < 60; f++) gba.runFrame();

  gba.cpu.r[14] = 0x08000100;
  gba.cpu.cpsr = (gba.cpu.cpsr & ~0x20) | ((addr & 1) ? 0x20 : 0);
  gba.cpu.r[15] = addr & ~1;

  console.log(`\n--- TRACING ${name} @ 0x${addr.toString(16)} ---`);
  let writtenIO: string[] = [];
  
  // Hook IO write
  const origWrite16 = gba.mem.writeIO16.bind(gba.mem);
  gba.mem.writeIO16 = (off: number, val: number) => {
    writtenIO.push(`writeIO16(0x${off.toString(16)}, 0x${val.toString(16)})`);
    origWrite16(off, val);
  };

  for (let s = 0; s < 50000; s++) {
    const pc = gba.cpu.r[15];
    if (pc === 0x08000100) break;
    gba.cpu.step();
  }

  console.log(`IO Writes during ${name}:`);
  writtenIO.forEach(w => console.log("  ", w));
  console.log(`End PC: 0x${gba.cpu.r[15].toString(16)}, DISPCNT: 0x${gba.ppu.dispcnt.toString(16)}`);
}

traceRoutine("Subtest 6 setup", 0x0800bc05);
traceRoutine("Subtest 6 render", 0x0800b949);

traceRoutine("Subtest 7 setup", 0x0800ae55);
traceRoutine("Subtest 7 render", 0x0800adbd);
