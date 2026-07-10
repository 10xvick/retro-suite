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
        out.push(`pb:${this.pb.toString(16)} pc:${this.pc.toString(16)} A:${this.a.toString(16)} m:${this.isAcc8()?'1':'0'} NMI:${this.bus.nmiEnabled?'1':'0'}`);
        if (this.pc === 0xdc1b) end_count++;
      }
      origStep();
    };
    
    // run frame 300 times
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
        if (end_count > 5) break;
    }
    
    return out.join('\n');
  }, Array.from(romData));

  console.log("TRACE:\n" + trace);
  await browser.close();
})();
