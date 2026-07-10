const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const romData = fs.readFileSync('public/sample.sfc');
  
  const trace = await page.evaluate(async (romArray) => {
    const emu = window._emulator;
    emu.loadRomBytes(new Uint8Array(romArray));
    emu.reset();
    await emu.enableAudio();
    
    let out = [];
    
    const origCpuStep = emu.cpu.step.bind(emu.cpu);
    let hit_dc1b = false;
    
    emu.cpu.step = function() {
      origCpuStep();
      if (!hit_dc1b && this.pb === 0xbf && this.pc === 0xdc1b) {
        hit_dc1b = true;
        const spc = emu.audio.apu.spc700;
        const hist = spc.pcHistory;
        const idx = spc.pcHistoryIdx;
        out.push("SPC PC History right before CPU hit dc1b:");
        for (let i = 0; i < 100; i++) {
            const hpc = hist[(idx + i) % 100];
            out.push(hpc.toString(16));
        }
      }
    }
    
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
    }
    
    return out.join('\n');
  }, Array.from(romData));

  console.log("TRACE:\n" + trace);
  await browser.close();
})();
