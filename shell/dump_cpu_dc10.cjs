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
  }, Array.from(romData));

  await new Promise(r => setTimeout(r, 2000));

  const data = await page.evaluate(() => {
    const bus = window._emulator.cpu.bus;
    let out = [];
    for (let i = 0xdc10; i <= 0xdc30; i++) {
      out.push(bus.readByte(0, i).toString(16).padStart(2, '0'));
    }
    return out.join(' ');
  });

  console.log('CPU Memory at dc10-dc30:\n' + data);
  await browser.close();
})();
