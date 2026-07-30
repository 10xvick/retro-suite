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

async function testPureMenuInteractiveToggles() {
  console.log("\n==========================================================================");
  console.log(" PURE MENU AUTOMATION WITH INTERACTIVE LAYER TOGGLES (ZERO CPU REGISTER HACKS)");
  console.log(" Output Directory: " + screenshotsDir);
  console.log("==========================================================================\n");

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  await page.goto('http://localhost:5006/emulator/retro-station/', { waitUntil: 'networkidle0' });

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
      { id: 1, name: "Basic Mode 3", menuDowns: 0 },
      { id: 2, name: "Basic Mode 4", menuDowns: 1 },
      { id: 3, name: "Degenerate OBJ transforms", menuDowns: 2 },
      { id: 4, name: "Layer toggle", menuDowns: 3 },
      { id: 5, name: "Layer toggle 2", menuDowns: 4 },
      { id: 6, name: "OAM Update Delay", menuDowns: 5 },
      { id: 7, name: "Window offscreen reset", menuDowns: 6 }
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
      // 100% PURE MENU AUTOMATION — NO CPU REGISTER HACKS!
      const gba = new GBA();
      gba.loadBios(bios);
      gba.loadCart(cart);
      gba.reset();
      gba.directBoot();

      for (let f = 0; f < 60; f++) gba.runFrame();

      const press = (k, holdFrames = 10, releaseFrames = 10) => {
        gba.mem.setKeyInput(k);
        for (let f = 0; f < holdFrames; f++) gba.runFrame();
        gba.mem.setKeyInput(keyReleased);
        for (let f = 0; f < releaseFrames; f++) gba.runFrame();
      };

      // 1. Step down Main Menu 13 times to Category 13
      for (let i = 0; i < 13; i++) press(keyDownPressed);
      press(keyAPressed); // Enter Category 13
      for (let f = 0; f < 20; f++) gba.runFrame();

      // 2. Step down Category 13 menu to sub.menuDowns
      for (let i = 0; i < sub.menuDowns; i++) press(keyDownPressed);
      press(keyAPressed); // Enter subtest description page
      for (let f = 0; f < 20; f++) gba.runFrame();

      // 3. Press A to start live test view
      press(keyAPressed);
      for (let f = 0; f < 30; f++) gba.runFrame();

      // 4. For Subtests 4 & 5, press A on subtest screen to toggle BG0 ON!
      if (sub.id === 4 || sub.id === 5) {
        press(keyAPressed);
        for (let f = 0; f < 20; f++) gba.runFrame();
      }

      // 5. HOLD LEFT D-PAD ACTIVELY FOR TRUE ACTUAL SCREEN (<Actual> badge)!
      gba.mem.setKeyInput(keyLeftPressed);
      for (let f = 0; f < 30; f++) gba.runFrame();
      gba.ppu.renderFrame();
      const liveActualDispcnt = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;
      const actualBuffer = Array.from(gba.ppu.framebuffer);

      // 6. HOLD RIGHT D-PAD ACTIVELY FOR TRUE EXPECTED SCREEN (<Expected> badge)!
      gba.mem.setKeyInput(keyRightPressed);
      for (let f = 0; f < 30; f++) gba.runFrame();
      gba.ppu.renderFrame();
      const expectedDispcnt = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;
      const expectedBuffer = Array.from(gba.ppu.framebuffer);

      gba.mem.setKeyInput(keyReleased);

      // 7. Parity calculation for top graphics ($y < 144$)
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

      report.push({
        id: sub.id,
        name: sub.name,
        actualDispcnt: liveActualDispcnt,
        expectedDispcnt,
        canvasMatches,
        canvasTotal,
        canvasMatchPct: (canvasMatches / canvasTotal) * 100,
        badgeMatches,
        badgeTotal,
        actualDataUrl: renderToDataUrl(actualBuffer),
        expectedDataUrl: renderToDataUrl(expectedBuffer),
        diffDataUrl: renderToDataUrl(diffBuffer)
      });
    }

    return report;
  }, biosBytes, romBytes);

  console.log("\n==========================================================================");
  console.log(" PURE MENU INTERACTIVE TOGGLE AUDIT SUMMARY FOR ALL 7 SUBTESTS");
  console.log("==========================================================================");

  let totalPassed = 0;

  for (const r of results) {
    const isPass = r.canvasMatchPct >= 90.0;
    if (isPass) totalPassed++;
    const mark = isPass ? "✅ PASS" : "❌ FAIL";
    console.log(`${mark} Subtest #${r.id} ("${r.name}") | Actual DISPCNT: ${r.actualDispcnt} | Expected DISPCNT: ${r.expectedDispcnt}`);
    console.log(`   | Top Canvas Graphics ($y < 144$): ${r.canvasMatches} / ${r.canvasTotal} (${r.canvasMatchPct.toFixed(2)}%)`);
    console.log(`   | Bottom Badge Text  ($y >= 144$): ${r.badgeMatches} / ${r.badgeTotal} pixels match (Distinct <Actual> vs <Expected> badges)`);

    const savePng = (dataUrl, filename) => {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      const outPath = path.join(screenshotsDir, filename);
      fs.writeFileSync(outPath, base64Data, 'base64');
      return outPath;
    };

    const actualPath = savePng(r.actualDataUrl, `interactive_sub${r.id.toString().padStart(2, '0')}_actual.png`);
    const expectedPath = savePng(r.expectedDataUrl, `interactive_sub${r.id.toString().padStart(2, '0')}_expected.png`);
    const diffPath = savePng(r.diffDataUrl, `interactive_sub${r.id.toString().padStart(2, '0')}_diff.png`);

    console.log(`   | Actual PNG   : ${actualPath}`);
    console.log(`   | Expected PNG : ${expectedPath}`);
    console.log(`   | Diff PNG     : ${diffPath}`);
    console.log("--------------------------------------------------------------------------");
  }

  console.log(`\nAUDIT COMPLETE: ${totalPassed} / ${results.length} Subtests passed under pure menu execution.`);
  await browser.close();
}

testPureMenuInteractiveToggles().catch(err => {
  console.error("Interactive audit error:", err);
  process.exit(1);
});
