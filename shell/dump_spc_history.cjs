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
    const history = Array.from(spc.pcHistory).map(p => p.toString(16).padStart(4, '0'));
    const idx = spc.pcHistoryIdx;
    
    const ordered = [...history.slice(idx), ...history.slice(0, idx)];
    
    return {
      ordered: ordered,
      pc: spc.state.pc.toString(16).padStart(4, '0'),
      a: spc.state.a.toString(16).padStart(2, '0'),
      x: spc.state.x.toString(16).padStart(2, '0'),
      y: spc.state.y.toString(16).padStart(2, '0'),
      f4: spc.ram[0xf4].toString(16).padStart(2, '0'),
      ef: spc.ram[0xef].toString(16).padStart(2, '0')
    };
  });

  console.log('SPC PC Trace (Last 30 instructions):');
  console.log(data.ordered.slice(-30).join(' '));
  console.log(`Current state: PC=${data.pc} A=${data.a} X=${data.x} Y=${data.y}`);
  console.log(`RAM[F4] (CPU->SPC 0): ${data.f4}`);
  console.log(`RAM[EF] (Loop cmp value): ${data.ef}`);
  await browser.close();
})();
