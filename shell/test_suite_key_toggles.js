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

async function testSuiteKeyToggles() {
  console.log("\n==========================================================================");
  console.log(" TESTING KEY TOGGLES IN SUITE.GBA CATEGORY 13 VIDEO TESTS");
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
    const keyAPressed = 0x03FF & ~0x0001;     // A
    const keyBPressed = 0x03FF & ~0x0002;     // B
    const keySelectPressed = 0x03FF & ~0x0004; // Select
    const keyStartPressed = 0x03FF & ~0x0008;  // Start
    const keyRightPressed = 0x03FF & ~0x0010; // Right
    const keyLeftPressed = 0x03FF & ~0x0020;  // Left
    const keyUpPressed = 0x03FF & ~0x0040;    // Up
    const keyDownPressed = 0x03FF & ~0x0080;  // Down
    const keyRPressed = 0x03FF & ~0x0100;     // R
    const keyLPressed = 0x03FF & ~0x0200;     // L

    const press = (k, holdFrames = 10, releaseFrames = 10) => {
      gba.mem.setKeyInput(k);
      for (let f = 0; f < holdFrames; f++) gba.runFrame();
      gba.mem.setKeyInput(keyReleased);
      for (let f = 0; f < releaseFrames; f++) gba.runFrame();
    };

    // Navigate to Category 13 -> Subtest 1 (Basic Mode 3)
    for (let i = 0; i < 13; i++) press(keyDownPressed);
    press(keyAPressed); // Enter Category 13
    for (let f = 0; f < 20; f++) gba.runFrame();

    press(keyAPressed); // Enter Subtest 1 description
    for (let f = 0; f < 20; f++) gba.runFrame();

    press(keyAPressed); // Start Subtest 1 live view
    for (let f = 0; f < 60; f++) gba.runFrame();

    const initialDispcnt = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;

    // Test pressing each key and record DISPCNT
    const keyLog = [];

    const testKey = (name, keyMask) => {
      press(keyMask);
      for (let f = 0; f < 30; f++) gba.runFrame();
      keyLog.push({ key: name, dispcnt: `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}` });
    };

    testKey('Left', keyLeftPressed);
    testKey('Right', keyRightPressed);
    testKey('Up', keyUpPressed);
    testKey('Down', keyDownPressed);
    testKey('Select', keySelectPressed);
    testKey('Start', keyStartPressed);
    testKey('L', keyLPressed);
    testKey('R', keyRPressed);
    testKey('B', keyBPressed);

    return {
      initialDispcnt,
      keyLog
    };
  }, biosBytes, romBytes);

  console.log(`Initial Subtest 1 DISPCNT: ${result.initialDispcnt}`);
  console.log("Keypress DISPCNT Log:");
  for (const k of result.keyLog) {
    console.log(`  Key: ${k.key.padEnd(8)} | DISPCNT: ${k.dispcnt}`);
  }

  await browser.close();
}

testSuiteKeyToggles().catch(err => {
  console.error("Key toggle test error:", err);
  process.exit(1);
});
