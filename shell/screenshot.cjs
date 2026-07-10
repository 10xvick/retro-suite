const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const romData = fs.readFileSync('public/sample.sfc');
  
  await page.evaluate((romArray) => {
    const emu = window._emulator;
    emu.loadRomBytes(new Uint8Array(romArray));
    emu.reset();
  }, Array.from(romData));

  // Run for 300 frames
  await page.evaluate(() => {
    const emu = window._emulator;
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
    }
  });
  
  // Take screenshot
  const element = await page.$('canvas');
  await element.screenshot({path: 'screenshot.png'});
  
  await browser.close();
})();
