import { Bus } from './nes/bus';
import { CPU } from './nes/cpu';
import { PPU } from './nes/ppu';
import { Cartridge } from './nes/cartridge';
import { Mapper4 } from './nes/mappers';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
  const romPath = path.join(__dirname, '../Teenage Mutant Ninja Turtles III - The Manhattan Project (USA) (The Cowabunga Collection).nes');
  const buffer = fs.readFileSync(romPath);
  
  const bus = new Bus();
  const ppu = new PPU();
  const cpu = new CPU(bus);
  
  bus.connect(cpu, ppu);
  const cart = new Cartridge(buffer.buffer);
  bus.insertCartridge(cart);
  
  cpu.reset();
  ppu.reset();
  
  const mapper = cart.mapper as Mapper4;
  
  let frameCount = 0;
  let irqCountThisFrame = 0;
  
  // Monkey patch mapper.tickScanline to monitor ticks
  const originalTick = mapper.tickScanline.bind(mapper);
  let scanlineTicks = 0;
  mapper.tickScanline = () => {
    scanlineTicks++;
    const oldCounter = (mapper as any).irqCounter;
    const oldPending = (mapper as any).irqPending;
    originalTick();
    const newCounter = (mapper as any).irqCounter;
    const newPending = (mapper as any).irqPending;
    const newActive = mapper.irqActive;
    
    if (frameCount >= 500 && frameCount < 505) {
      console.log(`[Frame ${frameCount} Scanline ${ppu.scanline} Cycle ${ppu.cycle}] A12 Tick. Counter: ${oldCounter} -> ${newCounter}, Pending: ${oldPending} -> ${newPending}, Active: ${newActive}`);
    }
  };
  
  // Monkey patch cpu.irq to monitor CPU IRQ handling
  const originalIrq = cpu.irq.bind(cpu);
  cpu.irq = () => {
    irqCountThisFrame++;
    if (frameCount >= 500 && frameCount < 505) {
      console.log(`[Frame ${frameCount} Scanline ${ppu.scanline} Cycle ${ppu.cycle}] CPU IRQ Triggered! PC=0x${cpu.pc.toString(16)}`);
    }
    originalIrq();
  };

  // Monitor writes to MMC3 registers
  const originalCpuWrite = mapper.cpuWrite.bind(mapper);
  mapper.cpuWrite = (addr: number, data: number) => {
    if (frameCount >= 500 && frameCount < 505 && addr >= 0x8000) {
      console.log(`[Frame ${frameCount} Scanline ${ppu.scanline} Cycle ${ppu.cycle}] Write to MMC3 Reg 0x${addr.toString(16)} = 0x${data.toString(16)}`);
    }
    return originalCpuWrite(addr, data);
  };
  
  console.log("Starting emulator loop...");
  
  for (frameCount = 0; frameCount < 510; frameCount++) {
    irqCountThisFrame = 0;
    scanlineTicks = 0;
    
    let frameComplete = false;
    while (!frameComplete) {
      for (let p = 0; p < 3; p++) {
        ppu.clock();
        if (ppu.scanline === 0 && ppu.cycle === 0) {
          frameComplete = true;
        }
      }
      cpu.clock();
      bus.apu.clock();
    }
    
    if (frameCount % 50 === 0 || frameCount >= 500) {
      console.log(`Frame ${frameCount} finished. Scanline ticks: ${scanlineTicks}, IRQs fired: ${irqCountThisFrame}`);
    }
  }
}

run().catch(console.error);
