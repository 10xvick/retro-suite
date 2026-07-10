const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const romData = fs.readFileSync('public/sample.sfc');
  await new Promise(r => setTimeout(r, 1000));
  
  await page.evaluate(async (romArray) => {
    window._emulator.loadRomBytes(new Uint8Array(romArray));
    
    // Run 300 frames manually!
    for (let i = 0; i < 300; i++) {
        window._emulator.runFrame(0, 1);
    }
  }, Array.from(romData));

  const data = await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700;
    const cpu = window._emulator.cpu;
    const history = Array.from(spc.pcHistory).map(p => p.toString(16).padStart(4, '0'));
    const idx = spc.pcHistoryIdx;
    
    const ordered = [...history.slice(idx), ...history.slice(0, idx)];
    
    return {
      ordered: ordered,
      pc: spc.state.pc.toString(16).padStart(4, '0'),
      cpuPc: cpu.pc.toString(16).padStart(4, '0')
    };
  });

  console.log('SPC PC Trace (Last 30 instructions):');
  console.log(data.ordered.slice(-30).join(' '));
  console.log(`Current state: SPC PC=${data.pc} CPU PC=${data.cpuPc}`);
  await browser.close();
})();
