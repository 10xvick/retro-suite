import { Cartridge } from './cartridge';

const NES_PALETTE = [
  0x7C7C7C, 0x0000FC, 0x0000BC, 0x4428BC, 0x940084, 0xA80020, 0xA81000, 0x881400,
  0x503000, 0x007800, 0x006800, 0x005800, 0x004058, 0x000000, 0x000000, 0x000000,
  0xBCBCBC, 0x0078F8, 0x0058F8, 0x6844FC, 0xD800B8, 0xE40058, 0xF83800, 0xE45C10,
  0xAC7C00, 0x00B800, 0x00A800, 0x00A844, 0x008888, 0x000000, 0x000000, 0x000000,
  0xF8F8F8, 0x3CBCFC, 0x6888FC, 0x9878FC, 0xF878F8, 0xF85898, 0xF87858, 0xFCA044,
  0xF8B800, 0xB8F818, 0x58D854, 0x58F898, 0x00E8D8, 0x787878, 0x000000, 0x000000,
  0xF8F8F8, 0xA4E4FC, 0xB8B8F8, 0xD8B8F8, 0xF8B8F8, 0xF8A4C0, 0xF0D0B0, 0xFCE0A0,
  0xFCE078, 0xD8F878, 0xB8F8B8, 0xB8F8D8, 0x00FCFC, 0xF8D8F8, 0x000000, 0x000000
];

export class PPU {
  private cart: Cartridge | null = null;

  // PPU Memory regions
  public vram: Uint8Array = new Uint8Array(2048); // 2KB Nametable VRAM
  public palette: Uint8Array = new Uint8Array(32); // 32 bytes color palettes
  public oam: Uint8Array = new Uint8Array(256); // 256 bytes sprite OAM

  // Render Framebuffer (256 * 240 pixel index colors)
  public frameBuffer: Int32Array = new Int32Array(256 * 240);

  // Scanline and cycle state
  public scanline = 0;
  public cycle = 0;
  public nmiTriggered = false; // Flag to trigger CPU NMI interrupt

  // PPU registers
  private control = 0x00;   // PPUCTRL $2000
  private mask = 0x00;      // PPUMASK $2001
  private status = 0x00;    // PPUSTATUS $2002
  private oamAddr = 0x00;   // OAMADDR $2003
  
  // Loopy Scrolling & VRAM address states
  private vramAddr = 0x0000;   // v: Current VRAM address (15 bits)
  private tempAddr = 0x0000;   // t: Temporary VRAM address (15 bits)
  private fineX = 0;           // x: Fine X scroll (3 bits)
  private writeLatch = 0;      // w: First/second write latch (1 bit)
  private ppuDataBuffer = 0x00;
  private lastA12 = 0;
  private a12LowTimer = 0;

  constructor() {}

  public connectCartridge(cart: Cartridge) {
    this.cart = cart;
  }

  public reset() {
    this.vram.fill(0);
    this.palette.fill(0);
    this.oam.fill(0);
    this.frameBuffer.fill(0);
    this.scanline = 0;
    this.cycle = 0;
    this.control = 0;
    this.mask = 0;
    this.status = 0;
    this.oamAddr = 0;
    this.vramAddr = 0;
    this.tempAddr = 0;
    this.fineX = 0;
    this.writeLatch = 0;
    this.ppuDataBuffer = 0;
    this.nmiTriggered = false;
    this.lastA12 = 0;
    this.a12LowTimer = 0;
  }

  private getA12ForCycle(): number {
    // We only care about cycles 1 to 336 during active rendering
    if (this.cycle < 1 || this.cycle > 336) {
      return 0;
    }

    if (this.cycle >= 1 && this.cycle <= 256) {
      const phase = (this.cycle - 1) % 8;
      if (phase === 0 || phase === 1 || phase === 2 || phase === 3) {
        return 0; // NT/AT fetch
      } else {
        return (this.control & 0x10) !== 0 ? 1 : 0; // BG pattern fetch
      }
    } else if (this.cycle >= 257 && this.cycle <= 320) {
      const phase = (this.cycle - 257) % 8;
      if (phase === 0 || phase === 1 || phase === 2 || phase === 3) {
        return 0; // Sprite NT/AT fetch
      } else {
        // Sprite pattern fetch
        if ((this.control & 0x20) !== 0) {
          // 8x16 sprites mode
          const spriteSlot = Math.floor((this.cycle - 257) / 8);
          // Find the sprite corresponding to this slot
          let spriteCount = 0;
          let spriteTable = 1; // Default to 1 (fetching dummy tile $FF)
          for (let i = 0; i < 256; i += 4) {
            const spriteY = this.oam[i] + 1;
            if (this.scanline >= spriteY && this.scanline < spriteY + 16) {
              if (spriteCount === spriteSlot) {
                const tileIndex = this.oam[i + 1];
                spriteTable = tileIndex & 0x01;
                break;
              }
              spriteCount++;
            }
          }
          return spriteTable;
        } else {
          // 8x8 sprites mode
          return (this.control & 0x08) !== 0 ? 1 : 0;
        }
      }
    } else if (this.cycle >= 321 && this.cycle <= 336) {
      const phase = (this.cycle - 321) % 8;
      if (phase === 0 || phase === 1 || phase === 2 || phase === 3) {
        return 0; // Next scanline NT/AT fetch
      } else {
        return (this.control & 0x10) !== 0 ? 1 : 0; // Next scanline BG pattern fetch
      }
    }

    return 0;
  }

  // CPU memory-mapped registers read
  public cpuRead(reg: number): number {
    let data = 0;
    switch (reg) {
      case 2: // PPUSTATUS
        data = (this.status & 0xE0) | (this.ppuDataBuffer & 0x1F);
        // Clear VBlank bit and reset write latch
        this.status &= ~0x80;
        this.writeLatch = 0;
        break;
      case 4: // OAMDATA
        data = this.oam[this.oamAddr];
        break;
      case 7: // PPUDATA
        data = this.ppuDataBuffer;
        this.ppuDataBuffer = this.ppuRead(this.vramAddr);
        if (this.vramAddr >= 0x3F00) {
          data = this.ppuDataBuffer; // Palette data is read instantly
        }
        // Increment VRAM address by 1 or 32
        this.vramAddr += (this.control & 0x04) !== 0 ? 32 : 1;
        this.vramAddr &= 0x3FFF;
        break;
    }
    return data;
  }

  // CPU memory-mapped registers write
  public cpuWrite(reg: number, data: number) {
    switch (reg) {
      case 0: // PPUCTRL
        const oldNmi = (this.control & 0x80) !== 0;
        this.control = data;
        const newNmi = (data & 0x80) !== 0;
        if (!oldNmi && newNmi && (this.status & 0x80) !== 0) {
          this.nmiTriggered = true;
        }
        // t: ...GH.. ........ = d: ......GH
        this.tempAddr = (this.tempAddr & 0xF3FF) | ((data & 0x03) << 10);
        break;
      case 1: // PPUMASK
        this.mask = data;
        break;
      case 3: // OAMADDR
        this.oamAddr = data;
        break;
      case 4: // OAMDATA
        this.oam[this.oamAddr] = data;
        this.oamAddr = (this.oamAddr + 1) & 0xFF;
        break;
      case 5: // PPUSCROLL
        if (this.writeLatch === 0) {
          // First write (X scroll):
          // t: ....... ...ABCDE = d: ABCDE...
          // fineX = d: .....FGH
          this.tempAddr = (this.tempAddr & 0xFFE0) | (data >> 3);
          this.fineX = data & 0x07;
          this.writeLatch = 1;
        } else {
          // Second write (Y scroll):
          // t: FGH..AB CDE..... = d: ABCDE FGH
          this.tempAddr = (this.tempAddr & 0x0C1F) | ((data & 0x07) << 12) | ((data & 0xF8) << 2);
          this.writeLatch = 0;
        }
        break;
      case 6: // PPUADDR
        if (this.writeLatch === 0) {
          // First write (high byte):
          // t: .CDEFGH ........ = d: ..CDEFGH
          // t: A...... ........ = 0
          this.tempAddr = (this.tempAddr & 0x00FF) | ((data & 0x3F) << 8);
          this.writeLatch = 1;
        } else {
          // Second write (low byte):
          // t: ....... ABCDEFGH = d: ABCDEFGH
          // v = t
          this.tempAddr = (this.tempAddr & 0xFF00) | data;
          this.vramAddr = this.tempAddr;
          this.writeLatch = 0;
        }
        break;
      case 7: // PPUDATA
        this.ppuWrite(this.vramAddr, data);
        this.vramAddr += (this.control & 0x04) !== 0 ? 32 : 1;
        this.vramAddr &= 0x3FFF;
        break;
    }
  }

  public writeOam(index: number, val: number) {
    this.oam[index] = val;
  }

  // Internally reads VRAM/Cartridge space
  private ppuRead(addr: number): number {
    addr &= 0x3FFF;
    if (this.cart && addr <= 0x1FFF) {
      return this.cart.ppuRead(addr);
    } 
    else if (addr >= 0x2000 && addr <= 0x3EFF) {
      return this.vram[this.getNametableOffset(addr)];
    } 
    else if (addr >= 0x3F00 && addr <= 0x3FFF) {
      let palAddr = addr & 0x001F;
      // Handle mirroring of transparency indices
      if (palAddr === 0x0010 || palAddr === 0x0014 || palAddr === 0x0018 || palAddr === 0x001C) {
        palAddr &= 0x000F;
      }
      return this.palette[palAddr];
    }
    return 0;
  }

  private ppuWrite(addr: number, data: number) {
    addr &= 0x3FFF;
    if (this.cart && addr <= 0x1FFF) {
      this.cart.ppuWrite(addr, data);
    } 
    else if (addr >= 0x2000 && addr <= 0x3EFF) {
      this.vram[this.getNametableOffset(addr)] = data;
    } 
    else if (addr >= 0x3F00 && addr <= 0x3FFF) {
      let palAddr = addr & 0x001F;
      if (palAddr === 0x0010 || palAddr === 0x0014 || palAddr === 0x0018 || palAddr === 0x001C) {
        palAddr &= 0x000F;
      }
      this.palette[palAddr] = data;
    }
  }

  // Maps mirroring offsets to the 2KB VRAM array
  private getNametableOffset(addr: number): number {
    addr = (addr - 0x2000) & 0x0FFF;
    const page = Math.floor(addr / 0x0400);
    const offset = addr & 0x03FF;
    const mirrorMode = this.cart ? this.cart.mirror : 0;

    if (mirrorMode === 1) { // VERTICAL MIRRORING
      if (page === 0 || page === 2) return offset;
      return 0x0400 + offset;
    } else { // HORIZONTAL MIRRORING
      if (page === 0 || page === 1) return offset;
      return 0x0400 + offset;
    }
  }

  // Ticks the PPU scroll Y address at the end of active scanlines
  private incrementY() {
    // If fine Y (bits 12-14) < 7, increment fine Y
    if ((this.vramAddr & 0x7000) !== 0x7000) {
      this.vramAddr += 0x1000;
    } else {
      // Fine Y wraps to 0
      this.vramAddr &= ~0x7000;
      // Increment coarse Y (bits 5-9)
      let y = (this.vramAddr & 0x03E0) >> 5;
      if (y === 29) {
        y = 0;
        // Toggle vertical nametable select (bit 11)
        this.vramAddr ^= 0x0800;
      } else if (y === 31) {
        y = 0;
      } else {
        y++;
      }
      this.vramAddr = (this.vramAddr & 0xFC1F) | (y << 5);
    }
  }

  // Copies horizontal scroll bits from temp to current address
  private transferX() {
    // Copy coarse X (bits 0-4) and horizontal nametable select (bit 10)
    this.vramAddr = (this.vramAddr & 0xFBE0) | (this.tempAddr & 0x041F);
  }

  // Copies vertical scroll bits from temp to current address
  private transferY() {
    // Copy fine Y (bits 12-14), coarse Y (bits 5-9), and vertical nametable select (bit 11)
    this.vramAddr = (this.vramAddr & 0x841F) | (this.tempAddr & 0x7BE0);
  }

  // Ticks the PPU core logic
  public clock() {
    const renderingEnabled = (this.mask & 0x18) !== 0;
    const inRenderingRange = (this.scanline >= 0 && this.scanline < 240) || this.scanline === 261;

    // Track A12 and clock MMC3 scanline counter
    let currentA12 = 0;
    if (renderingEnabled && inRenderingRange) {
      currentA12 = this.getA12ForCycle();
    } else {
      currentA12 = (this.vramAddr & 0x1000) !== 0 ? 1 : 0;
    }

    if (currentA12 === 0) {
      this.a12LowTimer++;
    } else {
      if (this.a12LowTimer >= 10) {
        if (this.cart) {
          this.cart.mapper.tickScanline();
        }
      }
      this.a12LowTimer = 0;
    }
    this.lastA12 = currentA12;

    if (this.scanline >= 0 && this.scanline < 240) {
      if (this.cycle === 256) {
        this.renderScanline();
        if (renderingEnabled) {
          this.incrementY();
        }
      }
      if (this.cycle === 257 && renderingEnabled) {
        this.transferX();
      }
    }

    if (this.scanline === 241 && this.cycle === 1) {
      // Enter VBlank state: set flag, trigger CPU NMI interrupt
      this.status |= 0x80;
      if ((this.control & 0x80) !== 0) {
        this.nmiTriggered = true;
      }
    }

    if (this.scanline === 261) {
      if (this.cycle === 1) {
        // Clear VBlank and sprite collision flags on pre-render scanline
        this.status &= ~0xE0;
      }
      if (this.cycle >= 280 && this.cycle <= 304 && renderingEnabled) {
        this.transferY();
      }
      if (this.cycle === 257 && renderingEnabled) {
        this.transferX();
      }
    }

    this.cycle++;
    if (this.cycle >= 341) {
      this.cycle = 0;
      this.scanline++;
      if (this.scanline >= 262) {
        this.scanline = 0;
      }
    }
  }

  // Scanline rendering core engine
  private renderScanline() {
    const showBG = (this.mask & 0x08) !== 0;
    const showSprites = (this.mask & 0x10) !== 0;

    // Reset collision buffer for this scanline
    const bgPixelActive = new Uint8Array(256);

    // 1. Draw Background pixels if enabled
    if (showBG) {
      // Extract active scroll from vramAddr for the beginning of this scanline
      let v = this.vramAddr;
      let fineY = (v >> 12) & 0x0007;
      let tileY = (v >> 5) & 0x001F;
      let nametable = 0x2000 + (v & 0x0C00);

      // Fine X offset (starting pixel offset in the first tile)
      let fineX = this.fineX;
      let tileX = v & 0x001F;

      for (let pixelX = 0; pixelX < 256; pixelX++) {
        // Fetch background tile index
        const tileAddress = nametable + tileY * 32 + tileX;
        const tileIndex = this.ppuRead(tileAddress);

        // Fetch attribute high-bit palette grouping
        const attrAddress = nametable + 0x03C0 + Math.floor(tileY / 4) * 8 + Math.floor(tileX / 4);
        const attrByte = this.ppuRead(attrAddress);
        const quadX = Math.floor((tileX % 4) / 2);
        const quadY = Math.floor((tileY % 4) / 2);
        
        let palHigh = 0;
        if (quadX === 0 && quadY === 0) palHigh = attrByte & 0x03;
        else if (quadX === 1 && quadY === 0) palHigh = (attrByte >> 2) & 0x03;
        else if (quadX === 0 && quadY === 1) palHigh = (attrByte >> 4) & 0x03;
        else if (quadX === 1 && quadY === 1) palHigh = (attrByte >> 6) & 0x03;

        // Fetch pattern table character graphics (2 bits per pixel color index)
        const patternTable = (this.control & 0x10) !== 0 ? 0x1000 : 0x0000;
        const patternAddress = patternTable + tileIndex * 16 + fineY;
        const plane1 = this.ppuRead(patternAddress);
        const plane2 = this.ppuRead(patternAddress + 8);

        // Extract color index bits
        const bit1 = (plane1 & (0x80 >> fineX)) !== 0 ? 1 : 0;
        const bit2 = (plane2 & (0x80 >> fineX)) !== 0 ? 1 : 0;
        const colorIdx = (bit2 << 1) | bit1;

        if (colorIdx !== 0) {
          bgPixelActive[pixelX] = colorIdx; // Latch collision bit
        }

        // Translate index to system color
        const systemPaletteIndex = this.ppuRead(0x3F00 + (palHigh << 2) + colorIdx);
        this.frameBuffer[this.scanline * 256 + pixelX] = NES_PALETTE[systemPaletteIndex & 0x3F];

        // Increment X scroll for the next pixel
        fineX++;
        if (fineX === 8) {
          fineX = 0;
          tileX++;
          if (tileX === 32) {
            tileX = 0;
            nametable ^= 0x0400; // Toggle horizontal nametable select
          }
        }
      }
    } else {
      // Draw background flat color
      const systemPaletteIndex = this.ppuRead(0x3F00);
      for (let x = 0; x < 256; x++) {
        this.frameBuffer[this.scanline * 256 + x] = NES_PALETTE[systemPaletteIndex & 0x3F];
      }
    }

    // 2. Draw Sprite pixels if enabled
    if (showSprites) {
      const spriteHeight = (this.control & 0x20) !== 0 ? 16 : 8;
      
      // Loop through sprites from low priority to high priority (OAM reverse index)
      for (let i = 252; i >= 0; i -= 4) {
        const spriteY = this.oam[i] + 1;
        const tileIndex = this.oam[i + 1];
        const attributes = this.oam[i + 2];
        const spriteX = this.oam[i + 3];

        // Is this sprite on the current scanline?
        if (this.scanline >= spriteY && this.scanline < spriteY + spriteHeight) {
          const row = this.scanline - spriteY;
          const flipY = (attributes & 0x80) !== 0;
          const flipX = (attributes & 0x40) !== 0;
          const palHigh = attributes & 0x03;
          const priority = (attributes & 0x20) === 0; // true = in front, false = behind background

          // Vertical flip calculations
          const fetchRow = flipY ? (spriteHeight - 1 - row) : row;

          let patternAddr = 0;
          if (spriteHeight === 8) {
            // 8x8 Sprites mode
            const patternTable = (this.control & 0x08) !== 0 ? 0x1000 : 0x0000;
            patternAddr = patternTable + tileIndex * 16 + fetchRow;
          } else {
            // 8x16 Sprites mode
            const patternTable = (tileIndex & 0x01) !== 0 ? 0x1000 : 0x0000;
            let index = tileIndex & 0xFE;
            if (fetchRow >= 8) {
              index++;
            }
            patternAddr = patternTable + index * 16 + (fetchRow & 7);
          }

          const plane1 = this.ppuRead(patternAddr);
          const plane2 = this.ppuRead(patternAddr + 8);

          // Draw the 8 pixels horizontally
          for (let col = 0; col < 8; col++) {
            const screenX = spriteX + col;
            if (screenX >= 256) continue;

            const shift = flipX ? col : (7 - col);
            const bit1 = (plane1 & (1 << shift)) !== 0 ? 1 : 0;
            const bit2 = (plane2 & (1 << shift)) !== 0 ? 1 : 0;
            const colorIdx = (bit2 << 1) | bit1;

            if (colorIdx === 0) continue; // Transparency

            // Check Sprite 0 Hit collision logic
            if (i === 0 && bgPixelActive[screenX] !== 0 && screenX < 255) {
              this.status |= 0x40; // Set Sprite 0 Hit flag
            }

            // Priority check (draw behind background if priority bit set)
            if (priority || bgPixelActive[screenX] === 0) {
              const systemPaletteIndex = this.ppuRead(0x3F10 + (palHigh << 2) + colorIdx);
              this.frameBuffer[this.scanline * 256 + screenX] = NES_PALETTE[systemPaletteIndex & 0x3F];
            }
          }
        }
      }
    }
  }
}
