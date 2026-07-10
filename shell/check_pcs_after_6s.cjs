const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  await page.evaluate(() => {
    const playBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Play'));
    if (playBtn) playBtn.click();
    const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reset'));
    if (resetBtn) resetBtn.click();
  });

  await new Promise(r => setTimeout(r, 6000));

  const pcs = await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700;
    const cpu = window._emulator.cpu;
    return {
      spcPC: spc.state.pc.toString(16),
      cpuPC: cpu.lastInstructionAddress ? cpu.lastInstructionAddress.toString(16) : 'unknown',
      spcCycles: spc.cycleDeficit,
      cpuCycles: cpu.cycles,
      spcHistory: spc.pcHistory.map(p => p.toString(16)).join(', ')
    };
  });

  console.log("Current State after 6s:", pcs.spcPC, pcs.cpuPC);
  console.log("SPC History:", pcs.spcHistory);

  await browser.close();
})();
