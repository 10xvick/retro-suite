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

async function runNonHeadlessVideoTest() {
  console.log("==========================================================================");
  console.log(" LAUNCHING NON-HEADLESS BROWSER FOR MANUAL GBA VIDEO SUITE VERIFICATION");
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
    if (msg.type() === 'error' || msg.text().includes('GBA') || msg.text().includes('Video')) {
      console.log(`[Browser Console] [${msg.type()}] ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    console.error(`[Browser Page Error] ${err.toString()}`);
  });

  await page.goto('http://localhost:5006/emulator/retro-station/', { waitUntil: 'networkidle0' });
  console.log('Successfully navigated to GBA Emulator Web UI in Chrome browser.');

  await new Promise(r => setTimeout(r, 1000));

  const biosPath = findPath('gba/public/roms/test/gba_bios.bin');
  const romPath = findPath('gba/public/roms/test/suite.gba');

  const biosBytes = Array.from(new Uint8Array(fs.readFileSync(biosPath)));
  const romBytes = Array.from(new Uint8Array(fs.readFileSync(romPath)));

  console.log(`Loaded bios (${biosBytes.length} bytes) and suite ROM (${romBytes.length} bytes).`);

  const results = await page.evaluate(async (biosArr, romArr) => {
    let GBA;
    try {
      const mod = await import('/emulator/retro-station/src/emulator/EmulatorCore.ts');
      const core = new mod.GbaEmulatorCore();
      GBA = core.gba.constructor;
    } catch (e) {
      console.error('Import error:', e);
      throw e;
    }

    const bios = new Uint8Array(biosArr);
    const cart = new Uint8Array(romArr);

    const subtests = [
      { id: 1, name: "Basic Mode 3", menuDowns: 0 },
      { id: 2, name: "Basic Mode 4", menuDowns: 1 },
      { id: 3, name: "Degenerate OBJ transforms", menuDowns: 2 },
      { id: 4, name: "Layer toggle", menuDowns: 3 },
      { id: 5, name: "Layer toggle 2", menuDowns: 4 },
      { id: 6, name: "OAM Update Delay", menuDowns: 5 },
      { id: 7, name: "Window offscreen reset", menuDowns: 6 }
    ];

    const keyReleased = 0x03FF;
    const keyAPressed = 0x03FF & ~1;
    const keyDownPressed = 0x03FF & ~0x0080;

    const report = [];

    let overlayCanvas = document.getElementById('manual-test-canvas');
    if (!overlayCanvas) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.id = 'manual-test-canvas';
      overlayCanvas.width = 240;
      overlayCanvas.height = 160;
      overlayCanvas.style.position = 'fixed';
      overlayCanvas.style.top = '20px';
      overlayCanvas.style.right = '20px';
      overlayCanvas.style.width = '480px';
      overlayCanvas.style.height = '320px';
      overlayCanvas.style.border = '4px solid #00ffcc';
      overlayCanvas.style.zIndex = '99999';
      overlayCanvas.style.boxShadow = '0 0 20px rgba(0,255,204,0.5)';
      document.body.appendChild(overlayCanvas);
    }
    const ctx = overlayCanvas.getContext('2d');

    for (const sub of subtests) {
      const gba = new GBA();
      gba.loadBios(bios);
      gba.loadCart(cart);
      gba.reset();
      gba.directBoot();

      for (let f = 0; f < 60; f++) gba.runFrame();

      const press = (k) => {
        gba.mem.setKeyInput(k);
        for (let f = 0; f < 8; f++) gba.runFrame();
        gba.mem.setKeyInput(keyReleased);
        for (let f = 0; f < 8; f++) gba.runFrame();
      };

      for (let i = 0; i < 13; i++) press(keyDownPressed);
      press(keyAPressed);

      for (let i = 0; i < sub.menuDowns; i++) press(keyDownPressed);
      press(keyAPressed);

      for (let f = 0; f < 60; f++) gba.runFrame();

      const fb = gba.ppu.framebuffer;
      let nonBlack = 0;
      for (let i = 0; i < fb.length; i++) {
        if ((fb[i] & 0x00FFFFFF) !== 0) nonBlack++;
      }

      const imgData = ctx.createImageData(240, 160);
      const data = imgData.data;
      for (let i = 0; i < fb.length; i++) {
        const pixel = fb[i];
        data[i * 4] = pixel & 0xff;
        data[i * 4 + 1] = (pixel >> 8) & 0xff;
        data[i * 4 + 2] = (pixel >> 16) & 0xff;
        data[i * 4 + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);

      const dataUrl = overlayCanvas.toDataURL('image/png');

      report.push({
        id: sub.id,
        name: sub.name,
        dispcnt: `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`,
        nonBlackPixels: nonBlack,
        totalPixels: 240 * 160,
        dataUrl
      });
    }

    return report;
  }, biosBytes, romBytes);

  console.log("\n--- BROWSER RENDERING RESULTS FOR MANUAL GBA VIDEO SUITE ---");
  for (const r of results) {
    console.log(`Subtest #${r.id} ("${r.name}") | DISPCNT: ${r.dispcnt} | Active Rendered Pixels: ${r.nonBlackPixels} / ${r.totalPixels}`);

    const base64Data = r.dataUrl.replace(/^data:image\/png;base64,/, "");
    const outPath = path.join(screenshotsDir, `manual_nonheadless_sub${r.id.toString().padStart(2, '0')}.png`);
    fs.writeFileSync(outPath, base64Data, 'base64');
    console.log(`  -> Saved non-headless browser screenshot: ${outPath}`);
  }

  console.log("\nKeeping browser window open for 5 seconds for visual confirmation...");
  await new Promise(r => setTimeout(r, 5000));

  await browser.close();
  console.log("\nNon-headless browser manual test completed successfully!");
}

runNonHeadlessVideoTest().catch(err => {
  console.error("Non-headless test error:", err);
  process.exit(1);
});
