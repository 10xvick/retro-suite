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

async function verifyLeftRightBadges() {
  console.log("\n==========================================================================");
  console.log(" VERIFYING LEFT VS RIGHT KEYPRESS BADGE TOGGLING IN SUITE.GBA");
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

  await new Promise(r => setTimeout(r, 1000));

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

    // Boot into main menu
    for (let f = 0; f < 60; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    const keyReleased = 0x03FF;
    const keyAPressed = 0x03FF & ~0x0001;     // A button
    const keyDownPressed = 0x03FF & ~0x0080;  // Down D-pad
    const keyLeftPressed = 0x03FF & ~0x0020;  // Left D-pad
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

    // Navigate to Category 13 -> Basic Mode 3
    for (let i = 0; i < 13; i++) await pressKey(keyDownPressed);
    await pressKey(keyAPressed); // Enter Category 13
    for (let f = 0; f < 30; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    await pressKey(keyAPressed); // Enter Basic Mode 3 description
    for (let f = 0; f < 30; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    await pressKey(keyAPressed); // Start test screen
    for (let f = 0; f < 40; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }

    // Capture initial entry screen
    gba.ppu.renderFrame();
    const entryDataUrl = mainCanvas.toDataURL('image/png');

    // Press LEFT to switch to ACTUAL screen!
    console.log("Pressing LEFT key to toggle to ACTUAL screen...");
    await pressKey(keyLeftPressed);
    for (let f = 0; f < 40; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }
    gba.ppu.renderFrame();
    const actualBuffer = Array.from(gba.ppu.framebuffer);
    const leftDataUrl = mainCanvas.toDataURL('image/png');
    await delay(3000);

    // Press RIGHT to switch to EXPECTED screen!
    console.log("Pressing RIGHT key to toggle to EXPECTED screen...");
    await pressKey(keyRightPressed);
    for (let f = 0; f < 40; f++) {
      gba.runFrame();
      drawToMainCanvas(gba.ppu.framebuffer);
    }
    gba.ppu.renderFrame();
    const expectedBuffer = Array.from(gba.ppu.framebuffer);
    const rightDataUrl = mainCanvas.toDataURL('image/png');
    await delay(3000);

    return {
      entryDataUrl,
      leftDataUrl,
      rightDataUrl
    };
  }, biosBytes, romBytes);

  const savePng = (dataUrl, filename) => {
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
    const outPath = path.join(screenshotsDir, filename);
    fs.writeFileSync(outPath, base64Data, 'base64');
    return outPath;
  };

  const entryPath = savePng(result.entryDataUrl, `verify_entry_screen.png`);
  const leftPath = savePng(result.leftDataUrl, `verify_left_actual.png`);
  const rightPath = savePng(result.rightDataUrl, `verify_right_expected.png`);

  console.log("\n--- BADGE TOGGLE VERIFICATION RESULT ---");
  console.log(`Entry Screen PNG : ${entryPath}`);
  console.log(`Left Press PNG  : ${leftPath}`);
  console.log(`Right Press PNG : ${rightPath}`);
  console.log("--------------------------------------------------------------------------\n");

  await new Promise(r => setTimeout(r, 1000));
  await browser.close();
  console.log("Badge verification complete!");
}

verifyLeftRightBadges().catch(err => {
  console.error("Verification error:", err);
  process.exit(1);
});
