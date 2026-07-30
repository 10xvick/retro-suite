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

async function verifyMode34Rendering() {
  console.log("\n==========================================================================");
  console.log(" VERIFYING MODE 3 & MODE 4 BITMAP RENDERING ACCURACY IN CORE");
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

    for (let f = 0; f < 60; f++) gba.runFrame();

    const keyReleased = 0x03FF;
    const keyAPressed = 0x03FF & ~0x0001;
    const keyDownPressed = 0x03FF & ~0x0080;
    const keyLeftPressed = 0x03FF & ~0x0020;

    const press = (k, holdFrames = 10, releaseFrames = 10) => {
      gba.mem.setKeyInput(k);
      for (let f = 0; f < holdFrames; f++) gba.runFrame();
      gba.mem.setKeyInput(keyReleased);
      for (let f = 0; f < releaseFrames; f++) gba.runFrame();
    };

    // Category 13 -> Subtest 1 (Basic Mode 3)
    for (let i = 0; i < 13; i++) press(keyDownPressed);
    press(keyAPressed);
    for (let f = 0; f < 20; f++) gba.runFrame();

    press(keyAPressed); // Description
    for (let f = 0; f < 20; f++) gba.runFrame();
    press(keyAPressed); // Start test
    for (let f = 0; f < 30; f++) gba.runFrame();

    press(keyLeftPressed); // Select Actual view
    for (let f = 0; f < 20; f++) gba.runFrame();

    gba.ppu.renderFrame();
    const mode3Dispcnt = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;
    const mode3NonZeroPixels = Array.from(gba.ppu.framebuffer).slice(0, 240 * 144).filter(p => p !== 0).length;

    return { mode3Dispcnt, mode3NonZeroPixels };
  }, biosBytes, romBytes);

  console.log(`Subtest 1 (Basic Mode 3) Render Stats:`);
  console.log(`  DISPCNT: ${result.mode3Dispcnt}`);
  console.log(`  Non-zero rendered graphics pixels ($y < 144$): ${result.mode3NonZeroPixels} / 34560`);

  await browser.close();
}

verifyMode34Rendering().catch(err => {
  console.error("Verification error:", err);
  process.exit(1);
});
