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

async function testVisibleReactCanvas() {
  console.log("\n==========================================================================");
  console.log(" LAUNCHING REAL-TIME VISIBLE RETROSTATION CANVAS ON DESKTOP");
  console.log("==========================================================================\n");

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:5006/emulator/retro-station/', { waitUntil: 'networkidle0' });

  const biosPath = findPath('gba/public/roms/test/gba_bios.bin');
  const romPath = findPath('gba/public/roms/test/suite.gba');

  const biosBytes = Array.from(new Uint8Array(fs.readFileSync(biosPath)));
  const romBytes = Array.from(new Uint8Array(fs.readFileSync(romPath)));

  // Load and mount onto the real DOM canvas element on screen
  await page.evaluate(async (biosArr, romArr) => {
    // Look for canvas element on the DOM
    const canvas = document.querySelector('canvas') || document.createElement('canvas');
    if (!canvas.parentElement) {
      canvas.width = 720;
      canvas.height = 480;
      canvas.style.position = 'fixed';
      canvas.style.top = '50px';
      canvas.style.left = '50px';
      canvas.style.zIndex = '999999';
      canvas.style.border = '4px solid #f6a626';
      canvas.style.boxShadow = '0 0 20px rgba(0,0,0,0.8)';
      document.body.appendChild(canvas);
    }

    const ctx = canvas.getContext('2d');

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

    const keyReleased = 0x03FF;
    const keyAPressed = 0x03FF & ~0x0001;
    const keyDownPressed = 0x03FF & ~0x0080;
    const keyLeftPressed = 0x03FF & ~0x0020;
    const keyRightPressed = 0x03FF & ~0x0010;

    const renderToScreen = () => {
      gba.ppu.renderFrame();
      const fb = gba.ppu.framebuffer;
      const imgData = ctx.createImageData(240, 160);
      const data = imgData.data;
      for (let i = 0; i < fb.length; i++) {
        const pixel = fb[i];
        data[i * 4] = pixel & 0xff;
        data[i * 4 + 1] = (pixel >> 8) & 0xff;
        data[i * 4 + 2] = (pixel >> 16) & 0xff;
        data[i * 4 + 3] = 255;
      }
      // Scaled up for crisp visible viewing on screen
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 240;
      tempCanvas.height = 160;
      tempCanvas.getContext('2d').putImageData(imgData, 0, 0);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
    };

    const pressAndRender = (k, holdFrames = 20, releaseFrames = 20) => {
      gba.mem.setKeyInput(k);
      for (let f = 0; f < holdFrames; f++) {
        gba.runFrame();
        renderToScreen();
      }
      gba.mem.setKeyInput(keyReleased);
      for (let f = 0; f < releaseFrames; f++) {
        gba.runFrame();
        renderToScreen();
      }
    };

    for (let f = 0; f < 60; f++) {
      gba.runFrame();
      renderToScreen();
    }

    // Step through Category 13 Subtests visibly
    console.log("Navigating to Category 13...");
    for (let i = 0; i < 13; i++) pressAndRender(keyDownPressed);
    pressAndRender(keyAPressed); // Category 13

    // Subtest 4 (Layer Toggle)
    console.log("Running Subtest 4 (Layer Toggle)...");
    for (let i = 0; i < 3; i++) pressAndRender(keyDownPressed);
    pressAndRender(keyAPressed); // Enter description
    pressAndRender(keyAPressed); // Start live view

    // Switch to Actual view & toggle BG0
    pressAndRender(keyLeftPressed, 30, 30);
    pressAndRender(keyAPressed, 30, 30);
    for (let f = 0; f < 60; f++) {
      gba.runFrame();
      renderToScreen();
    }

    // Switch to Expected view
    pressAndRender(keyRightPressed, 60, 60);

  }, biosBytes, romBytes);

  console.log("Live RetroStation Canvas demo running on screen. Pausing for 30 seconds...");
  await new Promise(r => setTimeout(r, 30000));
  await browser.close();
}

testVisibleReactCanvas().catch(err => {
  console.error("Visible canvas error:", err);
  process.exit(1);
});
