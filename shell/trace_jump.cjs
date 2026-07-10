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
    let record = false;
    
    emu.cpu.step = function() {
      if (this.pb === 0xbf && this.pc === 0xdd73) {
        record = true;
      }
      if (record) {
        out.push(`${this.pb.toString(16)}:${this.pc.toString(16)}`);
      }
      if (this.pb === 0xbf && this.pc === 0xdc00) {
        record = false;
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
