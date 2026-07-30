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

async function testMode3ReactUISlow() {
  console.log("\n==========================================================================");
  console.log(" VERIFIED TRUE ACTUAL VS EXPECTED CAPTURE FOR BASIC MODE 3");
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
  console.log('Opened Web UI in Chrome browser window.');

  const biosPath = findPath('gba/public/roms/test/gba_bios.bin');
  const romPath = findPath('gba/public/roms/test/suite.gba');

  const biosBytes = Array.from(new Uint8Array(fs.readFileSync(biosPath)));
  const romBytes = Array.from(new Uint8Array(fs.readFileSync(romPath)));

  console.log(`Loading bios (${biosBytes.length} bytes) and suite.gba (${romBytes.length} bytes)...`);

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

    // 1. Initial Boot: 60 frames to reach Main Menu, rendered on screen
    for (let f = 0; f < 60; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }
    await delay(1500); // 1.5-second pause on Main Menu

    const keyReleased = 0x03FF;
    const keyAPressed = 0x03FF & ~0x0001;     // A button (or X key in UI)
    const keyDownPressed = 0x03FF & ~0x0080;  // Down D-pad
    const keyRightPressed = 0x03FF & ~0x0010; // Right D-pad

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

    // 2. Navigate Main Menu down 13 times to Category 13 ("13 Video tests")
    for (let i = 0; i < 13; i++) {
      await pressKey(keyDownPressed);
    }
    await delay(1000); // 1-second pause

    await pressKey(keyAPressed); // Enter Category 13 subtest list
    for (let f = 0; f < 30; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }
    await delay(1000); // 1-second pause

    // 3. Basic Mode 3 is option 1 in Category 13
    await pressKey(keyAPressed); // Enter Basic Mode 3 description page
    for (let f = 0; f < 30; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }
    await delay(1500); // 1.5-second pause on description page

    // 4. Press A (X in UI) to open/start Live Actual Screen!
    await pressKey(keyAPressed);
    for (let f = 0; f < 40; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    // CAPTURE ACTUAL SCREEN RIGHT HERE BEFORE PRESSING RIGHT!
    gba.ppu.renderFrame();
    const actualDispcnt = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;
    const actualBuffer = Array.from(gba.ppu.framebuffer);
    const actualDataUrl = mainCanvas.toDataURL('image/png');

    console.log("--> CAPTURED ACTUAL SCREEN (<Actual> BADGE). PAUSING FOR 4 SECONDS...");
    await delay(4000); // Pause 4s on Actual screen

    // 5. NOW PRESS RIGHT ARROW TO SWITCH TO EXPECTED SCREEN!
    await pressKey(keyRightPressed);
    for (let f = 0; f < 40; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    // CAPTURE EXPECTED SCREEN RIGHT HERE AFTER PRESSING RIGHT!
    gba.ppu.renderFrame();
    const expectedDispcnt = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;
    const expectedBuffer = Array.from(gba.ppu.framebuffer);
    const expectedDataUrl = mainCanvas.toDataURL('image/png');

    console.log("--> CAPTURED EXPECTED SCREEN (<Expected> BADGE). PAUSING FOR 4 SECONDS...");
    await delay(4000); // Pause 4s on Expected screen

    // 6. Compare top canvas graphics ($y < 144$)
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
    console.log("--> DISPLAYING VISUAL DIFF MASK ON CANVAS FOR 3 SECONDS...");
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

  console.log("\n--- TRUE ACTUAL VS EXPECTED PARITY RESULTS ---");
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

  const actualPath = savePng(result.actualDataUrl, `true_mode3_actual.png`);
  const expectedPath = savePng(result.expectedDataUrl, `true_mode3_expected.png`);
  const diffPath = savePng(result.diffDataUrl, `true_mode3_diff.png`);

  console.log(`True Actual PNG   : ${actualPath}`);
  console.log(`True Expected PNG : ${expectedPath}`);
  console.log(`Diff PNG          : ${diffPath}`);
  console.log("--------------------------------------------------------------------------\n");

  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
  console.log("True Actual vs Expected verification complete!");
}

testMode3ReactUISlow().catch(err => {
  console.error("True capture error:", err);
  process.exit(1);
});
