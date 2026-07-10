const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const romData = fs.readFileSync('public/sample.sfc');
  
  await page.evaluate(async (romArray) => {
    window._emulator.loadRomBytes(new Uint8Array(romArray));
    
    // Run 600 frames manually!
    for (let i = 0; i < 600; i++) {
        window._emulator.runFrame(0, 1);
    }
  }, Array.from(romData));

  const data = await page.evaluate(() => {
    const cpu = window._emulator.cpu;
    const history = Array.from(cpu.pcHistory).map(p => p.toString(16).padStart(4, '0'));
    const idx = cpu.pcHistoryIdx;
    
    const ordered = [...history.slice(idx), ...history.slice(0, idx)];
    
    return {
      ordered: ordered,
      pc: cpu.pc.toString(16).padStart(4, '0'),
      pb: cpu.pb.toString(16).padStart(2, '0')
    };
  });

  console.log('CPU PC Trace (Last 30 instructions):');
  console.log(data.ordered.slice(-30).join(' '));
  console.log(`Current state: CPU PB=${data.pb} PC=${data.pc}`);
  await browser.close();
})();
