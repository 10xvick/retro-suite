import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

function findPath(relPath) {
  const candidates = [
    path.resolve(relPath),
    path.resolve(`../${relPath}`),
    path.resolve(`../../${relPath}`)
  ];
  return candidates.find(p => fs.existsSync(p)) || path.resolve(relPath);
}

const screenshotsDir = findPath('gba/public/debug/screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function testMode3TrueBadgeComparison() {
  console.log("\n==========================================================================");
  console.log(" TRUE BADGE COMPARISON FOR BASIC MODE 3: <ACTUAL> VS <EXPECTED>");
  console.log(" URL: http://localhost:5006/emulator/retro-station/");
  console.log(" Screenshots Output: " + screenshotsDir);
  console.log("==========================================================================\n");

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[Browser Console Error] ${msg.text()}`);
    }
  });

  await page.goto('http://localhost:5006/emulator/retro-station/', { waitUntil: 'networkidle0' });
  console.log('Opened Web UI in Chrome browser.');

  const biosPath = findPath('gba/public/roms/test/gba_bios.bin');
  const romPath = findPath('gba/public/roms/test/suite.gba');

  const biosBytes = Array.from(new Uint8Array(fs.readFileSync(biosPath)));
  const romBytes = Array.from(new Uint8Array(fs.readFileSync(romPath)));

  const result = await page.evaluate(async (biosArr, romArr) => {
    const mod = await import('/emulator/retro-station/src/emulator/EmulatorCore.ts');
    const gbaCore = new mod.GbaEmulatorCore();
    const GBA = gbaCore.gba.constructor;

    const bios = new Uint8Array(biosArr);
    const cart = new Uint8Array(romArr);

    const gba = new GBA();
    gba.loadBios(bios);
    gba.loadCart(cart);
    gba.reset();
    gba.directBoot();

    const mainCanvas = document.querySelector('canvas');
    if (mainCanvas) {
      mainCanvas.width = 240;
      mainCanvas.height = 160;
      mainCanvas.style.width = '100%';
      mainCanvas.style.height = '100%';
    }
    const ctx = mainCanvas ? mainCanvas.getContext('2d') : null;

    const drawToMainCanvas = (buffer) => {
      if (!ctx) return;
      const imgData = ctx.createImageData(240, 160);
      const data = imgData.data;
      for (let i = 0; i < buffer.length; i++) {
        const pixel = buffer[i];
        data[i * 4] = pixel & 0xff;
        data[i * 4 + 1] = (pixel >> 8) & 0xff;
        data[i * 4 + 2] = (pixel >> 16) & 0xff;
        data[i * 4 + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
    };

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    // Boot to main menu
    for (let f = 0; f < 60; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    const keyReleased = 0x03FF;
    const keyAPressed = 0x03FF & ~0x0001;     // A button
    const keyDownPressed = 0x03FF & ~0x0080;  // Down D-pad
    const keyLeftPressed = 0x03FF & ~0x0020;  // Left D-pad (Switches to ACTUAL badge view)
    const keyRightPressed = 0x03FF & ~0x0010; // Right D-pad (Switches to EXPECTED badge view)

    const pressKey = async (keyMask, holdFrames = 10, releaseFrames = 10) => {
      gba.mem.setKeyInput(keyMask);
      for (let f = 0; f < holdFrames; f++) {
        gba.runFrame();
        drawToMainCanvas(gba.ppu.framebuffer);
      }
      gba.mem.setKeyInput(keyReleased);
      for (let f = 0; f < releaseFrames; f++) {
        gba.runFrame();
        drawToMainCanvas(gba.ppu.framebuffer);
      }
    };

    // Navigate to Category 13 -> Basic Mode 3
    for (let i = 0; i < 13; i++) await pressKey(keyDownPressed);
    await pressKey(keyAPressed); // Enter Category 13
    for (let f = 0; f < 30; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    await pressKey(keyAPressed); // Enter Basic Mode 3 description page
    for (let f = 0; f < 30; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    await pressKey(keyAPressed); // Start subtest screen
    for (let f = 0; f < 40; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    // 1. Press LEFT key to switch to TRUE ACTUAL screen (<Actual> badge)!
    console.log("Pressing LEFT key to display <Actual> badge screen...");
    await pressKey(keyLeftPressed);
    for (let f = 0; f < 40; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    gba.ppu.renderFrame();
    const actualDispcnt = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;
    const actualBuffer = Array.from(gba.ppu.framebuffer);
    const actualDataUrl = mainCanvas.toDataURL('image/png');
    await delay(3000);

    // 2. Press RIGHT key to switch to TRUE EXPECTED screen (<Expected> badge)!
    console.log("Pressing RIGHT key to display <Expected> badge screen...");
    await pressKey(keyRightPressed);
    for (let f = 0; f < 40; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    gba.ppu.renderFrame();
    const expectedDispcnt = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;
    const expectedBuffer = Array.from(gba.ppu.framebuffer);
    const expectedDataUrl = mainCanvas.toDataURL('image/png');
    await delay(3000);

    // 3. Parity calculation for top graphics canvas ($y < 144$)
    let canvasMatches = 0;
    let canvasTotal = 0;
    const diffBuffer = new Array(240 * 160);

    for (let y = 0; y < 144; y++) {
      for (let x = 0; x < 240; x++) {
        canvasTotal++;
        const idx = y * 240 + x;
        if (actualBuffer[idx] === expectedBuffer[idx]) {
          canvasMatches++;
          diffBuffer[idx] = actualBuffer[idx];
        } else {
          diffBuffer[idx] = 0xFF0000FF; // Red highlight
        }
      }
    }

    for (let i = 240 * 144; i < 240 * 160; i++) {
      diffBuffer[i] = actualBuffer[i];
    }

    let badgeMatches = 0;
    let badgeTotal = 0;
    for (let i = 240 * 144; i < 240 * 160; i++) {
      badgeTotal++;
      if (actualBuffer[i] === expectedBuffer[i]) badgeMatches++;
    }

    drawToMainCanvas(diffBuffer);
    await delay(3000);

    return {
      subtest: "Basic Mode 3",
      actualDispcnt,
      expectedDispcnt,
      canvasMatches,
      canvasTotal,
      canvasMatchPct: (canvasMatches / canvasTotal) * 100,
      badgeMatches,
      badgeTotal,
      actualDataUrl,
      expectedDataUrl,
      diffDataUrl: mainCanvas.toDataURL('image/png')
    };
  }, biosBytes, romBytes);

  console.log("\n--- BASIC MODE 3 TRUE BADGE COMPARISON RESULTS ---");
  console.log(`Subtest: ${result.subtest}`);
  console.log(`Actual Screen DISPCNT   : ${result.actualDispcnt}`);
  console.log(`Expected Screen DISPCNT : ${result.expectedDispcnt}`);
  console.log(`Top Canvas Match ($y < 144$): ${result.canvasMatches} / ${result.canvasTotal} (${result.canvasMatchPct.toFixed(2)}%)`);
  console.log(`Bottom Badge Match ($y >= 144$): ${result.badgeMatches} / ${result.badgeTotal} pixels match (Differs ONLY by "Actual" vs "Expected" text)`);

  const savePng = (dataUrl, filename) => {
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
    const outPath = path.join(screenshotsDir, filename);
    fs.writeFileSync(outPath, base64Data, 'base64');
    return outPath;
  };

  const actualPath = savePng(result.actualDataUrl, `true_badge_mode3_actual.png`);
  const expectedPath = savePng(result.expectedDataUrl, `true_badge_mode3_expected.png`);
  const diffPath = savePng(result.diffDataUrl, `true_badge_mode3_diff.png`);

  console.log(`True Actual PNG (<Actual> badge)     : ${actualPath}`);
  console.log(`True Expected PNG (<Expected> badge) : ${expectedPath}`);
  console.log(`Diff PNG                             : ${diffPath}`);
  console.log("--------------------------------------------------------------------------\n");

  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
  console.log("True badge comparison complete!");
}

testMode3TrueBadgeComparison().catch(err => {
  console.error("True badge test error:", err);
  process.exit(1);
});
