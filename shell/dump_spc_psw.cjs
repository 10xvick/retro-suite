const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  await page.evaluate(() => {
    const audioBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Audio Off') || b.innerText.includes('Audio On'));
    if (audioBtn && audioBtn.innerText.includes('Off')) {
      audioBtn.click();
    }
    const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reset'));
    if (resetBtn) resetBtn.click();
    const playBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Play'));
    if (playBtn) playBtn.click();
  });

  await new Promise(r => setTimeout(r, 2000));

  const pswDump = await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700;
    return spc.state.psw.toString(16);
  });

  console.log("PSW:", pswDump);

  await browser.close();
})();
