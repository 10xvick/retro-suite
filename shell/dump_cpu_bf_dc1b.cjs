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
    const cpu = window._emulator.cpu;
    let out = [];
    for (let i = 0xdc1b; i <= 0xdc25; i++) {
      out.push(bus.readByte(0xbf, i).toString(16).padStart(2, '0'));
    }
    return { mem: out.join(' '), a: cpu.a.toString(16), port0: bus.readByte(0, 0x2140).toString(16) };
  });

  console.log('CPU Memory at bf:dc1b-dc25:\n' + data.mem);
  console.log('A=' + data.a + ' port0=' + data.port0);
  await browser.close();
})();
