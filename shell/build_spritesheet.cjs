/**
 * SNES Full-Color Sprite Sheet Generator
 * ─────────────────────────────────────────
 * Usage:  node build_spritesheet.cjs
 * Output: spritesheet.html  (open in browser)
 *
 * Fixes:
 *  1. COLOR  — uses real CGRAM palette captured from the running emulator
 *  2. SPRITES — assembles individual 8×8 tiles into complete character sprites
 *               using configurable N×M grid groupings (16×16, 32×32 etc.)
 *
 * SNES sprite facts:
 *  - Sprites = OBJ use palettes 8-15 (the upper 8 of 16 CGRAM palettes)
 *  - BG tiles use palettes 0-7
 *  - OBJ tiles are 4bpp, stored consecutively in VRAM
 *  - A "large" sprite (common for player chars) = 16×16px = 2×2 tiles
 *  - A "huge" sprite (boss) = 32×32px = 4×4 tiles
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Load ROM ────────────────────────────────────────────────────────────────
const romPath  = path.join(__dirname, 'public', 'sample.sfc');
const fileData = new Uint8Array(fs.readFileSync(romPath));

// Strip SMC header if present
function hasValidLoRom(data, off) {
  if (data.length < off + 0x8000) return false;
  const cs = data[off + 0x7FDE] | (data[off + 0x7FDF] << 8);
  const cc = data[off + 0x7FDC] | (data[off + 0x7FDD] << 8);
  return (cs + cc) === 0xFFFF;
}
const rom = (fileData.length > 512 && hasValidLoRom(fileData, 512))
  ? fileData.slice(512) : fileData;

process.stderr.write(`[info] ROM: ${(rom.length/1024).toFixed(0)} KB\n`);

// ─── Load real CGRAM from captured palette data ──────────────────────────────
const palDataPath = path.join(__dirname, 'palette_data.json');
if (!fs.existsSync(palDataPath)) {
  console.error('ERROR: palette_data.json not found. Run: npx tsx capture_palette.ts first!');
  process.exit(1);
}
const palData = JSON.parse(fs.readFileSync(palDataPath, 'utf8'));
const realPalettes = palData.palettes; // [{index, label, colors[[r,g,b]]}]
process.stderr.write(`[info] Loaded ${realPalettes.length} real CGRAM palettes\n`);

// ─── Tile decoder ─────────────────────────────────────────────────────────────
function decodeTile4bpp(data, offset) {
  const px = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const b0 = data[offset + y * 2];
    const b1 = data[offset + y * 2 + 1];
    const b2 = data[offset + 16 + y * 2];
    const b3 = data[offset + 16 + y * 2 + 1];
    for (let x = 0; x < 8; x++) {
      const sh = 7 - x;
      px[y * 8 + x] =
        ((b0 >> sh) & 1) |
        (((b1 >> sh) & 1) << 1) |
        (((b2 >> sh) & 1) << 2) |
        (((b3 >> sh) & 1) << 3);
    }
  }
  return px;
}

function isTileInteresting(px) {
  let nonZero = 0;
  for (const v of px) if (v !== 0) nonZero++;
  return nonZero >= 4;
}

// ─── Scan ROM for tile graphics regions ──────────────────────────────────────
// Heuristic: find contiguous runs of interesting 4bpp tiles
function scanGraphicsRegions() {
  const regions = [];
  for (let bank = 0x80; bank <= 0xFF; bank++) {
    const bankOff = (bank & 0x7F) * 0x8000;
    if (bankOff >= rom.length) break;

    let runStart = -1, runCount = 0;
    for (let addr = 0x8000; addr < 0x10000; addr += 32) {
      const off = bankOff + (addr - 0x8000);
      if (off + 32 > rom.length) break;
      const px = decodeTile4bpp(rom, off);
      if (isTileInteresting(px)) {
        if (runStart < 0) { runStart = off; runCount = 0; }
        runCount++;
      } else {
        if (runStart >= 0 && runCount >= 8) {
          regions.push({ romOffset: runStart, tileCount: runCount,
            bank, addrStart: 0x8000 + (runStart - bankOff) });
        }
        runStart = -1; runCount = 0;
      }
    }
    if (runStart >= 0 && runCount >= 8) {
      regions.push({ romOffset: runStart, tileCount: runCount,
        bank, addrStart: 0x8000 + (runStart - bankOff) });
    }
  }
  return regions;
}

process.stderr.write('[step1] Scanning graphics regions...\n');
const regions = scanGraphicsRegions();
process.stderr.write(`        Found ${regions.length} regions\n`);

// ─── Build sprite sheet data ─────────────────────────────────────────────────
// For each region, decode ALL tiles and store pixel data
// This gives us flat tiles we can assemble in the viewer

function encodeRegion(r) {
  const tiles = [];
  for (let i = 0; i < r.tileCount; i++) {
    const px = decodeTile4bpp(rom, r.romOffset + i * 32);
    tiles.push(Buffer.from(px).toString('base64'));
  }
  const hexBank = r.bank.toString(16).padStart(2, '0').toUpperCase();
  const hexAddr = r.addrStart.toString(16).padStart(4, '0').toUpperCase();
  return {
    label: `$${hexBank}:${hexAddr}`,
    tileCount: r.tileCount,
    tiles
  };
}

process.stderr.write('[step2] Encoding tile data...\n');
const encodedRegions = regions.map(encodeRegion);
process.stderr.write(`        ${encodedRegions.reduce((s,r) => s+r.tileCount, 0)} total tiles\n`);

// ─── Serialize data ───────────────────────────────────────────────────────────
const regionsJson  = JSON.stringify(encodedRegions);
const palettesJson = JSON.stringify(realPalettes);

// ─── Generate HTML ────────────────────────────────────────────────────────────
process.stderr.write('[step3] Generating spritesheet.html...\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Jungle Book — Full Color Sprite Sheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #070910;
  --surface: #0e1117;
  --surface2: #161b27;
  --border: #1e2d40;
  --accent: #3b82f6;
  --accent2: #8b5cf6;
  --text: #e2e8f0;
  --muted: #64748b;
  --green: #10b981;
  --orange: #f59e0b;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; min-height: 100vh; }

/* ── Header ── */
header {
  background: linear-gradient(135deg, #0e1117 0%, #111827 50%, #0f172a 100%);
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 16px;
  position: sticky; top: 0; z-index: 100;
  backdrop-filter: blur(12px);
}
header h1 { font-size: 16px; font-weight: 700; color: var(--accent); letter-spacing: -0.01em; white-space: nowrap; }
.badge {
  background: rgba(59,130,246,0.12);
  border: 1px solid rgba(59,130,246,0.25);
  color: var(--accent);
  padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
}
.badge.purple { background: rgba(139,92,246,0.12); border-color: rgba(139,92,246,0.25); color: var(--accent2); }
.badge.green  { background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.25); color: var(--green); }

/* ── Control bar ── */
.controls {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 10px 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  position: sticky; top: 56px; z-index: 99;
}
.ctrl { display: flex; align-items: center; gap: 8px; }
.ctrl label { color: var(--muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap; }
select, input[type=range] {
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  font-family: 'Inter', sans-serif;
  cursor: pointer;
  outline: none;
}
select:focus { border-color: var(--accent); }
select { min-width: 200px; }
.zoom-val { font-size: 12px; color: var(--muted); min-width: 28px; }
.divider { width: 1px; height: 24px; background: var(--border); }

/* ── Sprite size buttons ── */
.size-group { display: flex; gap: 0; }
.size-btn {
  background: var(--surface2);
  color: var(--muted);
  border: 1px solid var(--border);
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.size-btn:first-child { border-radius: 6px 0 0 6px; }
.size-btn:last-child  { border-radius: 0 6px 6px 0; border-left: none; }
.size-btn:not(:first-child):not(:last-child) { border-left: none; }
.size-btn.active { background: rgba(59,130,246,0.2); color: var(--accent); border-color: rgba(59,130,246,0.4); }
.size-btn:hover:not(.active) { background: rgba(255,255,255,0.05); color: var(--text); }

.export-btn {
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  color: white;
  border: none;
  border-radius: 6px;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  font-family: 'Inter', sans-serif;
}
.export-btn:hover { opacity: 0.85; }

/* ── Palette display ── */
.pal-section {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 8px 24px;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.pal-label { font-size: 10px; color: var(--muted); font-weight: 600; text-transform: uppercase; margin-right: 4px; }
.pal-group { display: flex; gap: 1px; position: relative; }
.pal-group-label {
  position: absolute; bottom: 26px; left: 0;
  font-size: 9px; color: var(--muted); font-weight: 600;
  background: var(--surface); padding: 1px 4px; border-radius: 3px;
  pointer-events: none; white-space: nowrap;
}
.swatch {
  width: 16px; height: 16px;
  border-radius: 2px;
  cursor: pointer;
  border: 1px solid rgba(0,0,0,0.3);
  transition: transform 0.1s;
  position: relative;
}
.swatch:hover { transform: scale(1.4); z-index: 10; }
.swatch.highlight { outline: 2px solid var(--accent); outline-offset: 1px; }

/* ── Main grid area ── */
main { padding: 20px 24px; }

.region-info {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 12px;
}
.region-addr { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 500; color: var(--accent); }
.region-meta { font-size: 11px; color: var(--muted); }
.sprite-count { font-size: 11px; color: var(--green); font-weight: 600; }

/* ── Sprite grid ── */
#sprite-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  background: #050607;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  min-height: 100px;
  max-height: 70vh;
  overflow-y: auto;
}
#sprite-grid::-webkit-scrollbar { width: 6px; }
#sprite-grid::-webkit-scrollbar-track { background: transparent; }
#sprite-grid::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

.sprite-cell {
  display: inline-block;
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: 3px;
  transition: border-color 0.12s, transform 0.12s;
  position: relative;
}
.sprite-cell:hover { border-color: var(--accent); transform: scale(1.05); z-index: 5; }
.sprite-cell.selected { border-color: var(--orange) !important; }
.sprite-cell canvas { display: block; image-rendering: pixelated; image-rendering: crisp-edges; }
.sprite-cell .frame-num {
  position: absolute; bottom: -14px; left: 50%; transform: translateX(-50%);
  font-size: 8px; color: var(--muted); white-space: nowrap;
}

/* ── Preview panel ── */
#preview {
  position: fixed; right: 20px; bottom: 20px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  width: 240px;
  display: none;
  z-index: 200;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
}
#preview h4 { font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; margin-bottom: 10px; }
#preview-canvas { image-rendering: pixelated; border: 1px solid var(--border); border-radius: 6px; width: 192px; height: auto; display: block; }
#preview-info { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); margin-top: 8px; line-height: 1.5; }
.close-preview {
  position: absolute; top: 8px; right: 8px;
  background: none; border: none; color: var(--muted);
  font-size: 16px; cursor: pointer; padding: 2px 6px;
}
.close-preview:hover { color: var(--text); }

/* ── Animation strip ── */
.anim-strip {
  display: flex; gap: 2px; overflow-x: auto;
  padding-bottom: 4px;
  margin-top: 8px;
}
.anim-strip canvas { image-rendering: pixelated; border: 1px solid var(--border); border-radius: 2px; cursor: pointer; }

/* ── Stats bar ── */
.stats-row {
  display: flex; gap: 20px; margin-bottom: 16px;
}
.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 16px;
  text-align: center;
}
.stat-card .val { font-size: 20px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
.stat-card .key { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }

/* ── View mode tabs ── */
.view-tabs { display: flex; gap: 0; }
.view-tab {
  background: var(--surface2);
  color: var(--muted);
  border: 1px solid var(--border);
  padding: 5px 14px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  font-family: 'Inter', sans-serif;
}
.view-tab:first-child { border-radius: 6px 0 0 6px; }
.view-tab:last-child  { border-radius: 0 6px 6px 0; border-left: none; }
.view-tab:not(:first-child) { border-left: none; }
.view-tab.active { background: rgba(59,130,246,0.15); color: var(--accent); border-color: rgba(59,130,246,0.4); }
</style>
</head>
<body>

<header>
  <h1>🕹️ The Jungle Book — Full Color Sprite Sheet</h1>
  <span class="badge" id="hdr-regions">…</span>
  <span class="badge purple" id="hdr-tiles">…</span>
  <span class="badge green" id="hdr-sprites">…</span>
</header>

<div class="controls">
  <div class="ctrl">
    <label>Region</label>
    <select id="region-sel" onchange="onRegionChange()"></select>
  </div>
  <div class="ctrl">
    <label>Palette</label>
    <select id="pal-sel" onchange="render()"></select>
  </div>
  <div class="divider"></div>
  <div class="ctrl">
    <label>Sprite Size</label>
    <div class="size-group">
      <button class="size-btn" onclick="setSize(1,1)">8×8</button>
      <button class="size-btn active" id="btn-2x2" onclick="setSize(2,2)">16×16</button>
      <button class="size-btn" onclick="setSize(2,4)">16×32</button>
      <button class="size-btn" onclick="setSize(4,4)">32×32</button>
      <button class="size-btn" onclick="setSize(4,8)">32×64</button>
    </div>
  </div>
  <div class="ctrl">
    <label>Zoom</label>
    <input type="range" id="zoom" min="1" max="8" value="3" oninput="onZoom(this.value)">
    <span class="zoom-val" id="zoom-lbl">3×</span>
  </div>
  <div class="divider"></div>
  <div class="ctrl">
    <label>View</label>
    <div class="view-tabs">
      <button class="view-tab active" onclick="setView('sprites')">Sprites</button>
      <button class="view-tab" onclick="setView('tiles')">Tiles</button>
    </div>
  </div>
  <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer">
    <input type="checkbox" id="show-blank" onchange="render()"> Show blank
  </label>
  <button class="export-btn" onclick="exportSheet()">⬇ Export PNG</button>
</div>

<!-- Real palette display -->
<div class="pal-section" id="pal-display"></div>

<main>
  <div class="stats-row">
    <div class="stat-card"><div class="val" id="sv-regions">0</div><div class="key">Regions</div></div>
    <div class="stat-card"><div class="val" id="sv-tiles">0</div><div class="key">Total Tiles</div></div>
    <div class="stat-card"><div class="val" id="sv-sprites">0</div><div class="key">Assembled Sprites</div></div>
    <div class="stat-card"><div class="val" id="sv-palettes">0</div><div class="key">Real Palettes</div></div>
  </div>

  <div class="region-info">
    <span class="region-addr" id="region-addr">—</span>
    <span class="region-meta" id="region-meta">—</span>
    <span class="sprite-count" id="sprite-count"></span>
  </div>

  <div id="sprite-grid"></div>
</main>

<div id="preview">
  <button class="close-preview" onclick="closePreview()">✕</button>
  <h4>Sprite Preview</h4>
  <canvas id="preview-canvas"></canvas>
  <div class="anim-strip" id="anim-strip"></div>
  <div id="preview-info"></div>
</div>

<script>
// ─── Injected data ────────────────────────────────────────────────────────────
const REGIONS  = ${regionsJson};
const PALETTES = ${palettesJson};

// ─── State ────────────────────────────────────────────────────────────────────
let curRegion  = 0;
let curPal     = 11;  // Default: OBJ palette 11 (full color)
let curZoom    = 3;
let curCols    = 2;   // sprite width in tiles
let curRows    = 2;   // sprite height in tiles
let viewMode   = 'sprites';
let selSprite  = -1;

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  // Region select
  const rSel = document.getElementById('region-sel');
  REGIONS.forEach((r, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = '[' + i + '] ' + r.label + ' — ' + r.tileCount + ' tiles';
    rSel.appendChild(opt);
  });

  // Palette select (show all 16, highlight OBJ ones)
  const pSel = document.getElementById('pal-sel');
  PALETTES.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    const type = i >= 8 ? '★OBJ' : 'BG ';
    const nonBlack = p.colors.filter(c => c[0]+c[1]+c[2] > 20).length;
    opt.textContent = type + ' Pal ' + i + ' — ' + nonBlack + '/16 colors';
    if (i === curPal) opt.selected = true;
    pSel.appendChild(opt);
  });

  // Stats
  const totalTiles = REGIONS.reduce((s, r) => s + r.tileCount, 0);
  document.getElementById('hdr-regions').textContent = REGIONS.length + ' regions';
  document.getElementById('hdr-tiles').textContent = totalTiles.toLocaleString() + ' tiles';
  document.getElementById('sv-regions').textContent = REGIONS.length;
  document.getElementById('sv-tiles').textContent = totalTiles.toLocaleString();
  document.getElementById('sv-palettes').textContent = PALETTES.length;

  renderPalDisplay();
  updateRegionInfo();
  render();
}

// ─── Palette display bar ──────────────────────────────────────────────────────
function renderPalDisplay() {
  const div = document.getElementById('pal-display');
  div.innerHTML = '<span class="pal-label">CGRAM</span>';
  PALETTES.forEach((p, pi) => {
    const grp = document.createElement('div');
    grp.className = 'pal-group';
    grp.style.position = 'relative';
    grp.style.marginRight = '6px';
    const lbl = document.createElement('div');
    lbl.className = 'pal-group-label';
    lbl.textContent = (pi >= 8 ? '★' : '') + pi;
    grp.appendChild(lbl);
    p.colors.forEach((c, ci) => {
      const s = document.createElement('div');
      s.className = 'swatch' + (pi === curPal ? ' highlight' : '');
      s.style.background = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      s.title = 'Pal ' + pi + ' color ' + ci + ': rgb(' + c.join(',') + ')';
      s.addEventListener('click', () => {
        curPal = pi;
        document.getElementById('pal-sel').value = pi;
        renderPalDisplay();
        render();
      });
      grp.appendChild(s);
    });
    div.appendChild(grp);
  });
}

// ─── Decode base64 tile pixels ────────────────────────────────────────────────
const tileCache = new Map();
function getTilePx(regionIdx, tileIdx) {
  const k = regionIdx + ':' + tileIdx;
  if (tileCache.has(k)) return tileCache.get(k);
  const b64 = REGIONS[regionIdx].tiles[tileIdx];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  tileCache.set(k, arr);
  return arr;
}

// ─── Render 8×8 tile into ImageData ──────────────────────────────────────────
function renderTileToImageData(imgData, px, pal, destX, destY, fullW) {
  const data = imgData.data;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const ci = px[y * 8 + x];
      const [r, g, b] = pal.colors[ci] || [0, 0, 0];
      const dstOff = ((destY + y) * fullW + (destX + x)) * 4;
      if (ci === 0) {
        data[dstOff] = 0; data[dstOff+1] = 0;
        data[dstOff+2] = 0; data[dstOff+3] = 0; // transparent
      } else {
        data[dstOff] = r; data[dstOff+1] = g;
        data[dstOff+2] = b; data[dstOff+3] = 255;
      }
    }
  }
}

// ─── Check if a sprite (set of tiles) is interesting ─────────────────────────
function isSpriteInteresting(regionIdx, startTile, tCols, tRows) {
  let nonZero = 0;
  for (let r = 0; r < tRows; r++) {
    for (let c = 0; c < tCols; c++) {
      const ti = startTile + r * tCols + c;
      if (ti >= REGIONS[regionIdx].tileCount) continue;
      const px = getTilePx(regionIdx, ti);
      for (const v of px) if (v !== 0) nonZero++;
    }
  }
  return nonZero >= 8;
}

// ─── Render assembled sprite onto canvas ─────────────────────────────────────
function renderSprite(canvas, regionIdx, startTile, tCols, tRows, zoom) {
  const sprW = tCols * 8;
  const sprH = tRows * 8;
  canvas.width  = sprW;
  canvas.height = sprH;
  canvas.style.width  = (sprW * zoom) + 'px';
  canvas.style.height = (sprH * zoom) + 'px';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, sprW, sprH);
  const imgData = ctx.createImageData(sprW, sprH);
  const pal = PALETTES[curPal];

  for (let row = 0; row < tRows; row++) {
    for (let col = 0; col < tCols; col++) {
      const ti = startTile + row * tCols + col;
      if (ti >= REGIONS[regionIdx].tileCount) continue;
      const px = getTilePx(regionIdx, ti);
      renderTileToImageData(imgData, px, pal, col * 8, row * 8, sprW);
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// ─── Update region info bar ───────────────────────────────────────────────────
function updateRegionInfo() {
  const r = REGIONS[curRegion];
  const tpc = curCols * curRows;
  const sprCount = Math.floor(r.tileCount / tpc);
  document.getElementById('region-addr').textContent = r.label;
  document.getElementById('region-meta').textContent =
    r.tileCount + ' tiles • grid ' + curCols + '×' + curRows + ' (' + (curCols*8) + '×' + (curRows*8) + 'px)';
  document.getElementById('sprite-count').textContent = '≈ ' + sprCount + ' sprites';
  document.getElementById('sv-sprites').textContent = sprCount;
  document.getElementById('hdr-sprites').textContent = sprCount + ' sprites';
}

// ─── Main render ──────────────────────────────────────────────────────────────
function render() {
  curPal = parseInt(document.getElementById('pal-sel').value);
  const showBlank = document.getElementById('show-blank').checked;
  const r = REGIONS[curRegion];
  const tpc = curCols * curRows; // tiles per sprite
  const zoom = curZoom;
  const grid = document.getElementById('sprite-grid');
  grid.innerHTML = '';
  selSprite = -1;

  updateRegionInfo();

  if (viewMode === 'sprites') {
    // Group tiles into sprites
    let sprIdx = 0;
    for (let startTile = 0; startTile + tpc <= r.tileCount; startTile += tpc) {
      if (!showBlank && !isSpriteInteresting(curRegion, startTile, curCols, curRows)) {
        sprIdx++;
        continue;
      }
      const cell = document.createElement('div');
      cell.className = 'sprite-cell';
      cell.dataset.sprite = sprIdx;
      cell.dataset.start = startTile;

      const c = document.createElement('canvas');
      renderSprite(c, curRegion, startTile, curCols, curRows, zoom);
      cell.appendChild(c);

      const lbl = document.createElement('div');
      lbl.className = 'frame-num';
      lbl.textContent = '#' + sprIdx;
      cell.appendChild(lbl);

      const si = sprIdx;
      const st = startTile;
      cell.addEventListener('click', () => selectSprite(si, st));
      if (si === selSprite) cell.classList.add('selected');

      grid.appendChild(cell);
      sprIdx++;
    }
  } else {
    // Tile view: show individual 8×8 tiles
    r.tiles.forEach((_, ti) => {
      const px = getTilePx(curRegion, ti);
      const nonZero = Array.from(px).filter(v => v !== 0).length;
      if (!showBlank && nonZero < 4) return;

      const c = document.createElement('canvas');
      const sz = 8;
      c.width = sz; c.height = sz;
      c.style.width = (sz * zoom) + 'px';
      c.style.height = (sz * zoom) + 'px';
      c.style.imageRendering = 'pixelated';

      const ctx = c.getContext('2d');
      const imgData = ctx.createImageData(sz, sz);
      const pal = PALETTES[curPal];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const ci = px[y * 8 + x];
        const [r2,g,b] = pal.colors[ci] || [0,0,0];
        const o = (y * 8 + x) * 4;
        imgData.data[o] = r2; imgData.data[o+1] = g; imgData.data[o+2] = b;
        imgData.data[o+3] = ci === 0 ? 0 : 255;
      }
      ctx.putImageData(imgData, 0, 0);

      const cell = document.createElement('div');
      cell.className = 'sprite-cell';
      cell.style.marginBottom = '14px';
      cell.appendChild(c);
      grid.appendChild(cell);
    });
  }
}

// ─── Sprite selection + preview ───────────────────────────────────────────────
function selectSprite(sprIdx, startTile) {
  document.querySelectorAll('.sprite-cell.selected').forEach(el => el.classList.remove('selected'));
  const cell = document.querySelector('[data-sprite="' + sprIdx + '"]');
  if (cell) cell.classList.add('selected');
  selSprite = sprIdx;

  const panel = document.getElementById('preview');
  panel.style.display = 'block';

  // Big preview (4× zoom)
  const pc = document.getElementById('preview-canvas');
  renderSprite(pc, curRegion, startTile, curCols, curRows, 4);

  // Animation strip: show ±4 sprites
  const strip = document.getElementById('anim-strip');
  strip.innerHTML = '';
  const r = REGIONS[curRegion];
  const tpc = curCols * curRows;
  const total = Math.floor(r.tileCount / tpc);
  const from = Math.max(0, sprIdx - 4);
  const to   = Math.min(total - 1, sprIdx + 4);
  for (let i = from; i <= to; i++) {
    const st = i * tpc;
    const fc = document.createElement('canvas');
    fc.style.imageRendering = 'pixelated';
    renderSprite(fc, curRegion, st, curCols, curRows, 2);
    if (i === sprIdx) fc.style.outline = '2px solid var(--orange)';
    fc.title = 'Frame ' + i;
    fc.addEventListener('click', () => selectSprite(i, st));
    strip.appendChild(fc);
  }

  // Info
  const nonZeroPx = [];
  for (let r = 0; r < curRows; r++) for (let c = 0; c < curCols; c++) {
    const ti = startTile + r * curCols + c;
    if (ti < REGIONS[curRegion].tileCount) {
      const px = getTilePx(curRegion, ti);
      nonZeroPx.push(Array.from(px).filter(v => v !== 0).length);
    }
  }
  document.getElementById('preview-info').textContent =
    'Sprite #' + sprIdx + '\\n' +
    'Region: ' + REGIONS[curRegion].label + '\\n' +
    'Tiles ' + startTile + '-' + (startTile + curCols * curRows - 1) + '\\n' +
    'Size: ' + (curCols*8) + 'x' + (curRows*8) + 'px\\n' +
    'Palette: ' + PALETTES[curPal].label + '\\n' +
    'Opaque px: ' + nonZeroPx.join(', ');
}

function closePreview() {
  document.getElementById('preview').style.display = 'none';
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function onRegionChange() {
  curRegion = parseInt(document.getElementById('region-sel').value);
  selSprite = -1;
  render();
}

function onZoom(v) {
  curZoom = parseInt(v);
  document.getElementById('zoom-lbl').textContent = v + '×';
  render();
}

function setSize(cols, rows) {
  curCols = cols; curRows = rows;
  document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
  // Find and activate matching button
  document.querySelectorAll('.size-btn').forEach(b => {
    const txt = b.textContent;
    const px = (cols * 8) + '×' + (rows * 8);
    if (txt === px) b.classList.add('active');
  });
  render();
}

function setView(mode) {
  viewMode = mode;
  document.querySelectorAll('.view-tab').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && mode === 'sprites') || (i === 1 && mode === 'tiles'));
  });
  render();
}

// ─── Export PNG sheet ─────────────────────────────────────────────────────────
function exportSheet() {
  const r = REGIONS[curRegion];
  const tpc = curCols * curRows;
  const total = Math.floor(r.tileCount / tpc);
  const showBlank = document.getElementById('show-blank').checked;

  const perRow = 8;
  const scale  = 3;
  const sprW   = curCols * 8 * scale;
  const sprH   = curRows * 8 * scale;
  const gap    = 2;
  const rows   = Math.ceil(total / perRow);

  const out = document.createElement('canvas');
  out.width  = perRow * (sprW + gap);
  out.height = rows  * (sprH + gap + 12);
  const octx = out.getContext('2d');
  octx.fillStyle = '#0a0a12';
  octx.fillRect(0, 0, out.width, out.height);
  octx.font = '9px monospace';
  octx.fillStyle = '#4a5568';

  const tmp = document.createElement('canvas');
  let col = 0, row2 = 0;

  for (let i = 0; i < total; i++) {
    const st = i * tpc;
    if (!showBlank && !isSpriteInteresting(curRegion, st, curCols, curRows)) continue;
    renderSprite(tmp, curRegion, st, curCols, curRows, scale);
    const dx = col * (sprW + gap);
    const dy = row2 * (sprH + gap + 12) + 12;
    octx.drawImage(tmp, dx, dy);
    octx.fillText('#' + i, dx + 1, dy - 2);
    col++;
    if (col >= perRow) { col = 0; row2++; }
  }

  const a = document.createElement('a');
  a.download = 'spritesheet_' + r.label.replace(/[^a-z0-9]/gi,'_') + '_pal' + curPal + '.png';
  a.href = out.toDataURL('image/png');
  a.click();
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'spritesheet.html'), html);
process.stderr.write('[done] spritesheet.html written!\n');
process.stderr.write('       Open with: open spritesheet.html\n');
