// Utility functions for exporting audio/music and sprite-sheets from active cores.

export class WAVRecorder {
  private chunks: Float32Array[] = [];
  private recording = false;
  private sampleRate = 44100;
  private timerInterval: any = null;
  private durationSeconds = 0;
  private onUpdate: ((duration: number) => void) | null = null;

  start(sampleRate: number, onUpdate?: (duration: number) => void) {
    this.chunks = [];
    this.recording = true;
    this.sampleRate = sampleRate;
    this.durationSeconds = 0;
    this.onUpdate = onUpdate || null;
    
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.recording) {
        this.durationSeconds += 0.1;
        if (this.onUpdate) this.onUpdate(this.durationSeconds);
      }
    }, 100);
  }

  record(leftChannel: Float32Array, rightChannel: Float32Array) {
    if (!this.recording) return;
    
    // Interleave left and right channels for stereo WAV
    const interleaved = new Float32Array(leftChannel.length * 2);
    for (let i = 0; i < leftChannel.length; i++) {
      interleaved[i * 2] = leftChannel[i];
      interleaved[i * 2 + 1] = rightChannel[i];
    }
    this.chunks.push(interleaved);
  }

  stop(): Blob {
    this.recording = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    let totalLength = 0;
    for (const chunk of this.chunks) {
      totalLength += chunk.length;
    }

    const flatBuffer = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      flatBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Write WAV header and raw PCM 16-bit data
    const buffer = new ArrayBuffer(44 + totalLength * 2);
    const view = new DataView(buffer);

    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // File length
    view.setUint32(4, 36 + totalLength * 2, true);
    // RIFF type
    writeString(view, 8, 'WAVE');
    // Format chunk identifier
    writeString(view, 12, 'fmt ');
    // Format chunk length
    view.setUint32(16, 16, true);
    // Sample format (1 = raw PCM)
    view.setUint16(20, 1, true);
    // Channel count (2 = Stereo)
    view.setUint16(22, 2, true);
    // Sample rate
    view.setUint32(24, this.sampleRate, true);
    // Byte rate (sampleRate * blockAlign)
    view.setUint32(28, this.sampleRate * 4, true);
    // Block align (channels * bytesPerSample = 2 * 2 = 4)
    view.setUint16(32, 4, true);
    // Bits per sample
    view.setUint16(34, 16, true);
    // Data chunk identifier
    writeString(view, 36, 'data');
    // Data chunk length
    view.setUint32(40, totalLength * 2, true);

    // Write PCM samples (Float32 to Int16 Conversion)
    let index = 44;
    for (let i = 0; i < flatBuffer.length; i++) {
      const s = Math.max(-1, Math.min(1, flatBuffer[i]));
      view.setInt16(index, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      index += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  isRecording(): boolean {
    return this.recording;
  }
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// ---------- System-Specific Decoders ----------

const NES_PALETTE = [
  '#7C7C7C', '#0000FC', '#0000BC', '#4428BC', '#940084', '#A80020', '#A81000', '#881400',
  '#503000', '#007800', '#006800', '#005800', '#004058', '#000000', '#000000', '#000000',
  '#BCBCBC', '#0078F8', '#0058F8', '#6844FC', '#D800B8', '#E40058', '#F83800', '#E45C10',
  '#AC7C00', '#00B800', '#00A800', '#00A844', '#008888', '#000000', '#000000', '#000000',
  '#F8F8F8', '#3CBCFC', '#6888FC', '#9878FC', '#F878F8', '#F85898', '#F87858', '#FCA044',
  '#F8B800', '#B8F818', '#58D854', '#58F898', '#00E8D8', '#787878', '#000000', '#000000',
  '#F8F8F8', '#A4E4FC', '#B8B8F8', '#D8B8F8', '#F8B8F8', '#F8A4C0', '#F0D0B0', '#FCE0A0',
  '#FCE078', '#D8F878', '#B8F8B8', '#B8F8D8', '#00FCFC', '#F8D8F8', '#000000', '#000000'
];

export function getGbTilePixels(vram: Uint8Array, tileIndex: number, bank = 0): Uint8Array {
  const pixels = new Uint8Array(8 * 8);
  const offset = bank * 0x2000 + tileIndex * 16;
  if (offset + 15 >= vram.length) return pixels;
  
  for (let row = 0; row < 8; row++) {
    const byte1 = vram[offset + row * 2];
    const byte2 = vram[offset + row * 2 + 1];
    for (let col = 0; col < 8; col++) {
      const bit = 7 - col;
      const lsb = (byte1 >> bit) & 1;
      const msb = (byte2 >> bit) & 1;
      pixels[row * 8 + col] = lsb | (msb << 1);
    }
  }
  return pixels;
}

export function getNesTilePixels(readByte: (addr: number) => number, tileIndex: number): Uint8Array {
  const pixels = new Uint8Array(8 * 8);
  const offset = tileIndex * 16;
  
  for (let row = 0; row < 8; row++) {
    const lsbByte = readByte(offset + row);
    const msbByte = readByte(offset + row + 8);
    for (let col = 0; col < 8; col++) {
      const bit = 7 - col;
      const lsb = (lsbByte >> bit) & 1;
      const msb = (msbByte >> bit) & 1;
      pixels[row * 8 + col] = lsb | (msb << 1);
    }
  }
  return pixels;
}

export function getSnesTilePixels(vram: Uint16Array, tileIndex: number): Uint8Array {
  const pixels = new Uint8Array(8 * 8);
  const offset = tileIndex * 16; // 16 words per tile in 4bpp
  if (offset + 15 >= vram.length) return pixels;
  
  for (let row = 0; row < 8; row++) {
    const w0 = vram[offset + row];
    const w1 = vram[offset + 8 + row];
    const b0 = w0 & 0xFF;
    const b1 = (w0 >> 8) & 0xFF;
    const b2 = w1 & 0xFF;
    const b3 = (w1 >> 8) & 0xFF;
    for (let col = 0; col < 8; col++) {
      const bit = 7 - col;
      const p0 = (b0 >> bit) & 1;
      const p1 = (b1 >> bit) & 1;
      const p2 = (b2 >> bit) & 1;
      const p3 = (b3 >> bit) & 1;
      pixels[row * 8 + col] = p0 | (p1 << 1) | (p2 << 2) | (p3 << 3);
    }
  }
  return pixels;
}

// ---------- Sprite Assembler & Bounding Box Clustering ----------

export interface AssembledSprite {
  id: string;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RawSpriteData {
  x: number;
  y: number;
  w: number;
  h: number;
  palIdx: number;
  oamIdx: number;
  draw: (ctx: CanvasRenderingContext2D, rx: number, ry: number) => void;
}

export function extractAssembledSprites(core: any): AssembledSprite[] {
  const rawSprites: RawSpriteData[] = [];
  
  if (core.id === 'gb' || core.id === 'gbc') {
    const gb = core.gb;
    if (!gb) return [];
    
    const lcdc = gb.ppu.lcdc;
    const spriteHeight = (lcdc & 0x04) ? 16 : 8;
    const vram = gb.ppu.vram;
    const isCGB = gb.mmu.cgbMode;
    const oam = gb.ppu.oam;

    for (let i = 0; i < 40; i++) {
      const oamOffset = i * 4;
      const y = oam[oamOffset] - 16;
      const x = oam[oamOffset + 1] - 8;
      const tileIdx = oam[oamOffset + 2];
      const attr = oam[oamOffset + 3];

      // Hide offscreen sprites
      if (y <= -16 || y >= 144 || x <= -8 || x >= 160) continue;

      const xFlip = !!(attr & 0x20);
      const yFlip = !!(attr & 0x40);
      const bank = isCGB ? ((attr >> 3) & 1) : 0;
      const palIdx = isCGB ? (attr & 0x07) : ((attr & 0x10) ? 1 : 0);

      rawSprites.push({
        x, y, w: 8, h: spriteHeight,
        palIdx,
        oamIdx: i,
        draw: (ctx, rx, ry) => {
          // Resolve palette colors
          let palette: string[] = [];
          if (isCGB) {
            const palNum = attr & 0x07;
            for (let c = 0; c < 4; c++) {
              const offset = palNum * 8 + c * 2;
              const b1 = gb.ppu.objPalette[offset] || 0;
              const b2 = gb.ppu.objPalette[offset + 1] || 0;
              const val = b1 | (b2 << 8);
              const r = (val & 0x1F) << 3;
              const g = ((val >> 5) & 0x1F) << 3;
              const b = ((val >> 10) & 0x1F) << 3;
              palette.push(`rgb(${r}, ${g}, ${b})`);
            }
          } else {
            const reg = (attr & 0x10) ? gb.ppu.obp1 : gb.ppu.obp0;
            const baseColors = ['#FFFFFF', '#C0C0C0', '#808080', '#000000'];
            for (let c = 0; c < 4; c++) {
              palette.push(baseColors[(reg >> (c * 2)) & 3]);
            }
          }

          if (spriteHeight === 8) {
            const pixels = getGbTilePixels(vram, tileIdx, bank);
            for (let ty = 0; ty < 8; ty++) {
              const drawY = yFlip ? (7 - ty) : ty;
              for (let tx = 0; tx < 8; tx++) {
                const drawX = xFlip ? (7 - tx) : tx;
                const colorIdx = pixels[drawY * 8 + drawX];
                if (colorIdx !== 0) { // transparent
                  ctx.fillStyle = palette[colorIdx];
                  ctx.fillRect(rx + tx, ry + ty, 1, 1);
                }
              }
            }
          } else {
            const topPixels = getGbTilePixels(vram, tileIdx & 0xFE, bank);
            const bottomPixels = getGbTilePixels(vram, tileIdx | 0x01, bank);
            for (let ty = 0; ty < 16; ty++) {
              const drawY = yFlip ? (15 - ty) : ty;
              const useBottom = drawY >= 8;
              const pixels = useBottom ? bottomPixels : topPixels;
              const tileY = drawY % 8;
              for (let tx = 0; tx < 8; tx++) {
                const drawX = xFlip ? (7 - tx) : tx;
                const colorIdx = pixels[tileY * 8 + drawX];
                if (colorIdx !== 0) {
                  ctx.fillStyle = palette[colorIdx];
                  ctx.fillRect(rx + tx, ry + ty, 1, 1);
                }
              }
            }
          }
        }
      });
    }
  } 
  else if (core.id === 'nes') {
    const bus = core.bus;
    if (!bus || !bus.ppu || !bus.cart) return [];
    
    const ctrl = bus.ppu.control;
    const spriteHeight = (ctrl & 0x20) ? 16 : 8;
    const oam = bus.ppu.oam;
    const paletteRAM = bus.ppu.palette;
    const readByte = (addr: number) => bus.cart.ppuRead(addr);

    for (let i = 0; i < 64; i++) {
      const y = oam[i * 4] + 1;
      const tileIdx = oam[i * 4 + 1];
      const attr = oam[i * 4 + 2];
      const x = oam[i * 4 + 3];

      // Hide offscreen sprites
      if (y >= 240) continue;

      const xFlip = !!(attr & 0x40);
      const yFlip = !!(attr & 0x80);
      const palIdx = attr & 0x03;

      rawSprites.push({
        x, y, w: 8, h: spriteHeight,
        palIdx,
        oamIdx: i,
        draw: (ctx, rx, ry) => {
          const palette: string[] = [];
          for (let c = 0; c < 4; c++) {
            const colorVal = paletteRAM[16 + palIdx * 4 + c] & 0x3F;
            palette.push(NES_PALETTE[colorVal]);
          }

          if (spriteHeight === 8) {
            const baseAddr = (ctrl & 0x08) ? 0x1000 : 0x0000;
            const pixels = getNesTilePixels(readByte, (baseAddr / 16) + tileIdx);
            for (let ty = 0; ty < 8; ty++) {
              const drawY = yFlip ? (7 - ty) : ty;
              for (let tx = 0; tx < 8; tx++) {
                const drawX = xFlip ? (7 - tx) : tx;
                const colorIdx = pixels[drawY * 8 + drawX];
                if (colorIdx !== 0) {
                  ctx.fillStyle = palette[colorIdx];
                  ctx.fillRect(rx + tx, ry + ty, 1, 1);
                }
              }
            }
          } else {
            const bank = tileIdx & 1;
            const baseTile = tileIdx & 0xFE;
            const baseAddr = bank ? 0x1000 : 0x0000;
            const topPixels = getNesTilePixels(readByte, (baseAddr / 16) + baseTile);
            const bottomPixels = getNesTilePixels(readByte, (baseAddr / 16) + baseTile + 1);
            for (let ty = 0; ty < 16; ty++) {
              const drawY = yFlip ? (15 - ty) : ty;
              const useBottom = drawY >= 8;
              const pixels = useBottom ? bottomPixels : topPixels;
              const tileY = drawY % 8;
              for (let tx = 0; tx < 8; tx++) {
                const drawX = xFlip ? (7 - tx) : tx;
                const colorIdx = pixels[tileY * 8 + drawX];
                if (colorIdx !== 0) {
                  ctx.fillStyle = palette[colorIdx];
                  ctx.fillRect(rx + tx, ry + ty, 1, 1);
                }
              }
            }
          }
        }
      });
    }
  } 
  else if (core.id === 'snes') {
    const snes = core.emulator;
    if (!snes) return [];

    const oam = snes.ppu.oam;
    const sss = (snes.ppu.spriteSize >> 5) & 7;
    const nn = (snes.ppu.spriteSize >> 3) & 3;
    const bbb = snes.ppu.spriteSize & 7;
    const base1 = bbb << 13;
    const base2 = (base1 + ((nn + 1) << 12)) & 0x7FFF;

    for (let i = 0; i < 128; i++) {
      const oamOffset = i * 4;
      const xLow = oam[oamOffset];
      const yVal = oam[oamOffset + 1];
      const tileIndex = oam[oamOffset + 2];
      const attr = oam[oamOffset + 3];

      const highByteIdx = Math.floor(i / 4);
      const highBitShift = (i % 4) * 2;
      const highVal = oam[512 + highByteIdx];
      const xHigh = (highVal >> highBitShift) & 1;
      const sizeToggle = (highVal >> (highBitShift + 1)) & 1;

      let x = xLow | (xHigh << 8);
      if (x >= 256) x -= 512;
      
      let y = yVal;
      if (y >= 224) y -= 256;

      // Hide offscreen sprites
      if (y <= -64 || y >= 224 || x <= -64 || x >= 256) continue;

      const sizeInfo = snes.ppu.getSpriteSize(sss, sizeToggle);
      const width = sizeInfo.w;
      const height = sizeInfo.h;

      const useSecondBlock = attr & 1;
      const charBase = useSecondBlock ? base2 : base1;
      const paletteOffset = (attr >> 1) & 7;
      const hFlip = (attr & 0x40) !== 0;
      const vFlip = (attr & 0x80) !== 0;
      const paletteBase = 128 + (paletteOffset * 16);

      rawSprites.push({
        x, y, w: width, h: height,
        palIdx: paletteOffset,
        oamIdx: i,
        draw: (ctx, rx, ry) => {
          const paletteColors: string[] = [];
          for (let c = 0; c < 16; c++) {
            const color = snes.ppu.cgram[paletteBase + c] ?? 0;
            const r = (color & 0x1F) << 3;
            const g = ((color >> 5) & 0x1F) << 3;
            const b = ((color >> 10) & 0x1F) << 3;
            paletteColors.push(`rgb(${r}, ${g}, ${b})`);
          }

          const rows = height / 8;
          const cols = width / 8;

          for (let ty = 0; ty < rows; ty++) {
            const drawTy = vFlip ? (rows - 1 - ty) : ty;
            for (let tx = 0; tx < cols; tx++) {
              const drawTx = hFlip ? (cols - 1 - tx) : tx;
              const spriteTile = (tileIndex + drawTx + (drawTy * 16)) & 0xFF;
              const pixels = getSnesTilePixels(snes.ppu.vram, charBase + spriteTile);

              const cellX = tx * 8;
              const cellY = ty * 8;

              for (let py = 0; py < 8; py++) {
                const drawPy = vFlip ? (7 - py) : py;
                for (let px = 0; px < 8; px++) {
                  const drawPx = hFlip ? (7 - px) : px;
                  const colorIdx = pixels[drawPy * 8 + drawPx];
                  if (colorIdx !== 0) {
                    ctx.fillStyle = paletteColors[colorIdx];
                    ctx.fillRect(rx + cellX + px, ry + cellY + py, 1, 1);
                  }
                }
              }
            }
          }
        }
      });
    }
  }

  // --- Bounding Box Bounding / Clustering Algorithm ---
  // Group sprites that are positioned near each other (margin = 12 pixels)
  // to reconstruct full characters like Spider-man.
  interface SpriteGroup {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    palIdx: number;
    sprites: RawSpriteData[];
  }

  let groups: SpriteGroup[] = rawSprites.map(s => ({
    minX: s.x,
    maxX: s.x + s.w,
    minY: s.y,
    maxY: s.y + s.h,
    palIdx: s.palIdx,
    sprites: [s]
  }));

  const margin = 4;
  let mergedAny = true;

  while (mergedAny) {
    mergedAny = false;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const g1 = groups[i];
        const g2 = groups[j];

        // Merge if they overlap spatially AND either:
        // 1. Share the same palette and are within 24 OAM slots (e.g. head and body)
        // 2. Have different palettes but consecutive/very close OAM slots (e.g. layered eyes, face, or outlines)
        const samePalette = g1.palIdx === g2.palIdx;
        const oamCloseSamePal = samePalette && g1.sprites.some(s1 => g2.sprites.some(s2 => Math.abs(s1.oamIdx - s2.oamIdx) <= 24));
        
        // Multi-palette merging (e.g. GBC layered eyes/faces) is enabled only for Game Boy/Color cores
        const isGB = core.id === 'gb' || core.id === 'gbc';
        const oamVeryCloseDiffPal = isGB && g1.sprites.some(s1 => g2.sprites.some(s2 => Math.abs(s1.oamIdx - s2.oamIdx) <= 4));

        const overlapX = !(g1.maxX + margin < g2.minX || g2.maxX + margin < g1.minX);
        const overlapY = !(g1.maxY + margin < g2.minY || g2.maxY + margin < g1.minY);

        if ((oamCloseSamePal || oamVeryCloseDiffPal) && overlapX && overlapY) {
          // Merge g2 into g1
          g1.minX = Math.min(g1.minX, g2.minX);
          g1.maxX = Math.max(g1.maxX, g2.maxX);
          g1.minY = Math.min(g1.minY, g2.minY);
          g1.maxY = Math.max(g1.maxY, g2.maxY);
          g1.sprites.push(...g2.sprites);

          groups.splice(j, 1);
          mergedAny = true;
          break;
        }
      }
      if (mergedAny) break;
    }
  }

  // Convert remaining clusters into AssembledSprite canvases
  const assembled: AssembledSprite[] = [];
  
  groups.forEach((g, idx) => {
    const width = g.maxX - g.minX;
    const height = g.maxY - g.minY;

    // Filter out crazy dimensions (corrupt entries or background segments)
    if (width <= 0 || height <= 0 || width > 128 || height > 128) return;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Draw all constituent sprites relative to bounding box top-left
    g.sprites.forEach(s => {
      const rx = s.x - g.minX;
      const ry = s.y - g.minY;
      s.draw(ctx, rx, ry);
    });

    assembled.push({
      id: `${core.id}_sprite_${idx}_${width}x${height}`,
      canvas,
      x: g.minX,
      y: g.minY,
      width,
      height
    });
  });

  return assembled;
}

// Render raw sprite sheet helper (fallback/VRAM tab view)
export function generateSpriteSheetCanvas(core: any): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  if (core.id === 'gb' || core.id === 'gbc') {
    const gb = core.gb;
    if (!gb) return canvas;
    
    canvas.width = 16 * 8;
    canvas.height = 24 * 8;
    
    const colors = ['#FFFFFF', '#C0C0C0', '#808080', '#000000'];
    const vram = gb.ppu.vram;
    
    for (let tile = 0; tile < 384; tile++) {
      const tx = tile % 16;
      const ty = Math.floor(tile / 16);
      const pixels = getGbTilePixels(vram, tile, 0);
      
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const colorIdx = pixels[y * 8 + x];
          ctx.fillStyle = colors[colorIdx] || '#000';
          ctx.fillRect(tx * 8 + x, ty * 8 + y, 1, 1);
        }
      }
    }
  } 
  else if (core.id === 'nes') {
    const bus = core.bus;
    if (!bus || !bus.cart) return canvas;
    
    canvas.width = 32 * 8;
    canvas.height = 16 * 8;
    
    const colors = ['#FFFFFF', '#C0C0C0', '#808080', '#000000'];
    const chrROM = bus.cart.chrROM;
    const readByte = (addr: number) => chrROM[addr] ?? 0;
    
    for (let tile = 0; tile < 512; tile++) {
      const tx = tile % 32;
      const ty = Math.floor(tile / 32);
      const pixels = getNesTilePixels(readByte, tile);
      
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const colorIdx = pixels[y * 8 + x];
          ctx.fillStyle = colors[colorIdx] || '#000';
          ctx.fillRect(tx * 8 + x, ty * 8 + y, 1, 1);
        }
      }
    }
  } 
  else if (core.id === 'snes') {
    const snes = core.emulator;
    if (!snes) return canvas;
    
    canvas.width = 32 * 8;
    canvas.height = 16 * 8;
    
    const paletteColors: string[] = [];
    const cgram = snes.ppu.cgram;
    for (let i = 0; i < 16; i++) {
      const color = cgram[i] ?? 0;
      const r = (color & 0x1F) << 3;
      const g = ((color >> 5) & 0x1F) << 3;
      const b = ((color >> 10) & 0x1F) << 3;
      paletteColors.push(`rgb(${r}, ${g}, ${b})`);
    }
    
    const vram = snes.ppu.vram;
    
    for (let tile = 0; tile < 512; tile++) {
      const tx = tile % 32;
      const ty = Math.floor(tile / 32);
      const pixels = getSnesTilePixels(vram, tile);
      
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const colorIdx = pixels[y * 8 + x];
          ctx.fillStyle = paletteColors[colorIdx] || '#000';
          ctx.fillRect(tx * 8 + x, ty * 8 + y, 1, 1);
        }
      }
    }
  }
  
  return canvas;
}
