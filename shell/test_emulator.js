import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

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
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Set viewport size
  await page.setViewport({ width: 1200, height: 900 });

  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    console.log(`[Browser Console] [${msg.type()}] ${text}`);
  });

  page.on('pageerror', err => {
    logs.push(`[Page Error] ${err.toString()}`);
    console.error(`[Browser Page Error] ${err}`);
  });

  const connectedUrl = await gotoWithFallback(page);
  console.log(`Connected to ${connectedUrl}`);

  // Wait a bit
  await new Promise(r => setTimeout(r, 1000));

  // Click on "Educational TS Core" tab just to be absolutely sure
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
  } else {
    console.log('Could not find "Educational TS Core" tab button.');
  }

  await new Promise(r => setTimeout(r, 500));

  // Find Play button
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
  } else {
    console.log('Could not find Play button.');
  }

  // Let the emulator run for 5 seconds
  console.log('Running emulator for 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));

  // Capture screenshot
  const screenshotPath = '/Users/vishalsingh/.gemini/antigravity/brain/bbc0c6bf-d289-44f8-9eb5-6c87778ab17b/test_result.png';
  console.log(`Taking screenshot to ${screenshotPath}...`);
  await page.screenshot({ path: screenshotPath });

  // Extract CPU registers and disassembled instructions from UI if present
  console.log('Extracting UI state...');
  const uiState = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    const registerText = spans
      .filter(s => s.textContent && (s.textContent.includes('A (Acc)') || s.textContent.includes('PC (Counter)')))
      .map(s => {
        const valSibling = s.nextElementSibling;
        return `${s.textContent}: ${valSibling ? valSibling.textContent : 'N/A'}`;
      });

    const asmItems = Array.from(document.querySelectorAll('.font-mono div'))
      .map(el => el.textContent);

    return { registerText, asmItems };
  });

  console.log('UI Registers:', uiState.registerText);
  console.log('UI ASM List:', uiState.asmItems.slice(0, 15));

  // Save logs to a file in the brain folder
  writeFileSync('/Users/vishalsingh/.gemini/antigravity/brain/bbc0c6bf-d289-44f8-9eb5-6c87778ab17b/test_logs.json', JSON.stringify({ logs, uiState }, null, 2));

  console.log('Closing browser...');
  await browser.close();
  console.log('Test complete!');
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
