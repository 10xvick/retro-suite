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
    
    // Trace CPU PC
    const origStep = emu.cpu.step.bind(emu.cpu);
    let dc1b_count = 0;
    
    emu.cpu.step = function() {
        if (this.pb === 0xbf && this.pc === 0xdc1b) {
            dc1b_count++;
        }
        origStep();
    };
    
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
    }
    
    return `dc1b loops: ${dc1b_count} | final PC: ${emu.cpu.pb.toString(16)}:${emu.cpu.pc.toString(16)}`;
  }, Array.from(romData));

  console.log("TRACE:\n" + trace);
  await browser.close();
})();
