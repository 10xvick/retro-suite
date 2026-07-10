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
    
    // Patch Bus writeByte
    const bus = emu.cpu.bus;
    const origWrite = bus.writeByte.bind(bus);
    bus.writeByte = function(bank, addr, val) {
        if (addr >= 0x2140 && addr <= 0x2143) {
            out.push(`CPU WROTE ${val.toString(16)} to ${addr.toString(16)} at PC=${emu.cpu.pb.toString(16)}:${emu.cpu.pc.toString(16)}`);
        }
        origWrite(bank, addr, val);
    };
    
    // Trace CPU PC
    const origStep = emu.cpu.step.bind(emu.cpu);
    let hit_dc00 = false;
    let limit = 0;
    let dc1b_count = 0;
    
    emu.cpu.step = function() {
      if (!hit_dc00 && this.pb === 0xbf && this.pc === 0xdc00) {
        hit_dc00 = true;
        out.push(`ENTERED AUDIO TRANSFER ROUTINE!`);
      }
      if (hit_dc00) {
        if (this.pc === 0xdc1b) {
            dc1b_count++;
            if (dc1b_count < 10) {
                out.push(`Hit dc1b! A=${this.a.toString(16)} ports=[${bus.apuBridge.ports[0].toString(16)}, ${bus.apuBridge.ports[1].toString(16)}]`);
            } else if (dc1b_count === 10) {
                out.push(`... dc1b loops omitted ...`);
            }
        }
      }
      origStep();
    };
    
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
    }
    
    return out.join('\n');
  }, Array.from(romData));

  fs.writeFileSync('trace_out.txt', trace);
  console.log("Wrote trace to trace_out.txt");
  await browser.close();
})();
