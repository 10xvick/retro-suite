const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const romData = fs.readFileSync('public/sample.sfc');
  
  const trace = await page.evaluate(async (romArray) => {
    const emu = window._emulator;
    emu.loadRomBytes(new Uint8Array(romArray));
    emu.reset();
    
    // Force enable audio without waiting for user gesture (headless allows this)
    await emu.enableAudio();
    
    let out = [];
    
    const origStep = emu.cpu.step.bind(emu.cpu);
    let dc00_hits = 0;
    
    emu.cpu.step = function() {
      if (this.pb === 0xbf && this.pc === 0xdc1b) {
        dc00_hits++;
        if (dc00_hits < 20) {
            out.push(`Hit dc1b! A=${this.a.toString(16)} ports=[${this.bus.apuBridge.read(0x2140, 0, null).toString(16)}, ${this.bus.apuBridge.read(0x2141, 0, null).toString(16)}]`);
        }
      }
      origStep();
    };
    
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
    }
    out.push(`Total dc1b hits: ${dc00_hits}`);
    
    return out.join('\n');
  }, Array.from(romData));

  console.log("TRACE:\n" + trace);
  await browser.close();
})();
