import puppeteer from 'puppeteer';

const URL_CANDIDATES = process.env.EMULATOR_URL
  ? [process.env.EMULATOR_URL]
  : ['http://localhost:5005/', 'http://localhost:5006/'];

async function gotoWithFallback(page) {
  let lastError = null;
  for (const url of URL_CANDIDATES) {
    try {
      console.log(`Navigating to ${url} ...`);
      await page.goto(url, { waitUntil: 'networkidle0' });
      return url;
    } catch (err) {
      lastError = err;
      console.warn(`Failed to connect to ${url}: ${err.message}`);
    }
  }
  throw lastError || new Error('No emulator URL candidates available');
}

async function main() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });

  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error' || text.includes('Unimplemented') || text.includes('Error') || text.includes('Input Debug')) {
      console.log(`[Browser Console] [${msg.type()}] ${text}`);
    }
  });

  page.on('pageerror', err => {
    consoleLogs.push(`[Page Error] ${err.toString()}`);
    console.error(`[Browser Page Error] ${err}`);
  });

  const connectedUrl = await gotoWithFallback(page);
  console.log(`Connected to ${connectedUrl}`);

  await new Promise(r => setTimeout(r, 1000));

  // Verify that the "Educational TS Core" works without errors
  console.log('Clicking "Educational TS Core" tab...');
  const buttons = await page.$$('button');
  let eduButton;
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('Educational TS Core')) {
      eduButton = btn;
      break;
    }
  }
  if (eduButton) {
    await eduButton.click();
    console.log('Clicked "Educational TS Core" tab.');
  }

  await new Promise(r => setTimeout(r, 500));

  // Find and click Play
  console.log('Finding and clicking Play button...');
  let playButton;
  const allButtons = await page.$$('button');
  for (const btn of allButtons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.trim() === 'Play' || text.includes('Play')) {
      playButton = btn;
      break;
    }
  }

  if (playButton) {
    await playButton.click();
    console.log('Clicked Play button.');
  }

  console.log('Running emulator for 3 seconds...');
  await new Promise(r => setTimeout(r, 3000));

  // Extract Registers
  console.log('Extracting UI state from Educational Core...');
  const uiStateEdu = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    const registerText = spans
      .filter(s => s.textContent && (s.textContent.includes('A (Acc)') || s.textContent.includes('PC (Counter)')))
      .map(s => {
        const valSibling = s.nextElementSibling;
        return `${s.textContent}: ${valSibling ? valSibling.textContent : 'N/A'}`;
      });
    return registerText;
  });
  console.log('Educational Core Registers:', uiStateEdu);

  // Switch to Turbo Showcase / Compatibility Core
  console.log('Clicking "Turbo Showcase" tab...');
  let turboButton;
  const allButtons2 = await page.$$('button');
  for (const btn of allButtons2) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('Turbo Showcase')) {
      turboButton = btn;
      break;
    }
  }
  if (turboButton) {
    await turboButton.click();
    console.log('Clicked "Turbo Showcase" tab.');
  }

  console.log('Finding and clicking Reset button...');
  let resetButton;
  const allButtons3 = await page.$$('button');
  for (const btn of allButtons3) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.trim() === 'Reset') {
      resetButton = btn;
      break;
    }
  }
  if (resetButton) {
    await resetButton.click();
    console.log('Clicked Reset button to restart the ROM.');
  } else {
    console.warn('Could not find Reset button, using fallback reset.');
    await page.evaluate(() => {
      if (window._emulator && typeof window._emulator.reset === 'function') {
        window._emulator.reset();
      }
    });
  }

  // Get start frame right after reset
  const startFrame = await page.evaluate(() => window._emulatorFrameCount || 0);
  console.log(`Starting frame-accurate input sequence. startFrame = ${startFrame}`);
  
  // Bring browser to front and focus body to ensure keyboard inputs are routed to window
  console.log('Focusing browser page body...');
  await page.bringToFront();
  await page.focus('body');

  // Blur any focused element (like the Reset button) so that pressing Enter does not trigger click events on it
  console.log('Blurring active element to prevent Enter button-click triggers...');
  await page.evaluate(() => {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
  });

  async function waitForAbsoluteFrame(targetFrame) {
    while (true) {
      const currentFrame = await page.evaluate(() => window._emulatorFrameCount || 0);
      const debugInfo = await page.evaluate(() => {
        if (window._emulator && typeof window._emulator.getRuntimeStatus === 'function') {
          const status = window._emulator.getRuntimeStatus();
          return `Frame ${window._emulatorFrameCount}: PC=$${status.pc.toString(16).toUpperCase()}, NMI=${status.nmiEnabled}`;
        }
        return `Frame ${window._emulatorFrameCount}`;
      });
      const stats = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        let nonBlack = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] !== 0 || data[i+1] !== 0 || data[i+2] !== 0) {
            nonBlack++;
          }
        }
        let bright = 'N/A';
        if (window._emulator && typeof window._emulator.getRuntimeStatus === 'function') {
          bright = window._emulator.getRuntimeStatus().brightness;
        }
        return { nonBlack, bright };
      });
      console.log(`[Sync] ${debugInfo}, NonBlack=${stats ? stats.nonBlack : 'N/A'}, Bright=${stats ? stats.bright : 'N/A'}`);

      if (currentFrame >= targetFrame) {
        return currentFrame;
      }
      await new Promise(r => setTimeout(r, 330)); // Wait ~20 frames
    }
  }

  // 1. Wait until frame 200 of the ROM to skip the Virgin copyright screen
  await waitForAbsoluteFrame(startFrame + 200);
  console.log('Pressing Enter (Start) to skip Virgin screen [1/3]...');
  await page.keyboard.down('Enter');
  
  // Hold for 30 frames (500ms)
  await waitForAbsoluteFrame(startFrame + 230);
  console.log('Releasing Enter (Start) [1/3]...');
  await page.keyboard.up('Enter');

  // 2. Wait until frame 450 of the ROM to skip the Disney screen
  await waitForAbsoluteFrame(startFrame + 450);
  console.log('Pressing Enter (Start) to skip Disney screen [2/3]...');
  await page.keyboard.down('Enter');
  
  // Hold for 30 frames (500ms)
  await waitForAbsoluteFrame(startFrame + 480);
  console.log('Releasing Enter (Start) [2/3]...');
  await page.keyboard.up('Enter');

  // 3. Wait until frame 760 of the ROM to transition/fade-in the Title screen
  await waitForAbsoluteFrame(startFrame + 760);
  console.log('Pressing Enter (Start) to transition to Title screen [3/3]...');
  await page.keyboard.down('Enter');
  
  // Hold for 30 frames (500ms)
  await waitForAbsoluteFrame(startFrame + 790);
  console.log('Releasing Enter (Start) [3/3]...');
  await page.keyboard.up('Enter');

  // 4. Wait until frame 1100 of the ROM when the Title screen is fully faded in
  await waitForAbsoluteFrame(startFrame + 1100);
  console.log('Pressing Enter (Start) on Title screen to START GAME...');
  await page.keyboard.down('Enter');
  
  // Hold for 30 frames (500ms)
  await waitForAbsoluteFrame(startFrame + 1130);
  console.log('Releasing Enter (Start) to let the game load...');
  await page.keyboard.up('Enter');

  // 5. Let it run for 12 seconds to observe cutscene transitions and potential crashes
  console.log('Running emulator for 12 seconds through cutscenes...');
  for (let s = 1; s <= 3; s++) {
    await new Promise(r => setTimeout(r, 4000));
    const currentFrame = await page.evaluate(() => window._emulatorFrameCount || 0);
    console.log(`Frame ${currentFrame}: Taking screenshot step ${s}...`);
    await page.screenshot({ path: `/Users/vishalsingh/.gemini/antigravity-ide/brain/dd197dcd-e818-4443-b122-2c39b44996f2/cutscene_step_${s}.png` });
  }

  console.log('Final check of canvas pixels...');
  const canvasPixels = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { error: 'No canvas found' };
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    let nonBlackCount = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      const color = `rgb(${r},${g},${b})`;
      if (r !== 0 || g !== 0 || b !== 0) {
        nonBlackCount++;
        colors.add(color);
      }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      nonBlackCount,
      totalPixels: canvas.width * canvas.height,
      colors: Array.from(colors).slice(0, 10)
    };
  });
  console.log('Canvas Pixels Check:', canvasPixels);

  const screenshotPath = '/Users/vishalsingh/.gemini/antigravity-ide/brain/dd197dcd-e818-4443-b122-2c39b44996f2/test_result.png';
  console.log(`Taking final screenshot to ${screenshotPath}...`);
  await page.screenshot({ path: screenshotPath });

  console.log('Closing browser...');
  await browser.close();
  console.log('Test complete!');
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
