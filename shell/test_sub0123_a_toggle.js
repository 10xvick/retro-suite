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

async function testSub0123AToggle() {
  console.log("\n==========================================================================");
  console.log(" TESTING 'A' BUTTON TOGGLE FOR SUBTESTS 1, 2, 3 IN SUITE.GBA");
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
    const keyRightPressed = 0x03FF & ~0x0010;
    const keyRPressed = 0x03FF & ~0x0100;
    const keyLPressed = 0x03FF & ~0x0200;

    const press = (k, holdFrames = 10, releaseFrames = 10) => {
      gba.mem.setKeyInput(k);
      for (let f = 0; f < holdFrames; f++) gba.runFrame();
      gba.mem.setKeyInput(keyReleased);
      for (let f = 0; f < releaseFrames; f++) gba.runFrame();
    };

    // Navigate to Category 13
    for (let i = 0; i < 13; i++) press(keyDownPressed);
    press(keyAPressed);
    for (let f = 0; f < 20; f++) gba.runFrame();

    // Subtest 1
    press(keyAPressed); // Enter description
    for (let f = 0; f < 20; f++) gba.runFrame();
    press(keyAPressed); // Start live test
    for (let f = 0; f < 30; f++) gba.runFrame();

    gba.ppu.renderFrame();
    const state0 = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;

    // Press A
    press(keyAPressed);
    gba.ppu.renderFrame();
    const stateA = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;

    // Press L
    press(keyLPressed);
    gba.ppu.renderFrame();
    const stateL = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;

    // Press R
    press(keyRPressed);
    gba.ppu.renderFrame();
    const stateR = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;

    return { state0, stateA, stateL, stateR };
  }, biosBytes, romBytes);

  console.log("Subtest 1 Key DISPCNT Responses:");
  console.log(`  Default live state: ${result.state0}`);
  console.log(`  After A press     : ${result.stateA}`);
  console.log(`  After L press     : ${result.stateL}`);
  console.log(`  After R press     : ${result.stateR}`);

  await browser.close();
}

testSub0123AToggle().catch(err => {
  console.error("Sub0123 toggle error:", err);
  process.exit(1);
});
