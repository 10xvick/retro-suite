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
    
    // FULL RESET!
    emu.reset();
    
    let out = [];
    
    // Trace CPU PC
    const origStep = emu.cpu.step.bind(emu.cpu);
    let hit_dc00 = false;
    
    emu.cpu.step = function() {
      if (!hit_dc00 && this.pb === 0xbf && this.pc === 0xdc00) {
        hit_dc00 = true;
      }
      if (hit_dc00) {
        if (this.pc === 0xdc1b) {
            out.push(`Hit dc1b! A=${this.a.toString(16)} val_read=${(this.bus.readByte(this.db, 0x2140) | (this.bus.readByte(this.db, 0x2141) << 8)).toString(16)}`);
        }
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
