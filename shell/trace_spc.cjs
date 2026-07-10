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
    
    const origStepSpc = emu.audio.apu.stepSpc.bind(emu.audio.apu);
    const origSpcStep = emu.audio.apu.spc700.step.bind(emu.audio.apu.spc700);
    let record = false;
    let records = 0;
    
    // Patch CPU step to start recording
    const origCpuStep = emu.cpu.step.bind(emu.cpu);
    emu.cpu.step = function() {
      if (this.pb === 0xbf && this.pc === 0xdd76) {
        record = true;
      }
      origCpuStep();
    }
    
    emu.audio.apu.spc700.step = function() {
       if (record && records < 100) {
         out.push(`SPC PC: ${this.pc.toString(16)} A=${this.a.toString(16)} X=${this.x.toString(16)} Y=${this.y.toString(16)}`);
         records++;
       }
       origSpcStep();
    }
    
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
    }
    
    return out.join('\n');
  }, Array.from(romData));

  console.log("TRACE:\n" + trace);
  await browser.close();
})();
