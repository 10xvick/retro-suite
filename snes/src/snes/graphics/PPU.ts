export class PPU {
  // Memory arrays
  public vram = new Uint16Array(32 * 1024); // 64KB VRAM (32K 16-bit words)
  public cgram = new Uint16Array(256);     // 512 bytes CGRAM (256 15-bit colors)
  public oam = new Uint8Array(544);        // 544 bytes OAM (128 sprites + high table)

  // Canvas Resolution
  public readonly width = 256;
  public readonly height = 224;

  // Registers
  public screenDisplay = 0x80; // Brightness and screen blanking ($2100)
  private spriteSize = 0;       // Sprite size / selection ($2101)
  private oamAddr = 0;          // OAM Address ($2102-$2103)
  private oamBaseAddr = 0;      // Programmed OAM address base
  private oamLatch = 0;         // Low byte buffer for write-twice
  private oamWriteToggle = false;
  private oamPriorityRotation = false; // Bit 7 of $2103

  // BG Mode and character sizes ($2105)
  public bgMode = 1; // Default to Mode 1
  public bgSizes = [0, 0, 0, 0]; // 0 = 8x8, 1 = 16x16
  public mainScreenDesignation = 0x1F; // Main screen designation ($212C)
  public subScreenDesignation = 0x00;  // Sub screen designation ($212D)
  public bg3Priority = false;          // BG3 priority flag from $2105

  // BG Tile Map Addresses ($2107-$210A) and sizes
  public bgTilemaps = [0, 0, 0, 0]; // Word offsets in VRAM
  public bgTilemapSizes = [0, 0, 0, 0]; // 0=32x32, 1=64x32, 2=32x64, 3=64x64

  // BG Character Addresses ($210B-$210C)
  public bgCharAddress = [0, 0, 0, 0]; // Word offsets in VRAM

  // BG Scroll Registers ($210D-$2114)
  public bgScrollH = [0, 0, 0, 0];
  public bgScrollV = [0, 0, 0, 0];
  private scrollLatches = [0, 0, 0, 0, 0, 0, 0, 0];
  private scrollToggles = [false, false, false, false, false, false, false, false];

  // VRAM Ports ($2115-$2119)
  private vramIncrementMode = 0; // 0 = increment on $2118/low write, 1 = $2119/high write
  private vramIncrementVal = 1;
  private vramAddressTranslation = 0; // 0=none, 1=8-bit, 2=9-bit, 3=10-bit
  private vramAddress = 0;

  // CGRAM Port ($2121-$2122)
  private cgramAddress = 0;
  private cgramLatch = 0; // Low/High byte latch for CGRAM color writes
  private cgramToggle = false;

  // Mosaic ($2106)
  private mosaicReg = 0;

  // Window Masking ($2123-$212B, $212E-$212F)
  private w12sel = 0;
  private w34sel = 0;
  private wobjsel = 0;
  private wbglog = 0;
  private wobjlog = 0;
  private mainScreenWindowEnable = 0; // TMW
  private subScreenWindowEnable = 0;  // TSW
  private win1Left = 0;
  private win1Right = 0;
  private win2Left = 0;
  private win2Right = 0;

  // Color Math & Screen settings ($2130-$2133)
  private cgwsel = 0;
  private cgadsub = 0;
  private fixedColorR = 0;
  private fixedColorG = 0;
  private fixedColorB = 0;
  private setiniReg = 0;

  // Mode 7 ($211A-$2120)
  private m7sel = 0;
  private m7a = 0;
  private m7b = 0;
  private m7c = 0;
  private m7d = 0;
  private m7x = 0;
  private m7y = 0;
  private m7Latches: { [key: string]: number } = { a: 0, b: 0, c: 0, d: 0, x: 0, y: 0 };
  private m7Toggles: { [key: string]: boolean } = { a: false, b: false, c: false, d: false, x: false, y: false };

  private registerCache = new Uint8Array(256);
  
  // Pre-allocated sprite compositing buffers to avoid GC pressure
  private spritePixels = new Uint8Array(256);
  private spritePriorities = new Uint8Array(256);
  private spritePaletteBases = new Uint16Array(256);
  private spriteIndices = new Int16Array(256);

  // H/V Counters and Status ($2137, $213C-$213F)
  private hCounterLatched = 0;
  private vCounterLatched = 0;
  private hvCounterLatchState = false;
  private hCounterLatchToggle = false;
  private vCounterLatchToggle = false;

  // Synchronization and field status
  public bus: any = null;
  public currentScanline = 0;
  public fieldToggle = false;
  public disableSpritesForNextScanline = false;

  constructor() { }

  // Reset state
  public reset() {
    this.vram.fill(0);
    this.cgram.fill(0);
    this.oam.fill(288);

    this.screenDisplay = 0x0F; // Full brightness, no blanking
    this.spriteSize = 0;
    this.oamAddr = 0;
    this.oamBaseAddr = 0;
    this.oamLatch = 0;
    this.oamWriteToggle = false;
    this.oamPriorityRotation = false;
    this.disableSpritesForNextScanline = false;
    this.bgMode = 1;
    this.bgSizes = [0, 0, 0, 0];
    this.bgTilemaps = [0, 0, 0, 0];
    this.bgTilemapSizes = [0, 0, 0, 0];
    this.bgCharAddress = [0, 0, 0, 0];
    this.bgScrollH = [0, 0, 0, 0];
    this.bgScrollV = [0, 0, 0, 0];
    this.scrollLatches.fill(0);
    this.scrollToggles.fill(false);
    this.vramIncrementMode = 0;
    this.vramIncrementVal = 1;
    this.vramAddressTranslation = 0;
    this.vramAddress = 0;
    this.cgramAddress = 0;
    this.cgramLatch = 0;
    this.cgramToggle = false;
    this.mainScreenDesignation = 0x1F;
    this.subScreenDesignation = 0x00;
    this.bg3Priority = false;

    this.mosaicReg = 0;
    this.w12sel = 0;
    this.w34sel = 0;
    this.wobjsel = 0;
    this.wbglog = 0;
    this.wobjlog = 0;
    this.mainScreenWindowEnable = 0;
    this.subScreenWindowEnable = 0;
    this.win1Left = 0;
    this.win1Right = 0;
    this.win2Left = 0;
    this.win2Right = 0;
    this.cgwsel = 0;
    this.cgadsub = 0;
    this.fixedColorR = 0;
    this.fixedColorG = 0;
    this.fixedColorB = 0;
    this.setiniReg = 0;

    this.m7sel = 0;
    this.m7a = 0;
    this.m7b = 0;
    this.m7c = 0;
    this.m7d = 0;
    this.m7x = 0;
    this.m7y = 0;
    this.m7Latches = { a: 0, b: 0, c: 0, d: 0, x: 0, y: 0 };
    this.m7Toggles = { a: false, b: false, c: false, d: false, x: false, y: false };

    this.hCounterLatched = 0;
    this.vCounterLatched = 0;
    this.hvCounterLatchState = false;
    this.hCounterLatchToggle = false;
    this.vCounterLatchToggle = false;
    this.currentScanline = 0;
    this.fieldToggle = false;
  }

  public startFrame() {
    this.oamAddr = this.oamBaseAddr;
    this.oamWriteToggle = false;
    this.cgramToggle = false;
    this.m7Toggles = { a: false, b: false, c: false, d: false, x: false, y: false };
    this.scrollToggles.fill(false);
    this.hCounterLatchToggle = false;
    this.vCounterLatchToggle = false;
  }

  // Register read
  public readRegister(addr: number): number {
    switch (addr) {
      case 0x2134: // MPYL (Multiply low byte)
        {
          const product = (this.m7a * this.m7b) >>> 0;
          return product & 0xFF;
        }
      case 0x2135: // MPYM (Multiply mid byte)
        {
          const product = (this.m7a * this.m7b) >>> 0;
          return (product >> 8) & 0xFF;
        }
      case 0x2136: // MPYH (Multiply high byte)
        {
          const product = (this.m7a * this.m7b) >>> 0;
          return (product >> 16) & 0xFF;
        }
      case 0x2137: // Software Latch
        {
          const currentCyclesInScanline = (this.bus && this.bus.cpu) ? (this.bus.cpu.cycles % 228) : 0;
          this.hCounterLatched = Math.floor((currentCyclesInScanline / 228) * 340);
          this.vCounterLatched = this.currentScanline;
          this.hvCounterLatchState = true;
          return 0x00;
        }
      case 0x213C: // OPHCT (horizontal counter)
        if (!this.hCounterLatchToggle) {
          this.hCounterLatchToggle = true;
          return this.hCounterLatched & 0xFF;
        } else {
          this.hCounterLatchToggle = false;
          return (this.hCounterLatched >> 8) & 0x01;
        }
      case 0x213D: // OPVCT (vertical counter)
        if (!this.vCounterLatchToggle) {
          this.vCounterLatchToggle = true;
          return this.vCounterLatched & 0xFF;
        } else {
          this.vCounterLatchToggle = false;
          return (this.vCounterLatched >> 8) & 0x01;
        }
      case 0x213E: // STAT77
        return 0x01; // Version 1, no overflow
      case 0x213F: // STAT78 (Status register)
        this.scrollToggles.fill(false);
        this.hCounterLatchToggle = false;
        this.vCounterLatchToggle = false;
        const statusVal = 0x03 | (this.hvCounterLatchState ? 0x40 : 0x00) | (this.fieldToggle ? 0x80 : 0x00);
        this.hvCounterLatchState = false;
        return statusVal;
      default:
        return this.registerCache[addr & 0xFF];
    }
  }

  // Expose cached register value for diagnostics
  public getRegisterCacheValue(addr: number): number {
    return this.registerCache[addr & 0xFF];
  }

  // Register write
  public writeRegister(addr: number, val: number) {
    this.registerCache[addr & 0xFF] = val;
    switch (addr) {
      case 0x2100: // Screen display
        this.screenDisplay = val;
        if (val & 0x80) {
          const cpuCycles = (this.bus && this.bus.cpu) ? this.bus.cpu.cycles : 0;
          const sy = this.currentScanline;
          const scanlineStartCycles = Math.floor((sy * 59666) / 262);
          const currentCyclesInScanline = cpuCycles - scanlineStartCycles;
          const hblankStart = 130;
          if (currentCyclesInScanline >= hblankStart) {
            this.disableSpritesForNextScanline = true;
          }
        }
        break;
      case 0x2101: // Sprite (OAM) configuration
        this.spriteSize = val;
        break;
      case 0x2102: // OAM address low
        this.oamBaseAddr = (this.oamBaseAddr & 0x100) | val;
        this.oamAddr = this.oamBaseAddr;
        this.oamWriteToggle = false;
        break;
      case 0x2103: // OAM address high
        this.oamBaseAddr = (this.oamBaseAddr & 0xFF) | ((val & 1) << 8);
        this.oamAddr = this.oamBaseAddr;
        this.oamPriorityRotation = (val & 0x80) !== 0;
        this.oamWriteToggle = false;
        break;
      case 0x2104: // OAM write (write-twice)
        if (this.oamAddr < 256) {
          // Low table (first 512 bytes / 256 words)
          if (!this.oamWriteToggle) {
            this.oamLatch = val;
            this.oamWriteToggle = true;
          } else {
            const wordIdx = this.oamAddr;
            this.oam[wordIdx * 2] = this.oamLatch;
            this.oam[wordIdx * 2 + 1] = val;
            this.oamAddr = (this.oamAddr + 1) & 0x1FF;
            this.oamWriteToggle = false;
          }
        } else {
          // High table (last 32 bytes): writes are immediate and address advances per byte.
          this.oam[512 + (this.oamAddr & 0x1F)] = val;
          this.oamAddr = (this.oamAddr + 1) & 0x1FF;
          this.oamWriteToggle = false;
        }
        break;
      case 0x2105: // BG Mode / sizes
        this.bgMode = val & 7;
        this.bg3Priority = (val & 0x08) !== 0;
        this.bgSizes[0] = (val & 0x10) ? 1 : 0;
        this.bgSizes[1] = (val & 0x20) ? 1 : 0;
        this.bgSizes[2] = (val & 0x40) ? 1 : 0;
        this.bgSizes[3] = (val & 0x80) ? 1 : 0;
        break;
      case 0x2106: // Mosaic
        this.mosaicReg = val;
        break;

      // BG Tile Map Addresses ($2107-$210A)
      case 0x2107: // BG1 Map
        this.bgTilemaps[0] = (val & 0xFC) << 8; // Word offset
        this.bgTilemapSizes[0] = val & 3;
        break;
      case 0x2108: // BG2 Map
        this.bgTilemaps[1] = (val & 0xFC) << 8;
        this.bgTilemapSizes[1] = val & 3;
        break;
      case 0x2109: // BG3 Map
        this.bgTilemaps[2] = (val & 0xFC) << 8;
        this.bgTilemapSizes[2] = val & 3;
        break;
      case 0x210A: // BG4 Map
        this.bgTilemaps[3] = (val & 0xFC) << 8;
        this.bgTilemapSizes[3] = val & 3;
        break;

      // BG Character Addresses ($210B-$210C)
      case 0x210B: // BG1 & BG2 Character
        this.bgCharAddress[0] = (val & 0x0F) << 12;
        this.bgCharAddress[1] = (val & 0xF0) << 8;
        break;
      case 0x210C: // BG3 & BG4 Character
        this.bgCharAddress[2] = (val & 0x0F) << 12;
        this.bgCharAddress[3] = (val & 0xF0) << 8;
        break;

      // BG Scrolls ($210D-$2114) - Write twice (Low, then High)
      case 0x210D: // BG1 Scroll H
        this.writeScroll(0, 0, val);
        break;
      case 0x210E: // BG1 Scroll V
        this.writeScroll(0, 1, val);
        break;
      case 0x210F: // BG2 Scroll H
        this.writeScroll(1, 0, val);
        break;
      case 0x2110: // BG2 Scroll V
        this.writeScroll(1, 1, val);
        break;
      case 0x2111: // BG3 Scroll H
        this.writeScroll(2, 0, val);
        break;
      case 0x2112: // BG3 Scroll V
        this.writeScroll(2, 1, val);
        break;
      case 0x2113: // BG4 Scroll H
        this.writeScroll(3, 0, val);
        break;
      case 0x2114: // BG4 Scroll V
        this.writeScroll(3, 1, val);
        break;

      // VRAM Port registers
      case 0x2115: // VRAM Video Port Control
        this.vramIncrementMode = (val & 0x80) ? 1 : 0;
        this.vramAddressTranslation = (val & 0x0C) >> 2;
        const incType = val & 3;
        if (incType === 0) this.vramIncrementVal = 1;
        else if (incType === 1) this.vramIncrementVal = 32;
        else this.vramIncrementVal = 128;
        break;
      case 0x2116: // VRAM address low
        this.vramAddress = (this.vramAddress & 0xFF00) | val;
        break;
      case 0x2117: // VRAM address high
        this.vramAddress = (this.vramAddress & 0x00FF) | (val << 8);
        break;
      case 0x2118: // VRAM write data low
        this.writeVramLow(this.vramAddress, val);
        if (this.vramIncrementMode === 0) {
          this.vramAddress = (this.vramAddress + this.vramIncrementVal) & 0xFFFF;
        }
        break;
      case 0x2119: // VRAM write data high
        this.writeVramHigh(this.vramAddress, val);
        if (this.vramIncrementMode === 1) {
          this.vramAddress = (this.vramAddress + this.vramIncrementVal) & 0xFFFF;
        }
        break;

      // Mode 7 registers
      case 0x211A: // M7SEL
        this.m7sel = val;
        break;
      case 0x211B: // M7A
        this.writeM7('a', val);
        break;
      case 0x211C: // M7B
        this.writeM7('b', val);
        break;
      case 0x211D: // M7C
        this.writeM7('c', val);
        break;
      case 0x211E: // M7D
        this.writeM7('d', val);
        break;
      case 0x211F: // M7X
        this.writeM7Center('x', val);
        break;
      case 0x2120: // M7Y
        this.writeM7Center('y', val);
        break;

      // CGRAM Port registers
      case 0x2121: // CGRAM Address
        this.cgramAddress = val;
        this.cgramLatch = 0;
        this.cgramToggle = false;
        break;
      case 0x2122: // CGRAM Write (write-twice)
        if (!this.cgramToggle) {
          this.cgramLatch = val;
          this.cgramToggle = true;
        } else {
          const colorVal = (val << 8) | this.cgramLatch;
          this.cgram[this.cgramAddress] = colorVal & 0x7FFF;
          this.cgramAddress = (this.cgramAddress + 1) & 0xFF;
          this.cgramToggle = false;
        }
        break;

      // Window selection registers
      case 0x2123: // W12SEL
        this.w12sel = val;
        break;
      case 0x2124: // W34SEL
        this.w34sel = val;
        break;
      case 0x2125: // WOBJSEL
        this.wobjsel = val;
        break;
      case 0x2126: // WH0 (Window 1 Left)
        this.win1Left = val;
        break;
      case 0x2127: // WH1 (Window 1 Right)
        this.win1Right = val;
        break;
      case 0x2128: // WH2 (Window 2 Left)
        this.win2Left = val;
        break;
      case 0x2129: // WH3 (Window 2 Right)
        this.win2Right = val;
        break;
      case 0x212A: // WBGLOG
        this.wbglog = val;
        break;
      case 0x212B: // WOBJLOG
        this.wobjlog = val;
        break;

      case 0x212C: // Main screen designation (TM)
        this.mainScreenDesignation = val;
        break;
      case 0x212D: // Sub screen designation (TS)
        this.subScreenDesignation = val;
        break;
      case 0x212E: // TMW
        this.mainScreenWindowEnable = val;
        break;
      case 0x212F: // TSW
        this.subScreenWindowEnable = val;
        break;

      // Color math registers
      case 0x2130: // CGWSEL
        this.cgwsel = val;
        break;
      case 0x2131: // CGADSUB
        this.cgadsub = val;
        break;
      case 0x2132: // COLDATA
        {
          const intensity = val & 0x1F;
          if (val & 0x20) this.fixedColorR = intensity;
          if (val & 0x40) this.fixedColorG = intensity;
          if (val & 0x80) this.fixedColorB = intensity;
        }
        break;
      case 0x2133: // SETINI
        this.setiniReg = val;
        break;
    }
  }

  private writeM7(reg: 'a' | 'b' | 'c' | 'd', val: number) {
    if (!this.m7Toggles[reg]) {
      this.m7Latches[reg] = val;
      this.m7Toggles[reg] = true;
    } else {
      const u16 = (val << 8) | this.m7Latches[reg];
      const s16 = (u16 << 16) >> 16;
      if (reg === 'a') this.m7a = s16;
      else if (reg === 'b') this.m7b = s16;
      else if (reg === 'c') this.m7c = s16;
      else this.m7d = s16;
      this.m7Toggles[reg] = false;
    }
  }

  private writeM7Center(reg: 'x' | 'y', val: number) {
    if (!this.m7Toggles[reg]) {
      this.m7Latches[reg] = val;
      this.m7Toggles[reg] = true;
    } else {
      const u13 = (((val & 0x1F) << 8) | this.m7Latches[reg]) & 0x1FFF;
      const s13 = (u13 << 19) >> 19;
      if (reg === 'x') this.m7x = s13;
      else this.m7y = s13;
      this.m7Toggles[reg] = false;
    }
  }

  private writeScroll(bg: number, isVertical: number, val: number) {
    const idx = (bg * 2) + isVertical;
    if (!this.scrollToggles[idx]) {
      this.scrollLatches[idx] = val;
      this.scrollToggles[idx] = true;
    } else {
      const full = (((val & 0x1F) << 8) | this.scrollLatches[idx]) & 0x1FFF;
      if (isVertical) this.bgScrollV[bg] = full;
      else this.bgScrollH[bg] = full;
      this.scrollToggles[idx] = false;
    }
  }

  private getTranslatedVramAddress(addr: number): number {
    addr &= 0x7FFF;
    if (this.vramAddressTranslation === 0) return addr;
    if (this.vramAddressTranslation === 1) { // 8-bit translation
      return (addr & 0xFF00) | ((addr & 0x00E0) >> 5) | ((addr & 0x001F) << 3);
    }
    if (this.vramAddressTranslation === 2) { // 9-bit translation
      return (addr & 0xFE00) | ((addr & 0x01C0) >> 6) | ((addr & 0x003F) << 3);
    }
    if (this.vramAddressTranslation === 3) { // 10-bit translation
      return (addr & 0xFC00) | ((addr & 0x0380) >> 7) | ((addr & 0x007F) << 3);
    }
    return addr;
  }

  private writeVramLow(addr: number, val: number) {
    const translatedAddr = this.getTranslatedVramAddress(addr);
    const current = this.vram[translatedAddr];
    this.vram[translatedAddr] = (current & 0xFF00) | val;
  }

  private writeVramHigh(addr: number, val: number) {
    const translatedAddr = this.getTranslatedVramAddress(addr);
    const current = this.vram[translatedAddr];
    this.vram[translatedAddr] = (current & 0x00FF) | (val << 8);
  }

  private writeOam(addr: number, val: number) {
    if (addr < 544) {
      this.oam[addr] = val;
    }
  }

  // Convert SNES 15-bit color (0BBBBBGGGGGRRRRR) to 32-bit RGBA integer
  private getRgbaColor(cgramIndex: number): number {
    const color = this.cgram[cgramIndex & 0xFF];
    const r = (color & 0x1F) << 3;
    const g = ((color >> 5) & 0x1F) << 3;
    const b = ((color >> 10) & 0x1F) << 3;

    // Return formatted as ABGR integer (standard for Canvas ImageData pixel buffer on little-endian)
    return 0xFF000000 | (b << 16) | (g << 8) | r;
  }

  // Render a full frame of 256x224 pixels using scanline compositing
  // Render a single scanline of 256 pixels using compositing
  public renderScanline(sy: number, pixelBuffer: Uint32Array) {
    if (this.screenDisplay & 0x80) {
      const rowOffset = sy * this.width;
      for (let sx = 0; sx < this.width; sx++) {
        pixelBuffer[rowOffset + sx] = 0xFF000000;
      }
      return;
    }

    const backdropColor = this.cgram[0];
    const brightness = (this.screenDisplay & 0x0F);

    // Sprite parameters
    const sss = (this.spriteSize >> 5) & 7;
    const nn = (this.spriteSize >> 3) & 3;
    const bbb = this.spriteSize & 7;
    const base1 = bbb << 13;
    const base2 = (base1 + ((nn + 1) << 12)) & 0x7FFF;

    // Compositing buffers for scanline (reused to avoid GC)
    const spritePixels = this.spritePixels;
    const spritePriorities = this.spritePriorities;
    const spritePaletteBases = this.spritePaletteBases;
    const spriteIndices = this.spriteIndices;

    spritePixels.fill(0);
    spritePriorities.fill(0);
    spritePaletteBases.fill(0);
    spriteIndices.fill(-1);

    const mainScreenObjEnabled = (this.mainScreenDesignation & 16) !== 0;
    const subScreenObjEnabled = (this.subScreenDesignation & 16) !== 0;

    if ((mainScreenObjEnabled || subScreenObjEnabled) && !this.disableSpritesForNextScanline) {
      const startSprite = this.oamPriorityRotation ? ((this.oamAddr >> 1) & 127) : 0;
      // Loop from lowest priority to highest priority
      for (let c = 127; c >= 0; c--) {
        const i = (startSprite + c) & 127;
        const oamOffset = i * 4;
        const xLow = this.oam[oamOffset];
        const y = this.oam[oamOffset + 1];
        const tileIndex = this.oam[oamOffset + 2];
        const attr = this.oam[oamOffset + 3];

        const highByteIdx = Math.floor(i / 4);
        const highBitShift = (i % 4) * 2;
        const highVal = this.oam[512 + highByteIdx];

        const xHigh = (highVal >> highBitShift) & 1;
        const sizeToggle = (highVal >> (highBitShift + 1)) & 1;

        let x = xLow | (xHigh << 8);
        if (x >= 256) x -= 512;

        const sizeInfo = this.getSpriteSize(sss, sizeToggle);
        const width = sizeInfo.w;
        const height = sizeInfo.h;

        // Check if sprite is active on this scanline
        let spriteY = y;
        if (spriteY >= 224) {
          spriteY -= 256;
        }

        if (sy >= spriteY && sy < spriteY + height) {
          if (x + width <= 0 || x >= 256) continue;

          const useSecondBlock = attr & 1;
          const charBase = useSecondBlock ? base2 : base1;
          const paletteOffset = (attr >> 1) & 7;
          const priority = (attr >> 4) & 3;
          const hFlip = (attr & 0x40) !== 0;
          const vFlip = (attr & 0x80) !== 0;

          const paletteBase = 128 + (paletteOffset * 16);
          const tileRowY = vFlip ? (height - 1 - (sy - spriteY)) : (sy - spriteY);
          const subTileY = tileRowY & 7;
          const rowOffset = Math.floor(tileRowY / 8);

          for (let sx = 0; sx < width; sx++) {
            const screenX = x + sx;
            if (screenX < 0 || screenX >= 256) continue;

            const tileColX = hFlip ? (width - 1 - sx) : sx;
            const subTileX = tileColX & 7;
            const colOffset = Math.floor(tileColX / 8);

            const spriteTile = (tileIndex + colOffset + (rowOffset * 16)) & 0xFF;
            const colorIndex = this.getPixelColorIndex(spriteTile, charBase, subTileX, subTileY, 4);

            if (colorIndex !== 0) {
              spritePixels[screenX] = colorIndex;
              spritePriorities[screenX] = priority;
              spritePaletteBases[screenX] = paletteBase;
              spriteIndices[screenX] = i;
            }
          }
        }
      }
    }

    // Composite scanline pixel-by-pixel
    for (let sx = 0; sx < this.width; sx++) {
      // Evaluate Main Screen pixel
      let mainColor = backdropColor;
      let mainCgramIndex = 0;
      let mainMathEnabled = (this.cgadsub & 0x20) !== 0; // default to backdrop color math
      let mainIsSprite = false;
      let mainSpritePaletteIdx = 0;
      let mainVisibleFound = false;

      // Main Screen layer mask enabling
      const mainScreenBg1Enabled = (this.mainScreenDesignation & 1) !== 0;
      const mainScreenBg2Enabled = (this.mainScreenDesignation & 2) !== 0;
      const mainScreenBg3Enabled = (this.mainScreenDesignation & 4) !== 0;
      const mainScreenBg4Enabled = (this.mainScreenDesignation & 8) !== 0;

      const checkBGLayer = (bgIdx: number, targetPri: number): boolean => {
        // 1. EXACT FIX: Check if this BG is enabled in the TM ($212C) register
        const isEnabled = (this.mainScreenDesignation & (1 << bgIdx)) !== 0;
        if (!isEnabled) return false;

        // 2. Existing window masking check...
        if ((this.mainScreenWindowEnable & (1 << bgIdx)) !== 0) {
          if (this.getWindowMask(bgIdx, sx)) return false;
        }

        // 3. Existing tile lookup...
        const pxInfo = this.getBGColorIndex(bgIdx, sx, sy);
        if (pxInfo.colorIndex !== 0 && pxInfo.priority === targetPri) {
          mainCgramIndex = pxInfo.paletteBase + pxInfo.colorIndex;
          mainColor = this.cgram[mainCgramIndex & 0xFF];
          mainMathEnabled = (this.cgadsub & (1 << bgIdx)) !== 0;
          mainVisibleFound = true;
          return true;
        }
        return false;
      };

      const checkObjLayer = (targetPri: number): boolean => {
        if (mainScreenObjEnabled) {
          if ((this.mainScreenWindowEnable & 16) !== 0) {
            if (this.getWindowMask(4, sx)) {
              return false;
            }
          }
          if (spritePixels[sx] !== 0 && spritePriorities[sx] === targetPri) {
            mainCgramIndex = spritePaletteBases[sx] + spritePixels[sx];
            mainColor = this.cgram[mainCgramIndex & 0xFF];
            mainMathEnabled = (this.cgadsub & 0x10) !== 0;
            mainIsSprite = true;
            mainSpritePaletteIdx = (spritePaletteBases[sx] - 128) >> 4;
            mainVisibleFound = true;
            return true;
          }
        }
        return false;
      };

      // Priority table scan for current Mode
      switch (this.bgMode) {
        case 0:
          if (checkObjLayer(3)) break;
          if (checkBGLayer(0, 1)) break;
          if (checkBGLayer(1, 1)) break;
          if (checkObjLayer(2)) break;
          if (checkBGLayer(0, 0)) break;
          if (checkBGLayer(1, 0)) break;
          if (checkObjLayer(1)) break;
          if (checkBGLayer(2, 1)) break;
          if (checkBGLayer(3, 1)) break;
          if (checkObjLayer(0)) break;
          if (checkBGLayer(2, 0)) break;
          if (checkBGLayer(3, 0)) break;
          break;

        case 1:
          if (this.bg3Priority) {
            if (checkBGLayer(2, 1)) break;
            if (checkObjLayer(3)) break;
            if (checkBGLayer(0, 1)) break;
            if (checkBGLayer(1, 1)) break;
            if (checkObjLayer(2)) break;
            if (checkBGLayer(0, 0)) break;
            if (checkBGLayer(1, 0)) break;
            if (checkObjLayer(1)) break;
            if (checkBGLayer(2, 0)) break;
            if (checkObjLayer(0)) break;
          } else {
            if (checkObjLayer(3)) break;
            if (checkBGLayer(0, 1)) break;
            if (checkBGLayer(1, 1)) break;
            if (checkObjLayer(2)) break;
            if (checkBGLayer(0, 0)) break;
            if (checkBGLayer(1, 0)) break;
            if (checkObjLayer(1)) break;
            if (checkBGLayer(2, 1)) break;
            if (checkObjLayer(0)) break;
            if (checkBGLayer(2, 0)) break;
          }
          break;

        case 2:
        case 4:
        case 5:
          if (checkObjLayer(3)) break;
          if (checkBGLayer(0, 1)) break;
          if (checkObjLayer(2)) break;
          if (checkBGLayer(1, 1)) break;
          if (checkObjLayer(1)) break;
          if (checkBGLayer(0, 0)) break;
          if (checkObjLayer(0)) break;
          if (checkBGLayer(1, 0)) break;
          break;

        case 3:
          if (checkObjLayer(3)) break;
          if (checkBGLayer(0, 1)) break;
          if (checkObjLayer(2)) break;
          if (checkBGLayer(1, 1)) break;
          if (checkObjLayer(1)) break;
          if (checkBGLayer(0, 0)) break;
          if (checkObjLayer(0)) break;
          if (checkBGLayer(1, 0)) break;
          break;

        case 6:
          if (checkObjLayer(3)) break;
          if (checkBGLayer(0, 1)) break;
          if (checkObjLayer(2)) break;
          if (checkObjLayer(1)) break;
          if (checkBGLayer(0, 0)) break;
          if (checkObjLayer(0)) break;
          break;

        case 7:
          {
            const extbg = (this.setiniReg & 0x40) !== 0;
            if (checkObjLayer(3)) break;
            if (checkObjLayer(2)) break;
            if (extbg && checkBGLayer(1, 1)) break;
            if (checkObjLayer(1)) break;
            if (checkBGLayer(0, 0)) break;
            if (checkObjLayer(0)) break;
            if (extbg && checkBGLayer(1, 0)) break;
          }
          break;
      }

      // Evaluate Sub Screen pixel (for blending)
      let subColor = backdropColor;
      let subCgramIndex = 0;
      let subVisibleFound = false;

      const subScreenBg1Enabled = (this.subScreenDesignation & 1) !== 0;
      const subScreenBg2Enabled = (this.subScreenDesignation & 2) !== 0;
      const subScreenBg3Enabled = (this.subScreenDesignation & 4) !== 0;
      const subScreenBg4Enabled = (this.subScreenDesignation & 8) !== 0;

      const checkBGSubLayer = (bgIdx: number, targetPri: number): boolean => {
        const isEnabled = (this.subScreenDesignation & (1 << bgIdx)) !== 0;
        if (!isEnabled) return false;

        if ((this.subScreenWindowEnable & (1 << bgIdx)) !== 0) {
          if (this.getWindowMask(bgIdx, sx)) {
            return false;
          }
        }
        const pxInfo = this.getBGColorIndex(bgIdx, sx, sy);
        if (pxInfo.colorIndex !== 0 && pxInfo.priority === targetPri) {
          subCgramIndex = pxInfo.paletteBase + pxInfo.colorIndex;
          subColor = this.cgram[subCgramIndex & 0xFF];
          subVisibleFound = true;
          return true;
        }
        return false;
      };

      const checkObjSubLayer = (targetPri: number): boolean => {
        if (subScreenObjEnabled) {
          if ((this.subScreenWindowEnable & 16) !== 0) {
            if (this.getWindowMask(4, sx)) {
              return false;
            }
          }
          if (spritePixels[sx] !== 0 && spritePriorities[sx] === targetPri) {
            subCgramIndex = spritePaletteBases[sx] + spritePixels[sx];
            subColor = this.cgram[subCgramIndex & 0xFF];
            subVisibleFound = true;
            return true;
          }
        }
        return false;
      };

      switch (this.bgMode) {
        case 0:
          if (checkObjSubLayer(3)) break;
          if (checkBGSubLayer(0, 1)) break;
          if (checkBGSubLayer(1, 1)) break;
          if (checkObjSubLayer(2)) break;
          if (checkBGSubLayer(0, 0)) break;
          if (checkBGSubLayer(1, 0)) break;
          if (checkObjSubLayer(1)) break;
          if (checkBGSubLayer(2, 1)) break;
          if (checkBGSubLayer(3, 1)) break;
          if (checkObjSubLayer(0)) break;
          if (checkBGSubLayer(2, 0)) break;
          if (checkBGSubLayer(3, 0)) break;
          break;

        case 1:
          if (this.bg3Priority) {
            if (checkBGSubLayer(2, 1)) break;
            if (checkObjSubLayer(3)) break;
            if (checkBGSubLayer(0, 1)) break;
            if (checkBGSubLayer(1, 1)) break;
            if (checkObjSubLayer(2)) break;
            if (checkBGSubLayer(0, 0)) break;
            if (checkBGSubLayer(1, 0)) break;
            if (checkObjSubLayer(1)) break;
            if (checkBGSubLayer(2, 0)) break;
            if (checkObjSubLayer(0)) break;
          } else {
            if (checkObjSubLayer(3)) break;
            if (checkBGSubLayer(0, 1)) break;
            if (checkBGSubLayer(1, 1)) break;
            if (checkObjSubLayer(2)) break;
            if (checkBGSubLayer(0, 0)) break;
            if (checkBGSubLayer(1, 0)) break;
            if (checkObjSubLayer(1)) break;
            if (checkBGSubLayer(2, 1)) break;
            if (checkObjSubLayer(0)) break;
            if (checkBGSubLayer(2, 0)) break;
          }
          break;

        case 2:
        case 3:
        case 4:
        case 5:
          if (checkObjSubLayer(3)) break;
          if (checkBGSubLayer(0, 1)) break;
          if (checkObjSubLayer(2)) break;
          if (checkBGSubLayer(1, 1)) break;
          if (checkObjSubLayer(1)) break;
          if (checkBGSubLayer(0, 0)) break;
          if (checkObjSubLayer(0)) break;
          if (checkBGSubLayer(1, 0)) break;
          break;

        case 6:
          if (checkObjSubLayer(3)) break;
          if (checkBGSubLayer(0, 1)) break;
          if (checkObjSubLayer(2)) break;
          if (checkObjSubLayer(1)) break;
          if (checkBGSubLayer(0, 0)) break;
          if (checkObjSubLayer(0)) break;
          break;

        case 7:
          {
            const extbg = (this.setiniReg & 0x40) !== 0;
            if (checkObjSubLayer(3)) break;
            if (checkObjSubLayer(2)) break;
            if (extbg && checkBGSubLayer(1, 1)) break;
            if (checkObjSubLayer(1)) break;
            if (checkBGSubLayer(0, 0)) break;
            if (checkObjSubLayer(0)) break;
            if (extbg && checkBGSubLayer(1, 0)) break;
          }
          break;
      }

      // Color Math execution
      let r = mainColor & 0x1F;
      let g = (mainColor >> 5) & 0x1F;
      let b = (mainColor >> 10) & 0x1F;

      let mathPrevented = false;
      const colorWindowMask = this.getWindowMask(5, sx); // Color Window

      const preventMathMode = (this.cgwsel >> 4) & 3;
      if (preventMathMode === 3) mathPrevented = true;
      else if (preventMathMode === 1 && !colorWindowMask) mathPrevented = true;
      else if (preventMathMode === 2 && colorWindowMask) mathPrevented = true;

      if (mainMathEnabled && !mathPrevented) {
        // Sprite exception: palettes 0-3 do not support math
        if (!(mainIsSprite && mainSpritePaletteIdx < 4)) {
          // Clip Main screen color to black if required
          const clipMode = (this.cgwsel >> 6) & 3;
          if (clipMode === 3 || (clipMode === 1 && !colorWindowMask) || (clipMode === 2 && colorWindowMask)) {
            r = 0; g = 0; b = 0;
          }

          // Select addend color source
          const useSubscreen = (this.cgwsel & 0x02) !== 0;
          let addR = this.fixedColorR;
          let addG = this.fixedColorG;
          let addB = this.fixedColorB;
          let actualSubscreenUsed = false;

          if (useSubscreen) {
            addR = subColor & 0x1F;
            addG = (subColor >> 5) & 0x1F;
            addB = (subColor >> 10) & 0x1F;
            actualSubscreenUsed = subVisibleFound;
          }

          // Addition / Subtraction
          const isSubtraction = (this.cgadsub & 0x80) !== 0;
          const isHalf = (this.cgadsub & 0x40) !== 0 && actualSubscreenUsed;

          if (isSubtraction) {
            r = Math.max(0, r - addR);
            g = Math.max(0, g - addG);
            b = Math.max(0, b - addB);
          } else {
            r = Math.min(31, r + addR);
            g = Math.min(31, g + addG);
            b = Math.min(31, b + addB);
          }

          if (isHalf) {
            r >>= 1;
            g >>= 1;
            b >>= 1;
          }
        }
      }

      // Apply Brightness
      r = (r * brightness) / 15;
      g = (g * brightness) / 15;
      b = (b * brightness) / 15;

      // Convert 5-bit color channels back to 8-bit scale
      r = (r << 3) | (r >> 2);
      g = (g << 3) | (g >> 2);
      b = (b << 3) | (b >> 2);

      const pixelOffset = (sy * this.width) + sx;
      pixelBuffer[pixelOffset] = 0xFF000000 | (b << 16) | (g << 8) | r;
    }
    this.disableSpritesForNextScanline = false;
  }

  // Render a full frame of 256x224 pixels using scanline compositing
  public renderFrame(pixelBuffer: Uint32Array) {
    for (let sy = 0; sy < this.height; sy++) {
      this.renderScanline(sy, pixelBuffer);
    }
    // Toggle the interlace field status bit at the end of each frame
    this.fieldToggle = !this.fieldToggle;
  }

  // Decode pixel color indices from VRAM character tile based on bpp (2, 4, or 8)
  private getPixelColorIndex(tileIndex: number, charBase: number, tx: number, ty: number, bpp: number): number {
    const wordsPerTile = bpp === 2 ? 8 : bpp === 4 ? 16 : 32;
    const tileStartAddr = (charBase + (tileIndex * wordsPerTile)) & 0x7FFF;

    let colorIdx = 0;

    if (bpp === 4) {
      const word0 = this.vram[(tileStartAddr + ty) & 0x7FFF];
      const word1 = this.vram[(tileStartAddr + 8 + ty) & 0x7FFF];

      const shift = 7 - tx;

      const bit0 = (word0 >> shift) & 1;
      const bit1 = (word0 >> (8 + shift)) & 1;
      const bit2 = (word1 >> shift) & 1;
      const bit3 = (word1 >> (8 + shift)) & 1;

      colorIdx = bit0 | (bit1 << 1) | (bit2 << 2) | (bit3 << 3);
    } else if (bpp === 2) {
      const word = this.vram[(tileStartAddr + ty) & 0x7FFF];
      const shift = 7 - tx;

      const bit0 = (word >> shift) & 1;
      const bit1 = (word >> (8 + shift)) & 1;

      colorIdx = bit0 | (bit1 << 1);
    } else if (bpp === 8) {
      const word0 = this.vram[(tileStartAddr + ty) & 0x7FFF];
      const word1 = this.vram[(tileStartAddr + 8 + ty) & 0x7FFF];
      const word2 = this.vram[(tileStartAddr + 16 + ty) & 0x7FFF];
      const word3 = this.vram[(tileStartAddr + 24 + ty) & 0x7FFF];

      const shift = 7 - tx;

      const bit0 = (word0 >> shift) & 1;
      const bit1 = (word0 >> (8 + shift)) & 1;
      const bit2 = (word1 >> shift) & 1;
      const bit3 = (word1 >> (8 + shift)) & 1;
      const bit4 = (word2 >> shift) & 1;
      const bit5 = (word2 >> (8 + shift)) & 1;
      const bit6 = (word3 >> shift) & 1;
      const bit7 = (word3 >> (8 + shift)) & 1;

      colorIdx = bit0 | (bit1 << 1) | (bit2 << 2) | (bit3 << 3) | (bit4 << 4) | (bit5 << 5) | (bit6 << 6) | (bit7 << 7);
    }

    return colorIdx;
  }

  private getSpriteSize(sss: number, sizeToggle: number): { w: number, h: number } {
    switch (sss) {
      case 0: return sizeToggle ? { w: 16, h: 16 } : { w: 8, h: 8 };
      case 1: return sizeToggle ? { w: 32, h: 32 } : { w: 8, h: 8 };
      case 2: return sizeToggle ? { w: 64, h: 64 } : { w: 8, h: 8 };
      case 3: return sizeToggle ? { w: 32, h: 32 } : { w: 16, h: 16 };
      case 4: return sizeToggle ? { w: 64, h: 64 } : { w: 16, h: 16 };
      case 5: return sizeToggle ? { w: 64, h: 64 } : { w: 32, h: 32 };
      case 6: return sizeToggle ? { w: 32, h: 64 } : { w: 16, h: 32 };
      case 7: return sizeToggle ? { w: 32, h: 32 } : { w: 16, h: 32 };
      default: return { w: 8, h: 8 };
    }
  }

  // Get color index of background layer bgIdx at pixel (x, y)
  private getBGColorIndex(bgIdx: number, x: number, y: number): { colorIndex: number, priority: number, paletteBase: number } {
    if (this.bgMode === 7) {
      if (bgIdx === 0) {
        return this.getMode7Pixel(x, y, false);
      } else if (bgIdx === 1 && (this.setiniReg & 0x40)) {
        return this.getMode7Pixel(x, y, true);
      }
      return { colorIndex: 0, priority: 0, paletteBase: 0 };
    }

    const tilemapBase = this.bgTilemaps[bgIdx];
    const charBase = this.bgCharAddress[bgIdx];
    const scrollX = this.bgScrollH[bgIdx];
    const scrollY = this.bgScrollV[bgIdx];

    // Apply Mosaic
    let px = x;
    let py = y;
    if (this.mosaicReg & (1 << bgIdx)) {
      const mosaicSize = ((this.mosaicReg >> 4) & 0x0F) + 1;
      px = Math.floor(x / mosaicSize) * mosaicSize;
      py = Math.floor(y / mosaicSize) * mosaicSize;
    }

    const is16x16 = this.bgSizes[bgIdx] === 1;
    const tileSize = is16x16 ? 16 : 8;

    const mapSize = this.bgTilemapSizes[bgIdx];
    const mapWidthPages = (mapSize & 1) ? 2 : 1;
    const mapHeightPages = (mapSize & 2) ? 2 : 1;

    const mapWidthPixels = mapWidthPages * 32 * tileSize;
    const mapHeightPixels = mapHeightPages * 32 * tileSize;

    const worldX = ((px + scrollX) % mapWidthPixels + mapWidthPixels) % mapWidthPixels;
    const worldY = ((py + scrollY) % mapHeightPixels + mapHeightPixels) % mapHeightPixels;

    // For 16x16 tiles, a page in the tilemap is still 32x32 entries (each entry representing a 16x16 tile),
    // and maps are laid out page-by-page. Since worldX/worldY are in pixels, we find the entry index by dividing by tileSize.
    const entryX = Math.floor(worldX / tileSize);
    const entryY = Math.floor(worldY / tileSize);

    const pageX = Math.floor(entryX / 32) & 1;
    const pageY = Math.floor(entryY / 32) & 1;

    // Page offsets are in terms of tilemap entries. A single page contains 32*32 = 1024 entries.
    const pageOffset = (pageY * mapWidthPages * 1024) + (pageX * 1024);
    const tilemapOffset = pageOffset + ((entryY & 31) << 5) + (entryX & 31);

    const mapEntry = this.vram[(tilemapBase + tilemapOffset) & 0x7FFF];
    if (mapEntry === undefined) {
      return { colorIndex: 0, priority: 0, paletteBase: 0 };
    }

    const baseTileIndex = mapEntry & 0x3FF;
    const paletteOffset = (mapEntry >> 10) & 7;
    const hFlip = (mapEntry & 0x4000) !== 0;
    const vFlip = (mapEntry & 0x8000) !== 0;
    const priority = (mapEntry & 0x2000) !== 0 ? 1 : 0;

    let subTileX = worldX & 7;
    let subTileY = worldY & 7;
    let tileIndex = baseTileIndex;

    // Compute bpp early so it can be used in the 16x16 stride calculation below
    let bpp = 2;
    switch (this.bgMode) {
      case 0: bpp = 2; break;
      case 1: bpp = bgIdx < 2 ? 4 : 2; break;
      case 2: bpp = 4; break;
      case 3: bpp = bgIdx === 0 ? 8 : 4; break;
      case 4: bpp = bgIdx === 0 ? 8 : 2; break;
      case 5: bpp = bgIdx === 0 ? 4 : 2; break;
      case 6: bpp = 4; break;
    }

    if (is16x16) {
      let colOffset = Math.floor((worldX & 15) / 8);
      let rowOffset = Math.floor((worldY & 15) / 8);
      if (hFlip) colOffset = 1 - colOffset;
      if (vFlip) rowOffset = 1 - rowOffset;

      // FIXED: The stride to the next row of 8x8 tiles in VRAM
      // is 32 for 2bpp (Mode 0) and 16 for 4bpp (Mode 1+).
      const verticalStride = (bpp === 2) ? 32 : 16;
      tileIndex = (baseTileIndex + colOffset + (rowOffset * verticalStride)) & 0x3FF;
    }

    const renderPixelX = hFlip ? 7 - subTileX : subTileX;
    const renderPixelY = vFlip ? 7 - subTileY : subTileY;

    const colorIndex = this.getPixelColorIndex(tileIndex, charBase, renderPixelX, renderPixelY, bpp);

    let paletteBase = 0;
    if (this.bgMode === 0) {
      paletteBase = (bgIdx * 32) + (paletteOffset * 4);
    } else {
      paletteBase = bpp === 8 ? 0 : paletteOffset * (bpp === 4 ? 16 : 4);
    }

    return { colorIndex, priority, paletteBase };
  }

  // Project screen coordinate (x, y) to Mode 7 coordinate and return color index
  private getMode7Pixel(x: number, y: number, isBg2: boolean): { colorIndex: number, priority: number, paletteBase: number } {
    const hFlip = (this.m7sel & 0x01) !== 0;
    const vFlip = (this.m7sel & 0x02) !== 0;

    const sx = hFlip ? (255 - x) : x;
    const sy = vFlip ? (223 - y) : y;

    // Apply matrix transformation center offsets with scroll offsets (M7HOFS/M7VOFS mapped to bgScrollH/V[0])
    const scrollX = this.bgScrollH[0];
    const scrollY = this.bgScrollV[0];
    const m7hofs = (scrollX << 19) >> 19; // Sign-extend 13-bit offset
    const m7vofs = (scrollY << 19) >> 19; // Sign-extend 13-bit offset

    const diffX = ((sx + m7hofs) & 0x1FFF) - this.m7x;
    const diffY = ((sy + m7vofs) & 0x1FFF) - this.m7y;

    // Project coordinates
    let Tx = ((this.m7a * diffX + this.m7b * diffY) >> 8) + this.m7x;
    let Ty = ((this.m7c * diffX + this.m7d * diffY) >> 8) + this.m7y;

    const repeat = (this.m7sel & 0x80) !== 0;
    const fillChar0 = (this.m7sel & 0x40) !== 0;

    if (Tx < 0 || Tx >= 1024 || Ty < 0 || Ty >= 1024) {
      if (repeat) {
        Tx = ((Tx % 1024) + 1024) % 1024;
        Ty = ((Ty % 1024) + 1024) % 1024;
      } else {
        if (fillChar0) {
          Tx &= 7;
          Ty &= 7;
          const char0Col = this.vram[0] >> 8;
          return { colorIndex: char0Col, priority: 0, paletteBase: 0 };
        } else {
          return { colorIndex: 0, priority: 0, paletteBase: 0 };
        }
      }
    }

    const tileX = Math.floor(Tx / 8);
    const tileY = Math.floor(Ty / 8);

    const tileIndex = this.vram[tileY * 128 + tileX] & 0xFF;
    const px = Tx & 7;
    const py = Ty & 7;

    const byteAddr = (tileIndex * 64 + py * 8 + px) & 0xFFFF;
    const word = this.vram[(byteAddr >> 1) & 0x7FFF];
    const colorIndex = (word >> ((byteAddr & 1) ? 0 : 8)) & 0xFF;

    if (isBg2) {
      const priority = (colorIndex & 0x80) !== 0 ? 1 : 0;
      return { colorIndex: colorIndex & 0x7F, priority, paletteBase: 0 };
    }

    return { colorIndex, priority: 0, paletteBase: 0 };
  }

  // Get window masking status for a layer at horizontal screen coordinate x
  private getWindowMask(layer: number, x: number): boolean {
    let win1Enable = false;
    let win1Invert = false;
    let win2Enable = false;
    let win2Invert = false;
    let logic = 0; // 0=OR, 1=AND, 2=XOR, 3=XNOR

    if (layer === 0) { // BG1
      win1Invert = (this.w12sel & 0x01) !== 0;
      win1Enable = (this.w12sel & 0x02) !== 0;
      win2Invert = (this.w12sel & 0x04) !== 0;
      win2Enable = (this.w12sel & 0x08) !== 0;
      logic = this.wbglog & 3;
    } else if (layer === 1) { // BG2
      win1Invert = (this.w12sel & 0x10) !== 0;
      win1Enable = (this.w12sel & 0x20) !== 0;
      win2Invert = (this.w12sel & 0x40) !== 0;
      win2Enable = (this.w12sel & 0x80) !== 0;
      logic = (this.wbglog >> 2) & 3;
    } else if (layer === 2) { // BG3
      win1Invert = (this.w34sel & 0x01) !== 0;
      win1Enable = (this.w34sel & 0x02) !== 0;
      win2Invert = (this.w34sel & 0x04) !== 0;
      win2Enable = (this.w34sel & 0x08) !== 0;
      logic = (this.wbglog >> 4) & 3;
    } else if (layer === 3) { // BG4
      win1Invert = (this.w34sel & 0x10) !== 0;
      win1Enable = (this.w34sel & 0x20) !== 0;
      win2Invert = (this.w34sel & 0x40) !== 0;
      win2Enable = (this.w34sel & 0x80) !== 0;
      logic = (this.wbglog >> 6) & 3;
    } else if (layer === 4) { // OBJ
      win1Invert = (this.wobjsel & 0x01) !== 0;
      win1Enable = (this.wobjsel & 0x02) !== 0;
      win2Invert = (this.wobjsel & 0x04) !== 0;
      win2Enable = (this.wobjsel & 0x08) !== 0;
      logic = this.wobjlog & 3;
    } else if (layer === 5) { // Color
      win1Invert = (this.wobjsel & 0x10) !== 0;
      win1Enable = (this.wobjsel & 0x20) !== 0;
      win2Invert = (this.wobjsel & 0x40) !== 0;
      win2Enable = (this.wobjsel & 0x80) !== 0;
      logic = (this.wobjlog >> 2) & 3;
    }

    let w1Active = false;
    if (win1Enable) {
      w1Active = (x >= this.win1Left && x <= this.win1Right);
      if (win1Invert) w1Active = !w1Active;
    }
    let w2Active = false;
    if (win2Enable) {
      w2Active = (x >= this.win2Left && x <= this.win2Right);
      if (win2Invert) w2Active = !w2Active;
    }

    if (win1Enable && win2Enable) {
      switch (logic) {
        case 0: return w1Active || w2Active; // OR
        case 1: return w1Active && w2Active; // AND
        case 2: return w1Active !== w2Active; // XOR
        case 3: return w1Active === w2Active; // XNOR
      }
    } else if (win1Enable) {
      return w1Active;
    } else if (win2Enable) {
      return w2Active;
    }
    return false;
  }
}
