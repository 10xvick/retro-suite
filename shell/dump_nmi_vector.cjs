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
  }, Array.from(romData));

  await new Promise(r => setTimeout(r, 1000));

  const data = await page.evaluate(() => {
    const bus = window._emulator.cpu.bus;
    const nmiEmul = bus.readByte(0, 0xFFFA) | (bus.readByte(0, 0xFFFB) << 8);
    const nmiNative = bus.readByte(0, 0xFFEA) | (bus.readByte(0, 0xFFEB) << 8);
    return { nmiEmul: nmiEmul.toString(16), nmiNative: nmiNative.toString(16) };
  });

  console.log('NMI Vectors:\n' + JSON.stringify(data));
  await browser.close();
})();
