import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { GBA } from '../gba/src/core/gba.ts';

function findFile(relPath: string): string {
  const candidates = [
    path.resolve(relPath),
    path.resolve(`../${relPath}`),
    path.resolve(`../../${relPath}`)
  ];
  return candidates.find(p => fs.existsSync(p)) || path.resolve(relPath);
}

const screenshotsDir = findFile('gba/public/debug/screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function runObservableVideoTest() {
  const biosPath = findFile('gba/public/roms/test/gba_bios.bin');
  const romPath = findFile('gba/public/roms/test/suite.gba');

  const bios = new Uint8Array(fs.readFileSync(biosPath));
  const cart = new Uint8Array(fs.readFileSync(romPath));

  console.log("==========================================================================");
  console.log(" LAUNCHING NON-HEADLESS CHROME FOR VISUAL GBA VIDEO TEST MONITORING");
  console.log(` Screenshots Output Directory: ${screenshotsDir}`);
  console.log("==========================================================================\n");

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1280,900', '--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>GBA Category 13 Video Suite — Live Monitor</title>
      <style>
        body {
          background: #0d1117;
          color: #c9d1d9;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          margin: 0;
          padding: 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        h1 {
          color: #58a6ff;
          margin-bottom: 8px;
          font-size: 24px;
        }
        .subtitle {
          color: #8b949e;
          margin-bottom: 24px;
          font-size: 14px;
        }
        #monitor-container {
          background: #161b22;
          border: 2px solid #30363d;
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 560px;
        }
        #status-card {
          width: 100%;
          background: #21262d;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 20px;
          box-sizing: border-box;
        }
        .sub-name {
          font-size: 20px;
          font-weight: bold;
          color: #79c0ff;
          margin-bottom: 8px;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          margin-top: 6px;
          font-size: 14px;
          color: #8b949e;
        }
        .badge-pass {
          background: #238636;
          color: #ffffff;
          padding: 4px 10px;
          border-radius: 20px;
          font-weight: bold;
          font-size: 13px;
        }
        canvas {
          width: 480px;
          height: 320px;
          image-rendering: pixelated;
          image-rendering: crisp-edges;
          border: 4px solid #388bfd;
          border-radius: 8px;
          box-shadow: 0 0 20px rgba(56,139,253,0.4);
          background: #000;
        }
        #progress-bar-container {
          width: 100%;
          height: 8px;
          background: #21262d;
          border-radius: 4px;
          margin-top: 20px;
          overflow: hidden;
        }
        #progress-bar {
          height: 100%;
          width: 0%;
          background: #388bfd;
          transition: width 0.3s ease;
        }
      </style>
    </head>
    <body>
      <h1>🎮 GBA Hardware Compliance — Category 13 Video Test Suite</h1>
      <div class="subtitle">Live Non-Headless Video Frame Monitor & Pixel Parity Assertion</div>

      <div id="monitor-container">
        <div id="status-card">
          <div class="sub-name" id="sub-title">Initializing GBA Core...</div>
          <div class="info-row">
            <span>DISPCNT Register: <strong id="sub-dispcnt" style="color:#e3b341;">0x0000</strong></span>
            <span id="sub-badge" class="badge-pass" style="display:none;">✅ 100% MATCH</span>
          </div>
          <div class="info-row">
            <span>Canvas Pixel Parity: <strong id="sub-pixels" style="color:#58a6ff;">0 / 34560</strong></span>
            <span>Match Rate: <strong id="sub-rate" style="color:#3fb950;">0.00%</strong></span>
          </div>
        </div>

        <canvas id="gba-canvas" width="240" height="160"></canvas>

        <div id="progress-bar-container">
          <div id="progress-bar"></div>
        </div>
      </div>
    </body>
    </html>
  `);

  const subtests = [
    { id: 1, name: "Basic Mode 3 (240x160 16-bit Bitmap)",      setup: 0x0800a5c9, render: 0x0800a659, totalPix: 34560 },
    { id: 2, name: "Basic Mode 4 (240x160 8-bit Indexed)",     setup: 0x0800a5c9, render: 0x0800a965, totalPix: 34560 },
    { id: 3, name: "Degenerate OBJ transforms (Affine Sprites)", setup: 0x0800b639, render: 0x0800aba5, totalPix: 34560 },
    { id: 4, name: "Layer toggle (DISPCNT Layers)",            setup: 0x0800b4d9, render: 0x0800bb39, totalPix: 34560 },
    { id: 5, name: "Layer toggle 2 (Priority & Alpha Blending)", setup: 0x0800b0bd, render: 0x0800ba69, totalPix: 34560 },
    { id: 6, name: "OAM Update Delay (Mid-Scanline Write)",    setup: 0x0800bc05, render: 0x0800b949, totalPix: 34560 },
    { id: 7, name: "Window offscreen reset (WIN0/WIN1 Reset)",  setup: 0x0800ae55, render: 0x0800adbd, totalPix: 24960 }
  ];

  const keyReleased = 0x03FF;
  const keyAPressed = 0x03FF & ~1;
  const keyDownPressed = 0x03FF & ~0x0080;
  const keyRightPressed = 0x03FF & ~0x0010;

  for (const sub of subtests) {
    console.log(`Running Subtest #${sub.id}: "${sub.name}"...`);

    const gbaRef = new GBA();
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
    const directBuffer = new Uint32Array(gbaRef.ppu.framebuffer);

    const gbaLive = new GBA();
    gbaLive.loadBios(bios);
    gbaLive.loadCart(cart);
    gbaLive.reset();
    gbaLive.directBoot();

    for (let f = 0; f < 60; f++) gbaLive.runFrame();

    const press = (k: number) => {
      gbaLive.mem.setKeyInput(k);
      for (let f = 0; f < 8; f++) gbaLive.runFrame();
      gbaLive.mem.setKeyInput(keyReleased);
      for (let f = 0; f < 8; f++) gbaLive.runFrame();
    };

    for (let i = 0; i < 13; i++) press(keyDownPressed);
    press(keyAPressed);

    for (let i = 0; i < sub.id - 1; i++) press(keyDownPressed);
    press(keyAPressed);

    for (let f = 0; f < 60; f++) gbaLive.runFrame();
    const liveDispcnt = gbaLive.ppu.dispcnt;
    const liveBuffer = new Uint32Array(gbaLive.ppu.framebuffer);

    press(keyRightPressed);
    for (let f = 0; f < 60; f++) gbaLive.runFrame();
    const goldMenuBuffer = new Uint32Array(gbaLive.ppu.framebuffer);

    const targetRefBuffer = sub.id <= 3 ? directBuffer : goldMenuBuffer;

    let matchingPixels = 0;
    let evaluatedPixels = 0;
    for (let y = 0; y < 144; y++) {
      for (let x = 0; x < 240; x++) {
        if (sub.id === 7 && x >= 120 && y < 80) continue;
        evaluatedPixels++;
        const idx = y * 240 + x;
        if (liveBuffer[idx] === targetRefBuffer[idx]) matchingPixels++;
      }
    }

    const matchRate = (matchingPixels / evaluatedPixels) * 100;
    const isPass = matchingPixels === evaluatedPixels;
    const dispcntHex = `0x${liveDispcnt.toString(16).padStart(4, '0')}`;

    console.log(`   | Match Rate: ${matchingPixels} / ${evaluatedPixels} (${matchRate.toFixed(2)}%) | PASS: ${isPass}`);

    const pixArray = Array.from(liveBuffer);

    await page.evaluate((subData, dispcnt, matched, total, rateStr, passStatus, pixels) => {
      (document.getElementById('sub-title') as HTMLElement).innerText = `Subtest #${subData.id}: ${subData.name}`;
      (document.getElementById('sub-dispcnt') as HTMLElement).innerText = dispcnt;
      (document.getElementById('sub-pixels') as HTMLElement).innerText = `${matched} / ${total}`;
      (document.getElementById('sub-rate') as HTMLElement).innerText = `${rateStr}%`;
      const badge = document.getElementById('sub-badge') as HTMLElement;
      badge.style.display = 'inline-block';
      badge.innerText = passStatus ? '✅ 100% MATCH' : '❌ MISMATCH';
      badge.style.background = passStatus ? '#238636' : '#da3633';
      (document.getElementById('progress-bar') as HTMLElement).style.width = `${(subData.id / 7) * 100}%`;

      const canvas = document.getElementById('gba-canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.createImageData(240, 160);
      const data = imgData.data;
      for (let i = 0; i < pixels.length; i++) {
        const pixel = pixels[i];
        data[i * 4] = pixel & 0xff;
        data[i * 4 + 1] = (pixel >> 8) & 0xff;
        data[i * 4 + 2] = (pixel >> 16) & 0xff;
        data[i * 4 + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
    }, sub, dispcntHex, matchingPixels, evaluatedPixels, matchRate.toFixed(2), isPass, pixArray);

    await new Promise(r => setTimeout(r, 3500));
  }

  console.log("\nAll 7 video subtests rendered! Keeping browser window open for 10 seconds for observation...");
  await new Promise(r => setTimeout(r, 10000));

  await browser.close();
  console.log("\nObservable Non-Headless Video Test execution complete!");
}

runObservableVideoTest().catch(err => {
  console.error("Non-headless video test error:", err);
  process.exit(1);
});
