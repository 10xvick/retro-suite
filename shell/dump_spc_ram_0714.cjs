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

  const ram = await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700;
    const bytes = [];
    for (let i = 0x0714; i < 0x0720; i++) {
      bytes.push(spc.ram[i].toString(16).padStart(2, '0'));
    }
    return bytes.join(' ');
  });

  console.log("RAM at 0x0714:", ram);

  await browser.close();
})();
