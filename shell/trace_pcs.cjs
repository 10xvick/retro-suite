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

  console.log("Sampling CPU and APU PCs over 10 seconds...");
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const state = await page.evaluate(() => {
      const emu = window._emulator;
      return {
        cpuPc: emu.getLegacyDebugState().cpu.pc,
        apuPc: emu.getApuDebugState().spc700Pc
      };
    });
    console.log(`[Second ${i+1}] CPU PC: ${state.cpuPc}, APU PC: 0x${state.apuPc.toString(16).toUpperCase()}`);
  }

  await browser.close();
})();
