const puppeteer = require('puppeteer');

(async () => {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Set viewport to a decent size
  await page.setViewport({ width: 1280, height: 800 });

  console.log("Navigating to emulator...");
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

  console.log("Waiting for emulator to load...");
  await page.waitForFunction('window._emulator !== undefined');

  console.log("Enabling audio...");
  await page.evaluate(() => {
    const audioBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Audio Off') || b.innerText.includes('Audio On'));
    if (audioBtn && audioBtn.innerText.includes('Off')) {
      audioBtn.click();
    }
    const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reset'));
    if (resetBtn) resetBtn.click();
    const playBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Play'));
    if (playBtn) playBtn.click();
  });

  console.log("Waiting for game to run past boot screen (5 seconds)...");
  await new Promise(r => setTimeout(r, 5000));

  const screenshotPath = '/Users/vishalsingh/.gemini/antigravity-ide/brain/bd5c43bc-ef45-4168-99ca-09129d5cbcd8/screenshot.png';
  await page.screenshot({ path: screenshotPath });
  console.log("Screenshot saved to", screenshotPath);

  await browser.close();
})();
