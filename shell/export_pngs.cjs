/**
 * export_pngs.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates full-color PNG sprite sheets directly from the ROM.
 * No browser needed — pure Node.js PNG encoding.
 *
 * Output:
 *   sprites/region_XX_palYY_WxH.png   — one PNG per region × palette combo
 *   sprites/index.html                — gallery to browse all sheets
 *
 * Usage:  node export_pngs.cjs
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── Load ROM ────────────────────────────────────────────────────────────────
const romPath = path.join(__dirname, 'public', 'sample.sfc');
const fileData = new Uint8Array(fs.readFileSync(romPath));
function hasLoRom(d, off) {
  if (d.length < off + 0x8000) return false;
  const cs = d[off+0x7FDE]|(d[off+0x7FDF]<<8), cc = d[off+0x7FDC]|(d[off+0x7FDD]<<8);
  return (cs+cc) === 0xFFFF;
}
const rom = (fileData.length > 512 && hasLoRom(fileData, 512)) ? fileData.slice(512) : fileData;
process.stderr.write(`ROM: ${(rom.length/1024)|0} KB\n`);

// ─── Load real CGRAM palettes ─────────────────────────────────────────────────
const palData = JSON.parse(fs.readFileSync(path.join(__dirname, 'palette_data.json'), 'utf8'));
// palData.palettes[i] = { index, label, colors: [[r,g,b], ...] }

// ─── Tile decoder ─────────────────────────────────────────────────────────────
function decode4bpp(data, off) {
  const px = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const b0=data[off+y*2], b1=data[off+y*2+1], b2=data[off+16+y*2], b3=data[off+16+y*2+1];
    for (let x = 0; x < 8; x++) {
      const sh = 7 - x;
      px[y*8+x] = ((b0>>sh)&1) | (((b1>>sh)&1)<<1) | (((b2>>sh)&1)<<2) | (((b3>>sh)&1)<<3);
    }
  }
  return px;
}
function tileOk(px) {
  let n = 0; for (const v of px) if (v) n++; return n >= 8;
}

// ─── Scan graphics regions ────────────────────────────────────────────────────
function scanRegions() {
  const regions = [];
  for (let bank = 0x80; bank <= 0xFF; bank++) {
    const bankOff = (bank & 0x7F) * 0x8000;
    if (bankOff >= rom.length) break;
    let rStart = -1, rCount = 0;
    for (let addr = 0x8000; addr < 0x10000; addr += 32) {
      const off = bankOff + (addr - 0x8000);
      if (off + 32 > rom.length) break;
      if (tileOk(decode4bpp(rom, off))) {
        if (rStart < 0) { rStart = off; rCount = 0; }
        rCount++;
      } else {
        if (rStart >= 0 && rCount >= 8) {
          regions.push({ off: rStart, n: rCount, bank, addr: 0x8000 + (rStart - bankOff) });
        }
        rStart = -1; rCount = 0;
      }
    }
    if (rStart >= 0 && rCount >= 8) {
      regions.push({ off: rStart, n: rCount, bank, addr: 0x8000 + (rStart - bankOff) });
    }
  }
  return regions;
}

process.stderr.write('Scanning regions...\n');
const regions = scanRegions();
process.stderr.write(`Found ${regions.length} regions\n`);

// ─── Pure-JS PNG writer ───────────────────────────────────────────────────────
// Writes a minimal valid PNG from RGBA Uint8Array (w × h × 4 bytes)
function writePng(rgba, w, h) {
  // Filter each row with None (0x00)
  const filtered = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    filtered[y * (w*4+1)] = 0; // filter type = None
    rgba.copy(filtered, y * (w*4+1) + 1, y * w * 4, (y+1) * w * 4);
  }
  const compressed = zlib.deflateSync(filtered, { level: 6 });

  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const crc = crc32(Buffer.concat([t, data]));
    const crcBuf = Buffer.alloc(4); crcBuf.writeInt32BE(crc);
    return Buffer.concat([len, t, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB (no alpha for simplicity)
  // Actually let's do RGBA
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// CRC32 table
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let crc = -1;
  for (const b of buf) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xFF];
  return (crc ^ -1);
}

// ─── Render sprite sheet ──────────────────────────────────────────────────────
// cols × rows per sprite (in tiles), spriteScale = pixel multiplier
function renderSheet(region, pal, tCols, tRows, sprScale) {
  const { off: rOff, n: tileCount } = region;
  const tilesPer = tCols * tRows;
  const spritesPerRow = 8;
  const numSprites = Math.floor(tileCount / tilesPer);

  // Filter interesting sprites
  const interestingSprites = [];
  for (let si = 0; si < numSprites; si++) {
    const startTile = si * tilesPer;
    let nonZero = 0;
    for (let r = 0; r < tRows; r++) {
      for (let c = 0; c < tCols; c++) {
        const ti = startTile + r * tCols + c;
        if (ti >= tileCount) continue;
        const px = decode4bpp(rom, rOff + ti * 32);
        for (const v of px) if (v) nonZero++;
      }
    }
    if (nonZero >= 8) interestingSprites.push(si);
  }

  if (interestingSprites.length === 0) return null;

  const sprW = tCols * 8 * sprScale;
  const sprH = tRows * 8 * sprScale;
  const gap = 2;
  const labelH = 10;
  const sheetCols = Math.min(spritesPerRow, interestingSprites.length);
  const sheetRows = Math.ceil(interestingSprites.length / sheetCols);
  const W = sheetCols * (sprW + gap);
  const H = sheetRows * (sprH + gap + labelH);

  const rgba = Buffer.alloc(W * H * 4, 0); // start transparent

  for (let idx = 0; idx < interestingSprites.length; idx++) {
    const si = interestingSprites[idx];
    const startTile = si * tilesPer;
    const gridX = (idx % sheetCols) * (sprW + gap);
    const gridY = Math.floor(idx / sheetCols) * (sprH + gap + labelH);

    // Fill sprite background dark
    for (let py = 0; py < sprH; py++) {
      for (let px2 = 0; px2 < sprW; px2++) {
        const o = ((gridY + py) * W + (gridX + px2)) * 4;
        rgba[o] = 12; rgba[o+1] = 12; rgba[o+2] = 18; rgba[o+3] = 255; // dark bg
      }
    }

    // Render tiles
    for (let row = 0; row < tRows; row++) {
      for (let col = 0; col < tCols; col++) {
        const ti = startTile + row * tCols + col;
        if (ti >= tileCount) continue;
        const px = decode4bpp(rom, rOff + ti * 32);
        for (let ty = 0; ty < 8; ty++) {
          for (let tx = 0; tx < 8; tx++) {
            const ci = px[ty * 8 + tx];
            if (ci === 0) continue; // transparent
            const [r, g, b] = pal.colors[ci] || [0, 0, 0];
            const destX = gridX + (col * 8 + tx) * sprScale;
            const destY = gridY + (row * 8 + ty) * sprScale;
            // Write scaled pixel
            for (let sy = 0; sy < sprScale; sy++) {
              for (let sx = 0; sx < sprScale; sx++) {
                const o = ((destY + sy) * W + (destX + sx)) * 4;
                rgba[o] = r; rgba[o+1] = g; rgba[o+2] = b; rgba[o+3] = 255;
              }
            }
          }
        }
      }
    }
  }

  return { rgba, W, H, count: interestingSprites.length };
}

// ─── Generate sprite sheets ───────────────────────────────────────────────────
const outDir = path.join(__dirname, 'sprites');
fs.mkdirSync(outDir, { recursive: true });

// Focus on OBJ palettes (8-15, especially 10-15 which have color)
const sprPalettes = palData.palettes.filter(p => p.index >= 10);

// Test combinations: try each region with each OBJ palette
// but only for the top regions (by tile count)
const topRegions = regions
  .sort((a, b) => b.n - a.n)
  .slice(0, 50); // top 50 biggest regions

process.stderr.write(`Generating sprite sheets for top ${topRegions.length} regions × ${sprPalettes.length} palettes...\n`);

const index = []; // for gallery HTML

let generated = 0;
for (const reg of topRegions) {
  const hexBank = reg.bank.toString(16).padStart(2,'0').toUpperCase();
  const hexAddr = reg.addr.toString(16).padStart(4,'0').toUpperCase();
  const regionLabel = `${hexBank}_${hexAddr}`;

  for (const pal of sprPalettes) {
    // Try 16×16 sprites (2×2 tiles) — most common for SNES characters
    const sheet = renderSheet(reg, pal, 2, 2, 3);
    if (!sheet || sheet.count < 4) continue; // skip if fewer than 4 interesting sprites

    const fname = `r${regionLabel}_p${pal.index}_16x16.png`;
    const fpath = path.join(outDir, fname);
    const png = writePng(sheet.rgba, sheet.W, sheet.H);
    fs.writeFileSync(fpath, png);

    index.push({
      file: fname,
      region: `$${hexBank}:${hexAddr}`,
      pal: pal.index,
      palLabel: pal.label,
      sprites: sheet.count,
      tiles: reg.n,
    });
    generated++;
    process.stderr.write(`  [${generated}] $${hexBank}:${hexAddr} Pal${pal.index}: ${sheet.count} sprites → ${fname}\n`);
  }
}

process.stderr.write(`\nGenerated ${generated} PNG sheets\n`);

// ─── Also generate 32×32 sheets for the biggest regions ──────────────────────
for (const reg of topRegions.slice(0, 20)) {
  const hexBank = reg.bank.toString(16).padStart(2,'0').toUpperCase();
  const hexAddr = reg.addr.toString(16).padStart(4,'0').toUpperCase();
  const regionLabel = `${hexBank}_${hexAddr}`;
  for (const pal of sprPalettes) {
    const sheet = renderSheet(reg, pal, 4, 4, 2);
    if (!sheet || sheet.count < 2) continue;
    const fname = `r${regionLabel}_p${pal.index}_32x32.png`;
    fs.writeFileSync(path.join(outDir, fname), writePng(sheet.rgba, sheet.W, sheet.H));
    index.push({ file: fname, region: `$${hexBank}:${hexAddr}`, pal: pal.index, palLabel: pal.label, sprites: sheet.count, tiles: reg.n, size: '32×32' });
    generated++;
  }
}

// ─── Generate gallery HTML ────────────────────────────────────────────────────
const gallery = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>The Jungle Book — Sprite Sheet Gallery</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #060810; color: #e2e8f0; font-family: 'Inter',sans-serif; min-height: 100vh; }
header { background: linear-gradient(135deg, #0e1117, #111827); border-bottom: 1px solid #1e2d40; padding: 16px 24px; }
header h1 { font-size: 18px; font-weight: 700; color: #3b82f6; }
header p { font-size: 12px; color: #64748b; margin-top: 4px; }
.filters { background: #0e1117; border-bottom: 1px solid #1e2d40; padding: 10px 24px; display:flex; gap:12px; align-items:center; }
.filters label { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; }
select, input { background: #161b27; color: #e2e8f0; border: 1px solid #1e2d40; border-radius: 6px; padding: 4px 8px; font-size: 12px; font-family:'Inter',sans-serif; }
.grid { display: flex; flex-wrap: wrap; gap: 16px; padding: 20px 24px; }
.card {
  background: #0e1117; border: 1px solid #1e2d40; border-radius: 10px;
  overflow: hidden; cursor: pointer; transition: border-color 0.2s, transform 0.2s;
  max-width: 400px;
}
.card:hover { border-color: #3b82f6; transform: translateY(-2px); }
.card img { display: block; max-width: 100%; image-rendering: pixelated; background: #050607; }
.card-info { padding: 8px 12px; }
.card-title { font-size: 12px; font-weight: 600; color: #3b82f6; font-family: monospace; }
.card-meta { font-size: 10px; color: #64748b; margin-top: 2px; }
.badge { display: inline-block; background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); border-radius: 10px; padding: 1px 6px; font-size: 10px; font-weight: 600; }
</style>
</head>
<body>
<header>
  <h1>🕹️ The Jungle Book — Sprite Sheet Gallery</h1>
  <p>${generated} sheets • Real CGRAM palettes • 16×16 and 32×32 sprites</p>
</header>
<div class="filters">
  <label>Filter</label>
  <input type="text" id="search" placeholder="Region address..." oninput="filter()" style="min-width:150px">
  <label>Palette</label>
  <select id="pal-filter" onchange="filter()">
    <option value="">All palettes</option>
    ${sprPalettes.map(p => `<option value="${p.index}">Pal ${p.index}</option>`).join('')}
  </select>
  <label>Size</label>
  <select id="size-filter" onchange="filter()">
    <option value="">All sizes</option>
    <option value="16x16">16×16</option>
    <option value="32x32">32×32</option>
  </select>
</div>
<div class="grid" id="grid">
${index.map(item => `
  <div class="card" data-region="${item.region}" data-pal="${item.pal}" data-file="${item.file}">
    <img src="${item.file}" loading="lazy" title="${item.region} Pal${item.pal}">
    <div class="card-info">
      <div class="card-title">${item.region}</div>
      <div class="card-meta">Pal ${item.pal} • ${item.sprites} sprites <span class="badge">${item.size||'16×16'}</span></div>
    </div>
  </div>`).join('')}
</div>
<script>
function filter() {
  const search = document.getElementById('search').value.toLowerCase();
  const pal = document.getElementById('pal-filter').value;
  const sz = document.getElementById('size-filter').value;
  document.querySelectorAll('.card').forEach(c => {
    const reg = c.dataset.region.toLowerCase();
    const p = c.dataset.pal;
    const f = c.dataset.file;
    const show = (!search || reg.includes(search)) && (!pal || p === pal) && (!sz || f.includes(sz));
    c.style.display = show ? '' : 'none';
  });
}
</script>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, 'index.html'), gallery);
process.stderr.write(`Gallery: sprites/index.html\n`);
process.stderr.write('Open: open sprites/index.html\n');
