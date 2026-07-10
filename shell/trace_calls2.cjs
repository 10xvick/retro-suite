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
    let count = 0;
    
    const origStep = emu.cpu.step.bind(emu.cpu);
    
    emu.cpu.step = function() {
      if (this.pb === 0xbf && (this.pc === 0xdc00 || this.pc === 0xdd4f || this.pc === 0xdbd0)) {
        out.push(`Hit ${this.pc.toString(16)}! count=${count}`);
      }
      count++;
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
