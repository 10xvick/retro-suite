/**
 * SNES Sprite & Tile Extractor — The Jungle Book
 * ─────────────────────────────────────────────────
 * Usage:  node extract_sprites.cjs
 * Output: sprites.html  (open in browser)
 *
 * How it works:
 *  1. Scan ROM for all DMA-to-VRAM patterns (source of tile graphics)
 *  2. Scan ROM for all DMA-to-CGRAM patterns (source of palettes)
 *  3. Also scan for inline CGRAM writes ($2122 write-twice sequences)
 *  4. Decode SNES 4bpp and 2bpp bitplane tile format → pixel arrays
 *  5. Output a self-contained interactive HTML tile viewer
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Load ROM ────────────────────────────────────────────────────────────────
const romPath  = path.join(__dirname, 'public', 'sample.sfc');
const fileData = new Uint8Array(fs.readFileSync(romPath));

// Strip 512-byte SMC header if present
function hasValidLoRomHeader(data, offset) {
  if (data.length < offset + 0x8000) return false;
  const cs = data[offset + 0x7FDE] | (data[offset + 0x7FDF] << 8);
  const cc = data[offset + 0x7FDC] | (data[offset + 0x7FDD] << 8);
  return (cs + cc) === 0xFFFF;
}
const rom = (fileData.length > 512 && hasValidLoRomHeader(fileData, 512))
  ? fileData.slice(512)
  : fileData;

process.stderr.write(`[info] ROM size: ${(rom.length/1024).toFixed(0)} KB (LoROM)\n`);

// ─── LoROM address helpers ────────────────────────────────────────────────────
function loRomOffset(bank, addr) {
  if (addr < 0x8000) return -1;
  const off = ((bank & 0x7F) * 0x8000) + (addr - 0x8000);
  return off < rom.length ? off : -1;
}

// Read ROM byte via LoROM bank:addr mapping
function romByte(bank, addr) {
  const off = loRomOffset(bank, addr);
  return off >= 0 ? rom[off] : 0;
}

// ─── DMA Pattern Scanner ─────────────────────────────────────────────────────
// Strategy: scan raw ROM bytes for the sequence:
//   LDA #$XX   (A9 XX)
//   STA $43C1  (8D C1 43) where C = channel*0x10, B-bus = XX
//
// When B-bus = $18 → DMA writes to $2118 (VRAM tile data, low byte)
// When B-bus = $22 → DMA writes to $2122 (CGRAM palette data)
//
// Near each match, look for: source bank ($43X4), address ($43X2-X3), count ($43X5-X6)

function findDmaTransfers() {
  const vramTransfers = [];   // { romOffset, bank, addr, byteCount, channel }
  const cgramTransfers = [];  // { romOffset, bank, addr, byteCount }

  // For each of 8 DMA channels, scan for B-bus setup
  for (let ch = 0; ch < 8; ch++) {
    const bBusReg    = 0x4301 + (ch * 0x10); // $4301, $4311, ..., $4371
    const bBusLo     = bBusReg & 0xFF;        // 01, 11, 21, ...
    const bBusHi     = (bBusReg >> 8) & 0xFF; // 43

    // Scan raw ROM for: A9 XX 8D bBusLo bBusHi
    for (let i = 0; i < rom.length - 10; i++) {
      // Match: LDA #bBusVal, STA $43Xn
      if (rom[i] !== 0xA9) continue;
      const bBusVal = rom[i + 1];
      if (rom[i + 2] !== 0x8D) continue;
      if (rom[i + 3] !== bBusLo) continue;
      if (rom[i + 4] !== bBusHi) continue;

      // Only care about VRAM ($18) and CGRAM ($22) targets
      if (bBusVal !== 0x18 && bBusVal !== 0x22) continue;

      // Now scan a window around this instruction for the other DMA registers
      // Source address: STA $43X2 / STA $43X3, bank: STA $43X4, count: STA $43X5/$43X6
      const addrRegLo = 0x4302 + (ch * 0x10);
      const addrRegHi = 0x4303 + (ch * 0x10);
      const bankReg   = 0x4304 + (ch * 0x10);
      const cntRegLo  = 0x4305 + (ch * 0x10);
      const cntRegHi  = 0x4306 + (ch * 0x10);

      // Search window: 400 bytes before and after the B-bus setup
      const winStart = Math.max(0, i - 400);
      const winEnd   = Math.min(rom.length - 5, i + 400);

      let srcAddrLo = -1, srcAddrHi = -1, srcBank = -1, cntLo = -1, cntHi = -1;

      for (let j = winStart; j < winEnd - 4; j++) {
        // Pattern: LDA #imm (A9 xx) then STA $43XX (8D lo 43)
        if (rom[j] === 0xA9 && rom[j+2] === 0x8D && rom[j+4] === 0x43) {
          const imm = rom[j + 1];
          const reg = 0x4300 | rom[j + 3];
          if (reg === addrRegLo) srcAddrLo = imm;
          if (reg === addrRegHi) srcAddrHi = imm;
          if (reg === bankReg)   srcBank   = imm;
          if (reg === cntRegLo)  cntLo     = imm;
          if (reg === cntRegHi)  cntHi     = imm;
        }
        // Pattern: LDX #imm16 (A2 lo hi) then STX $43XX (8E lo 43) — 16-bit address store
        if (rom[j] === 0xA2 && rom[j+3] === 0x8E && rom[j+5] === 0x43) {
          const reg = 0x4300 | rom[j + 4];
          const lo  = rom[j + 1], hi = rom[j + 2];
          if (reg === addrRegLo) { srcAddrLo = lo; srcAddrHi = hi; }
          if (reg === cntRegLo)  { cntLo = lo; cntHi = hi; }
        }
        // Pattern: LDY #imm16 (A0 lo hi) then STY $43XX (8C lo 43)
        if (rom[j] === 0xA0 && rom[j+3] === 0x8C && rom[j+5] === 0x43) {
          const reg = 0x4300 | rom[j + 4];
          const lo  = rom[j + 1], hi = rom[j + 2];
          if (reg === addrRegLo) { srcAddrLo = lo; srcAddrHi = hi; }
          if (reg === cntRegLo)  { cntLo = lo; cntHi = hi; }
        }
        // Pattern: STX $43XX directly (8E lo 43) — after some prior LDX
        if (rom[j] === 0x8E && rom[j+2] === 0x43) {
          // Can't know value without tracking X — skip
        }
      }

      if (srcAddrLo < 0 || srcAddrHi < 0 || srcBank < 0) continue;

      const srcAddr   = srcAddrLo | (srcAddrHi << 8);
      const byteCount = (cntLo < 0 ? 0 : cntLo) | ((cntHi < 0 ? 0 : cntHi) << 8);
      if (byteCount === 0) continue;

      const romOff = loRomOffset(srcBank, srcAddr);
      if (romOff < 0 || romOff + byteCount > rom.length) continue;

      const entry = { romOffset: romOff, bank: srcBank, addr: srcAddr, byteCount, channel: ch };

      if (bBusVal === 0x18) {
        vramTransfers.push(entry);
      } else {
        cgramTransfers.push(entry);
      }
    }
  }

  // Deduplicate by romOffset
  const dedup = (arr) => {
    const seen = new Set();
    return arr.filter(e => {
      const k = `${e.romOffset}:${e.byteCount}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  };

  return { vramTransfers: dedup(vramTransfers), cgramTransfers: dedup(cgramTransfers) };
}

// ─── Inline CGRAM write scanner ───────────────────────────────────────────────
// Some games write palette via write-twice $2122 directly in code.
// Scan for STA $2122 (8D 22 21) sequences.
function findInlinePalettes() {
  const palettes = [];
  for (let i = 0; i < rom.length - 5; i++) {
    // Look for: LDA #lo / STA $2122 / LDA #hi / STA $2122
    if (rom[i]   === 0xA9 &&
        rom[i+2] === 0x8D && rom[i+3] === 0x22 && rom[i+4] === 0x21 &&
        rom[i+5] === 0xA9 &&
        rom[i+7] === 0x8D && rom[i+8] === 0x22 && rom[i+9] === 0x21) {
      const lo = rom[i + 1];
      const hi = rom[i + 6];
      palettes.push((hi << 8) | lo); // 15-bit SNES color
      i += 9;
    }
  }
  return palettes;
}

// ─── Heuristic palette scanner ────────────────────────────────────────────────
// Scan ROM for contiguous blocks of valid SNES 15-bit colors.
// A valid SNES color has bit 15 = 0 (0BBBBBGGGGGRRRRR).
// We look for runs of N consecutive valid 16-bit words — these are palette tables.
function findHeuristicPalettes(minColors = 16) {
  const found = []; // { romOffset, colors[], rawWords[] }
  let runStart  = -1;
  let runColors = [];
  let runWords  = [];

  for (let off = 0; off + 1 < rom.length; off += 2) {
    const word = rom[off] | (rom[off + 1] << 8);
    const isValid = (word & 0x8000) === 0; // bit 15 must be 0 for SNES color

    if (isValid) {
      if (runStart < 0) { runStart = off; runColors = []; runWords = []; }
      runColors.push(snesColorToRgb(word));
      runWords.push(word);
    } else {
      if (runStart >= 0 && runColors.length >= minColors) {
        // Quality check: at least 30% of colors must be non-zero, and at least 20% saturated
        const nonZero   = runWords.filter(w => w !== 0).length;
        const saturated = runWords.filter(w => {
          const r = w & 0x1F, g = (w >> 5) & 0x1F, b = (w >> 10) & 0x1F;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          return max > 2 && (max - min) > 3; // has meaningful color difference
        }).length;
        if (nonZero / runColors.length >= 0.3 && saturated / runColors.length >= 0.15) {
          found.push({ romOffset: runStart, colors: runColors.slice(), words: runWords.slice() });
        }
      }
      runStart = -1; runColors = []; runWords = [];
    }
  }
  return found;
}

// ─── Tile Decoders ────────────────────────────────────────────────────────────

// Decode one 8×8 4bpp SNES tile (32 bytes) → Uint8Array[64] of 4-bit color indices
function decodeTile4bpp(data, offset) {
  const px = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const bp01a = data[offset + y * 2];      // bitplane 0
    const bp01b = data[offset + y * 2 + 1];  // bitplane 1
    const bp23a = data[offset + 16 + y * 2]; // bitplane 2
    const bp23b = data[offset + 16 + y * 2 + 1]; // bitplane 3
    for (let x = 0; x < 8; x++) {
      const sh = 7 - x;
      px[y * 8 + x] =
        ((bp01a >> sh) & 1)       |
        (((bp01b >> sh) & 1) << 1) |
        (((bp23a >> sh) & 1) << 2) |
        (((bp23b >> sh) & 1) << 3);
    }
  }
  return px;
}

// Decode one 8×8 2bpp SNES tile (16 bytes) → Uint8Array[64] of 2-bit color indices
function decodeTile2bpp(data, offset) {
  const px = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const bp0 = data[offset + y * 2];
    const bp1 = data[offset + y * 2 + 1];
    for (let x = 0; x < 8; x++) {
      const sh = 7 - x;
      px[y * 8 + x] = ((bp0 >> sh) & 1) | (((bp1 >> sh) & 1) << 1);
    }
  }
  return px;
}

// Check if a tile is "interesting" (not all-zero, not all-same-value)
function isTileInteresting(px) {
  const first = px[0];
  let hasNonZero = false, hasDiff = false;
  for (const v of px) {
    if (v !== 0) hasNonZero = true;
    if (v !== first) hasDiff = true;
    if (hasNonZero && hasDiff) return true;
  }
  return false;
}

// ─── Palette decoder ──────────────────────────────────────────────────────────
// SNES 15-bit color: 0BBBBBGGGGGRRRRR → [r,g,b] in 0-255
function snesColorToRgb(c) {
  const r = (c & 0x1F) << 3;
  const g = ((c >> 5) & 0x1F) << 3;
  const b = ((c >> 10) & 0x1F) << 3;
  return [r | (r >> 5), g | (g >> 5), b | (b >> 5)]; // extend to 8-bit
}

// Decode a palette block (N*2 bytes) from ROM as 15-bit SNES colors → RGB arrays
function decodePalette(data, offset, numColors) {
  const colors = [];
  for (let i = 0; i < numColors && offset + i * 2 + 1 < data.length; i++) {
    const c = data[offset + i * 2] | (data[offset + i * 2 + 1] << 8);
    colors.push(snesColorToRgb(c & 0x7FFF));
  }
  return colors;
}

// ─── Main extraction ─────────────────────────────────────────────────────────
process.stderr.write('[step1] Scanning for DMA transfer patterns...\n');
const { vramTransfers, cgramTransfers } = findDmaTransfers();
process.stderr.write(`        VRAM DMA regions found: ${vramTransfers.length}\n`);
process.stderr.write(`        CGRAM DMA regions found: ${cgramTransfers.length}\n`);

process.stderr.write('[step2] Scanning for inline palette writes...\n');
const inlinePaletteColors = findInlinePalettes();
process.stderr.write(`        Inline palette colors found: ${inlinePaletteColors.length}\n`);

// Decode all palettes
const allPalettes = []; // Array of {label, colors[16]}

// Default SNES grayscale palette (fallback)
const grayPal = Array.from({length:16}, (_, i) => { const v = i * 17; return [v,v,v]; });
allPalettes.push({ label: 'Grayscale (fallback)', colors: grayPal });

// Decode CGRAM DMA palettes
for (const t of cgramTransfers) {
  const numColors = Math.min(256, Math.floor(t.byteCount / 2));
  const colors = decodePalette(rom, t.romOffset, numColors);
  if (colors.length >= 4) {
    // Split into 16-color sub-palettes
    for (let p = 0; p * 16 < colors.length; p++) {
      const sub = colors.slice(p * 16, (p + 1) * 16);
      while (sub.length < 16) sub.push([0,0,0]);
      allPalettes.push({
        label: `DMA $${t.bank.toString(16).padStart(2,'0')}:${t.addr.toString(16).padStart(4,'0')} pal${p}`,
        colors: sub
      });
    }
  }
}

// Build inline palette if enough colors
if (inlinePaletteColors.length >= 4) {
  for (let p = 0; p * 16 < inlinePaletteColors.length; p++) {
    const sub = inlinePaletteColors.slice(p * 16, (p + 1) * 16)
      .map(c => snesColorToRgb(c));
    while (sub.length < 16) sub.push([0,0,0]);
    allPalettes.push({ label: `Inline pal${p}`, colors: sub });
  }
}

process.stderr.write('[step3b] Scanning ROM for heuristic palette blocks...\n');
const heuristicPals = findHeuristicPalettes(16); // minimum 16 colors = at least one full palette

// Score each palette by color richness (avg saturation) and keep only top 50
const scoredPals = heuristicPals.map(hp => {
  const satScore = hp.words.reduce((s, w) => {
    const r = w & 0x1F, g = (w >> 5) & 0x1F, b = (w >> 10) & 0x1F;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return s + (max - min);
  }, 0) / hp.colors.length;
  return { ...hp, satScore };
}).sort((a, b) => b.satScore - a.satScore).slice(0, 50);

process.stderr.write(`         Heuristic palette blocks found: ${heuristicPals.length}, kept top ${scoredPals.length}\n`);
for (const hp of scoredPals) {
  const colors  = hp.colors.slice(0, 256);
  const bankOff = Math.floor(hp.romOffset / 0x8000);
  const bank    = (bankOff + 0x80).toString(16).padStart(2,'0').toUpperCase();
  const addr    = (0x8000 + (hp.romOffset % 0x8000)).toString(16).padStart(4,'0').toUpperCase();
  for (let p = 0; p * 16 < colors.length; p++) {
    const sub = colors.slice(p * 16, (p + 1) * 16);
    while (sub.length < 16) sub.push([0,0,0]);
    allPalettes.push({ label: `$${bank}:${addr} pal${p} (score:${hp.satScore.toFixed(1)})`, colors: sub });
  }
}

process.stderr.write(`[step3] Total palettes: ${allPalettes.length}\n`);


// Decode tiles from VRAM DMA regions
process.stderr.write('[step4] Decoding tiles from VRAM DMA regions...\n');

const regions = []; // { label, tiles4bpp[], tiles2bpp[] }

for (const t of vramTransfers) {
  const label = `$${t.bank.toString(16).padStart(2,'0').toUpperCase()}:${t.addr.toString(16).padStart(4,'0').toUpperCase()} (${t.byteCount} bytes, ch${t.channel})`;
  const tiles4 = [];
  const tiles2 = [];
  const slice = rom.slice(t.romOffset, t.romOffset + t.byteCount);

  // Try 4bpp tiles (32 bytes each)
  for (let off = 0; off + 32 <= slice.length; off += 32) {
    const px = decodeTile4bpp(slice, off);
    tiles4.push({ px, interesting: isTileInteresting(px) });
  }

  // Try 2bpp tiles (16 bytes each) — for BG3 data
  for (let off = 0; off + 16 <= slice.length; off += 16) {
    const px = decodeTile2bpp(slice, off);
    tiles2.push({ px, interesting: isTileInteresting(px) });
  }

  const interesting4 = tiles4.filter(t => t.interesting).length;
  const interesting2 = tiles2.filter(t => t.interesting).length;

  process.stderr.write(`  Region ${label}: ${tiles4.length} 4bpp tiles (${interesting4} interesting), ${tiles2.length} 2bpp tiles (${interesting2} interesting)\n`);

  regions.push({ label, tiles4, tiles2, byteCount: t.byteCount });
}

// Also scan unidentified ROM regions heuristically
// Look at every bank for regions of non-zero data past known code areas
process.stderr.write('[step5] Scanning remaining ROM banks for unidentified graphics...\n');

const knownOffsets = new Set();
for (const t of vramTransfers) {
  for (let j = 0; j < t.byteCount; j++) knownOffsets.add(t.romOffset + j);
}

// Scan each bank for "interesting" tile clusters not already covered
for (let bank = 0x80; bank <= 0xFF; bank++) {
  const bankOff = (bank & 0x7F) * 0x8000;
  if (bankOff >= rom.length) break;

  let regionStart = -1;
  let regionCount = 0;

  for (let addr = 0x8000; addr < 0x10000; addr += 32) {
    const off = bankOff + (addr - 0x8000);
    if (off + 32 > rom.length) break;
    if (knownOffsets.has(off)) { regionStart = -1; regionCount = 0; continue; }

    const px = decodeTile4bpp(rom, off);
    if (isTileInteresting(px)) {
      if (regionStart < 0) { regionStart = off; regionCount = 0; }
      regionCount++;
    } else {
      if (regionStart >= 0 && regionCount >= 8) {
        // Found a region of ≥8 interesting tiles — include it
        const byteLen = regionCount * 32;
        const tiles4 = [];
        for (let j = 0; j < regionCount; j++) {
          const px2 = decodeTile4bpp(rom, regionStart + j * 32);
          tiles4.push({ px: px2, interesting: true });
        }
        const hexBank = bank.toString(16).padStart(2,'0').toUpperCase();
        const hexAddr = (0x8000 + (regionStart - bankOff)).toString(16).padStart(4,'0').toUpperCase();
        regions.push({
          label: `$${hexBank}:${hexAddr} (${byteLen}B, heuristic)`,
          tiles4,
          tiles2: [],
          byteCount: byteLen
        });
      }
      regionStart = -1; regionCount = 0;
    }
  }
}

process.stderr.write(`[done] Total regions: ${regions.length}, Total palettes: ${allPalettes.length}\n`);

// ─── Serialize to JSON for HTML embedding ────────────────────────────────────
// Encode tile pixel arrays as compact base64 strings
function encodeRegions(regions) {
  return regions.map(r => ({
    label: r.label,
    byteCount: r.byteCount,
    tiles4: r.tiles4.map(t => ({
      px: Buffer.from(t.px).toString('base64'),
      ok: t.interesting
    })),
    tiles2: r.tiles2.map(t => ({
      px: Buffer.from(t.px).toString('base64'),
      ok: t.interesting
    }))
  }));
}

const regionsJson   = JSON.stringify(encodeRegions(regions));
const palettesJson  = JSON.stringify(allPalettes);

// ─── Generate HTML viewer ─────────────────────────────────────────────────────
process.stderr.write('[output] Generating sprites.html...\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>The Jungle Book — SNES Sprite &amp; Tile Viewer</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0d0f14;
    color: #e2e8f0;
    font-family: 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
  }
  header {
    background: linear-gradient(135deg, #1a1f2e 0%, #0f1520 100%);
    border-bottom: 1px solid #2d3748;
    padding: 16px 24px;
    display: flex;
    align-items: center;
    gap: 16px;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  header h1 { font-size: 18px; font-weight: 700; color: #63b3ed; }
  header .badge {
    background: #2d3748;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 12px;
    color: #a0aec0;
  }
  .controls {
    background: #161b27;
    border-bottom: 1px solid #2d3748;
    padding: 12px 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    position: sticky;
    top: 57px;
    z-index: 99;
  }
  .ctrl-group { display: flex; align-items: center; gap: 8px; }
  .ctrl-group label { color: #a0aec0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  select, input[type=range] {
    background: #1e2535;
    color: #e2e8f0;
    border: 1px solid #2d3748;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 13px;
    cursor: pointer;
  }
  select { min-width: 280px; }
  input[type=range] { width: 120px; }
  .btn {
    background: #2b6cb0;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 5px 14px;
    font-size: 13px;
    cursor: pointer;
    font-weight: 600;
    transition: background 0.2s;
  }
  .btn:hover { background: #3182ce; }
  .btn.secondary { background: #2d3748; color: #a0aec0; }
  .btn.secondary:hover { background: #4a5568; color: #e2e8f0; }
  .toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .toggle input { cursor: pointer; }

  .palette-strip {
    display: flex;
    gap: 2px;
    align-items: center;
    flex-wrap: wrap;
    max-width: 400px;
  }
  .pal-swatch {
    width: 20px; height: 20px;
    border-radius: 3px;
    border: 1px solid rgba(255,255,255,0.1);
    cursor: pointer;
    position: relative;
  }
  .pal-swatch:hover::after {
    content: attr(data-tip);
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a202c;
    color: #e2e8f0;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    z-index: 200;
    pointer-events: none;
  }

  main { padding: 20px 24px; }
  .region-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .region-title { font-size: 13px; font-weight: 600; color: #63b3ed; font-family: monospace; }
  .region-meta  { font-size: 11px; color: #718096; }
  .tile-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-bottom: 24px;
    background: #0a0c12;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid #1a1f2e;
    max-height: 600px;
    overflow-y: auto;
  }
  canvas.tile {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    cursor: pointer;
    border: 1px solid transparent;
    border-radius: 2px;
    transition: border-color 0.1s;
  }
  canvas.tile:hover { border-color: #63b3ed; }
  canvas.tile.selected { border-color: #f6ad55 !important; }
  canvas.tile.dim { opacity: 0.2; }

  #preview-panel {
    position: fixed;
    right: 24px;
    bottom: 24px;
    background: #1a1f2e;
    border: 1px solid #2d3748;
    border-radius: 12px;
    padding: 16px;
    width: 220px;
    display: none;
    z-index: 200;
  }
  #preview-panel h3 { font-size: 13px; color: #a0aec0; margin-bottom: 10px; }
  #preview-canvas { image-rendering: pixelated; width: 128px; height: 128px; border: 1px solid #2d3748; border-radius: 4px; }
  #preview-info { font-size: 11px; color: #718096; margin-top: 8px; font-family: monospace; }

  .stats-bar {
    background: #161b27;
    border: 1px solid #2d3748;
    border-radius: 8px;
    padding: 10px 16px;
    margin-bottom: 20px;
    display: flex;
    gap: 24px;
  }
  .stat { text-align: center; }
  .stat .val { font-size: 22px; font-weight: 700; color: #63b3ed; }
  .stat .key { font-size: 11px; color: #718096; text-transform: uppercase; letter-spacing: 0.05em; }

  #bpp-tabs { display: flex; gap: 0; margin-bottom: 4px; }
  .tab-btn {
    background: #1e2535;
    color: #718096;
    border: 1px solid #2d3748;
    padding: 4px 14px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
  }
  .tab-btn:first-child { border-radius: 6px 0 0 6px; }
  .tab-btn:last-child  { border-radius: 0 6px 6px 0; border-left: none; }
  .tab-btn.active { background: #2b6cb0; color: white; border-color: #2b6cb0; }

  #region-select { min-width: 380px; }
  .scroll-x { overflow-x: auto; }
</style>
</head>
<body>

<header>
  <h1>🕹️ The Jungle Book — Sprite &amp; Tile Viewer</h1>
  <span class="badge" id="stat-regions">? regions</span>
  <span class="badge" id="stat-tiles">? tiles</span>
  <span class="badge" id="stat-pals">? palettes</span>
</header>

<div class="controls">
  <div class="ctrl-group">
    <label>Region</label>
    <select id="region-select" onchange="loadRegion()"></select>
  </div>
  <div class="ctrl-group">
    <label>Palette</label>
    <select id="palette-select" onchange="renderTiles()"></select>
  </div>
  <div class="ctrl-group">
    <label>Zoom</label>
    <input type="range" id="zoom" min="1" max="8" value="3" oninput="onZoom(this.value)">
    <span id="zoom-label">3×</span>
  </div>
  <div id="bpp-tabs">
    <button class="tab-btn active" id="btn-4bpp" onclick="setBpp(4)">4bpp</button>
    <button class="tab-btn" id="btn-2bpp" onclick="setBpp(2)">2bpp</button>
  </div>
  <label class="toggle">
    <input type="checkbox" id="show-blank" onchange="renderTiles()"> Show blank tiles
  </label>
  <button class="btn secondary" onclick="exportPng()">Export PNG sheet</button>
</div>

<main>
  <div class="stats-bar">
    <div class="stat"><div class="val" id="sv-regions">0</div><div class="key">Graphics Regions</div></div>
    <div class="stat"><div class="val" id="sv-tiles">0</div><div class="key">Total Tiles</div></div>
    <div class="stat"><div class="val" id="sv-pals">0</div><div class="key">Palettes</div></div>
    <div class="stat"><div class="val" id="sv-interesting">0</div><div class="key">Interesting Tiles</div></div>
  </div>

  <div class="palette-strip" id="pal-strip"></div>
  <br>

  <div class="region-header">
    <span class="region-title" id="region-label">Select a region above</span>
    <span class="region-meta" id="region-meta"></span>
  </div>
  <div class="tile-grid" id="tile-grid"></div>
</main>

<div id="preview-panel">
  <h3>Selected Tile</h3>
  <canvas id="preview-canvas" width="16" height="16"></canvas>
  <div id="preview-info"></div>
</div>

<script>
// ─── Data (injected by Node) ──────────────────────────────────────────────────
const REGIONS  = ${regionsJson};
const PALETTES = ${palettesJson};

// ─── State ────────────────────────────────────────────────────────────────────
let currentRegion   = 0;
let currentPalette  = 0;
let currentZoom     = 3;
let currentBpp      = 4;
let selectedTileIdx = -1;

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  // Populate region select
  const rSel = document.getElementById('region-select');
  REGIONS.forEach((r, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    const tiles = currentBpp === 4 ? r.tiles4 : r.tiles2;
    const interesting = tiles.filter(t => t.ok).length;
    opt.textContent = \`[\${i}] \${r.label} — \${r.tiles4.length}t (4bpp) / \${r.tiles2.length}t (2bpp)\`;
    rSel.appendChild(opt);
  });

  // Populate palette select
  const pSel = document.getElementById('palette-select');
  PALETTES.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = \`[\${i}] \${p.label}\`;
    pSel.appendChild(opt);
  });

  // Update stats
  const totalTiles4 = REGIONS.reduce((s,r) => s + r.tiles4.length, 0);
  const totalTiles2 = REGIONS.reduce((s,r) => s + r.tiles2.length, 0);
  const interesting  = REGIONS.reduce((s,r) => s + r.tiles4.filter(t=>t.ok).length, 0);
  document.getElementById('stat-regions').textContent  = REGIONS.length + ' regions';
  document.getElementById('stat-tiles').textContent    = totalTiles4 + ' tiles';
  document.getElementById('stat-pals').textContent     = PALETTES.length + ' palettes';
  document.getElementById('sv-regions').textContent    = REGIONS.length;
  document.getElementById('sv-tiles').textContent      = totalTiles4;
  document.getElementById('sv-pals').textContent       = PALETTES.length;
  document.getElementById('sv-interesting').textContent = interesting;

  loadRegion();
}

function loadRegion() {
  currentRegion   = parseInt(document.getElementById('region-select').value);
  selectedTileIdx = -1;
  document.getElementById('preview-panel').style.display = 'none';
  renderTiles();
}

// ─── Decode base64 tile pixels ────────────────────────────────────────────────
function decodeTilePx(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ─── Get current palette colors as [[r,g,b], ...] ────────────────────────────
function getCurrentPalette() {
  return PALETTES[currentPalette].colors;
}

// ─── Render one tile to a canvas ─────────────────────────────────────────────
function renderTileToCtx(ctx, px, palette, scale, ox, oy) {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const ci = px[y * 8 + x];
      const c  = palette[ci] || [0, 0, 0];
      if (ci === 0) {
        ctx.clearRect(ox + x * scale, oy + y * scale, scale, scale);
      } else {
        ctx.fillStyle = \`rgb(\${c[0]},\${c[1]},\${c[2]})\`;
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
  }
}

// ─── Render tile grid ─────────────────────────────────────────────────────────
function renderTiles() {
  currentPalette = parseInt(document.getElementById('palette-select').value);
  const showBlank = document.getElementById('show-blank').checked;
  const r = REGIONS[currentRegion];
  const tiles = currentBpp === 4 ? r.tiles4 : r.tiles2;
  const pal   = getCurrentPalette();
  const sz    = currentZoom * 8;

  document.getElementById('region-label').textContent = r.label;
  const bppLabel = currentBpp;
  document.getElementById('region-meta').textContent =
    r.byteCount + ' bytes \u2022 ' + tiles.length + ' tiles (' + bppLabel + 'bpp) \u2022 ' + tiles.filter(t=>t.ok).length + ' interesting';

  // Render palette strip
  const strip = document.getElementById('pal-strip');
  strip.innerHTML = '';
  pal.forEach((c, i) => {
    const s = document.createElement('div');
    s.className = 'pal-swatch';
    s.style.background = \`rgb(\${c[0]},\${c[1]},\${c[2]})\`;
    s.title = \`#\${i}: rgb(\${c[0]},\${c[1]},\${c[2]})\`;
    s.dataset.tip = \`#\${i} rgb(\${c[0]},\${c[1]},\${c[2]})\`;
    strip.appendChild(s);
  });

  const grid = document.getElementById('tile-grid');
  grid.innerHTML = '';

  tiles.forEach((tile, idx) => {
    if (!showBlank && !tile.ok) return;
    const px = decodeTilePx(tile.px);
    const c  = document.createElement('canvas');
    c.width  = 8;
    c.height = 8;
    c.style.width  = sz + 'px';
    c.style.height = sz + 'px';
    c.className = 'tile' + (!tile.ok ? ' dim' : '');
    c.title = \`Tile #\${idx}\`;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 8, 8);
    renderTileToCtx(ctx, px, pal, 1, 0, 0);
    c.addEventListener('click', () => selectTile(idx, px, c));
    if (idx === selectedTileIdx) c.classList.add('selected');
    grid.appendChild(c);
  });
}

function selectTile(idx, px, canvasEl) {
  document.querySelectorAll('canvas.tile.selected').forEach(c => c.classList.remove('selected'));
  canvasEl.classList.add('selected');
  selectedTileIdx = idx;

  const panel = document.getElementById('preview-panel');
  panel.style.display = 'block';

  const pc = document.getElementById('preview-canvas');
  pc.width = 16; pc.height = 16;
  pc.style.width  = '128px';
  pc.style.height = '128px';
  const ctx = pc.getContext('2d');
  ctx.clearRect(0, 0, 16, 16);
  // Draw 2×2 of the same tile to preview at large size
  const pal = getCurrentPalette();
  renderTileToCtx(ctx, px, pal, 1, 0, 0);
  renderTileToCtx(ctx, px, pal, 1, 8, 0);
  renderTileToCtx(ctx, px, pal, 1, 0, 8);
  renderTileToCtx(ctx, px, pal, 1, 8, 8);

  const nonZero = Array.from(px).filter(v => v !== 0).length;
  document.getElementById('preview-info').textContent =
    \`Tile #\${idx}\\nRegion: \${REGIONS[currentRegion].label}\\nNon-transparent: \${nonZero}/64 px\`;
}

function onZoom(v) {
  currentZoom = parseInt(v);
  document.getElementById('zoom-label').textContent = v + '×';
  renderTiles();
}

function setBpp(bpp) {
  currentBpp = bpp;
  document.getElementById('btn-4bpp').className = 'tab-btn' + (bpp === 4 ? ' active' : '');
  document.getElementById('btn-2bpp').className = 'tab-btn' + (bpp === 2 ? ' active' : '');
  renderTiles();
}

function exportPng() {
  const r    = REGIONS[currentRegion];
  const tiles = currentBpp === 4 ? r.tiles4 : r.tiles2;
  const pal  = getCurrentPalette();
  const showBlank = document.getElementById('show-blank').checked;
  const visibleTiles = showBlank ? tiles : tiles.filter(t => t.ok);
  if (!visibleTiles.length) { alert('No tiles to export'); return; }

  const cols = 16;
  const rows = Math.ceil(visibleTiles.length / cols);
  const sc   = 2;
  const off  = 1; // 1px gap

  const out = document.createElement('canvas');
  out.width  = cols * (8 * sc + off);
  out.height = rows * (8 * sc + off);
  const ctx  = out.getContext('2d');
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, out.width, out.height);

  visibleTiles.forEach((tile, i) => {
    const px = decodeTilePx(tile.px);
    const col = i % cols, row = Math.floor(i / cols);
    renderTileToCtx(ctx, px, pal, sc, col * (8*sc+off), row * (8*sc+off));
  });

  const link = document.createElement('a');
  link.download = \`sprites_region\${currentRegion}_\${currentBpp}bpp.png\`;
  link.href = out.toDataURL('image/png');
  link.click();
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'sprites.html'), html);
process.stderr.write('[output] sprites.html written!\n');
process.stderr.write('         Open it in your browser: open sprites.html\n');
