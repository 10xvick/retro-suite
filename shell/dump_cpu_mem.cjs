const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  await page.evaluate(() => {
    const playBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Play'));
    if (playBtn) playBtn.click();
    const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reset'));
    if (resetBtn) resetBtn.click();
  });

  await new Promise(r => setTimeout(r, 2000));

  const mem = await page.evaluate(() => {
    const bus = window._emulator.bus;
    const bytes = [];
    for (let i = 0xDCB0; i < 0xDCD0; i++) {
      bytes.push(bus.readByte(0, i).toString(16).padStart(2, '0'));
    }
    return bytes.join(' ');
  });

  console.log("CPU Mem at 0xDCB0:", mem);

  await browser.close();
})();
