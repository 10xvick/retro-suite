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
    emu.cpu.reset();
    
    let out = [];
    
    // Patch Bus writeByte
    const bus = emu.cpu.bus;
    const origWrite = bus.writeByte.bind(bus);
    bus.writeByte = function(bank, addr, val) {
        if (addr >= 0x2140 && addr <= 0x2143) {
            out.push(`CPU wrote ${val.toString(16)} to ${addr.toString(16)} at PC=${emu.cpu.pb.toString(16)}:${emu.cpu.pc.toString(16)}`);
        }
        origWrite(bank, addr, val);
    };
    
    for(let i=0; i<300; i++) {
        emu.runFrame(0, 1);
    }
    
    return out.join('\n');
  }, Array.from(romData));

  console.log("TRACE:\n" + trace);
  await browser.close();
})();
