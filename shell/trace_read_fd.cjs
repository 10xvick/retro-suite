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

  await new Promise(r => setTimeout(r, 2000));

  await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700;
    spc.readFDLog = [];
    
    // Monkey patch readSpcIo to track reads to 0xFD
    const origReadSpcIo = spc.readSpcIo.bind(spc);
    spc.readSpcIo = function(addr) {
      const val = origReadSpcIo(addr);
      if (addr === 0xFD && val !== 0) {
        spc.readFDLog.push(val);
      }
      return val;
    };
    
    // Monkey patch executeOpcode to track PC
    const origExec = spc.executeOpcode.bind(spc);
    spc.executeOpcode = function(opcode) {
      if (spc.state.pc >= 0x714 && spc.state.pc <= 0x716) {
        // we're in the loop
      }
      return origExec(opcode);
    };
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  const log = await page.evaluate(() => {
    const spc = window._emulator.audio.apu.spc700;
    return spc.readFDLog;
  });
  
  console.log("Reads of FD returning non-zero:", log);

  await browser.close();
})();
