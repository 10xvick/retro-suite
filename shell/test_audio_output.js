const puppeteer = require('puppeteer');

async function testAudio() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5008/', { waitUntil: 'networkidle0' });
  
  // Wait for page to load
  await page.waitForTimeout(2000);
  
  // Click Play button
  console.log('Starting emulator...');
  await page.click('button:has-text("Play")');
  await page.waitForTimeout(1000);
  
  // Monitor audio diagnostics
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(500);
    
    const diagnostics = await page.evaluate(() => {
      const emu = window.__EMULATOR__;
      if (!emu) return { error: 'No emulator found' };
      
      const audioDebug = emu.getAudioDebugState();
      const apuDebug = emu.getApuDebugState();
      
      return {
        audio: audioDebug,
        apu: apuDebug
      };
    });
    
    console.log(`\n=== Sample ${i + 1} ===`);
    console.log('Audio:', JSON.stringify(diagnostics.audio, null, 2));
    console.log('APU SPC700 PC:', diagnostics.apu?.spc700Pc?.toString(16));
    console.log('APU SPC700 A:', diagnostics.apu?.spc700A?.toString(16));
  }
  
  await browser.close();
}

testAudio().catch(console.error);
