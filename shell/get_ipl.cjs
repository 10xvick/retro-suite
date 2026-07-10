const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const trace = await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700; // wait, I can access it by casting
    return "skip";
  });
  await browser.close();
})();
