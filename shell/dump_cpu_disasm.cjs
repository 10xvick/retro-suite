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

  const disasm = await page.evaluate(() => {
    const dis = window._disassembler; // wait, is disassembler exposed?
    // Let's just dump the ROM bytes and we can disassemble it offline!
    const bus = window._emulator.cpu.bus;
    let out = [];
    for (let i = 0xdd20; i <= 0xdd50; i++) {
      out.push(bus.readByte(0, i).toString(16).padStart(2, '0'));
    }
    return out.join(' ');
  });

  console.log('CPU Memory at dd20-dd50:\n' + disasm);

  await browser.close();
})();
