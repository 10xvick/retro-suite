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
    emu.reset();
    
    let out = [];
    
    const origStep = emu.cpu.step.bind(emu.cpu);
    
    emu.cpu.step = function() {
      // Check if PC is at the reset vector (which is loaded from FFFC)
      if (this.pb === 0 && this.pc === 0x8000) {
        out.push(`Hit RESET at 8000!`);
      }
      if (this.pb === 0xbf && this.pc === 0xdc00) {
        out.push(`Hit dc00!`);
      }
      origStep();
    };
    
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
    }
    
    return out.join('\n');
  }, Array.from(romData));

  console.log("TRACE:\n" + trace);
  await browser.close();
})();
