const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const romData = fs.readFileSync('public/sample.sfc');
  await new Promise(r => setTimeout(r, 1000));
  
  await page.evaluate((romArray) => {
    window._emulator.loadRomBytes(new Uint8Array(romArray));
    const playBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Play'));
    if (playBtn) playBtn.click();
    
    const audioBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Enable Audio'));
    if (audioBtn) audioBtn.click();
  }, Array.from(romData));

  await new Promise(r => setTimeout(r, 2000));

  const data = await page.evaluate(() => {
    const cpu = window._emulator.cpu;
    return {
      pc: cpu.pc.toString(16).padStart(4, '0'),
      pb: cpu.pb.toString(16).padStart(2, '0'),
      cycles: cpu.cycles,
      a: cpu.a.toString(16),
      x: cpu.x.toString(16),
      y: cpu.y.toString(16),
      sp: cpu.sp.toString(16),
      p: cpu.p.toString(16)
    };
  });

  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
