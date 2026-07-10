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

  await new Promise(r => setTimeout(r, 2000));

  const trace = await page.evaluate(() => {
    const cpu = window._emulator.cpu;
    let out = [];
    out.push(`Current PC: ${cpu.pb.toString(16)}:${cpu.pc.toString(16)} A=${cpu.a.toString(16)}`);
    for (let i = 0; i < 16; i++) {
      const pc = cpu.pcHistory[(cpu.pcHistoryIdx + i) % 16];
      out.push(`History[${i}]: ${pc.toString(16)}`);
    }
    return out.join('\n');
  });

  console.log(trace);
  await browser.close();
})();
