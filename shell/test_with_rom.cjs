const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('[log]', msg.text()));
  page.on('pageerror', err => console.log('[error]', err.message));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const romData = fs.readFileSync('public/sample.sfc');

  await new Promise(r => setTimeout(r, 1000));
  
  await page.evaluate((romArray) => {
    window._emulator.loadRomBytes(new Uint8Array(romArray));
    const playBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Play'));
    if (playBtn) { playBtn.click(); } 
    
    const audioBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Enable Audio'));
    if (audioBtn) audioBtn.click();
  }, Array.from(romData));

  await new Promise(r => setTimeout(r, 6000));

  const pcs = await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700;
    const cpu = window._emulator.cpu;
    return {
      spcPC: spc.state.pc.toString(16),
      cpuPC: cpu.lastInstructionAddress ? cpu.lastInstructionAddress.toString(16) : 'unknown',
      spcHistory: spc.pcHistory.map(p => p.toString(16)).join(', '),
      cycleDeficit: spc.cycleDeficit, spcHalted: spc.halted, cpuHalted: cpu.halted, cpuCycles: cpu.cycles, spcHalted: spc.halted
    };
  });

  console.log(`Current State after 6s: ${pcs.spcPC} ${pcs.cpuPC}`);
  console.log(`SPC History: ${pcs.spcHistory}`);
  console.log(`cycleDeficit: ${pcs.cycleDeficit}, spcHalted: ${pcs.spcHalted}, cpuHalted: ${pcs.cpuHalted}, cpuCycles: ${pcs.cpuCycles}`);

  await browser.close();
})();
