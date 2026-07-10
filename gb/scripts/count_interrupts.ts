import { GameBoy } from "../src/gb/gameboy";
import * as fs from "fs";

const rom = new Uint8Array(fs.readFileSync("/home/z/my-project/upload/Batman - The Animated Series (USA, Europe).gb"));
const gb = new GameBoy({});
gb.loadRom(rom);

// Hook into PPU's onRequestInterrupt
const origRequest = gb.mmu.requestInterrupt.bind(gb.mmu);
let vblankCount = 0;
let statCount = 0;
let timerCount = 0;
let serialCount = 0;
let joypadCount = 0;
(gb.mmu as any).requestInterrupt = function(bit: number) {
  switch (bit) {
    case 0: vblankCount++; break;
    case 1: statCount++; break;
    case 2: timerCount++; break;
    case 3: serialCount++; break;
    case 4: joypadCount++; break;
  }
  this.if_ |= (1 << bit);
  this.cpu.requestInterrupt(bit);
};

// Run 5 frames and count interrupt requests
for (let f = 0; f < 5; f++) {
  gb.runFrame();
  console.log(`After frame ${f + 1}: VBlank_req=${vblankCount} STAT_req=${statCount} Timer_req=${timerCount} Serial_req=${serialCount} Joypad_req=${joypadCount}`);
  console.log(`  CPU state: PC=0x${gb.cpu.pc.toString(16)} IME=${gb.cpu.ime} IF=0x${gb.mmu.if_.toString(16)} IE=0x${gb.mmu.ie.toString(16)}`);
  console.log(`  LY=${gb.ppu.ly} LCDC=0x${gb.ppu.lcdc.toString(16)} STAT=0x${gb.ppu.stat.toString(16)}`);
}
