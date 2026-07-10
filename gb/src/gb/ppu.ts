// Picture Processing Unit - supports both DMG (4-shade) and CGB (color) modes.
//
// DMG mode:
//   - 4 shades of green via BGP/OBP0/OBP1 palettes
//   - Framebuffer stores palette indices 0-3
//
// CGB mode adds:
//   - 2 VRAM banks (8KB each) switched via 0xFF4F
//   - 8 BG palettes + 8 OBJ palettes (4 colors each, 16-bit RGB565)
//   - Per-tile BG attributes (palette, VRAM bank, X/Y flip, BG priority)
//   - Per-sprite attributes (palette 0-7, VRAM bank)
//   - Framebuffer stores 32-bit RGBA directly (true color)
//
// Timing reference (in M-cycles, 1 M-cycle = 4 T-cycles):
//   Each scanline takes 114 M-cycles (456 T-cycles).
//   144 visible scanlines + 10 vblank scanlines = 154 total.
//   One full frame = 154 * 114 = 17556 M-cycles.

export class PPU {
  // I/O registers
  lcdc: number = 0x91;        // 0xFF40 - LCD control
  stat: number = 0x85;        // 0xFF41 - LCD status
  scy: number = 0x00;         // 0xFF42 - scroll Y
  scx: number = 0x00;         // 0xFF43 - scroll X
  ly: number = 0x00;          // 0xFF44 - current scanline
  lyc: number = 0x00;         // 0xFF45 - LYC compare
  bgp: number = 0xFC;         // 0xFF47 - BG palette (DMG)
  obp0: number = 0xFF;        // 0xFF48 - sprite palette 0 (DMG)
  obp1: number = 0xFF;        // 0xFF49 - sprite palette 1 (DMG)
  wy: number = 0x00;          // 0xFF4A - window Y
  wx: number = 0x00;          // 0xFF4B - window X

  // CGB-specific registers
  vramBank: number = 0;       // 0xFF4F bit 0 - current VRAM bank (for CPU access)
  bgpi: number = 0x00;        // 0xFF68 - BG palette index (bit 7 = auto-increment)
  bgpd: number = 0x00;        // 0xFF69 - BG palette data
  obpi: number = 0x00;        // 0xFF6A - OBJ palette index (bit 7 = auto-increment)
  obpd: number = 0x00;        // 0xFF6B - OBJ palette data
  opri: number = 0x00;        // 0xFF6C - OBJ priority mode

  // VRAM - 2 banks of 8KB in CGB mode, 1 bank in DMG
  vram: Uint8Array = new Uint8Array(0x4000);  // 16KB total (banks 0 and 1)
  oam: Uint8Array = new Uint8Array(0xA0);

  // CGB palettes: 8 BG palettes × 4 colors × 2 bytes + 8 OBJ palettes × 4 colors × 2 bytes
  // Each color is 16-bit RGB565 (5 bits R, 6 bits G, 5 bits B - actually CGB uses 5-bit RGB with bit 15 unused)
  // Layout: byte 0 = low (R5 G3), byte 1 = high (G2 B5)
  bgPalette: Uint8Array = new Uint8Array(64);   // 32 bytes of palette data
  objPalette: Uint8Array = new Uint8Array(64);  // 32 bytes of palette data

  // Framebuffer: 160x144x4 bytes (RGBA32)
  // In DMG mode we still write RGBA (converted from palette indices)
  // In CGB mode we write the actual palette colors
  framebuffer: Uint8Array = new Uint8Array(160 * 144 * 4);

  // Internal state
  mode: number = 2;
  private modeClock: number = 0;
  private spritesOnLine: number[] = [];

  private onRequestInterrupt: (bit: number) => void;

  frameCount: number = 0;
  frameReady: boolean = false;

  // CGB mode flag (set by MMU when ROM has CGB flag)
  cgbMode: boolean = false;

  // Double-speed mode (CGB only)
  doubleSpeed: boolean = false;
  private ppuCycleAccumulator: number = 0;

  constructor(onRequestInterrupt: (bit: number) => void) {
    this.onRequestInterrupt = onRequestInterrupt;
  }

  reset() {
    this.mode = 2;
    this.modeClock = 0;
    this.ly = 0;
    this.frameReady = false;
    this.frameCount = 0;
    this.vramBank = 0;
    // The boot ROMs leave the LCD ON (LCDC=0x91) before jumping to 0x0100.
    this.lcdc = 0x91;
    // Reset DMG palette registers to post-boot defaults
    this.bgp = 0xFC;    // BG palette: all dark initially
    this.obp0 = 0xFF;   // OBJ palette 0: all light
    this.obp1 = 0xFF;   // OBJ palette 1: all light
    this.scy = 0;
    this.scx = 0;
    this.lyc = 0;
    this.wy = 0;
    this.wx = 0;
    this.stat = 0x85;
    // Reset CGB palette index registers
    this.bgpi = 0;
    this.obpi = 0;
    // Reset LCD-off tracking
    this._lcdWasOff = false;
  }

  // LCDC bit helpers
  get lcdEnabled(): boolean { return (this.lcdc & 0x80) !== 0; }
  get windowTileMap(): number { return (this.lcdc & 0x40) !== 0 ? 0x1C00 : 0x1800; }
  get windowEnabled(): boolean { return (this.lcdc & 0x20) !== 0; }
  get bgWindowTileData(): number { return (this.lcdc & 0x10) !== 0 ? 0x0000 : 0x1000; }
  get bgTileMap(): number { return (this.lcdc & 0x08) !== 0 ? 0x1C00 : 0x1800; }
  get spriteHeight(): number { return (this.lcdc & 0x04) !== 0 ? 16 : 8; }
  get spritesEnabled(): boolean { return (this.lcdc & 0x02) !== 0; }
  get bgEnabled(): boolean { return (this.lcdc & 0x01) !== 0; }

  // VRAM access - CPU reads/writes go to the selected bank
  readVram(offset: number): number {
    const bankOffset = this.vramBank * 0x2000 + offset;
    return this.vram[bankOffset] || 0;
  }
  writeVram(offset: number, value: number) {
    const bankOffset = this.vramBank * 0x2000 + offset;
    if (bankOffset < this.vram.length) this.vram[bankOffset] = value;
  }
  // Internal access by PPU rendering - always bank 0 for tile data unless attribute specifies otherwise
  private vramRead(bank: number, offset: number): number {
    return this.vram[bank * 0x2000 + offset] || 0;
  }

  readOam(offset: number): number { return this.oam[offset]; }
  writeOam(offset: number, value: number) { this.oam[offset] = value; }

  setStat(value: number) {
    this.stat = (this.stat & 0x07) | (value & 0x78) | 0x80;
    this.checkLyc();
  }

  private checkLyc() {
    if (this.ly === this.lyc) {
      this.stat |= 0x04;
      if (this.stat & 0x40) this.onRequestInterrupt(1);
    } else {
      this.stat &= ~0x04;
    }
  }

  tick(mCycles: number) {
    if (!this.lcdEnabled) {
      // When LCD is off, real hardware shows a blank white screen.
      // We must clear the framebuffer so stale pixels from the previous
      // frame don't bleed through when the LCD turns back on.
      if (this.ly !== 0 || !this._lcdWasOff) {
        this.clearFramebuffer();
      }
      this._lcdWasOff = true;
      this.ly = 0;
      this.mode = 0;
      this.modeClock = 0;
      this.stat = (this.stat & 0x78) | 0x80;
      return;
    }
    this._lcdWasOff = false;

    let ppuCycles = mCycles;
    if (this.doubleSpeed) {
      this.ppuCycleAccumulator += mCycles;
      ppuCycles = Math.floor(this.ppuCycleAccumulator / 2);
      this.ppuCycleAccumulator %= 2;
    }

    for (let i = 0; i < ppuCycles; i++) {
      this.tickOneMCycle();
    }
  }

  private _lcdWasOff: boolean = false;

  // Clear the framebuffer to white (blank screen).
  // Called when LCD is off and at the start of each new frame to prevent
  // frame accumulation artifacts (stale pixels from previous frames).
  // Alpha is set to 0 so sprite priority checks see "no BG drawn here".
  private clearFramebuffer() {
    // Fill RGB with 0xFF (white), alpha with 0x00 (no priority)
    // Do this in 4-byte chunks: R=FF G=FF B=FF A=00
    const fb = this.framebuffer;
    for (let i = 0; i < fb.length; i += 4) {
      fb[i] = 0xFF;
      fb[i + 1] = 0xFF;
      fb[i + 2] = 0xFF;
      fb[i + 3] = 0x00;
    }
  }

  private tickOneMCycle() {
    this.modeClock++;

    switch (this.mode) {
      case 2:
        if (this.modeClock === 1) {
          this.findSprites();
        }
        if (this.modeClock >= 20) {
          this.mode = 3;
          this.modeClock = 0;
          this.stat = (this.stat & 0xFC) | 0x03;
          if (this.stat & 0x20) this.onRequestInterrupt(1);
        }
        break;

      case 3:
        if (this.modeClock === 1) {
          this.drawScanline();
        }
        if (this.modeClock >= 43) {
          this.mode = 0;
          this.modeClock = 0;
          this.stat = (this.stat & 0xFC) | 0x00;
          if (this.stat & 0x08) this.onRequestInterrupt(1);
        }
        break;

      case 0:
        if (this.modeClock >= 51) {
          this.modeClock = 0;
          this.ly++;
          this.checkLyc();

          if (this.ly === 144) {
            this.mode = 1;
            this.stat = (this.stat & 0xFC) | 0x01;
            this.frameReady = true;
            this.frameCount++;
            this.onRequestInterrupt(0);
            if (this.stat & 0x10) this.onRequestInterrupt(1);
          } else {
            this.mode = 2;
            this.stat = (this.stat & 0xFC) | 0x02;
            if (this.stat & 0x20) this.onRequestInterrupt(1);
          }
        }
        break;

      case 1:
        if (this.modeClock >= 114) {
          this.modeClock = 0;
          this.ly++;
          if (this.ly > 153) {
            this.ly = 0;
            this.mode = 2;
            this.stat = (this.stat & 0xFC) | 0x02;
            if (this.stat & 0x20) this.onRequestInterrupt(1);
            // Note: We do NOT clear the framebuffer here. The BG drawing
            // (drawBackgroundCGB/drawBackgroundDMG) covers every pixel of
            // every scanline, so the entire framebuffer is overwritten each
            // frame. Clearing here would cause white flashes if any scanline
            // isn't fully drawn (e.g., mid-frame LCDC changes).
          }
          this.checkLyc();
        }
        break;
    }
  }

  private findSprites() {
    this.spritesOnLine = [];
    const height = this.spriteHeight;
    for (let i = 0; i < 40; i++) {
      const spriteY = this.oam[i * 4] - 16;
      if (this.ly >= spriteY && this.ly < spriteY + height) {
        this.spritesOnLine.push(i);
        if (this.spritesOnLine.length === 10) break;
      }
    }
    // In CGB mode, sprite priority is by OAM index (lower = higher priority) unless OPRI bit 0 is set
    if (!this.cgbMode || (this.opri & 0x01) === 0) {
      // DMG mode: sort by X (lowest X has highest priority)
      this.spritesOnLine.sort((a, b) => {
        const xa = this.oam[a * 4 + 1];
        const xb = this.oam[b * 4 + 1];
        if (xa !== xb) return xa - xb;
        return a - b;
      });
    }
  }

  private drawScanline() {
    if (this.cgbMode) {
      this.drawScanlineCGB();
    } else {
      this.drawScanlineDMG();
    }
  }

  // DMG mode rendering (4-shade palette)
  private drawScanlineDMG() {
    if (this.bgEnabled) {
      this.drawBackgroundDMG();
    } else {
      for (let x = 0; x < 160; x++) {
        this.setPixel(x, this.ly, 155, 188, 15);
      }
    }
    if (this.windowEnabled && this.wy <= this.ly) {
      this.drawWindowDMG();
    }
    if (this.spritesEnabled) {
      this.drawSpritesDMG();
    }
  }

  private drawBackgroundDMG() {
    const tileMap = this.bgTileMap;
    const tileData = this.bgWindowTileData;
    const signed = (this.lcdc & 0x10) === 0;
    const y = (this.ly + this.scy) & 0xFF;
    const tileRow = (y >> 3) & 0x1F;

    for (let x = 0; x < 160; x++) {
      const sx = (x + this.scx) & 0xFF;
      const tileCol = (sx >> 3) & 0x1F;
      const tileIdx = this.vram[tileMap + tileRow * 32 + tileCol];
      let tileAddr: number;
      if (signed) {
        tileAddr = tileData + (((tileIdx << 24) >> 24) * 16);
      } else {
        tileAddr = tileData + tileIdx * 16;
      }
      const py = y & 0x07;
      const b1 = this.vram[tileAddr + py * 2];
      const b2 = this.vram[tileAddr + py * 2 + 1];
      const px = sx & 0x07;
      const bit = 7 - px;
      const colorIdx = ((b2 >> bit) & 0x01) << 1 | ((b1 >> bit) & 0x01);
      const shade = (this.bgp >> (colorIdx * 2)) & 0x03;
      const [r, g, b] = DMG_SHADES[shade];
      this.setPixel(x, this.ly, r, g, b);
    }
  }

  private drawWindowDMG() {
    const tileMap = this.windowTileMap;
    const tileData = this.bgWindowTileData;
    const signed = (this.lcdc & 0x10) === 0;
    const windowY = this.ly - this.wy;
    if (windowY < 0) return;
    const tileRow = (windowY >> 3) & 0x1F;
    const startX = this.wx - 7;
    if (startX >= 160) return;

    for (let x = Math.max(0, startX); x < 160; x++) {
      const windowX = x - startX;
      if (windowX < 0) continue;
      const tileCol = (windowX >> 3) & 0x1F;
      const tileIdx = this.vram[tileMap + tileRow * 32 + tileCol];
      let tileAddr: number;
      if (signed) {
        tileAddr = tileData + (((tileIdx << 24) >> 24) * 16);
      } else {
        tileAddr = tileData + tileIdx * 16;
      }
      const py = windowY & 0x07;
      const b1 = this.vram[tileAddr + py * 2];
      const b2 = this.vram[tileAddr + py * 2 + 1];
      const px = windowX & 0x07;
      const bit = 7 - px;
      const colorIdx = ((b2 >> bit) & 0x01) << 1 | ((b1 >> bit) & 0x01);
      const shade = (this.bgp >> (colorIdx * 2)) & 0x03;
      const [r, g, b] = DMG_SHADES[shade];
      this.setPixel(x, this.ly, r, g, b);
    }
  }

  private drawSpritesDMG() {
    const height = this.spriteHeight;
    for (const i of this.spritesOnLine) {
      const spriteY = this.oam[i * 4] - 16;
      const spriteX = this.oam[i * 4 + 1] - 8;
      const tileBase = this.oam[i * 4 + 2];
      const flags = this.oam[i * 4 + 3];
      const priority = (flags & 0x80) !== 0;
      const yFlip = (flags & 0x40) !== 0;
      const xFlip = (flags & 0x20) !== 0;
      const palette = (flags & 0x10) !== 0 ? this.obp1 : this.obp0;
      const tile = height === 16 ? (tileBase & 0xFE) : tileBase;

      let row = this.ly - spriteY;
      if (yFlip) row = height - 1 - row;
      const b1 = this.vram[tile * 16 + row * 2];
      const b2 = this.vram[tile * 16 + row * 2 + 1];

      for (let px = 0; px < 8; px++) {
        const screenX = spriteX + px;
        if (screenX < 0 || screenX >= 160) continue;
        const bit = xFlip ? px : 7 - px;
        const colorIdx = ((b2 >> bit) & 0x01) << 1 | ((b1 >> bit) & 0x01);
        if (colorIdx === 0) continue;
        if (priority && this.getPixelIdx(screenX, this.ly) !== 0) continue;
        const shade = (palette >> (colorIdx * 2)) & 0x03;
        const [r, g, b] = DMG_SHADES[shade];
        this.setPixel(screenX, this.ly, r, g, b);
      }
    }
  }

  // CGB mode rendering (per-tile palettes, VRAM banking, attributes)
  private drawScanlineCGB() {
    // In CGB mode, LCDC bit 0 is the "BG and Window Master Priority" flag.
    // When bit 0 = 0, BG and Window are completely OFF — the scanline should
    // be blank (palette 0 color 0) with only sprites visible on top.
    const bgPriorityMaster = (this.lcdc & 0x01) !== 0;

    if (bgPriorityMaster) {
      this.drawBackgroundCGB(true);
      if (this.windowEnabled && this.wy <= this.ly) {
        this.drawWindowCGB(true);
      }
    } else {
      // BG is off: clear this scanline to palette 0 color 0 (background color)
      const [r, g, b] = this.getCgbColor(this.bgPalette, 0, 0);
      for (let x = 0; x < 160; x++) {
        this.setPixel(x, this.ly, r, g, b);
      }
    }

    if (this.spritesEnabled) {
      this.drawSpritesCGB();
    }
  }

  private drawBackgroundCGB(bgPriorityMaster: boolean) {
    const tileMap = this.bgTileMap;
    const tileData = this.bgWindowTileData;
    const signed = (this.lcdc & 0x10) === 0;
    const y = (this.ly + this.scy) & 0xFF;
    const tileRow = (y >> 3) & 0x1F;
    // CGB attribute map is in VRAM BANK 1 at the SAME offset as the tile map in bank 0.
    const attrBase = tileMap;  // same offset, but read from bank 1

    for (let x = 0; x < 160; x++) {
      const sx = (x + this.scx) & 0xFF;
      const tileCol = (sx >> 3) & 0x1F;
      const mapIdx = tileRow * 32 + tileCol;
      const tileIdx = this.vramRead(0, tileMap + mapIdx);
      const attr = this.vramRead(1, attrBase + mapIdx);

      const attrVramBank = (attr & 0x08) ? 1 : 0;
      const attrPalette = attr & 0x07;
      const attrXFlip = (attr & 0x20) !== 0;
      const attrYFlip = (attr & 0x40) !== 0;
      const attrBgPriority = (attr & 0x80) !== 0;

      let tileAddr: number;
      if (signed) {
        tileAddr = tileData + (((tileIdx << 24) >> 24) * 16);
      } else {
        tileAddr = tileData + tileIdx * 16;
      }

      let py = y & 0x07;
      if (attrYFlip) py = 7 - py;
      const b1 = this.vramRead(attrVramBank, tileAddr + py * 2);
      const b2 = this.vramRead(attrVramBank, tileAddr + py * 2 + 1);

      let px = sx & 0x07;
      if (attrXFlip) px = 7 - px;
      const bit = 7 - px;
      const colorIdx = ((b2 >> bit) & 0x01) << 1 | ((b1 >> bit) & 0x01);

      // Get color from CGB BG palette
      const [r, g, b] = this.getCgbColor(this.bgPalette, attrPalette, colorIdx);
      // Color 0 in any palette is "transparent" for BG priority purposes,
      // but for visual rendering we just draw it.
      // We store the priority info in the alpha channel: alpha=0 means "BG color 0" (sprite can override)
      const isColorZero = colorIdx === 0;
      this.setPixelWithPriority(x, this.ly, r, g, b, bgPriorityMaster && !isColorZero, attrBgPriority, attrPalette);
    }
  }

  private drawWindowCGB(bgPriorityMaster: boolean) {
    const tileMap = this.windowTileMap;
    const tileData = this.bgWindowTileData;
    const signed = (this.lcdc & 0x10) === 0;
    const windowY = this.ly - this.wy;
    if (windowY < 0) return;
    const tileRow = (windowY >> 3) & 0x1F;
    // CGB attribute map is in VRAM BANK 1 at the SAME offset as the tile map.
    const attrBase = tileMap;
    const startX = this.wx - 7;
    if (startX >= 160) return;

    for (let x = Math.max(0, startX); x < 160; x++) {
      const windowX = x - startX;
      if (windowX < 0) continue;
      const tileCol = (windowX >> 3) & 0x1F;
      const mapIdx = tileRow * 32 + tileCol;
      const tileIdx = this.vramRead(0, tileMap + mapIdx);
      const attr = this.vramRead(1, attrBase + mapIdx);

      const attrVramBank = (attr & 0x08) ? 1 : 0;
      const attrPalette = attr & 0x07;
      const attrXFlip = (attr & 0x20) !== 0;
      const attrYFlip = (attr & 0x40) !== 0;
      const attrBgPriority = (attr & 0x80) !== 0;

      let tileAddr: number;
      if (signed) {
        tileAddr = tileData + (((tileIdx << 24) >> 24) * 16);
      } else {
        tileAddr = tileData + tileIdx * 16;
      }

      let py = windowY & 0x07;
      if (attrYFlip) py = 7 - py;
      const b1 = this.vramRead(attrVramBank, tileAddr + py * 2);
      const b2 = this.vramRead(attrVramBank, tileAddr + py * 2 + 1);

      let px = windowX & 0x07;
      if (attrXFlip) px = 7 - px;
      const bit = 7 - px;
      const colorIdx = ((b2 >> bit) & 0x01) << 1 | ((b1 >> bit) & 0x01);

      const [r, g, b] = this.getCgbColor(this.bgPalette, attrPalette, colorIdx);
      const isColorZero = colorIdx === 0;
      this.setPixelWithPriority(x, this.ly, r, g, b, bgPriorityMaster && !isColorZero, attrBgPriority, attrPalette);
    }
  }

  private drawSpritesCGB() {
    const height = this.spriteHeight;
    for (const i of this.spritesOnLine) {
      const spriteY = this.oam[i * 4] - 16;
      const spriteX = this.oam[i * 4 + 1] - 8;
      const tileBase = this.oam[i * 4 + 2];
      const flags = this.oam[i * 4 + 3];
      // CGB sprite attributes:
      //   bit 0-2: CGB palette number (0-7)
      //   bit 3: VRAM bank
      //   bit 4: DMG palette (ignored in CGB mode)
      //   bit 5: X flip
      //   bit 6: Y flip
      //   bit 7: priority (1 = behind BG colors 1-3)
      const cgbPalette = flags & 0x07;
      const vramBank = (flags & 0x08) ? 1 : 0;
      const xFlip = (flags & 0x20) !== 0;
      const yFlip = (flags & 0x40) !== 0;
      const priority = (flags & 0x80) !== 0;
      const tile = height === 16 ? (tileBase & 0xFE) : tileBase;

      let row = this.ly - spriteY;
      if (yFlip) row = height - 1 - row;
      const b1 = this.vramRead(vramBank, tile * 16 + row * 2);
      const b2 = this.vramRead(vramBank, tile * 16 + row * 2 + 1);

      for (let px = 0; px < 8; px++) {
        const screenX = spriteX + px;
        if (screenX < 0 || screenX >= 160) continue;
        const bit = xFlip ? px : 7 - px;
        const colorIdx = ((b2 >> bit) & 0x01) << 1 | ((b1 >> bit) & 0x01);
        if (colorIdx === 0) continue;  // Color 0 is transparent for sprites

        // Check BG priority
        const fbIdx = (this.ly * 160 + screenX) * 4;
        const bgPriorityByte = this.framebuffer[fbIdx + 3];  // We stash priority in alpha during BG drawing
        const bgIsNonZero = (bgPriorityByte & 0x40) !== 0;    // BG pixel is non-color-0

        if (priority && bgIsNonZero) continue;  // Sprite is behind BG colors 1-3

        const [r, g, b] = this.getCgbColor(this.objPalette, cgbPalette, colorIdx);
        this.setPixel(screenX, this.ly, r, g, b);
      }
    }
  }

  // Decode a CGB palette color. Palette data is 32 bytes per palette set (8 palettes × 4 colors × 1 byte... no wait)
  // Actually: 8 palettes × 4 colors × 2 bytes = 64 bytes per palette set (BG or OBJ)
  // Each color is 16-bit: byte 0 = R5 G3, byte 1 = G2 B5 (5 bits each)
  private getCgbColor(palette: Uint8Array, paletteNum: number, colorIdx: number): [number, number, number] {
    const offset = (paletteNum * 4 + colorIdx) * 2;
    const lo = palette[offset];
    const hi = palette[offset + 1];
    const color16 = lo | (hi << 8);
    // RGB555: 5 bits per channel, bit 15 unused
    const r5 = color16 & 0x1F;
    const g5 = (color16 >> 5) & 0x1F;
    const b5 = (color16 >> 10) & 0x1F;
    const r = (r5 << 3) | (r5 >> 2);
    const g = (g5 << 3) | (g5 >> 2);
    const b = (b5 << 3) | (b5 >> 2);
    return [r, g, b];
  }

  // Set a pixel with RGBA values
  private setPixel(x: number, y: number, r: number, g: number, b: number) {
    const idx = (y * 160 + x) * 4;
    this.framebuffer[idx] = r;
    this.framebuffer[idx + 1] = g;
    this.framebuffer[idx + 2] = b;
    this.framebuffer[idx + 3] = 255;
  }

  // Set a pixel with priority info stashed in alpha (used by CGB BG rendering)
  // We use alpha bits: 0x80 = BG priority master on, 0x40 = non-color-0 (sprite can be hidden)
  // The actual visible alpha is always 255; we OR in 0x80|0x40 internally then sprites clear it
  private setPixelWithPriority(x: number, y: number, r: number, g: number, b: number, bgPriority: boolean, _tilePriority: boolean, _palette: number) {
    const idx = (y * 160 + x) * 4;
    this.framebuffer[idx] = r;
    this.framebuffer[idx + 1] = g;
    this.framebuffer[idx + 2] = b;
    // Stash priority in alpha: bit 7 = bg priority master, bit 6 = non-color-0
    let alpha = 0;
    if (bgPriority) alpha |= 0x40;
    this.framebuffer[idx + 3] = alpha;
  }

  // DMG helper: get palette index at pixel (for sprite priority check)
  private getPixelIdx(x: number, y: number): number {
    // In DMG mode we don't actually track the palette index in the framebuffer anymore.
    // For sprite priority (DMG bit 7), we need to know if BG pixel is color 0.
    // We approximate: if alpha bit 6 is set, BG is non-color-0.
    const idx = (y * 160 + x) * 4;
    return (this.framebuffer[idx + 3] & 0x40) ? 1 : 0;
  }

  // CGB palette register access
  writeBgpi(value: number) {
    this.bgpi = value & 0xBF;  // Bit 7 = auto-increment, bits 0-5 = index
  }
  writeBgpd(value: number) {
    const index = this.bgpi & 0x3F;
    this.bgPalette[index] = value & 0xFF;
    if (this.bgpi & 0x80) {
      this.bgpi = (this.bgpi & 0x80) | ((index + 1) & 0x3F);
    }
  }
  readBgpi(): number { return this.bgpi | 0x40; }
  readBgpd(): number {
    const index = this.bgpi & 0x3F;
    const v = this.bgPalette[index] || 0;
    if (this.bgpi & 0x80) {
      this.bgpi = (this.bgpi & 0x80) | ((index + 1) & 0x3F);
    }
    return v;
  }

  writeObpi(value: number) {
    this.obpi = value & 0xBF;
  }
  writeObpd(value: number) {
    const index = this.obpi & 0x3F;
    this.objPalette[index] = value & 0xFF;
    if (this.obpi & 0x80) {
      this.obpi = (this.obpi & 0x80) | ((index + 1) & 0x3F);
    }
  }
  readObpi(): number { return this.obpi | 0x40; }
  readObpd(): number {
    const index = this.obpi & 0x3F;
    const v = this.objPalette[index] || 0;
    if (this.obpi & 0x80) {
      this.obpi = (this.obpi & 0x80) | ((index + 1) & 0x3F);
    }
    return v;
  }
}

// DMG green palette shades
const DMG_SHADES: number[][] = [
  [155, 188, 15],   // 0 - lightest
  [139, 172, 15],   // 1
  [48, 98, 48],     // 2
  [15, 56, 15],     // 3 - darkest
];
