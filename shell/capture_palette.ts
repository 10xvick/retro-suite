/**
 * capture_palette.ts
 * Run: npx tsx capture_palette.ts
 *
 * Boots the SNES emulator headlessly, runs 600 frames (~10 seconds),
 * then dumps the real CGRAM palette and OAM data to palette_data.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Minimal browser API stubs (emulator uses requestAnimationFrame, AudioContext etc.) ──
(global as any).AudioContext = class {
  sampleRate = 44100;
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  createScriptProcessor() { return { connect() {}, addEventListener() {}, onaudioprocess: null }; }
  createBuffer() { return {}; }
  createBufferSource() { return { connect() {}, start() {}, buffer: null }; }
  get destination() { return {}; }
  get currentTime() { return 0; }
  close() {}
};
(global as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 16);
(global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
(global as any).performance = { now: () => Date.now() };

// Minimal canvas stub (PPU renders to canvas)
class MockContext2D {
  canvas: any;
  constructor(canvas: any) { this.canvas = canvas; }
  clearRect() {}
  putImageData() {}
  createImageData(w: number, h: number) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  getImageData(x: number, y: number, w: number, h: number) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  fillRect() {}
  drawImage() {}
  save() {} restore() {} scale() {} translate() {}
}

class MockCanvas {
  width = 256;
  height = 224;
  style: any = {};
  _ctx: MockContext2D;
  constructor() { this._ctx = new MockContext2D(this); }
  getContext(type: string) { return this._ctx; }
  addEventListener() {}
}

(global as any).document = {
  createElement(tag: string) {
    if (tag === 'canvas') return new MockCanvas();
    return { style: {}, addEventListener() {}, appendChild() {} };
  },
  getElementById() { return new MockCanvas(); },
  addEventListener() {},
};

(global as any).window = global;
(global as any).HTMLCanvasElement = MockCanvas;

// ── Now import the emulator ──────────────────────────────────────────────────
import { SnesEmulator } from './src/emulator/EmulatorFacade';

async function main() {
  const romPath = path.join(__dirname, 'public', 'sample.sfc');
  const romData = fs.readFileSync(romPath);
  const romArray = new Uint8Array(romData);

  console.log(`ROM loaded: ${(romArray.length / 1024).toFixed(0)} KB`);

  const emulator = new SnesEmulator();

  // Load the ROM
  const romDetails = emulator.loadRomBytes(romArray);
  console.log('ROM details:', romDetails);

  // Run frames - capture at multiple points
  const FRAMES = 1800; // 30 seconds of game time
  console.log(`Running ${FRAMES} frames...`);
  
  // Collect palette snapshots at key frames
  const snapshots: Array<{frame: number, cgram: number[]}> = [];
  let lastPercent = 0;
  
  for (let i = 0; i < FRAMES; i++) {
    try {
      emulator.runFrame(0, 1); // no controller input, 1x speed
    } catch (e) {
      // CPU might throw on unimplemented opcodes — continue
    }
    
    // Capture snapshots at key frames
    if ([100, 200, 300, 400, 600, 900, 1200, 1500, 1800].includes(i+1)) {
      const snap = emulator.createDebugSnapshot(0);
      snapshots.push({ frame: i+1, cgram: [...snap.cgram] });
    }
    const pct = Math.floor((i / FRAMES) * 100);
    if (pct !== lastPercent && pct % 10 === 0) {
      process.stdout.write(`\r  ${pct}% (frame ${i})`);
      lastPercent = pct;
    }
  }
  console.log('\nDone running frames.');

  // Capture debug snapshot
  const snapshot = emulator.createDebugSnapshot(0);

  // Get raw CGRAM (256 15-bit SNES colors)
  const cgram = snapshot.cgram; // number[]
  console.log(`CGRAM colors captured: ${cgram.length}`);
  console.log(`OAM entries: ${snapshot.oam.length}`);

  // Also capture raw VRAM data for tile extraction
  const rawState = (emulator as any).getRawState ? (emulator as any).getRawState() : null;

  // Extract palette data
  const palettes: Array<{ index: number; label: string; colors: [number,number,number][] }> = [];
  for (let p = 0; p < 16; p++) {
    const colors: [number,number,number][] = [];
    for (let c = 0; c < 16; c++) {
      const idx = p * 16 + c;
      const snesColor = cgram[idx] || 0;
      const r = (snesColor & 0x1F) << 3;
      const g = ((snesColor >> 5) & 0x1F) << 3;
      const b = ((snesColor >> 10) & 0x1F) << 3;
      colors.push([r | (r >> 5), g | (g >> 5), b | (b >> 5)]);
    }
    const type = p < 8 ? 'BG' : 'OBJ';
    palettes.push({ index: p, label: `Pal ${p} (${type})`, colors });
  }

  // Save result
  const output = {
    frames: FRAMES,
    romTitle: romDetails?.title || 'Unknown',
    cgram,
    oam: snapshot.oam,
    palettes,
    snapshots, // multiple capture points
  };

  fs.writeFileSync(
    path.join(__dirname, 'palette_data.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('palette_data.json written!');
  console.log(`  ${palettes.length} palettes extracted (8 BG + 8 OBJ)`);

  // Print palette preview
  for (const p of palettes) {
    const nonBlack = p.colors.filter(([r,g,b]) => r+g+b > 30).length;
    console.log(`  Pal ${p.index.toString().padStart(2)} (${p.label.slice(7)}): ${nonBlack}/16 non-black colors`);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
