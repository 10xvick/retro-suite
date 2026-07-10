/**
 * make_final_sheets.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates the definitive full-color Jungle Book sprite sheets.
 * Uses palette 15 (confirmed Mowgli colors: green/orange/blue).
 * Tries palettes 8-15 for all detected sprite regions.
 * Groups by similarity to find animation frames.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── Load ROM ────────────────────────────────────────────────────────────────
const fileData = new Uint8Array(fs.readFileSync(path.join(__dirname, 'public', 'sample.sfc')));
function hasLoRom(d, off) {
  if (d.length < off + 0x8000) return false;
  const cs = d[off+0x7FDE]|(d[off+0x7FDF]<<8), cc = d[off+0x7FDC]|(d[off+0x7FDD]<<8);
  return (cs+cc) === 0xFFFF;
}
const rom = (fileData.length > 512 && hasLoRom(fileData, 512)) ? fileData.slice(512) : fileData;

// ─── Load palettes (1800-frame capture) ───────────────────────────────────────
const palData = JSON.parse(fs.readFileSync(path.join(__dirname, 'palette_data.json'), 'utf8'));

// ─── PNG writer ───────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xFF]; return c ^ -1; }
function chunk(t, d) {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const tp = Buffer.from(t), cr = Buffer.alloc(4); cr.writeInt32BE(crc32(Buffer.concat([tp, d])));
  return Buffer.concat([l, tp, d, cr]);
}
function writePng(rgba, w, h) {
  const filt = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { filt[y*(w*4+1)] = 0; rgba.copy(filt, y*(w*4+1)+1, y*w*4, (y+1)*w*4); }
  const comp = zlib.deflateSync(filt, { level: 9 });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]), chunk('IHDR',ihdr), chunk('IDAT',comp), chunk('IEND',Buffer.alloc(0))]);
}

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

// ─── Scan ALL ROM for graphics regions ────────────────────────────────────────
console.log('Scanning ROM for 4bpp tile regions...');
const allRegions = [];
for (let bank = 0x80; bank <= 0xFF; bank++) {
  const bankOff = (bank & 0x7F) * 0x8000;
  if (bankOff >= rom.length) break;
  let rStart = -1, rCount = 0;
  for (let addr = 0x8000; addr < 0x10000; addr += 32) {
    const off = bankOff + (addr - 0x8000);
    if (off + 32 > rom.length) break;
    const px = decode4bpp(rom, off);
    let n = 0; for (const v of px) if (v) n++;
    if (n >= 6) {
      if (rStart < 0) { rStart = off; rCount = 0; }
      rCount++;
    } else {
      if (rStart >= 0 && rCount >= 4) {
        allRegions.push({ off: rStart, n: rCount, bank, addr: 0x8000 + (rStart - bankOff) });
      }
      rStart = -1; rCount = 0;
    }
  }
  if (rStart >= 0 && rCount >= 4) {
    allRegions.push({ off: rStart, n: rCount, bank, addr: 0x8000 + (rStart - bankOff) });
  }
}
console.log(`Found ${allRegions.length} tile regions`);

// ─── Render sprites ────────────────────────────────────────────────────────────
function renderSprites(romOff, tileCount, pal, tCols, tRows, scale) {
  const tilesPer = tCols * tRows;
  const spriteList = [];
  for (let si = 0; si * tilesPer < tileCount; si++) {
    let totalColorPixels = 0;
    for (let r = 0; r < tRows; r++) {
      for (let c = 0; c < tCols; c++) {
        const ti = si * tilesPer + r * tCols + c;
        if (ti >= tileCount) continue;
        const px = decode4bpp(rom, romOff + ti * 32);
        for (const v of px) if (v) totalColorPixels++;
      }
    }
    if (totalColorPixels >= 16) spriteList.push(si);
  }
  if (spriteList.length < 2) return null;

  const sprW = tCols * 8 * scale, sprH = tRows * 8 * scale;
  const gap = 4, labelH = 0;
  const cols = Math.min(16, spriteList.length);
  const rows = Math.ceil(spriteList.length / cols);
  const W = cols * (sprW + gap);
  const H = rows * (sprH + gap + labelH);
  const rgba = Buffer.alloc(W * H * 4, 0);

  // Dark background
  for (let i = 0; i < rgba.length; i += 4) { rgba[i]=8; rgba[i+1]=8; rgba[i+2]=12; rgba[i+3]=255; }

  for (let idx = 0; idx < spriteList.length; idx++) {
    const si = spriteList[idx];
    const gridX = (idx % cols) * (sprW + gap);
    const gridY = Math.floor(idx / cols) * (sprH + gap + labelH);
    for (let row = 0; row < tRows; row++) {
      for (let col = 0; col < tCols; col++) {
        const ti = si * tilesPer + row * tCols + col;
        if (ti >= tileCount) continue;
        const px = decode4bpp(rom, romOff + ti * 32);
        for (let ty = 0; ty < 8; ty++) {
          for (let tx = 0; tx < 8; tx++) {
            const ci = px[ty * 8 + tx];
            if (ci === 0) continue;
            const [r, g, b] = pal.colors[ci] || [0, 0, 0];
            const destX = gridX + (col * 8 + tx) * scale;
            const destY = gridY + (row * 8 + ty) * scale;
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const o = ((destY + sy) * W + (destX + sx)) * 4;
                rgba[o] = r; rgba[o+1] = g; rgba[o+2] = b; rgba[o+3] = 255;
              }
            }
          }
        }
      }
    }
  }
  return { rgba, W, H, count: spriteList.length };
}

// ─── Focus: palette 15 (Mowgli colors) for all regions ───────────────────────
const pal15 = palData.palettes[15];
const pal11 = palData.palettes[11];
const pal13 = palData.palettes[13];

const outDir = path.join(__dirname, 'sprites', 'final');
fs.mkdirSync(outDir, { recursive: true });

// Sort by tile count
const sorted = allRegions.sort((a, b) => b.n - a.n);

const manifest = [];
let done = 0;

// Try the top 100 regions with palettes 11, 13, 15
for (const reg of sorted.slice(0, 200)) {
  const hexBank = reg.bank.toString(16).padStart(2, '0').toUpperCase();
  const hexAddr = reg.addr.toString(16).padStart(4, '0').toUpperCase();

  for (const [palIdx, pal] of [[11, pal11], [13, pal13], [15, pal15]]) {
    // Try 16×16 (2×2 tiles)
    for (const [tCols, tRows, scale, label] of [[2,2,4,'16x16'], [4,4,2,'32x32']]) {
      const sheet = renderSprites(reg.off, reg.n, pal, tCols, tRows, scale);
      if (!sheet || sheet.count < 2) continue;

      const fname = `${hexBank}_${hexAddr}_p${palIdx}_${label}.png`;
      fs.writeFileSync(path.join(outDir, fname), writePng(sheet.rgba, sheet.W, sheet.H));
      manifest.push({
        file: fname,
        region: `$${hexBank}:${hexAddr}`,
        pal: palIdx,
        size: label,
        sprites: sheet.count,
        tiles: reg.n,
        bank: hexBank,
        addr: hexAddr,
      });
      done++;
    }
  }
  if (done % 50 === 0) process.stderr.write(`${done} sheets...\n`);
}

console.log(`Generated ${done} final sprite sheets`);
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// ─── Generate final gallery HTML ──────────────────────────────────────────────
const palColors = (palIdx) => palData.palettes[palIdx].colors
  .slice(1, 16)
  .map(([r,g,b]) => `rgb(${r},${g},${b})`)
  .join(',');

const galleryHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>🕹️ The Jungle Book SNES — Complete Sprite Gallery</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: #07090f;
  color: #e2e8f0;
  font-family: 'Inter', system-ui, sans-serif;
  min-height: 100vh;
}
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: #0e1117; }
::-webkit-scrollbar-thumb { background: #1e2d40; border-radius: 4px; }

/* Header */
.header {
  background: linear-gradient(135deg, #0e1117 0%, #111827 100%);
  border-bottom: 1px solid rgba(59,130,246,0.2);
  padding: 20px 32px;
  display: flex; align-items: center; gap: 16px;
}
.header-icon { font-size: 32px; }
.header-title h1 { font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
.header-title p { font-size: 12px; color: #64748b; margin-top: 2px; }
.badge { display: inline-flex; align-items: center; gap: 4px; background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); border-radius: 999px; padding: 3px 10px; font-size: 11px; font-weight: 600; margin-left: 6px; }

/* Toolbar */
.toolbar {
  background: #0e1117;
  border-bottom: 1px solid #1a2535;
  padding: 12px 32px;
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
}
.toolbar label { font-size: 10px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
select, input[type="text"] {
  background: #0a0d14;
  color: #e2e8f0;
  border: 1px solid #1e2d40;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  font-family: 'Inter', sans-serif;
  outline: none;
  transition: border-color 0.15s;
}
select:focus, input[type="text"]:focus { border-color: #3b82f6; }
.toolbar-divider { width: 1px; height: 24px; background: #1e2d40; }
#count { font-size: 11px; color: #64748b; margin-left: auto; }

/* Palette Legend */
.pal-legend { display: flex; gap: 4px; align-items: center; }
.pal-swatch { display: inline-flex; width: 12px; height: 12px; border-radius: 2px; }

/* Grid */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1px;
  padding: 0;
  background: #0d1117;
}
.card {
  background: #0e1117;
  border: 1px solid #111827;
  border-radius: 0;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  position: relative;
}
.card:hover {
  border-color: rgba(59,130,246,0.5);
  background: #0f1622;
  z-index: 1;
}
.card.selected { border-color: #3b82f6 !important; }

.card-preview {
  background: #050608;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  min-height: 80px;
}
.card-preview img {
  max-width: 100%;
  max-height: 120px;
  image-rendering: pixelated;
  object-fit: contain;
}
.card-info {
  padding: 8px 12px 10px;
  border-top: 1px solid #0d1117;
}
.card-region {
  font-size: 12px;
  font-weight: 700;
  color: #38bdf8;
  font-family: 'Courier New', monospace;
}
.card-meta {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 4px;
  flex-wrap: wrap;
}
.tag {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid;
}
.tag.pal11 { background: rgba(251,191,36,0.1); color: #fbbf24; border-color: rgba(251,191,36,0.3); }
.tag.pal13 { background: rgba(239,68,68,0.1); color: #f87171; border-color: rgba(239,68,68,0.3); }
.tag.pal15 { background: rgba(34,197,94,0.1); color: #4ade80; border-color: rgba(34,197,94,0.3); }
.tag.size { background: rgba(99,102,241,0.1); color: #a5b4fc; border-color: rgba(99,102,241,0.3); }
.tag.sprites { background: rgba(14,165,233,0.1); color: #38bdf8; border-color: rgba(14,165,233,0.3); }

/* Modal */
.modal {
  display: none;
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.85);
  backdrop-filter: blur(8px);
  z-index: 1000;
  align-items: center;
  justify-content: center;
  padding: 40px;
}
.modal.open { display: flex; }
.modal-content {
  background: #0e1117;
  border: 1px solid #1e2d40;
  border-radius: 16px;
  overflow: hidden;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid #1e2d40;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-title { font-size: 14px; font-weight: 700; color: #38bdf8; font-family: monospace; }
.modal-close { background: #1e2d40; border: none; color: #94a3b8; cursor: pointer; width: 28px; height: 28px; border-radius: 6px; font-size: 16px; display: flex; align-items: center; justify-content: center; }
.modal-close:hover { color: #fff; background: #2e3d50; }
.modal-body { padding: 24px; overflow: auto; display: flex; align-items: center; justify-content: center; }
.modal-body img { image-rendering: pixelated; max-width: 100%; max-height: 70vh; }
.modal-footer { padding: 12px 20px; border-top: 1px solid #1e2d40; display: flex; gap: 8px; }
.btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  font-family: 'Inter', sans-serif;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn-primary { background: #3b82f6; color: #fff; }
.btn-primary:hover { background: #2563eb; }
.btn-ghost { background: #1e2d40; color: #94a3b8; }
.btn-ghost:hover { color: #fff; background: #2e3d50; }
</style>
</head>
<body>
<header class="header">
  <div class="header-icon">🕹️</div>
  <div class="header-title">
    <h1>The Jungle Book SNES — Complete Sprite Gallery</h1>
    <p>Full-color sprites extracted from ROM • Real CGRAM palettes at frame 1800 (gameplay state)</p>
  </div>
  <span class="badge" id="total-count">${manifest.length} sheets</span>
</header>

<div class="toolbar">
  <label>Search</label>
  <input type="text" id="search" placeholder="Bank address..." oninput="applyFilters()">
  <div class="toolbar-divider"></div>
  <label>Palette</label>
  <select id="pal-f" onchange="applyFilters()">
    <option value="">All</option>
    <option value="11">Pal 11 (yellow/green)</option>
    <option value="13">Pal 13 (red/orange)</option>
    <option value="15" selected>Pal 15 (Mowgli/jungle)</option>
  </select>
  <div class="toolbar-divider"></div>
  <label>Size</label>
  <select id="size-f" onchange="applyFilters()">
    <option value="">All</option>
    <option value="16x16" selected>16×16</option>
    <option value="32x32">32×32</option>
  </select>
  <div class="toolbar-divider"></div>
  <label>Min sprites</label>
  <select id="min-f" onchange="applyFilters()">
    <option value="2">2+</option>
    <option value="4" selected>4+</option>
    <option value="8">8+</option>
    <option value="16">16+</option>
  </select>
  <span id="count">Loading...</span>
</div>

<div class="grid" id="grid">
${manifest.map(item => `
<div class="card"
     data-region="${item.region}"
     data-pal="${item.pal}"
     data-size="${item.size}"
     data-sprites="${item.sprites}"
     data-file="${item.file}"
     onclick="openModal('${item.file}','${item.region}','${item.pal}','${item.size}','${item.sprites}')">
  <div class="card-preview">
    <img src="${item.file}" loading="lazy" alt="${item.region} Pal${item.pal}">
  </div>
  <div class="card-info">
    <div class="card-region">${item.region}</div>
    <div class="card-meta">
      <span class="tag pal${item.pal}">Pal ${item.pal}</span>
      <span class="tag size">${item.size}</span>
      <span class="tag sprites">${item.sprites} sprites</span>
    </div>
  </div>
</div>`).join('')}
</div>

<div class="modal" id="modal" onclick="if(event.target===this)closeModal()">
  <div class="modal-content">
    <div class="modal-header">
      <div class="modal-title" id="modal-title">Region</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <img id="modal-img" src="" alt="">
    </div>
    <div class="modal-footer">
      <a class="btn btn-primary" id="modal-dl" href="#" download>⬇ Download PNG</a>
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
    </div>
  </div>
</div>

<script>
function applyFilters() {
  const search = document.getElementById('search').value.toLowerCase();
  const pal = document.getElementById('pal-f').value;
  const size = document.getElementById('size-f').value;
  const minS = parseInt(document.getElementById('min-f').value)||2;
  let visible = 0;
  document.querySelectorAll('.card').forEach(c => {
    const show = (!search || c.dataset.region.toLowerCase().includes(search))
      && (!pal || c.dataset.pal === pal)
      && (!size || c.dataset.size === size)
      && parseInt(c.dataset.sprites) >= minS;
    c.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.getElementById('count').textContent = visible + ' visible';
}

function openModal(file, region, pal, size, sprites) {
  document.getElementById('modal-title').textContent = region + ' — Pal ' + pal + ' — ' + size + ' — ' + sprites + ' sprites';
  document.getElementById('modal-img').src = file;
  document.getElementById('modal-dl').href = file;
  document.getElementById('modal-dl').download = file.split('/').pop();
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Default: show pal 15, 16x16
applyFilters();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, 'index.html'), galleryHtml);
console.log(`Gallery saved: sprites/final/index.html`);
console.log(`Run: open sprites/final/index.html`);
