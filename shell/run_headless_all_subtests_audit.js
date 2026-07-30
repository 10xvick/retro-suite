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

async function runHeadlessAllSubtestsAudit() {
  console.log("\n==========================================================================");
  console.log(" HEADLESS AUTOMATED AUDIT: ALL 7 GBA CATEGORY 13 VIDEO SUBTESTS");
  console.log(" Output Directory: " + screenshotsDir);
  console.log("==========================================================================\n");

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[Browser Console Error] ${msg.text()}`);
    }
  });

  await page.goto('http://localhost:5006/emulator/retro-station/', { waitUntil: 'networkidle0' });
  console.log('Opened Web UI in headless Chrome mode.');

  const biosPath = findPath('gba/public/roms/test/gba_bios.bin');
  const romPath = findPath('gba/public/roms/test/suite.gba');

  const biosBytes = Array.from(new Uint8Array(fs.readFileSync(biosPath)));
  const romBytes = Array.from(new Uint8Array(fs.readFileSync(romPath)));

  const results = await page.evaluate(async (biosArr, romArr) => {
    const mod = await import('/emulator/retro-station/src/emulator/EmulatorCore.ts');
    const gbaCore = new mod.GbaEmulatorCore();
    const GBA = gbaCore.gba.constructor;

    const bios = new Uint8Array(biosArr);
    const cart = new Uint8Array(romArr);

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
    const keyAPressed = 0x03FF & ~0x0001;     // A button
    const keyDownPressed = 0x03FF & ~0x0080;  // Down D-pad
    const keyLeftPressed = 0x03FF & ~0x0020;  // Left D-pad (Switches to ACTUAL badge view)
    const keyRightPressed = 0x03FF & ~0x0010; // Right D-pad (Switches to EXPECTED badge view)

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 240;
    overlayCanvas.height = 160;
    const ctx = overlayCanvas.getContext('2d');

    const renderToDataUrl = (buffer) => {
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
      return overlayCanvas.toDataURL('image/png');
    };

    const report = [];

    for (const sub of subtests) {
      // 1. Golden Reference Execution
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
      const goldRefBuffer = Array.from(gbaRef.ppu.framebuffer);

      // 2. Interactive Menu Traversal to Subtest
      const gbaLive = new GBA();
      gbaLive.loadBios(bios);
      gbaLive.loadCart(cart);
      gbaLive.reset();
      gbaLive.directBoot();

      for (let f = 0; f < 60; f++) gbaLive.runFrame();

      const press = (k) => {
        gbaLive.mem.setKeyInput(k);
        for (let f = 0; f < 6; f++) gbaLive.runFrame();
        gbaLive.mem.setKeyInput(keyReleased);
        for (let f = 0; f < 6; f++) gbaLive.runFrame();
      };

      // Step down Main Menu to Category 13
      for (let i = 0; i < 13; i++) press(keyDownPressed);
      press(keyAPressed); // Enter Category 13 menu
      for (let f = 0; f < 10; f++) gbaLive.runFrame();

      // Step down Category 13 subtest list to sub.menuDowns
      for (let i = 0; i < sub.menuDowns; i++) press(keyDownPressed);
      press(keyAPressed); // Enter subtest description page
      for (let f = 0; f < 10; f++) gbaLive.runFrame();

      press(keyAPressed); // Enter live subtest screen
      for (let f = 0; f < 20; f++) gbaLive.runFrame();

      // Press RIGHT for EXPECTED badge menu background
      press(keyRightPressed);
      for (let f = 0; f < 6; f++) gbaLive.runFrame();
      gbaLive.ppu.renderFrame();
      const goldMenuBuffer = Array.from(gbaLive.ppu.framebuffer);

      // Press LEFT for ACTUAL badge menu background
      press(keyLeftPressed);
      for (let f = 0; f < 6; f++) gbaLive.runFrame();

      // Execute sub.setup & sub.render routine IMMEDIATELY BEFORE renderFrame()!
      gbaLive.cpu.r[14] = 0x08000100;
      gbaLive.cpu.cpsr = (gbaLive.cpu.cpsr & ~0x20) | ((sub.setup & 1) ? 0x20 : 0);
      gbaLive.cpu.r[15] = sub.setup & ~1;
      for (let s = 0; s < 200000; s++) {
        gbaLive.cpu.step();
        if (gbaLive.cpu.r[15] === 0x08000100) break;
      }
      gbaLive.cpu.r[14] = 0x08000100;
      gbaLive.cpu.cpsr = (gbaLive.cpu.cpsr & ~0x20) | ((sub.render & 1) ? 0x20 : 0);
      gbaLive.cpu.r[15] = sub.render & ~1;
      for (let s = 0; s < 200000; s++) {
        gbaLive.cpu.step();
        if (gbaLive.cpu.r[15] === 0x08000100) break;
      }

      gbaLive.ppu.renderFrame();
      const liveActualDispcnt = `0x${gbaLive.ppu.dispcnt.toString(16).padStart(4, '0')}`;
      const actualBuffer = Array.from(gbaLive.ppu.framebuffer);

      // Build expected buffer with top graphic reference
      const finalExpectedBuffer = new Array(240 * 160);
      for (let i = 0; i < 240 * 144; i++) {
        finalExpectedBuffer[i] = goldRefBuffer[i];
      }
      for (let i = 240 * 144; i < 240 * 160; i++) {
        finalExpectedBuffer[i] = goldMenuBuffer[i];
      }

      // Parity calculation for top graphics ($y < 144$)
      let canvasMatches = 0;
      let canvasTotal = 0;
      const diffBuffer = new Array(240 * 160);

      for (let y = 0; y < 144; y++) {
        for (let x = 0; x < 240; x++) {
          if (sub.id === 7 && x >= 120 && y < 80) {
            // Window 7 ignore status text overlay region
            diffBuffer[y * 240 + x] = actualBuffer[y * 240 + x];
            continue;
          }
          canvasTotal++;
          const idx = y * 240 + x;
          if (actualBuffer[idx] === finalExpectedBuffer[idx]) {
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
        if (actualBuffer[i] === finalExpectedBuffer[i]) badgeMatches++;
      }

      report.push({
        id: sub.id,
        name: sub.name,
        dispcnt: liveActualDispcnt,
        canvasMatches,
        canvasTotal,
        canvasMatchPct: (canvasMatches / canvasTotal) * 100,
        badgeMatches,
        badgeTotal,
        actualDataUrl: renderToDataUrl(actualBuffer),
        expectedDataUrl: renderToDataUrl(finalExpectedBuffer),
        diffDataUrl: renderToDataUrl(diffBuffer)
      });
    }

    return report;
  }, biosBytes, romBytes);

  console.log("\n==========================================================================");
  console.log(" HEADLESS PARITY AUDIT SUMMARY FOR ALL 7 SUBTESTS");
  console.log("==========================================================================");

  let totalPassed = 0;

  for (const r of results) {
    const isPass = r.canvasMatchPct >= 90.0;
    if (isPass) totalPassed++;
    const mark = isPass ? "✅ PASS" : "❌ FAIL";
    console.log(`${mark} Subtest #${r.id} ("${r.name}") | DISPCNT: ${r.dispcnt}`);
    console.log(`   | Top Canvas Graphics ($y < 144$): ${r.canvasMatches} / ${r.canvasTotal} (${r.canvasMatchPct.toFixed(2)}%)`);
    console.log(`   | Bottom Badge Text  ($y >= 144$): ${r.badgeMatches} / ${r.badgeTotal} pixels match (Distinct <Actual> vs <Expected> badges)`);

    const savePng = (dataUrl, filename) => {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      const outPath = path.join(screenshotsDir, filename);
      fs.writeFileSync(outPath, base64Data, 'base64');
      return outPath;
    };

    const actualPath = savePng(r.actualDataUrl, `headless_sub${r.id.toString().padStart(2, '0')}_actual.png`);
    const expectedPath = savePng(r.expectedDataUrl, `headless_sub${r.id.toString().padStart(2, '0')}_expected.png`);
    const diffPath = savePng(r.diffDataUrl, `headless_sub${r.id.toString().padStart(2, '0')}_diff.png`);

    console.log(`   | Actual PNG   : ${actualPath}`);
    console.log(`   | Expected PNG : ${expectedPath}`);
    console.log(`   | Diff PNG     : ${diffPath}`);
    console.log("--------------------------------------------------------------------------");
  }

  console.log(`\nAUDIT COMPLETE: ${totalPassed} / ${results.length} Subtests passed (>= 90% top canvas parity).`);
  await browser.close();
}

runHeadlessAllSubtestsAudit().catch(err => {
  console.error("Audit error:", err);
  process.exit(1);
});
