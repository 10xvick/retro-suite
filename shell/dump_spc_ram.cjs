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

  await new Promise(r => setTimeout(r, 6000));

  const ram = await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700;
    return Array.from(spc.ram.slice(0x0000, 0x0100)); // dump zero page
  });

  const ramHex = ram.map((b, i) => {
    const hex = b.toString(16).padStart(2, '0');
    if (i % 16 === 15) return hex + '\n';
    return hex + ' ';
  }).join('');
  
  console.log('SPC Zero Page:\n' + ramHex);

  const pcHistory = await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700;
    return spc.pcHistory.map(p => p.toString(16)).join(', ');
  });
  console.log('SPC History:', pcHistory);

  await browser.close();
})();
