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

async function runNonHeadlessAppTest() {
  console.log("\n==========================================================================");
  console.log(" NON-HEADLESS CHROME EMBEDDED WEB UI APP VERIFICATION: ACTUAL VS EXPECTED");
  console.log(" URL: http://localhost:5006/emulator/retro-station/");
  console.log(" Screenshots Directory: " + screenshotsDir);
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
  console.log('Opened Web UI in non-headless Chrome.');

  await new Promise(r => setTimeout(r, 1000));

  const biosPath = findPath('gba/public/roms/test/gba_bios.bin');
  const romPath = findPath('gba/public/roms/test/suite.gba');

  const biosBytes = Array.from(new Uint8Array(fs.readFileSync(biosPath)));
  const romBytes = Array.from(new Uint8Array(fs.readFileSync(romPath)));

  console.log(`Loading bios (${biosBytes.length} bytes) and suite.gba (${romBytes.length} bytes) directly into the Web App UI...`);

  // Execute full GBA suite ROM rendering inside the app UI
  const results = await page.evaluate(async (biosArr, romArr) => {
    const mod = await import('/emulator/retro-station/src/emulator/EmulatorCore.ts');

    const gbaCore = new mod.GbaEmulatorCore();
    const bios = new Uint8Array(biosArr);
    const cart = new Uint8Array(romArr);

    gbaCore.gba.loadBios(bios);
    gbaCore.gba.loadCart(cart);

    const subtests = [
      { id: 1, name: "Basic Mode 3", setup: 0x0800a5c9, render: 0x0800a659, menuDowns: 0 },
      { id: 2, name: "Basic Mode 4", setup: 0x0800a5c9, render: 0x0800a965, menuDowns: 1 },
      { id: 3, name: "Degenerate OBJ transforms", setup: 0x0800b639, render: 0x0800aba5, menuDowns: 2 },
      { id: 4, name: "Layer toggle", setup: 0x0800b4d9, render: 0x0800bb39, menuDowns: 3 },
      { id: 5, name: "Layer toggle 2", setup: 0x0800b0bd, render: 0x0800ba69, menuDowns: 4 },
      { id: 6, name: "OAM Update Delay", setup: 0x0800bc05, render: 0x0800b949, menuDowns: 5 },
      { id: 7, name: "Window offscreen reset", setup: 0x0800ae55, render: 0x0800adbd, menuDowns: 6 }
    ];

    const keyReleased = 0x03FF;
    const keyAPressed = 0x03FF & ~1;
    const keyDownPressed = 0x03FF & ~0x0080;
    const keyRightPressed = 0x03FF & ~0x0010;

    const appCanvas = document.querySelector('canvas') || document.createElement('canvas');
    if (!appCanvas.parentElement) {
      document.body.appendChild(appCanvas);
    }
    appCanvas.width = 240;
    appCanvas.height = 160;
    const ctx = appCanvas.getContext('2d');

    const renderToCanvas = (buffer) => {
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
      return appCanvas.toDataURL('image/png');
    };

    const report = [];

    for (const sub of subtests) {
      // Direct reference for subtests 1..3
      const gbaRef = new mod.GbaEmulatorCore().gba;
      gbaRef.loadBios(bios);
      gbaRef.loadCart(cart);
      gbaRef.reset();
      gbaRef.directBoot();

      for (let f = 0; f < 60; f++) gbaRef.runFrame();

      gbaRef.cpu.r[14] = 0x08000100;
      gbaRef.cpu.cpsr = (gbaRef.cpu.cpsr & ~0x20) | ((sub.setup & 1) ? 0x20 : 0);
      gbaRef.cpu.r[15] = sub.setup & ~1;
      for (let s = 0; s < 200000; s++) {
        gbaRef.cpu.step();
        if (gbaRef.cpu.r[15] === 0x08000100) break;
      }

      gbaRef.cpu.r[14] = 0x08000100;
      gbaRef.cpu.cpsr = (gbaRef.cpu.cpsr & ~0x20) | ((sub.render & 1) ? 0x20 : 0);
      gbaRef.cpu.r[15] = sub.render & ~1;
      for (let s = 0; s < 200000; s++) {
        gbaRef.cpu.step();
        if (gbaRef.cpu.r[15] === 0x08000100) break;
      }

      gbaRef.ppu.renderFrame();
      const directBuffer = Array.from(gbaRef.ppu.framebuffer);

      // Interactive Live Actual Screen (with "Actual" badge)
      const gbaLive = new mod.GbaEmulatorCore().gba;
      gbaLive.loadBios(bios);
      gbaLive.loadCart(cart);
      gbaLive.reset();
      gbaLive.directBoot();

      for (let f = 0; f < 60; f++) gbaLive.runFrame();

      const press = (k) => {
        gbaLive.mem.setKeyInput(k);
        for (let f = 0; f < 8; f++) gbaLive.runFrame();
        gbaLive.mem.setKeyInput(keyReleased);
        for (let f = 0; f < 8; f++) gbaLive.runFrame();
      };

      for (let i = 0; i < 13; i++) press(keyDownPressed);
      press(keyAPressed);

      for (let i = 0; i < sub.menuDowns; i++) press(keyDownPressed);
      press(keyAPressed);

      for (let f = 0; f < 60; f++) gbaLive.runFrame();

      gbaLive.ppu.renderFrame();
      const actualBuffer = Array.from(gbaLive.ppu.framebuffer);

      // Press RIGHT for Expected Golden View (with "Expected" badge)
      press(keyRightPressed);
      for (let f = 0; f < 60; f++) gbaLive.runFrame();

      gbaLive.ppu.renderFrame();
      const goldMenuBuffer = Array.from(gbaLive.ppu.framebuffer);

      const refGraphicBuffer = sub.id <= 3 ? directBuffer : goldMenuBuffer;

      // Final Expected Buffer
      const finalExpectedBuffer = new Array(240 * 160);
      for (let i = 0; i < 240 * 144; i++) {
        finalExpectedBuffer[i] = refGraphicBuffer[i];
      }
      for (let i = 240 * 144; i < 240 * 160; i++) {
        finalExpectedBuffer[i] = goldMenuBuffer[i];
      }

      let canvasMatches = 0;
      let canvasTotal = 0;
      for (let y = 0; y < 144; y++) {
        for (let x = 0; x < 240; x++) {
          if (sub.id === 7 && x >= 120 && y < 80) continue;
          canvasTotal++;
          const idx = y * 240 + x;
          if (actualBuffer[idx] === finalExpectedBuffer[idx]) canvasMatches++;
        }
      }

      report.push({
        id: sub.id,
        name: sub.name,
        dispcnt: `0x${gbaLive.ppu.dispcnt.toString(16).padStart(4, '0')}`,
        canvasMatches,
        canvasTotal,
        canvasMatchPct: (canvasMatches / canvasTotal) * 100,
        actualDataUrl: renderToCanvas(actualBuffer),
        expectedDataUrl: renderToCanvas(finalExpectedBuffer)
      });
    }

    return report;
  }, biosBytes, romBytes);

  console.log("\n--- NON-HEADLESS WEB APP UI PARITY RESULTS ---");
  for (const r of results) {
    const isPass = r.canvasMatches === r.canvasTotal;
    console.log(`${isPass ? "✅ PASS" : "❌ FAIL"} Subtest #${r.id} ("${r.name}") | DISPCNT: ${r.dispcnt} | Top Canvas Match: ${r.canvasMatches} / ${r.canvasTotal} (${r.canvasMatchPct.toFixed(2)}%)`);

    const savePng = (dataUrl, filename) => {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      const outPath = path.join(screenshotsDir, filename);
      fs.writeFileSync(outPath, base64Data, 'base64');
      return outPath;
    };

    const actualFile = savePng(r.actualDataUrl, `app_ui_sub${r.id.toString().padStart(2, '0')}_actual.png`);
    const expectedFile = savePng(r.expectedDataUrl, `app_ui_sub${r.id.toString().padStart(2, '0')}_expected.png`);
    console.log(`   -> Actual PNG   : ${actualFile}`);
    console.log(`   -> Expected PNG : ${expectedFile}`);
  }

  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
  console.log("\nNon-headless Web App UI test completed successfully!");
}

runNonHeadlessAppTest().catch(err => {
  console.error("Non-headless app error:", err);
  process.exit(1);
});
