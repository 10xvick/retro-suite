const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const romData = fs.readFileSync('public/sample.sfc');
  
  const trace = await page.evaluate((romArray) => {
    const emu = window._emulator;
    emu.loadRomBytes(new Uint8Array(romArray));
    emu.cpu.reset();
    
    // Patch CPU step
    const origStep = emu.cpu.step.bind(emu.cpu);
    let out = [];
    let hit_dc00 = false;
    let end_count = 0;
    
    emu.cpu.step = function() {
      if (!hit_dc00 && this.pb === 0xbf && this.pc === 0xdc00) {
        hit_dc00 = true;
      }
      if (hit_dc00) {
        if (this.pc === 0xdc1b) {
            const addr = 0x2140; // from memory
            const bank = this.db;
            const is8 = this.isAcc8();
            const val = is8 ? this.bus.readByte(bank, addr) : (this.bus.readByte(bank, addr) | (this.bus.readByte(bank, addr + 1) << 8));
            
            // also get what APU port returns!
            const apu_port0 = this.bus.apuBridge.read(0x2140, this.bus.wram[3], null);
            const apu_port1 = this.bus.apuBridge.read(0x2141, this.bus.wram[3], null);
            
            out.push(`A:${this.a.toString(16)} val_read:${val.toString(16)} port0:${apu_port0.toString(16)} port1:${apu_port1.toString(16)}`);
            end_count++;
        }
      }
      origStep();
    };
    
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
        if (end_count > 5) break;
    }
    
    return out.join('\n');
  }, Array.from(romData));

  console.log("TRACE:\n" + trace);
  await browser.close();
})();
