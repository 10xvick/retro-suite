const puppeteer = require('puppeteer');

async function testApuPorts() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5006/', { waitUntil: 'networkidle0' });
  await page.waitForTimeout(2000);
  
  // Click Reset and Play
  await page.click('button:has-text("Reset")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Play")');
  
  // Monitor for 5 seconds
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(500);
    
    const state = await page.evaluate(() => {
      const emu = window._emulator;
      if (!emu) return null;
      
      // Try to access bus to check APU port writes
      const cpuState = emu.getCpuSnapshot();
      const apuState = emu.getApuDebugState();
      
      return {
        cpu: { pc: cpuState.pc, pb: cpuState.pb },
        spc700: { pc: apuState.spc700Pc, a: apuState.spc700A }
      };
    });
    
    if (state) {
      console.log(`CPU PC=$${state.cpu.pb.toString(16).padStart(2, '0')}:${state.cpu.pc.toString(16).padStart(4, '0')} | SPC700 PC=$${state.spc700.pc.toString(16).padStart(4, '0')} A=$${state.spc700.a.toString(16).padStart(2, '0')}`);
    }
  }
  
  await browser.close();
}

testApuPorts().catch(console.error);
