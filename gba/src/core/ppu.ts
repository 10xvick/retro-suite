// GBA Pixel Processing Unit — renders the 240x160 display
import { Memory, IO } from "./memory";
import { GBA_WIDTH, GBA_HEIGHT } from "./types";

export class PPU {
  mem: Memory;
  // RGBA framebuffer (Uint32, ABGR for little-endian canvas)
  framebuffer: Uint32Array;
  // line buffer of color indices (priority + color) for blending
  private bgColor: Uint32Array; // top BG color (0 = transparent)
  private bgColor2: Uint32Array; // second BG color (below top, 0 = transparent)
  private bgPrio: Uint8Array;
  private bgPrio2: Uint8Array;
  private bgLayer: Uint8Array;
  private bgLayer2: Uint8Array;
  private objColor: Uint32Array;
  private objPrio: Uint8Array;
  private objSemi: Uint8Array; // 1 = semi-transparent sprite

  // Layer source IDs for blend targeting:
  // 0=BD(backdrop), 1=BG0, 2=BG1, 3=BG2, 4=BG3, 5=OBJ
  private objLayer: Uint8Array;

  win0InY = false;
  win1InY = false;

  constructor(mem: Memory) {
    this.mem = mem;
    this.framebuffer = new Uint32Array(GBA_WIDTH * GBA_HEIGHT);
    this.bgColor = new Uint32Array(GBA_WIDTH);
    this.bgColor2 = new Uint32Array(GBA_WIDTH);
    this.bgPrio = new Uint8Array(GBA_WIDTH);
    this.bgPrio2 = new Uint8Array(GBA_WIDTH);
    this.objColor = new Uint32Array(GBA_WIDTH);
    this.objPrio = new Uint8Array(GBA_WIDTH);
    this.objSemi = new Uint8Array(GBA_WIDTH);
    this.bgLayer = new Uint8Array(GBA_WIDTH);
    this.bgLayer2 = new Uint8Array(GBA_WIDTH);
    this.objLayer = new Uint8Array(GBA_WIDTH);
  }

  get dispcnt() { return this.mem.readIO16(IO.DISPCNT); }
  get dispstat() { return this.mem.readIO16(IO.DISPSTAT); }

  // Convert a GBA BGR555 color to canvas ABGR (RGBA little-endian)
  // Uses bit replication: 5-bit → 8-bit by (c << 3) | (c >> 2)
  static color555to32(c: number): number {
    const r = (c & 0x1f) << 3 | ((c >> 2) & 7);
    const g = ((c >> 5) & 0x1f) << 3 | ((c >> 7) & 7);
    const b = ((c >> 10) & 0x1f) << 3 | ((c >> 12) & 7);
    return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }

  // Convert a 32-bit ABGR framebuffer color back to GBA BGR555 (for blending)
  static color32to555(c: number): number {
    const r = (c >>> 0) & 0xff;
    const g = (c >>> 8) & 0xff;
    const b = (c >>> 16) & 0xff;
    return ((b >> 3) << 10) | ((g >> 3) << 5) | (r >> 3);
  }

  // Alpha-blend two 32-bit ABGR colors in 5-bit space (matches GBA hardware)
  static blend32(c1: number, c2: number, eva: number, evb: number): number {
    // Convert to 5-bit, blend, then expand back to 8-bit with bit replication
    const r1 = (c1 & 0xff) >> 3, g1 = ((c1 >>> 8) & 0xff) >> 3, b1 = ((c1 >>> 16) & 0xff) >> 3;
    const r2 = (c2 & 0xff) >> 3, g2 = ((c2 >>> 8) & 0xff) >> 3, b2 = ((c2 >>> 16) & 0xff) >> 3;
    const r5 = Math.min(31, (r1 * eva + r2 * evb) >> 4);
    const g5 = Math.min(31, (g1 * eva + g2 * evb) >> 4);
    const b5 = Math.min(31, (b1 * eva + b2 * evb) >> 4);
    const r = (r5 << 3) | (r5 >> 2);
    const g = (g5 << 3) | (g5 >> 2);
    const b = (b5 << 3) | (b5 >> 2);
    return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }

  // Brightness up on 32-bit ABGR color
  static brightUp32(c: number, evy: number): number {
    const r = c & 0xff, g = (c >>> 8) & 0xff, b = (c >>> 16) & 0xff;
    const nr = Math.min(255, r + ((255 - r) * evy >> 4));
    const ng = Math.min(255, g + ((255 - g) * evy >> 4));
    const nb = Math.min(255, b + ((255 - b) * evy >> 4));
    return (0xff000000 | (nb << 16) | (ng << 8) | nr) >>> 0;
  }

  // Brightness down on 32-bit ABGR color
  static brightDown32(c: number, evy: number): number {
    const r = c & 0xff, g = (c >>> 8) & 0xff, b = (c >>> 16) & 0xff;
    const nr = Math.max(0, r - ((r * evy) >> 4));
    const ng = Math.max(0, g - ((g * evy) >> 4));
    const nb = Math.max(0, b - ((b * evy) >> 4));
    return (0xff000000 | (nb << 16) | (ng << 8) | nr) >>> 0;
  }

  // Brightness up (fade to white): result = c + ((31 - c) * evy) / 16
  static brightUp555(c: number, evy: number): number {
    const r = c & 0x1f, g = (c >> 5) & 0x1f, b = (c >> 10) & 0x1f;
    const nr = Math.min(31, r + (((31 - r) * evy) >> 4));
    const ng = Math.min(31, g + (((31 - g) * evy) >> 4));
    const nb = Math.min(31, b + (((31 - b) * evy) >> 4));
    return (nb << 10) | (ng << 5) | nr;
  }

  // Brightness down (fade to black): result = c - (c * evy) / 16
  static brightDown555(c: number, evy: number): number {
    const r = c & 0x1f, g = (c >> 5) & 0x1f, b = (c >> 10) & 0x1f;
    const nr = Math.max(0, r - ((r * evy) >> 4));
    const ng = Math.max(0, g - ((g * evy) >> 4));
    const nb = Math.max(0, b - ((b * evy) >> 4));
    return (nb << 10) | (ng << 5) | nr;
  }

  // Render a full frame (fallback — not used in per-scanline mode)
  renderFrame() {
    const cnt = this.dispcnt;
    const mode = cnt & 7;
    const forcedBlank = (cnt >>> 7) & 1;
    if (forcedBlank) {
      this.framebuffer.fill(0xffffffff);
      return;
    }
    for (let y = 0; y < GBA_HEIGHT; y++) {
      this.renderLine(y, mode, cnt);
    }
  }

  // Update window Y flags on scanline start (ticked on all 228 lines including VBlank)
  updateScanline(y: number) {
    const win0v = this.mem.readIO16(0x44); // WIN0V
    const win1v = this.mem.readIO16(0x46); // WIN1V
    const win0_y1 = (win0v >>> 8) & 0xff;
    const win0_y2 = win0v & 0xff;
    const win1_y1 = (win1v >>> 8) & 0xff;
    const win1_y2 = win1v & 0xff;

    this.win0InY = (win0_y1 <= win0_y2) ? (y >= win0_y1 && y < win0_y2) : (y >= win0_y1 || y < win0_y2);
    this.win1InY = (win1_y1 <= win1_y2) ? (y >= win1_y1 && y < win1_y2) : (y >= win1_y1 || y < win1_y2);
  }

  checkWinVWrite(off: number) {
    const y = this.mem.gba ? this.mem.gba.scanline : 0;
    const win0v = this.mem.readIO16(0x44); // WIN0V
    const win1v = this.mem.readIO16(0x46); // WIN1V
    const win0_y1 = (win0v >>> 8) & 0xff;
    const win0_y2 = win0v & 0xff;
    const win1_y1 = (win1v >>> 8) & 0xff;
    const win1_y2 = win1v & 0xff;

    if (off === 0x44 || off === 0x45) {
      if (y === win0_y1) this.win0InY = true;
      if (y === win0_y2) this.win0InY = false;
    }
    if (off === 0x46 || off === 0x47) {
      if (y === win1_y1) this.win1InY = true;
      if (y === win1_y2) this.win1InY = false;
    }
  }

  // Render a single scanline (per-scanline mode — latches HOFS/VOFS per line)
  renderScanline(y: number) {
    const cnt = this.dispcnt;
    const mode = cnt & 7;
    const forcedBlank = (cnt >>> 7) & 1;
    if (forcedBlank) {
      const yoff = y * GBA_WIDTH;
      for (let x = 0; x < GBA_WIDTH; x++) this.framebuffer[yoff + x] = 0xffffffff;
      return;
    }
    this.renderLine(y, mode, cnt);
  }

  private renderLine(y: number, mode: number, cnt: number) {
    const fb = this.framebuffer;
    const yoff = y * GBA_WIDTH;
    // Default backdrop color = palette[0]
    const backdrop = PPU.color555to32(this.mem.palette[0] | (this.mem.palette[1] << 8));

    if (mode >= 3) {
      // Bitmap modes: no BG layers except the bitmap (BG2)
      // Reset OBJ buffers for this line
      for (let x = 0; x < GBA_WIDTH; x++) {
        this.objColor[x] = 0;
        this.objPrio[x] = 4;
        this.objLayer[x] = 0;
        this.objSemi[x] = 0;
      }
      this.renderBitmapLine(y, mode, cnt);
      // sprites can still overlay
      if ((cnt >>> 12) & 1) this.renderObjLine(y, mode, cnt);
      // Composite OBJ over bitmap with alpha blending support
      const bldcnt = this.mem.readIO16(IO.BLDCNT);
      const bldalpha = this.mem.readIO16(IO.BLDALPHA);
      const bldy = this.mem.readIO16(IO.BLDY);
      const eva = bldalpha & 0x1f;
      const evb = (bldalpha >> 8) & 0x1f;
      const evy = bldy & 0x1f;
      const t1Mask = bldcnt & 0x3f;
      const t2Mask = (bldcnt >> 8) & 0x3f;
      const effect = (bldcnt >> 6) & 3;
      const win0Enable = (cnt >>> 13) & 1;
      const win1Enable = (cnt >>> 14) & 1;
      const objWinEnable = (cnt >>> 15) & 1;
      const anyWinEnable = win0Enable || win1Enable || objWinEnable;

      let win0h = 0, win1h = 0, winin = 0, winout = 0;
      if (anyWinEnable) {
        win0h = this.mem.readIO16(0x40);
        win1h = this.mem.readIO16(0x42);
        winin = this.mem.readIO16(0x48);
        winout = this.mem.readIO16(0x4a);
      }

      for (let x = 0; x < GBA_WIDTH; x++) {
        let winMask = 0x3f;
        if (anyWinEnable) {
        let winControl = winout & 0x3f;
        const win0_x1 = (win0h >>> 8) & 0xff, win0_x2 = win0h & 0xff;
        const win1_x1 = (win1h >>> 8) & 0xff, win1_x2 = win1h & 0xff;
        const inWin0X = (win0_x1 === win0_x2) ? false : (win0_x1 < win0_x2 ? (x >= win0_x1 && x < win0_x2) : (x >= win0_x1 || x < win0_x2));
        const inWin1X = (win1_x1 === win1_x2) ? false : (win1_x1 < win1_x2 ? (x >= win1_x1 && x < win1_x2) : (x >= win1_x1 || x < win1_x2));

        if (win0Enable && this.win0InY && inWin0X) {
          winControl = winin & 0x3f;
        } else if (win1Enable && this.win1InY && inWin1X) {
          winControl = (winin >> 8) & 0x3f;
        } else if (objWinEnable && this.objWinMask[x]) {
          winControl = (winout >> 8) & 0x3f;
        }
        winMask = winControl;
        }

        let col = (winMask & 0x04) ? fb[yoff + x] : backdrop;
        let topLayer = (winMask & 0x04) ? 3 : 0; // BG2 is bitmap
        const oc = (winMask & 0x10) ? this.objColor[x] : 0;
        if (oc !== 0) {
          const isSemi = this.objSemi[x] === 1;
          const bottomCol = col;
          col = oc;
          topLayer = 5; // OBJ
          // Apply blending for OBJ over bitmap
          if (effect === 1 && isSemi) {
            col = PPU.blend32(col, bottomCol, eva, evb);
          } else if (effect === 1 && (t1Mask & 0x10)) {
            if (t2Mask & 0x04) {
              col = PPU.blend32(col, bottomCol, eva, evb);
            }
          }
        }
        // Apply brightness effect if allowed by window
        const allowEffect = (winMask & 0x20) !== 0;
        if (effect >= 2 && allowEffect) {
          const topBit = topLayer === 5 ? 0x10 : (topLayer === 3 ? 0x04 : 0);
          if (t1Mask & topBit) {
            if (effect === 2) col = PPU.brightUp32(col, evy);
            else col = PPU.brightDown32(col, evy);
          }
        }
        fb[yoff + x] = col;
      }
      return;
    }

    // Text/affine modes: render BGs
    // Reset line buffers. Use 0 as the transparent sentinel — real colors always
    // have alpha 0xFF (0xFFxxxxxx), so they are never 0.
    for (let x = 0; x < GBA_WIDTH; x++) {
      this.bgColor[x] = 0;
      this.bgColor2[x] = 0;
      this.bgPrio[x] = 4;
      this.bgPrio2[x] = 4;
      this.bgLayer[x] = 0;
      this.bgLayer2[x] = 0;
      this.objColor[x] = 0;
      this.objPrio[x] = 4;
      this.objLayer[x] = 0;
      this.objSemi[x] = 0;
    }

    const bgEnable = [(cnt >>> 8) & 1, (cnt >>> 9) & 1, (cnt >>> 10) & 1, (cnt >>> 11) & 1];
    // Render BG3, BG2, BG1, BG0 (so higher priority overwrites via priority field)
    if (mode === 0) {
      if (bgEnable[3]) this.renderTextBg(3, y);
      if (bgEnable[2]) this.renderTextBg(2, y);
      if (bgEnable[1]) this.renderTextBg(1, y);
      if (bgEnable[0]) this.renderTextBg(0, y);
    } else if (mode === 1) {
      if (bgEnable[3]) this.renderTextBg(3, y);
      if (bgEnable[1]) this.renderTextBg(1, y);
      if (bgEnable[0]) this.renderTextBg(0, y);
      if (bgEnable[2]) this.renderAffineBg(2, y);
    } else if (mode === 2) {
      if (bgEnable[3]) this.renderAffineBg(3, y);
      if (bgEnable[2]) this.renderAffineBg(2, y);
    }

    if ((cnt >>> 12) & 1) this.renderObjLine(y, mode, cnt);

    // Windowing checks
    const win0Enable = (cnt >>> 13) & 1;
    const win1Enable = (cnt >>> 14) & 1;
    const objWinEnable = (cnt >>> 15) & 1;
    const anyWinEnable = win0Enable || win1Enable || objWinEnable;

    let win0h = 0, win1h = 0, winin = 0, winout = 0;
    if (anyWinEnable) {
      win0h = this.mem.readIO16(0x40); // WIN0H
      win1h = this.mem.readIO16(0x42); // WIN1H
      winin = this.mem.readIO16(0x48); // WININ
      winout = this.mem.readIO16(0x4a); // WINOUT
    }

    // Composite: backdrop + BGs (by priority) + OBJ, with alpha blending & brightness
    const bldcnt = this.mem.readIO16(IO.BLDCNT);
    const bldalpha = this.mem.readIO16(IO.BLDALPHA);
    const bldy = this.mem.readIO16(IO.BLDY);
    const eva = bldalpha & 0x1f;
    const evb = (bldalpha >> 8) & 0x1f;
    const evy = bldy & 0x1f;
    // BLDCNT: bits 0-5 = target 1 (BG0,BG1,BG2,BG3,OBJ,BD)
    //         bits 6-7 = effect (0=none,1=blend,2=brightup,3=brightdown)
    //         bits 8-13 = target 2
    const t1Mask = bldcnt & 0x3f;
    const t2Mask = (bldcnt >> 8) & 0x3f;
    const effect = (bldcnt >> 6) & 3;
    // Layer ID → BLDCNT bit: 0=BD(5), 1=BG0(0), 2=BG1(1), 3=BG2(2), 4=BG3(3), 5=OBJ(4)
    const layerBit = [0x20, 0x01, 0x02, 0x04, 0x08, 0x10];

    for (let x = 0; x < GBA_WIDTH; x++) {
      let winMask = 0x3f;
      if (anyWinEnable) {
        let winControl = winout & 0x3f;
        const win0_x1 = (win0h >>> 8) & 0xff, win0_x2 = win0h & 0xff;
        const win1_x1 = (win1h >>> 8) & 0xff, win1_x2 = win1h & 0xff;
        const inWin0X = (win0_x1 === win0_x2) ? false : (win0_x1 < win0_x2 ? (x >= win0_x1 && x < win0_x2) : (x >= win0_x1 || x < win0_x2));
        const inWin1X = (win1_x1 === win1_x2) ? false : (win1_x1 < win1_x2 ? (x >= win1_x1 && x < win1_x2) : (x >= win1_x1 || x < win1_x2));

        if (win0Enable && this.win0InY && inWin0X) {
          winControl = winin & 0x3f;
        } else if (win1Enable && this.win1InY && inWin1X) {
          winControl = (winin >> 8) & 0x3f;
        } else if (objWinEnable && this.objWinMask[x]) {
          winControl = (winout >> 8) & 0x3f;
        }
        winMask = winControl;
      }

      let col = backdrop;
      let curPrio = 5;
      let topLayer = 0; // 0 = backdrop
      let bottomLayer = 0;
      let bottomCol = backdrop;
      let isSemiTransparent = false;
      // Compare BG and OBJ priorities; lower number = higher priority (front)
      let bc = (this.bgColor[x] !== 0 && (winMask & (1 << (this.bgLayer[x] - 1)))) ? this.bgColor[x] : 0;
      let bp = bc !== 0 ? this.bgPrio[x] : 4;
      let oc = (this.objColor[x] !== 0 && (winMask & 0x10)) ? this.objColor[x] : 0;
      let op = oc !== 0 ? this.objPrio[x] : 4;
      // BG vs OBJ: BG drawn first if bgPrio <= objPrio, else obj first (then other can overwrite if <=)
      // Simplify: pick the one with lower priority; if equal, OBJ wins.
      if (bp <= op) {
        if (bc !== 0) { col = bc; curPrio = bp; topLayer = this.bgLayer[x]; }
        if (oc !== 0 && op <= curPrio) {
          bottomCol = col; bottomLayer = topLayer;
          col = oc; topLayer = 5;
          isSemiTransparent = this.objSemi[x] === 1;
        }
      } else {
        if (oc !== 0) { col = oc; curPrio = op; topLayer = 5; isSemiTransparent = this.objSemi[x] === 1; }
        if (bc !== 0 && bp < curPrio) {
          bottomCol = col; bottomLayer = topLayer;
          col = bc; topLayer = this.bgLayer[x];
          isSemiTransparent = false;
        }
      }
      // Use second BG layer as bottom for blending if available
      const bc2 = (this.bgColor2[x] !== 0 && (winMask & (1 << (this.bgLayer2[x] - 1)))) ? this.bgColor2[x] : 0;
      if (bc2 !== 0 && bottomLayer === 0) {
        bottomCol = bc2;
        bottomLayer = this.bgLayer2[x];
      }

      // Apply special effects (alpha blending / brightness) — use 32-bit direct if allowed by window
      const allowEffect = (winMask & 0x20) !== 0;
      if (effect !== 0 && allowEffect) {
        const topBit = layerBit[topLayer];
        if (effect === 1) {
          // Alpha blending
          if (isSemiTransparent) {
            col = PPU.blend32(col, bottomCol, eva, evb);
          } else if (t1Mask & topBit) {
            const botBit = layerBit[bottomLayer];
            if (t2Mask & botBit) {
              col = PPU.blend32(col, bottomCol, eva, evb);
            }
          }
        } else if (t1Mask & topBit) {
          // Brightness (fade to white or black)
          if (effect === 2) {
            col = PPU.brightUp32(col, evy);
          } else {
            col = PPU.brightDown32(col, evy);
          }
        }
      }

      fb[yoff + x] = col;
    }
  }

  // ---- Text BG (mode 0, and BG0/1 in mode 1) ----
  private renderTextBg(bg: number, y: number) {
    const cnt = this.mem.readIO16(IO.BG0CNT + bg * 2);
    const prio = cnt & 3;
    const charBase = ((cnt >>> 2) & 3) * 0x4000;
    const screenBase = ((cnt >>> 8) & 0x1f) * 0x800;
    const is256 = (cnt >>> 7) & 1;
    const screenSize = (cnt >>> 14) & 3;
    const hofs = this.mem.readIO16(IO.BG0HOFS + bg * 4) & 0x1ff;
    const vofs = this.mem.readIO16(IO.BG0VOFS + bg * 4) & 0x1ff;

    const sizeW = screenSize & 1 ? 512 : 256;
    const sizeH = screenSize & 2 ? 512 : 256;

    const vram = this.mem.vram;
    const palette = this.mem.palette;

    for (let x = 0; x < GBA_WIDTH; x++) {
      const px = (x + hofs) % sizeW;
      const py = (y + vofs) % sizeH;
      const tileX = px >> 3;
      const tileY = py >> 3;
      const inX = px & 7;
      const inY = py & 7;
      // screen base may differ for tileX >= 32
      let sb = screenBase;
      let tx = tileX;
      if (screenSize === 1 && tileX >= 32) { sb += 0x800; tx -= 32; }
      else if (screenSize === 2 && tileY >= 32) { sb += 0x800; }
      else if (screenSize === 3) {
        if (tileX >= 32 && tileY < 32) { sb += 0x800; tx -= 32; }
        else if (tileX < 32 && tileY >= 32) { sb += 0x1000; }
        else if (tileX >= 32 && tileY >= 32) { sb += 0x1800; tx -= 32; }
      }
      const mapOff = (sb + ((tileY & 31) * 32 + (tx & 31)) * 2) & (vram.length - 1);
      const entry = vram[mapOff] | (vram[mapOff + 1] << 8);
      const tileNum = entry & 0x3ff;
      const hflip = (entry >>> 10) & 1;
      const vflip = (entry >>> 11) & 1;
      const pal = (entry >>> 12) & 0xf;
      let fx = hflip ? 7 - inX : inX;
      let fy = vflip ? 7 - inY : inY;
      let colorIdx: number;
      let color: number;
      if (is256) {
        const tileOff = (charBase + tileNum * 64 + fy * 8 + fx) & (vram.length - 1);
        colorIdx = vram[tileOff];
        if (colorIdx === 0) continue; // transparent
        color = PPU.color555to32(palette[(colorIdx * 2)] | (palette[(colorIdx * 2) + 1] << 8));
      } else {
        const tileOff = (charBase + tileNum * 32 + fy * 4 + (fx >> 1)) & (vram.length - 1);
        const byte = vram[tileOff];
        colorIdx = (fx & 1) ? (byte >> 4) & 0xf : byte & 0xf;
        if (colorIdx === 0) continue;
        const p = pal * 32 + colorIdx * 2;
        color = PPU.color555to32(palette[p] | (palette[p + 1] << 8));
      }
      if (prio <= this.bgPrio[x]) {
        // Push old top to second layer
        this.bgColor2[x] = this.bgColor[x];
        this.bgPrio2[x] = this.bgPrio[x];
        this.bgLayer2[x] = this.bgLayer[x];
        this.bgColor[x] = color;
        this.bgPrio[x] = prio;
        this.bgLayer[x] = bg + 1; // 1=BG0, 2=BG1, 3=BG2, 4=BG3
      } else if (prio <= this.bgPrio2[x]) {
        // New second layer
        this.bgColor2[x] = color;
        this.bgPrio2[x] = prio;
        this.bgLayer2[x] = bg + 1;
      }
    }
  }

  // ---- Affine BG (mode 1 BG2, mode 2 BG2/BG3) ----
  private renderAffineBg(bg: number, y: number) {
    const cnt = this.mem.readIO16(IO.BG0CNT + bg * 2);
    const prio = cnt & 3;
    const charBase = ((cnt >>> 2) & 3) * 0x4000;
    const screenBase = ((cnt >>> 8) & 0x1f) * 0x800;
    const screenSize = (cnt >>> 14) & 3;
    const overflow = (cnt >>> 13) & 1;
    const size = 128 << screenSize; // 128, 256, 512, 1024
    // Read affine params (16-bit signed)
    const readS16 = (off: number) => { const v = this.mem.readIO16(off); return (v & 0x8000) ? (v - 0x10000) : v; };
    const A = readS16(IO.BG2PA + (bg - 2) * 0x10);
    const B = readS16(IO.BG2PB + (bg - 2) * 0x10);
    const C = readS16(IO.BG2PC + (bg - 2) * 0x10);
    const D = readS16(IO.BG2PD + (bg - 2) * 0x10);
    let refX = this.mem.readIO32(IO.BG2X + (bg - 2) * 0x10);
    refX = (refX & 0x80000000) ? (refX - 0x100000000) : refX;
    let refY = this.mem.readIO32(IO.BG2Y + (bg - 2) * 0x10);
    refY = (refY & 0x80000000) ? (refY - 0x100000000) : refY;
    // refX/Y are 28.4 fixed point
    let dx = (refX + B * y) | 0;
    let dy = (refY + D * y) | 0;
    const vram = this.mem.vram;
    const palette = this.mem.palette;
    for (let x = 0; x < GBA_WIDTH; x++) {
      // texture coordinates (8.8 fixed for the 8x8 tile mapping? affine uses pixel coords)
      const tx = dx >> 8;
      const ty = dy >> 8;
      dx = (dx + A) | 0;
      dy = (dy + C) | 0;
      let ix = tx, iy = ty;
      if (ix < 0 || ix >= size || iy < 0 || iy >= size) {
        if (!overflow) continue;
        ix = ((ix % size) + size) % size;
        iy = ((iy % size) + size) % size;
      }
      // affine BG is 256-color, 8x8 tiles, 1 byte per pixel
      const tileX = ix >> 3, tileY = iy >> 3;
      const inX = ix & 7, inY = iy & 7;
      // screen base: affine screen base is 1 byte per entry, tile number is 8-bit
      const screenOff = (screenBase + tileY * (size >> 3) + tileX) & (vram.length - 1);
      const tileNum = vram[screenOff];
      const tileOff = (charBase + tileNum * 64 + inY * 8 + inX) & (vram.length - 1);
      const colorIdx = vram[tileOff];
      if (colorIdx === 0) continue;
      const color = PPU.color555to32(palette[colorIdx * 2] | (palette[colorIdx * 2 + 1] << 8));
      if (prio <= this.bgPrio[x]) {
        this.bgColor2[x] = this.bgColor[x]; this.bgPrio2[x] = this.bgPrio[x]; this.bgLayer2[x] = this.bgLayer[x];
        this.bgColor[x] = color; this.bgPrio[x] = prio; this.bgLayer[x] = bg + 1;
      } else if (prio <= this.bgPrio2[x]) {
        this.bgColor2[x] = color; this.bgPrio2[x] = prio; this.bgLayer2[x] = bg + 1;
      }
    }
  }

  // ---- Bitmap modes ----
  private renderBitmapLine(y: number, mode: number, cnt: number) {
    const fb = this.framebuffer;
    const yoff = y * GBA_WIDTH;
    const page = ((cnt >>> 4) & 1) * 0xa000;
    const vram = this.mem.vram;
    const palette = this.mem.palette;
    const bg2Enable = (cnt >>> 10) & 1;
    const backdrop = PPU.color555to32(palette[0] | (palette[1] << 8));

    if (!bg2Enable) {
      for (let x = 0; x < GBA_WIDTH; x++) fb[yoff + x] = backdrop;
      return;
    }

    const win0Enable = (cnt >>> 13) & 1;
    const win1Enable = (cnt >>> 14) & 1;
    const objWinEnable = (cnt >>> 15) & 1;
    const anyWinEnable = win0Enable || win1Enable || objWinEnable;

    let win0h = 0, win1h = 0, winin = 0, winout = 0;
    if (anyWinEnable) {
      win0h = this.mem.readIO16(0x40);
      win1h = this.mem.readIO16(0x42);
      winin = this.mem.readIO16(0x48);
      winout = this.mem.readIO16(0x4a);
    }

    const win0_x1 = (win0h >>> 8) & 0xff, win0_x2 = win0h & 0xff;
    const win1_x1 = (win1h >>> 8) & 0xff, win1_x2 = win1h & 0xff;

    if (mode === 3) {
      const base = y * GBA_WIDTH * 2;
      for (let x = 0; x < GBA_WIDTH; x++) {
        if (anyWinEnable) {
          let winControl = winout & 0x3f;
          const inWin0X = (win0_x1 === win0_x2) ? false : (win0_x1 < win0_x2 ? (x >= win0_x1 && x < win0_x2) : (x >= win0_x1 || x < win0_x2));
          const inWin1X = (win1_x1 === win1_x2) ? false : (win1_x1 < win1_x2 ? (x >= win1_x1 && x < win1_x2) : (x >= win1_x1 || x < win1_x2));
          if (win0Enable && this.win0InY && inWin0X) winControl = winin & 0x3f;
          else if (win1Enable && this.win1InY && inWin1X) winControl = (winin >> 8) & 0x3f;
          else if (objWinEnable && this.objWinMask[x]) winControl = (winout >> 8) & 0x3f;

          if ((winControl & 0x04) === 0) {
            fb[yoff + x] = backdrop;
            continue;
          }
        }
        const o = base + x * 2;
        const c = vram[o] | (vram[o + 1] << 8);
        fb[yoff + x] = PPU.color555to32(c);
      }
    } else if (mode === 4) {
      const base = page + y * GBA_WIDTH;
      for (let x = 0; x < GBA_WIDTH; x++) {
        if (anyWinEnable) {
          let winControl = winout & 0x3f;
          const inWin0X = (win0_x1 === win0_x2) ? false : (win0_x1 < win0_x2 ? (x >= win0_x1 && x < win0_x2) : (x >= win0_x1 || x < win0_x2));
          const inWin1X = (win1_x1 === win1_x2) ? false : (win1_x1 < win1_x2 ? (x >= win1_x1 && x < win1_x2) : (x >= win1_x1 || x < win1_x2));
          if (win0Enable && this.win0InY && inWin0X) winControl = winin & 0x3f;
          else if (win1Enable && this.win1InY && inWin1X) winControl = (winin >> 8) & 0x3f;
          else if (objWinEnable && this.objWinMask[x]) winControl = (winout >> 8) & 0x3f;

          if ((winControl & 0x04) === 0) {
            fb[yoff + x] = backdrop;
            continue;
          }
        }
        const idx = vram[base + x];
        const c = palette[idx * 2] | (palette[idx * 2 + 1] << 8);
        fb[yoff + x] = PPU.color555to32(c);
      }
    } else if (mode === 5) {
      const w = 160;
      if (y >= 128) { for (let x = 0; x < GBA_WIDTH; x++) fb[yoff + x] = backdrop; return; }
      const base = page + y * w * 2;
      for (let x = 0; x < GBA_WIDTH; x++) {
        if (x >= w) { fb[yoff + x] = backdrop; continue; }
        if (anyWinEnable) {
          let winControl = winout & 0x3f;
          const inWin0X = (win0_x1 === win0_x2) ? false : (win0_x1 < win0_x2 ? (x >= win0_x1 && x < win0_x2) : (x >= win0_x1 || x < win0_x2));
          const inWin1X = (win1_x1 === win1_x2) ? false : (win1_x1 < win1_x2 ? (x >= win1_x1 && x < win1_x2) : (x >= win1_x1 || x < win1_x2));
          if (win0Enable && this.win0InY && inWin0X) winControl = winin & 0x3f;
          else if (win1Enable && this.win1InY && inWin1X) winControl = (winin >> 8) & 0x3f;
          else if (objWinEnable && this.objWinMask[x]) winControl = (winout >> 8) & 0x3f;

          if ((winControl & 0x04) === 0) {
            fb[yoff + x] = backdrop;
            continue;
          }
        }
        const o = base + x * 2;
        const c = vram[o] | (vram[o + 1] << 8);
        fb[yoff + x] = PPU.color555to32(c);
      }
    }
  }

  // ---- Sprites (OBJ) ----
  private renderObjLine(y: number, _mode: number, cnt: number) {
    const oam = this.mem.oam;
    const palette = this.mem.palette;
    const vram = this.mem.vram;
    const oneD = (cnt >>> 6) & 1; // 1 = 1D mapping, 0 = 2D mapping
    const tileDataBase = 0x10000;
    // For 2D mapping: 4bpp = 32 tiles/row (1024-byte rows)
    const tilesPerRow4 = 32;

    for (let i = 127; i >= 0; i--) {
      const attr0 = oam[i * 8] | (oam[i * 8 + 1] << 8);
      const attr1 = oam[i * 8 + 2] | (oam[i * 8 + 3] << 8);
      const attr2 = oam[i * 8 + 4] | (oam[i * 8 + 5] << 8);
      const shape = (attr0 >>> 14) & 3;
      if (shape === 3) continue; // invalid
      const size = (attr1 >>> 14) & 3;
      const dims = this.objDims(shape, size);
      let w = dims.w, h = dims.h;
      const objMode = (attr0 >>> 10) & 3;
      if (objMode === 2) continue; // disabled
      const affine = ((attr0 >>> 8) & 1) === 1;
      const doubleSize = affine && ((attr0 >>> 9) & 1) === 1;
      let x = attr1 & 0x1ff;
      // 9-bit signed: 0-255 normal, 256-511 = -256 to -1
      if (x >= 256) x -= 512;
      const y0 = attr0 & 0xff;
      const ys = (y0 >= 160) ? y0 - 256 : y0;
      const renderH = doubleSize ? h * 2 : h;
      const dy = y - ys;
      if (dy < 0 || dy >= renderH) continue;
      let prio = (attr2 >>> 10) & 3;
      const palIdx = (attr2 >>> 12) & 0xf;
      const tileBase = attr2 & 0x3ff;
      const bpp8 = (attr0 >>> 13) & 1;
      const hflip = !affine && ((attr1 >>> 12) & 1);
      const vflip = !affine && ((attr1 >>> 13) & 1);

      // Affine parameters (for affine sprites)
      let pa = 256, pb = 0, pc = 0, pd = 256;
      if (affine) {
        const rotIdx = (attr1 >>> 9) & 0x1f; // GBATEK: bits 9-13 = affine index (0-31)
        // PA, PB, PC, PD stored in OAM filler bytes of entries rotIdx*4+0..3
        pa = oam[(rotIdx * 4 + 0) * 8 + 6] | (oam[(rotIdx * 4 + 0) * 8 + 7] << 8);
        pb = oam[(rotIdx * 4 + 1) * 8 + 6] | (oam[(rotIdx * 4 + 1) * 8 + 7] << 8);
        pc = oam[(rotIdx * 4 + 2) * 8 + 6] | (oam[(rotIdx * 4 + 2) * 8 + 7] << 8);
        pd = oam[(rotIdx * 4 + 3) * 8 + 6] | (oam[(rotIdx * 4 + 3) * 8 + 7] << 8);
        // Sign-extend 16-bit
        if (pa & 0x8000) pa -= 0x10000;
        if (pb & 0x8000) pb -= 0x10000;
        if (pc & 0x8000) pc -= 0x10000;
        if (pd & 0x8000) pd -= 0x10000;
      }

      const renderW = doubleSize ? w * 2 : w;
      const cx = renderW >> 1;
      const cy = renderH >> 1;

      for (let dx = 0; dx < renderW; dx++) {
        let sx = x + dx;
        if (sx < 0 || sx >= GBA_WIDTH) continue;
        let tx: number, ty: number;
        if (affine) {
          // Affine transform: map screen-space (dx,dy) to texture-space (tx,ty)
          const sdx = dx - cx;
          const sdy = dy - cy;
          // GBATEK formula: (dx - cx) * PA + (dy - cy) * PB >> 8 + (W / 2)
          tx = (((sdx * pa + sdy * pb) >> 8) + (w >> 1)) | 0;
          ty = (((sdx * pc + sdy * pd) >> 8) + (h >> 1)) | 0;
          if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
        } else {
          tx = dx;
          ty = dy;
          if (hflip) tx = w - 1 - tx;
          if (vflip) ty = h - 1 - ty;
        }

        let colorIdx: number;
        // GBATEK: OAM attr2 Character Base is in units of 0x20 (32) bytes.
        // For 8bpp (64-byte tiles), tileBase*32 gives the byte offset.
        // For 4bpp (32-byte tiles), tileBase*32 = tileBase*tile_size, so tileBase IS the tile number.
        if (bpp8) {
          let off: number;
          const baseByteOff = tileBase * 32;
          if (oneD) {
            // 1D: tiles laid out linearly, stride = w/8 tiles per row × 64 bytes
            off = tileDataBase + baseByteOff + Math.floor(ty / 8) * (w / 8) * 64 + Math.floor(tx / 8) * 64 + (ty & 7) * 8 + (tx & 7);
          } else {
            // 2D: 16 tiles per row (1024 bytes per row)
            const baseRow = Math.floor(baseByteOff / 1024);
            const baseCol = Math.floor((baseByteOff % 1024) / 64);
            const tileRow = baseRow + Math.floor(ty / 8);
            const tileCol = baseCol + Math.floor(tx / 8);
            off = tileDataBase + tileRow * 1024 + tileCol * 64 + (ty & 7) * 8 + (tx & 7);
          }
          colorIdx = vram[off & (vram.length - 1)];
        } else {
          let off: number;
          // 4bpp: tileBase is already the tile number (32 bytes per tile = 0x20 unit)
          if (oneD) {
            off = tileDataBase + (tileBase + Math.floor(ty / 8) * (w / 8) + Math.floor(tx / 8)) * 32 + (ty & 7) * 4 + ((tx & 7) >> 1);
          } else {
            // 2D: 32 tiles per row (1024 bytes per row)
            const tileRow = Math.floor(tileBase / tilesPerRow4) + Math.floor(ty / 8);
            const tileCol = (tileBase % tilesPerRow4) + Math.floor(tx / 8);
            off = tileDataBase + tileRow * 1024 + tileCol * 32 + (ty & 7) * 4 + ((tx & 7) >> 1);
          }
          const byte = vram[off & (vram.length - 1)];
          colorIdx = (tx & 1) ? (byte >> 4) & 0xf : byte & 0xf;
        }
        if (colorIdx === 0) continue;
        let color: number;
        if (bpp8) color = PPU.color555to32(palette[0x200 + colorIdx * 2] | (palette[0x200 + colorIdx * 2 + 1] << 8));
        else color = PPU.color555to32(palette[0x200 + palIdx * 32 + colorIdx * 2] | (palette[0x200 + palIdx * 32 + colorIdx * 2 + 1] << 8));
        // write with priority (lower prio = front; later sprites (lower i) draw over)
        if (prio <= this.objPrio[sx] || this.objColor[sx] === 0) {
          this.objColor[sx] = color;
          this.objPrio[sx] = prio;
          this.objLayer[sx] = 5; // OBJ layer ID
          // Semi-transparent: objMode === 1 (requires alpha blending enabled)
          this.objSemi[sx] = (objMode === 1) ? 1 : 0;
        }
      }
    }
  }

  private objDims(shape: number, size: number): { w: number; h: number } {
    // GBA sprite dimension table (from GBATEK)
    const t = [
      [[8, 8], [16, 16], [32, 32], [64, 64]],    // square (shape 0)
      [[16, 8], [32, 8], [32, 16], [64, 32]],     // wide (shape 1)
      [[8, 16], [8, 32], [16, 32], [32, 64]],     // tall (shape 2)
      [[8, 8], [8, 8], [8, 8], [8, 8]],           // invalid (shape 3)
    ];
    const d = t[shape][size];
    return { w: d[0], h: d[1] };
  }
}
