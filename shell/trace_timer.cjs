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

  console.log("Sampling Timer 0 state over 10 seconds...");
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const state = await page.evaluate(() => {
      const spc = window._emulator.audio.apu.spc700;
      const t = spc.timers[0];
      return {
        enabled: t.enabled,
        target: t.target,
        ramTarget: spc.ram[0xFA],
        counter: t.counter,
        divider: t.divider,
        output: t.output
      };
    });
    console.log(`[Second ${i+1}]`, state);
  }

  await browser.close();
})();
