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

async function testSuiteAllKeysMode3() {
  console.log("\n==========================================================================");
  console.log(" TESTING ALL KEY COMBINATIONS IN SUITE.GBA SUBTEST 1 (BASIC MODE 3)");
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
    const keys = [
      { name: 'A', mask: 0x03FF & ~0x0001 },
      { name: 'B', mask: 0x03FF & ~0x0002 },
      { name: 'Select', mask: 0x03FF & ~0x0004 },
      { name: 'Start', mask: 0x03FF & ~0x0008 },
      { name: 'Right', mask: 0x03FF & ~0x0010 },
      { name: 'Left', mask: 0x03FF & ~0x0020 },
      { name: 'Up', mask: 0x03FF & ~0x0040 },
      { name: 'Down', mask: 0x03FF & ~0x0080 },
      { name: 'R', mask: 0x03FF & ~0x0100 },
      { name: 'L', mask: 0x03FF & ~0x0200 },
      { name: 'L+R', mask: 0x03FF & ~0x0300 },
      { name: 'Select+Start', mask: 0x03FF & ~0x000C },
    ];

    const press = (k, holdFrames = 10, releaseFrames = 10) => {
      gba.mem.setKeyInput(k);
      for (let f = 0; f < holdFrames; f++) gba.runFrame();
      gba.mem.setKeyInput(keyReleased);
      for (let f = 0; f < releaseFrames; f++) gba.runFrame();
    };

    // Navigate to Category 13 -> Subtest 1
    for (let i = 0; i < 13; i++) press(0x03FF & ~0x0080); // Down
    press(0x03FF & ~0x0001); // A -> Category 13
    for (let f = 0; f < 20; f++) gba.runFrame();

    press(0x03FF & ~0x0001); // A -> Subtest 1 description
    for (let f = 0; f < 20; f++) gba.runFrame();

    press(0x03FF & ~0x0001); // A -> Subtest 1 live view
    for (let f = 0; f < 60; f++) gba.runFrame();

    const log = [];

    for (const k of keys) {
      // Return to live view state with Left
      gba.mem.setKeyInput(0x03FF & ~0x0020);
      for (let f = 0; f < 20; f++) gba.runFrame();

      // Press candidate key
      press(k.mask, 15, 15);
      gba.ppu.renderFrame();
      const dispcnt = `0x${gba.ppu.dispcnt.toString(16).padStart(4, '0')}`;
      log.push({ key: k.name, dispcnt });
    }

    return log;
  }, biosBytes, romBytes);

  console.log("Subtest 1 Key Response Matrix:");
  for (const item of result) {
    console.log(`  Key ${item.key.padEnd(12)} -> DISPCNT: ${item.dispcnt}`);
  }

  await browser.close();
}

testSuiteAllKeysMode3().catch(err => {
  console.error("Key matrix error:", err);
  process.exit(1);
});
