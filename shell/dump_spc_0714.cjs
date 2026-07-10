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

  await new Promise(r => setTimeout(r, 2000));

  const data = await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700;
    
    let mem = [];
    for (let i = 0x0710; i <= 0x0720; i++) {
      mem.push(spc.ram[i].toString(16).padStart(2, '0'));
    }
    return mem.join(' ');
  });

  console.log('SPC Memory 0710-0720:');
  console.log(data);
  await browser.close();
})();
