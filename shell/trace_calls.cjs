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
    
    let out = [];
    
    const origStep = emu.cpu.step.bind(emu.cpu);
    let last_pc = 0;
    
    emu.cpu.step = function() {
      if (this.pb === 0xbf && this.pc === 0xdc00) {
        // Find out where it was called from
        let caller = 0;
        // peek stack
        if (this.e === 1) {
            caller = this.bus.readByte(0, 0x100 | ((this.s + 1)&0xff)) | (this.bus.readByte(0, 0x100 | ((this.s + 2)&0xff)) << 8);
        } else {
            caller = this.bus.readByte(0, (this.s + 1)&0xffff) | (this.bus.readByte(0, (this.s + 2)&0xffff) << 8);
        }
        out.push(`Hit dc00! Caller from stack: ${caller.toString(16)}, Previous PC: ${last_pc.toString(16)}`);
      }
      last_pc = this.pc;
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
