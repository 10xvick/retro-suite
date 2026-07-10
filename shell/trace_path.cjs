const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window._emulator !== undefined');

  const romData = fs.readFileSync('public/sample.sfc');
  
  const trace = await page.evaluate((romArray) => {
    const emu = window._emulator;
    emu.loadRomBytes(new Uint8Array(romArray));
    emu.reset();
    
    let out = [];
    let count = 0;
    
    const origStep = emu.cpu.step.bind(emu.cpu);
    
    let last_branch = '';
    
    emu.cpu.step = function() {
      if (this.pb === 0 && this.pc === 0x8000) {
        out.push(`START at 8000`);
      }
      
      const opcode = this.bus.readByte(this.pb, this.pc);
      // JSR, JSL, JMP, RTL, RTS
      if ([0x20, 0x22, 0x4C, 0x5C, 0x6B, 0x60].includes(opcode)) {
          out.push(`Call/Jump at ${this.pb.toString(16)}:${this.pc.toString(16)} opcode=${opcode.toString(16)}`);
      }
      
      if (this.pb === 0xbf && this.pc === 0xdc00) {
        out.push(`Hit dc00!`);
        // Stop tracing
        emu.cpu.step = origStep;
      }
      origStep();
    };
    
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
    }
    
    return out.join('\n');
  }, Array.from(romData));

  console.log("TRACE:\n" + trace);
  await browser.close();
})();
