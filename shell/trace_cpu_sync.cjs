const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const romData = fs.readFileSync('public/sample.sfc');
  
  const trace = await page.evaluate((romArray) => {
    // STOP the main animation loop if possible, or just create a new facade
    const emu = window._emulator;
    emu.loadRomBytes(new Uint8Array(romArray));
    // Reset it completely
    emu.cpu.reset();
    
    const cpu = emu.cpu;
    let out = [];
    let hit_dc00 = false;
    let end_count = 0;
    
    for (let i = 0; i < 5000000; i++) {
      if (!hit_dc00 && cpu.pb === 0xbf && cpu.pc === 0xdc00) {
        hit_dc00 = true;
      }
      if (hit_dc00) {
        out.push(`pb:${cpu.pb.toString(16)} pc:${cpu.pc.toString(16)} A:${cpu.a.toString(16)} X:${cpu.x.toString(16)} Y:${cpu.y.toString(16)} m:${cpu.isAcc8()?'1':'0'} x:${cpu.isIndex8()?'1':'0'}`);
        if (cpu.pc === 0xdc1b) end_count++;
        if (end_count > 5) break;
      }
      cpu.step();
    }
    return out.join('\n');
  }, Array.from(romData));

  console.log('CPU Trace:\n' + trace);
  await browser.close();
})();
