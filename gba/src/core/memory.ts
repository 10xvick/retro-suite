// GBA Memory map + IO registers + bus
import {
  BIOS_SIZE, EWRAM_SIZE, IWRAM_SIZE, IO_SIZE, PALETTE_SIZE, VRAM_SIZE, OAM_SIZE,
} from "./types";

// IO register address offsets (relative to IO_BASE 0x04000000)
export const IO = {
  DISPCNT: 0x000,
  GREENSWAP: 0x002,
  DISPSTAT: 0x004,
  VCOUNT: 0x006,
  BG0CNT: 0x008, BG1CNT: 0x00a, BG2CNT: 0x00c, BG3CNT: 0x00e,
  BG0HOFS: 0x010, BG0VOFS: 0x012,
  BG1HOFS: 0x014, BG1VOFS: 0x016,
  BG2HOFS: 0x018, BG2VOFS: 0x01a,
  BG3HOFS: 0x01c, BG3VOFS: 0x01e,
  BG2PA: 0x020, BG2PB: 0x022, BG2PC: 0x024, BG2PD: 0x026,
  BG2X: 0x028, BG2Y: 0x02c,
  BG3PA: 0x030, BG3PB: 0x032, BG3PC: 0x034, BG3PD: 0x036,
  BG3X: 0x038, BG3Y: 0x03c,
  WIN0H: 0x040, WIN1H: 0x042, WIN0V: 0x044, WIN1V: 0x046,
  WININ: 0x048, WINOUT: 0x04a,
  MOSAIC: 0x04c,
  BLDCNT: 0x050, BLDALPHA: 0x052, BLDY: 0x054,
  SOUND1CNT_L: 0x060,
  SOUNDCNT_H: 0x082, SOUNDCNT_X: 0x084, SOUNDBIAS: 0x088,
  DMA0SAD: 0x0b0, DMA0DAD: 0x0b4, DMA0CNT_L: 0x0b8, DMA0CNT_H: 0x0ba,
  DMA1SAD: 0x0bc, DMA1DAD: 0x0c0, DMA1CNT_L: 0x0c4, DMA1CNT_H: 0x0c6,
  DMA2SAD: 0x0c8, DMA2DAD: 0x0cc, DMA2CNT_L: 0x0d0, DMA2CNT_H: 0x0d2,
  DMA3SAD: 0x0d4, DMA3DAD: 0x0d8, DMA3CNT_L: 0x0dc, DMA3CNT_H: 0x0de,
  TM0D: 0x100, TM0CNT: 0x102,
  TM1D: 0x104, TM1CNT: 0x106,
  TM2D: 0x108, TM2CNT: 0x10a,
  TM3D: 0x10c, TM3CNT: 0x10e,
  KEYINPUT: 0x130, KEYCNT: 0x132, RCNT: 0x134,
  IE: 0x200, IF: 0x202, WAITCNT: 0x204, IME: 0x208,
  POSTFLG: 0x300, HALTCNT: 0x301,
} as const;

const SRAM_SIZE = 0x20000; // 128 KB
const SRAM_MASK = 0x7FFF;  // 32 KB mirror

export class Memory {
  bios: Uint8Array;
  ewram: Uint8Array;
  iwram: Uint8Array;
  io: Uint8Array;
  palette: Uint8Array;
  vram: Uint8Array;
  oam: Uint8Array;
  cart: Uint8Array;
  sram: Uint8Array;

  // Flash state machine
  flashState = 0;
  flashCmd = 0;
  flashWritePending = false;
  flashBankPending = false;
  flashBank = 0;

  // Cart ROM tracking
  cartMask = 0;
  cartActualSize = 0;

  // BIOS protected memory
  lastBiosPc = 0;
  r15Shadow = 0;
  lastInstruction = 0;
  biosPrefetchOffset = 8;
  dmaEnableCallback: (() => void) | null = null;
  timerWriteCallback: ((timer: number, value: number) => void) | null = null;

  halted = false;
  // When true, CPU writes to KEYINPUT/KEYCNT are blocked (hardware is read-only)
  // The emulator sets this AFTER boot so key input works during boot but
  // cart code can't corrupt it later.
  blockKeyWrites = false;

  private ioView: DataView;

  constructor() {
    this.bios = new Uint8Array(BIOS_SIZE);
    this.ewram = new Uint8Array(EWRAM_SIZE);
    this.iwram = new Uint8Array(IWRAM_SIZE);
    this.io = new Uint8Array(IO_SIZE);
    this.palette = new Uint8Array(PALETTE_SIZE);
    this.vram = new Uint8Array(VRAM_SIZE);
    this.oam = new Uint8Array(OAM_SIZE);
    this.cart = new Uint8Array(0);
    this.sram = new Uint8Array(SRAM_SIZE);
    this.sram.fill(0xFF);
    this.ioView = new DataView(this.io.buffer);
  }

  loadBios(data: Uint8Array) {
    this.bios.set(data.subarray(0, BIOS_SIZE));
  }

  loadCart(data: Uint8Array) {
    this.cartActualSize = data.length;
    // Pad to power of 2
    let pow2 = 1;
    while (pow2 < data.length && pow2 < 0x2000000) pow2 <<= 1;
    if (pow2 < 1) pow2 = 1;
    this.cart = new Uint8Array(pow2);
    this.cart.set(data.subarray(0, Math.min(data.length, pow2)));
    this.cartMask = pow2 - 1;
  }

  // ---- SRAM / Flash ----
  sramOffset(addr: number): number {
    return ((this.flashBank << 16) | ((addr - 0x0e000000) & SRAM_MASK)) >>> 0;
  }

  writeSram8(addr: number, val: number) {
    addr >>>= 0; val &= 0xff;
    const off = (addr - 0x0e000000) & SRAM_MASK;

    // Pending data write (after 0xA0 command)
    if (this.flashWritePending) {
      const o = this.sramOffset(addr);
      this.sram[o] = this.sram[o] & val; // flash writes can only clear bits (AND)
      this.flashWritePending = false;
      this.flashState = 0;
      return;
    }
    // Pending bank switch (after 0xB0 command)
    if (this.flashBankPending) {
      this.flashBank = val & 1;
      this.flashBankPending = false;
      this.flashState = 0;
      return;
    }

    // Flash command sequence: 0xAA->0x5555, 0x55->0x2AAA, cmd->0x5555
    if (this.flashState === 0) {
      if (off === 0x5555 && val === 0xAA) { this.flashState = 1; return; }
      if (val === 0xF0) { this.flashState = 0; return; } // reset
      // Not in command sequence: plain SRAM write (battery-backed SRAM)
      this.sram[this.sramOffset(addr)] = val;
      return;
    }
    if (this.flashState === 1) {
      if (off === 0x2AAA && val === 0x55) { this.flashState = 2; return; }
      this.flashState = 0;
      return;
    }
    if (this.flashState === 2) {
      if (off === 0x5555) {
        if (val === 0xA0) { this.flashWritePending = true; this.flashState = 0; return; } // write byte
        if (val === 0xB0) { this.flashBankPending = true; this.flashState = 0; return; } // bank switch
        if (val === 0x80) { this.flashState = 3; this.flashCmd = 0x80; return; } // erase setup
        if (val === 0xF0) { this.flashState = 0; return; } // reset
      }
      this.flashState = 0;
      return;
    }
    if (this.flashState === 3) {
      // Erase setup: expect 0xAA->0x5555, 0x55->0x2AAA, then 0x10 or 0x30
      if (off === 0x5555 && val === 0xAA) { this.flashState = 4; return; }
      this.flashState = 0;
      return;
    }
    if (this.flashState === 4) {
      if (off === 0x2AAA && val === 0x55) { this.flashState = 5; return; }
      this.flashState = 0;
      return;
    }
    if (this.flashState === 5) {
      if (val === 0x10) {
        // Chip erase
        this.sram.fill(0xFF);
      } else if (val === 0x30) {
        // Sector erase (4KB sector)
        const sectorBase = this.sramOffset(addr) & ~0xFFF;
        for (let i = 0; i < 0x1000; i++) {
          this.sram[(sectorBase + i) % SRAM_SIZE] = 0xFF;
        }
      }
      this.flashState = 0;
      return;
    }
    this.flashState = 0;
  }

  // ---- IO helpers ----
  // readIO16: for internal emulator use (PPU, timers, etc.) — returns raw value
  // Bus reads (CPU instructions) go through read8/read16/read32 which apply ioReadMask16
  readIO16(off: number): number { return this.ioView.getUint16(off, true); }
  writeIO16(off: number, val: number) { this.writeIO(off, val, 2); }
  readIO32(off: number): number { return this.ioView.getUint32(off, true); }
  writeIO32(off: number, val: number) { this.writeIO(off, val, 4); }

  // Set key input state (bypasses writeIO guard — for emulator use only)
  setKeyInput(val: number) {
    this.io[IO.KEYINPUT] = val & 0xff;
    this.io[IO.KEYINPUT + 1] = (val >> 8) & 0xff;
  }

  // ---- VRAM mirroring helper ----
  vramOffset(addr: number): number {
    let off = (addr & 0x1FFFF);
    if (off >= 0x18000) {
      off -= 0x8000;
    }
    return off;
  }

  // ---- Open bus helpers ----
  getOpenBus8(addr: number): number {
    return (this.lastInstruction >>> ((addr & 3) * 8)) & 0xFF;
  }

  getOpenBus16(addr: number): number {
    const shift = (addr & 2) * 8;
    return (this.lastInstruction >>> shift) & 0xFFFF;
  }

  getOpenBus32(addr: number): number {
    return this.lastInstruction >>> 0;
  }

  // ---- BIOS protected reads ----
  private inBios(): boolean {
    return this.r15Shadow < 0x02000000;
  }
  private readBios8(addr: number): number {
    if (addr >= 0x00004000) return this.getOpenBus8(addr);
    if (this.inBios()) return this.bios[addr & (BIOS_SIZE - 1)];
    const pc = (this.lastBiosPc + this.biosPrefetchOffset) & ~3;
    return this.bios[(pc + (addr & 3)) & (BIOS_SIZE - 1)];
  }
  private readBios16(addr: number): number {
    if (addr >= 0x00004000) return this.getOpenBus16(addr);
    if (this.inBios()) {
      const o = (addr & (BIOS_SIZE - 1)) & ~1;
      return this.bios[o] | (this.bios[o + 1] << 8);
    }
    const pc = (this.lastBiosPc + this.biosPrefetchOffset) & ~3;
    const o = (pc + (addr & 2)) & (BIOS_SIZE - 1);
    return this.bios[o] | (this.bios[o + 1] << 8);
  }
  private readBios32(addr: number): number {
    if (addr >= 0x00004000) return this.getOpenBus32(addr);
    if (this.inBios()) {
      const o = (addr & (BIOS_SIZE - 1)) & ~3;
      return (this.bios[o] | (this.bios[o + 1] << 8) | (this.bios[o + 2] << 16) | (this.bios[o + 3] << 24)) >>> 0;
    }
    const pc = (this.lastBiosPc + this.biosPrefetchOffset) & ~3;
    const o = pc & (BIOS_SIZE - 1);
    return (this.bios[o] | (this.bios[o + 1] << 8) | (this.bios[o + 2] << 16) | (this.bios[o + 3] << 24)) >>> 0;
  }

  // ---- Cart open bus (reads beyond actual ROM size) ----
  // The GBA cart bus is 16-bit; open-bus value at aligned address A is
  // (A>>1)&0xFFFF (low byte = (A>>1)&0xFF, high byte = (A>>9)&0xFF).
  private cartOpenBus16(addr: number): number {
    const off = (addr - 0x08000000) & 0x01FFFFFF;
    return (off >> 1) & 0xffff;
  }

  private getSiocntMask(val: number): number {
    const mode = (val >>> 12) & 3;
    if (mode === 0) return 0x708B;
    if (mode === 1) return 0x708B;
    if (mode === 2) return 0x7083;
    return 0xFFFF;
  }

  private writeSiocnt(val: number, oldVal: number) {
    const oldMode = (oldVal >>> 12) & 3;
    const rcnt = this.ioView.getUint16(0x134, true);
    const isGp = ((rcnt & 0x8000) !== 0) && ((rcnt & 0x4000) === 0);
    const isJoy = ((rcnt & 0x8000) !== 0) && ((rcnt & 0x4000) !== 0);
    const newMode = (isGp || isJoy) ? 3 : (val >>> 12) & 3;

    const isInternalClock = (newMode === 2) || ((newMode === 0 || newMode === 1) && (val & 0x0001) !== 0);
    if ((val & 0x0080) && isInternalClock) {
      if (newMode === 2) {
        const sendVal = this.ioView.getUint16(0x12a, true);
        this.ioView.setUint16(0x120, sendVal, true);
        this.ioView.setUint16(0x122, 0xFFFF, true);
        this.ioView.setUint16(0x124, 0xFFFF, true);
        this.ioView.setUint16(0x126, 0xFFFF, true);
      } else if (newMode === 1) {
        this.ioView.setUint16(0x120, 0xFFFF, true);
        this.ioView.setUint16(0x122, 0xFFFF, true);
      } else if (newMode === 0) {
        this.ioView.setUint16(0x12a, 0x00FF, true);
      }
      val &= ~0x0080;
      if (val & 0x4000) {
        const curIf = this.ioView.getUint16(0x202, true);
        this.ioView.setUint16(0x202, curIf | 0x0080, true);
        this.halted = false;
      }
    }
    this.ioView.setUint16(0x128, val & this.getSiocntMask(val), true);
  }

  private writeRcnt(val: number, oldRcnt: number) {
    const oldSiocnt = this.ioView.getUint16(0x128, true);

    const nextGpMode = ((val & 0x8000) !== 0) && ((val & 0x4000) === 0);
    const nextJoybus = ((val & 0x8000) !== 0) && ((val & 0x4000) !== 0);

    if (nextJoybus) {
      val &= 0xC000;
    } else if (nextGpMode) {
      val &= 0xC1FF;
    } else {
      const nextMode = (oldSiocnt >>> 12) & 3;
      if (nextMode === 2) {
        val = (val & 0xC000) | (oldRcnt & 0x3E00);
      } else {
        val = (val & 0xC100) | (oldRcnt & 0x3E00);
      }
    }
    this.ioView.setUint16(0x134, val, true);
  }

  private writeJoycnt(val: number) {
    const rcnt = this.ioView.getUint16(0x134, true);
    const isJoybus = ((rcnt & 0x8000) !== 0) && ((rcnt & 0x4000) !== 0);
    if (isJoybus) {
      const cur = this.ioView.getUint16(0x140, true);
      const writable = val & 0x0040; // Only bit 6 is writable by the CPU
      const readonly = cur & 0x0006; // Keep bits 1 and 2 Send/Receive Complete status
      if (val & 0x0001) {
        // Reset: clear Send/Receive Complete status bits
        this.ioView.setUint16(0x140, writable | 0x4000, true);
      } else {
        this.ioView.setUint16(0x140, writable | readonly | 0x4000, true);
      }
    }
  }

  // ---- IO register read/write ----
  private ioReadMask16(off: number, addr: number): number {
    const siocnt = this.ioView.getUint16(0x128, true);
    const rcnt = this.ioView.getUint16(0x134, true);
    const isGpMode = ((rcnt & 0x8000) !== 0) && ((rcnt & 0x4000) === 0);
    const isJoybus = ((rcnt & 0x8000) !== 0) && ((rcnt & 0x4000) !== 0);
    const mode = (isGpMode || isJoybus) ? 3 : (siocnt >>> 12) & 3;

    // Completely write-only registers return 0 when read on GBA
    if (off >= 0x010 && off <= 0x01F) return 0; // BG offsets
    if (off >= 0x020 && off <= 0x03F) return 0; // BG affine params
    if (off >= 0x040 && off <= 0x047) return 0; // Window boundaries
    if (off === 0x04C) return 0; // MOSAIC
    if (off === 0x054) return 0; // BLDY
    if (off === 0x0B8 || off === 0x0C4 || off === 0x0D0 || off === 0x0DC) return 0; // DMA0-3 count
    if (off === 0x300) {
      // 0x301 is HALTCNT (write-only, returns 0)
      return this.io[0x300];
    }

    // BG control registers: mask out unused and mode-restricted bits
    if (off === 0x008 || off === 0x00A) {
      return this.ioView.getUint16(off, true) & 0xDFCF;
    }
    if (off === 0x00C || off === 0x00E) {
      return this.ioView.getUint16(off, true) & 0xFFCF;
    }

    // DISPSTAT: mask out unused bits 6-7
    if (off === 0x004) {
      return this.ioView.getUint16(0x004, true) & 0xFF3F;
    }

    const isSio = (off >= 0x120 && off <= 0x15F) && (off !== 0x130) && (off !== 0x132);
    if (!isSio) {
      return this.ioView.getUint16(off, true);
    }
    let readable = false;
    if (off === 0x128) {
      readable = true;
    } else if (off === 0x12A) {
      readable = (isGpMode || isJoybus) ? true : (mode === 0 || mode === 2);
    } else if (off === 0x120 || off === 0x122) {
      readable = !isGpMode && !isJoybus && (mode === 1 || mode === 2);
    } else if (off === 0x124 || off === 0x126) {
      readable = !isGpMode && !isJoybus && (mode === 2);
    } else if (off === 0x134) {
      readable = true; // RCNT is always readable
    } else if (off === 0x140) {
      readable = isJoybus; // JOYCNT is active only in Joybus mode
    } else if (off === 0x154 || off === 0x156) {
      readable = isJoybus; // JOY_TRANS is active only in Joybus mode
    } else if (off >= 0x150 && off <= 0x15C) {
      readable = isJoybus; // Other JOY registers are active only in Joybus mode
    }

    if (!readable) {
      if (isSio) {
        console.log(`SIO Read: off=0x${off.toString(16)} val=0 (readonly/unmapped)`);
      }
      return 0;
    }

    let val = this.ioView.getUint16(off, true);
    if (off === 0x128) {
      const siocntMode = (val >>> 12) & 3;
      if (siocntMode === 0 || siocntMode === 1) {
        const isStart = (val & 0x0080) !== 0;
        const isInternalClock = (val & 0x0001) !== 0;
        val &= 0x708B;
        val |= 0x0004; // SI pin always floats high (1)
        if (isStart || !isInternalClock) {
          val |= 0x0008; // SO pin floats high (1) when not R/W
        }
      } else if (siocntMode === 2) {
        val &= 0x7083;
        val |= 0x0008; // SI=0, SO=1 (floats high)
      } else if (siocntMode === 3) {
        // Return raw value
      }
    } else if (off === 0x12A) {
      if (mode === 0 || mode === 2) {
        val = this.ioView.getUint16(0x12A, true);
      } else {
        val = 0;
      }
    } else if (off === 0x120 || off === 0x122 || off === 0x124 || off === 0x126) {
      if (mode === 2) {
        const playerId = (this.ioView.getUint16(0x128, true) >>> 4) & 3;
        const regId = (off - 0x120) >>> 1;
        if (regId === playerId) {
          val = this.ioView.getUint16(0x12A, true);
        } else {
          val = this.ioView.getUint16(off, true);
        }
      } else if (mode === 1) {
        if (off === 0x120 || off === 0x122) {
          val = this.ioView.getUint16(off, true);
        } else {
          val = 0;
        }
      } else {
        val = 0;
      }
    } else if (off === 0x134) {
      if (isJoybus) {
        val &= 0xC000;
      } else if (isGpMode) {
        val &= 0xC1FF;
        // Pin float high logic for inputs:
        // For each pin 0..3: if direction (bit i+4) is 0 (input), data (bit i) floats high (1)
        for (let i = 0; i < 4; i++) {
          if (!(val & (1 << (i + 4)))) {
            val |= (1 << i);
          }
        }
      } else {
        const modeBits = (this.ioView.getUint16(0x128, true) >>> 12) & 3;
        if (modeBits === 2) {
          val = 0x0009; // SI=0, SD=0, SC=1, SO=1
        } else {
          val = 0x000B; // SI=0, SD=1, SC=1, SO=1
        }
      }
    } else if (off === 0x140) {
      if (!isJoybus) {
        val = 0; // JOYCNT is read-only 0 if not in Joybus mode
      } else {
        val = (val & 0x0046) | 0x4000;
      }
    } else if (off === 0x142) {
      val = 0;
    } else if (off === 0x150 || off === 0x152) {
      if (!isJoybus) {
        val = 0;
      } else {
        const curJoyStat = this.ioView.getUint16(0x158, true);
        this.ioView.setUint16(0x158, curJoyStat & ~0x0008, true);
      }
    } else if (off === 0x154 || off === 0x156) {
      if (!isJoybus) val = 0;
    } else if (off === 0x15A) {
      val = 0;
    } else if (off === 0x158) {
      if (!isJoybus) {
        val = 0;
      } else {
        val |= 0x0012; // Default receive empty and transmit empty flags
      }
    }
    if (isSio) {
      const raw = this.ioView.getUint16(off, true);
      console.log(`SIO Read: off=0x${off.toString(16)} val=0x${val.toString(16)} (raw=0x${raw.toString(16)} gp=${isGpMode} joy=${isJoybus} mode=${mode})`);
    }
    return val;
  }

  read8(addr: number): number {
    addr >>>= 0;
    if (addr < 0x02000000) return this.readBios8(addr);
    if (addr < 0x03000000) return this.ewram[addr & (EWRAM_SIZE - 1)];
    if (addr < 0x04000000) return this.iwram[addr & (IWRAM_SIZE - 1)];
    if (addr < 0x05000000) {
      if ((addr & 0x00FFFFFF) >= 0x400) return this.getOpenBus8(addr);
      const off = addr & (IO_SIZE - 1);
      const v16 = this.ioReadMask16(off & ~1, addr);
      return (off & 1) ? ((v16 >> 8) & 0xff) : (v16 & 0xff);
    }
    if (addr < 0x06000000) return this.palette[addr & (PALETTE_SIZE - 1)];
    if (addr < 0x07000000) return this.vram[this.vramOffset(addr)];
    if (addr < 0x08000000) return this.oam[addr & (OAM_SIZE - 1)];
    if (addr < 0x0e000000) {
      // GamePak0/1/2 mirroring
      const o = (addr - 0x08000000) & 0x01FFFFFF;
      if (o < this.cartActualSize) return this.cart[o & this.cartMask];
      // Open bus: 16-bit read at aligned address, extract byte.
      const v16 = this.cartOpenBus16(addr);
      return (addr & 1) ? ((v16 >> 8) & 0xff) : (v16 & 0xff);
    }
    if (addr < 0x0f000000) {
      return this.sram[this.sramOffset(addr)];
    }
    return this.getOpenBus8(addr);
  }

  read16(addr: number): number {
    addr >>>= 0;
    if (addr < 0x02000000) return this.readBios16(addr);
    if (addr < 0x03000000) { const o = (addr & (EWRAM_SIZE - 1)) & ~1; return this.ewram[o] | (this.ewram[o + 1] << 8); }
    if (addr < 0x04000000) { const o = (addr & (IWRAM_SIZE - 1)) & ~1; return this.iwram[o] | (this.iwram[o + 1] << 8); }
    if (addr < 0x05000000) {
      if ((addr & 0x00FFFFFF) >= 0x400) return this.getOpenBus16(addr);
      return this.ioReadMask16((addr & (IO_SIZE - 1)) & ~1, addr);
    }
    if (addr < 0x06000000) { const o = (addr & (PALETTE_SIZE - 1)) & ~1; return this.palette[o] | (this.palette[o + 1] << 8); }
    if (addr < 0x07000000) { const o = this.vramOffset(addr) & ~1; return this.vram[o] | (this.vram[o + 1] << 8); }
    if (addr < 0x08000000) { const o = (addr & (OAM_SIZE - 1)) & ~1; return this.oam[o] | (this.oam[o + 1] << 8); }
    if (addr < 0x0e000000) {
      // GamePak0/1/2 mirroring
      const o = (addr - 0x08000000) & 0x01FFFFFF;
      if (o < this.cartActualSize) {
        const m = this.cartMask;
        return this.cart[o & m] | (this.cart[(o + 1) & m] << 8);
      }
      return this.cartOpenBus16(addr);
    }
    if (addr < 0x0f000000) {
      const b = this.sram[this.sramOffset(addr)];
      return b | (b << 8);
    }
    return this.getOpenBus16(addr);
  }

  read32(addr: number): number {
    addr >>>= 0;
    if (addr < 0x02000000) return this.readBios32(addr);
    if (addr < 0x03000000) { const o = (addr & (EWRAM_SIZE - 1)) & ~3; return (this.ewram[o] | (this.ewram[o+1]<<8) | (this.ewram[o+2]<<16) | (this.ewram[o+3]<<24)) >>> 0; }
    if (addr < 0x04000000) { const o = (addr & (IWRAM_SIZE - 1)) & ~3; return (this.iwram[o] | (this.iwram[o+1]<<8) | (this.iwram[o+2]<<16) | (this.iwram[o+3]<<24)) >>> 0; }
    if (addr < 0x05000000) {
      if ((addr & 0x00FFFFFF) >= 0x400) return this.getOpenBus32(addr);
      const off = (addr & (IO_SIZE - 1)) & ~3;
      const lo = this.ioReadMask16(off, addr);
      const hi = this.ioReadMask16((off + 2) & (IO_SIZE - 1), addr + 2);
      return ((hi << 16) | lo) >>> 0;
    }
    if (addr < 0x06000000) { const o = (addr & (PALETTE_SIZE - 1)) & ~3; return (this.palette[o] | (this.palette[o+1]<<8) | (this.palette[o+2]<<16) | (this.palette[o+3]<<24)) >>> 0; }
    if (addr < 0x07000000) { const o = this.vramOffset(addr) & ~3; return (this.vram[o] | (this.vram[o+1]<<8) | (this.vram[o+2]<<16) | (this.vram[o+3]<<24)) >>> 0; }
    if (addr < 0x08000000) { const o = (addr & (OAM_SIZE - 1)) & ~3; return (this.oam[o] | (this.oam[o+1]<<8) | (this.oam[o+2]<<16) | (this.oam[o+3]<<24)) >>> 0; }
    if (addr < 0x0e000000) {
      // GamePak0/1/2 mirroring
      const o = (addr - 0x08000000) & 0x01FFFFFF;
      if (o < this.cartActualSize) {
        const m = this.cartMask;
        return (this.cart[o & m] | (this.cart[(o+1)&m]<<8) | (this.cart[(o+2)&m]<<16) | (this.cart[(o+3)&m]<<24)) >>> 0;
      }
      const v = this.cartOpenBus16(addr);
      return (v | (v << 16)) >>> 0;
    }
    if (addr < 0x0f000000) {
      const b = this.sram[this.sramOffset(addr)];
      return (b | (b << 8) | (b << 16) | (b << 24)) >>> 0;
    }
    return this.getOpenBus32(addr);
  }

  // ---- Raw write (bypasses VRAM/palette byte duplication) ----
  rawWrite8(addr: number, val: number) {
    addr >>>= 0; val &= 0xff;
    if (addr < 0x02000000) return; // BIOS readonly
    if (addr < 0x03000000) { this.ewram[addr & (EWRAM_SIZE - 1)] = val; return; }
    if (addr < 0x04000000) { this.iwram[addr & (IWRAM_SIZE - 1)] = val; return; }
    if (addr < 0x05000000) {
      if ((addr & 0x00FFFFFF) >= 0x400) return;
      this.writeIO(addr & (IO_SIZE - 1), val, 1);
      return;
    }
    if (addr < 0x06000000) { this.palette[addr & (PALETTE_SIZE - 1)] = val; return; }
    if (addr < 0x07000000) { this.vram[this.vramOffset(addr)] = val; return; }
    if (addr < 0x08000000) { this.oam[addr & (OAM_SIZE - 1)] = val; return; }
    if (addr >= 0x0e000000) { this.writeSram8(addr, val); return; }
  }

  // ---- DMA write (byte-level, no alignment, uses rawWrite8) ----
  dmaWrite(addr: number, val: number) {
    this.rawWrite8(addr, val);
  }

  write8(addr: number, val: number) {
    addr >>>= 0; val &= 0xff;
    if (addr < 0x02000000) return; // BIOS readonly
    if (addr < 0x03000000) { this.ewram[addr & (EWRAM_SIZE - 1)] = val; return; }
    if (addr < 0x04000000) { this.iwram[addr & (IWRAM_SIZE - 1)] = val; return; }
    if (addr < 0x05000000) {
      if ((addr & 0x00FFFFFF) >= 0x400) return;
      this.writeIO(addr & (IO_SIZE - 1), val, 1);
      return;
    }
    if (addr < 0x06000000) {
      // Palette byte writes duplicate to both halves
      const o = (addr & (PALETTE_SIZE - 1)) & ~1;
      this.palette[o] = val; this.palette[o + 1] = val;
      return;
    }
    if (addr < 0x07000000) {
      // Background VRAM byte writes duplicate to both halves, Sprite VRAM byte writes ignored
      const o = this.vramOffset(addr);
      if (o < 0x10000) {
        const aligned = o & ~1;
        this.vram[aligned] = val; this.vram[aligned + 1] = val;
      }
      return;
    }
    if (addr < 0x08000000) return; // OAM byte writes ignored
    if (addr < 0x0e000000) return; // Cartridge readonly
    if (addr < 0x0f000000) {
      this.writeSram8(addr, val);
      return;
    }
  }

  write16(addr: number, val: number) {
    addr >>>= 0; val &= 0xffff;
    if (addr < 0x02000000) return;
    if (addr < 0x03000000) { const o = (addr & (EWRAM_SIZE - 1)) & ~1; this.ewram[o]=val&0xff; this.ewram[o+1]=(val>>8)&0xff; return; }
    if (addr < 0x04000000) { const o = (addr & (IWRAM_SIZE - 1)) & ~1; this.iwram[o]=val&0xff; this.iwram[o+1]=(val>>8)&0xff; return; }
    if (addr < 0x05000000) {
      if ((addr & 0x00FFFFFF) >= 0x400) return;
      this.writeIO((addr & (IO_SIZE - 1)) & ~1, val, 2);
      return;
    }
    if (addr < 0x06000000) { const o = (addr & (PALETTE_SIZE - 1)) & ~1; this.palette[o]=val&0xff; this.palette[o+1]=(val>>8)&0xff; return; }
    if (addr < 0x07000000) { const o = this.vramOffset(addr) & ~1; this.vram[o]=val&0xff; this.vram[o+1]=(val>>8)&0xff; return; }
    if (addr < 0x08000000) { const o = (addr & (OAM_SIZE - 1)) & ~1; this.oam[o]=val&0xff; this.oam[o+1]=(val>>8)&0xff; return; }
    if (addr < 0x0e000000) return;
    if (addr < 0x0f000000) {
      // SRAM is 8-bit bus: write only low 8 bits to specified address
      this.writeSram8(addr, val & 0xff);
      return;
    }
  }

  write32(addr: number, val: number) {
    addr >>>= 0; val >>>= 0;
    if (addr < 0x02000000) return;
    if (addr < 0x03000000) { const o = (addr & (EWRAM_SIZE - 1)) & ~3; this.ewram[o]=val; this.ewram[o+1]=val>>8; this.ewram[o+2]=val>>16; this.ewram[o+3]=val>>24; return; }
    if (addr < 0x04000000) { const o = (addr & (IWRAM_SIZE - 1)) & ~3; this.iwram[o]=val; this.iwram[o+1]=val>>8; this.iwram[o+2]=val>>16; this.iwram[o+3]=val>>24; return; }
    if (addr < 0x05000000) {
      if ((addr & 0x00FFFFFF) >= 0x400) return;
      this.writeIO((addr & (IO_SIZE - 1)) & ~3, val, 4);
      return;
    }
    if (addr < 0x06000000) { const o = (addr & (PALETTE_SIZE - 1)) & ~3; this.palette[o]=val; this.palette[o+1]=val>>8; this.palette[o+2]=val>>16; this.palette[o+3]=val>>24; return; }
    if (addr < 0x07000000) { const o = this.vramOffset(addr) & ~3; this.vram[o]=val; this.vram[o+1]=val>>8; this.vram[o+2]=val>>16; this.vram[o+3]=val>>24; return; }
    if (addr < 0x08000000) { const o = (addr & (OAM_SIZE - 1)) & ~3; this.oam[o]=val; this.oam[o+1]=val>>8; this.oam[o+2]=val>>16; this.oam[o+3]=val>>24; return; }
    if (addr < 0x0e000000) return;
    if (addr < 0x0f000000) {
      // SRAM is 8-bit bus: write only low 8 bits to specified address
      this.writeSram8(addr, val & 0xff);
      return;
    }
  }

  // Check if a byte offset is within any DMA control register (DMAxCNT_H)
  private isDmaCntOff(off: number): boolean {
    for (let ch = 0; ch < 4; ch++) {
      const base = IO.DMA0CNT_H + ch * 12;
      if (off === base || off === base + 1) return true;
    }
    return false;
  }

  // Get timer index for a TMxD offset, or -1 if not a timer data register
  private timerIndexForOff(off: number): number {
    for (let t = 0; t < 4; t++) {
      const base = IO.TM0D + t * 4;
      if (off === base || off === base + 1) return t;
    }
    return -1;
  }

  // IO write with side effects (IF ack, HALTCNT, DMA enable check)
  private writeIO(off: number, val: number, size: 1 | 2 | 4) {
    const oldSiocnt = this.ioView.getUint16(0x128, true);
    const oldRcnt = this.ioView.getUint16(0x134, true);
    const isSio = (off >= 0x120 && off <= 0x15F) && (off !== 0x130) && (off !== 0x132);
    let mode = 0;
    let isGpMode = false;
    let isJoybus = false;
    if (isSio) {
      console.log(`SIO Write: off=0x${off.toString(16)} val=0x${val.toString(16)} size=${size}`);
      isGpMode = ((oldRcnt & 0x8000) !== 0) && ((oldRcnt & 0x4000) === 0);
      isJoybus = ((oldRcnt & 0x8000) !== 0) && ((oldRcnt & 0x4000) !== 0);
      mode = (isGpMode || isJoybus) ? 3 : (oldSiocnt >>> 12) & 3;

      let writable = false;
      if (off === 0x128) {
        writable = true;
      } else if (off === 0x12A) {
        writable = true;
      } else if (off === 0x120 || off === 0x122 || off === 0x124 || off === 0x126) {
        if (mode === 2) {
          const playerId = (oldSiocnt >>> 4) & 3;
          const regId = (off - 0x120) >>> 1;
          if (regId === playerId) {
            off = 0x12A;
          }
        }
        writable = true;
      } else if (off === 0x134) {
        writable = true; // RCNT is always writable
      } else if (off === 0x140) {
        writable = isJoybus;
      } else if (off === 0x154 || off === 0x156) {
        writable = isJoybus;
      }

      if (!writable) return;

      const oldJoycnt = this.ioView.getUint16(0x140, true);

      // Perform raw write to ioView first so we have the merged value
      if (size === 2) {
        this.ioView.setUint16(off, val & 0xffff, true);
      } else if (size === 4) {
        this.ioView.setUint32(off, val, true);
      } // Size 1 already written by write8

      if (off <= 0x128 && off + size > 0x128) {
        this.writeSiocnt(this.ioView.getUint16(0x128, true), oldSiocnt);
      }
      if (off <= 0x134 && off + size > 0x134) {
        this.writeRcnt(this.ioView.getUint16(0x134, true));
      }
      if (off <= 0x140 && off + size > 0x140) {
        this.writeJoycnt(this.ioView.getUint16(0x140, true));
      }
      if (isJoybus) {
        if ((off <= 0x154 && off + size > 0x154) || (off <= 0x156 && off + size > 0x156)) {
          const curJoyStat = this.ioView.getUint16(0x158, true);
          this.ioView.setUint16(0x158, curJoyStat | 0x0002, true);
        }
      }
      return;
    }

    // KEYINPUT (0x130-0x131) is read-only on real hardware.
    // Only block CPU writes (not emulator key input which writes directly to io[]).
    if (this.blockKeyWrites && off >= 0x130 && off < 0x132) return;
    if (size === 1) {
      // Byte write
      if (off === IO.IF || off === IO.IF + 1) {
        // IF acknowledge: writing 1s clears those bits
        this.io[off] &= ~(val & 0xff);
        this.lastBiosPc = 0x0DC; // BIOS protected memory update on IF ack
        this.checkDmaEnable();
        return;
      }
      this.io[off] = val & 0xff;      // SIO registers: re-apply 16-bit register masks
      if (off === 0x128 || off === 0x129) {
        let v = this.ioView.getUint16(0x128, true);
        this.writeSiocnt(v, oldSiocnt);
      } else if (off === 0x134 || off === 0x135) {
        let v = this.ioView.getUint16(0x134, true);
        this.writeRcnt(v, oldRcnt);
      } else if (off === 0x140 || off === 0x141) {
        let v = this.ioView.getUint16(0x140, true);
        this.ioView.setUint16(0x140, v & 0x417B, true);
      }

      if (off === IO.HALTCNT) {
        if (val & 0x80) this.halted = true; // halt CPU until interrupt
      }
      if (this.isDmaCntOff(off)) this.checkDmaEnable();
      // Timer data write: notify GBA to update internal counter
      const ti = this.timerIndexForOff(off);
      if (ti >= 0 && this.timerWriteCallback) {
        const fullVal = this.ioView.getUint16(IO.TM0D + ti * 4, true);
        this.timerWriteCallback(ti, fullVal);
      }
    } else if (size === 2) {
      // 16-bit write
      if (off === IO.IF) {
        // IF acknowledge: writing 1s clears those bits
        const cur = this.ioView.getUint16(IO.IF, true);
        this.ioView.setUint16(IO.IF, cur & ~(val & 0xffff) & 0xffff, true);
        this.lastBiosPc = 0x0DC;
        this.checkDmaEnable();
        return;
      }

      if (off === 0x128) {
        const oldVal = this.ioView.getUint16(0x128, true);
        this.writeSiocnt(val, oldVal);
        return;
      } else if (off === 0x12A) {
        if (mode === 2 || mode === 0) {
          if (mode === 2) {
            const playerId = (oldSiocnt >>> 4) & 3;
            this.ioView.setUint16(0x120 + playerId * 2, val & 0xffff, true);
          }
          this.ioView.setUint16(0x12A, val & 0xffff, true);
        }
        return;
      } else if (off === 0x120 || off === 0x122 || off === 0x124 || off === 0x126) {
        if (mode === 2) {
          const playerId = (oldSiocnt >>> 4) & 3;
          const regId = (off - 0x120) >>> 1;
          if (regId === playerId) {
            this.ioView.setUint16(0x12A, val & 0xffff, true);
          }
          this.ioView.setUint16(off, val & 0xffff, true);
        } else if (mode === 1) {
          if (off === 0x120 || off === 0x122) {
            this.ioView.setUint16(off, val & 0xffff, true);
          }
        }
        return;
      } else if (off === 0x134) {
        const oldVal = this.ioView.getUint16(0x134, true);
        this.writeRcnt(val, oldVal);
        return;
      } else if (off === 0x140) {
        this.writeJoycnt(val);
        return;
      }

      this.ioView.setUint16(off, val & 0xffff, true);
      // HALTCNT (high byte of 0x300 write)
      if (off === 0x300) {
        if ((val >> 8) & 0x80) this.halted = true;
      }
      if (this.isDmaCntOff(off)) this.checkDmaEnable();
      // Timer data write: notify GBA to update internal counter
      const ti = this.timerIndexForOff(off);
      if (ti >= 0 && this.timerWriteCallback) {
        this.timerWriteCallback(ti, val & 0xffff);
      }
    } else {
      // 32-bit write
      this.ioView.setUint32(off, val >>> 0, true);

      // SIO registers: re-apply 16-bit register masks if covered
      if (off <= 0x128 && off + 4 > 0x128) {
        let v = this.ioView.getUint16(0x128, true);
        this.writeSiocnt(v, oldSiocnt);
      }
      if (off <= 0x134 && off + 4 > 0x134) {
        let v = this.ioView.getUint16(0x134, true);
        this.writeRcnt(v, oldRcnt);
      }
      if (off <= 0x140 && off + 4 > 0x140) {
        let v = this.ioView.getUint16(0x140, true);
        this.ioView.setUint16(0x140, v & 0x0047, true);
      }

      // IF acknowledge (if write covers IF)
      if (off <= IO.IF && off + 4 > IO.IF) {
        const ifOff = IO.IF - off;
        const ifVal = (val >>> (ifOff * 8)) & 0xffff;
        const cur = this.ioView.getUint16(IO.IF, true);
        this.ioView.setUint16(IO.IF, cur & ~ifVal & 0xffff, true);
        this.lastBiosPc = 0x0DC;
      }
      // HALTCNT (if write covers HALTCNT)
      if (off <= IO.HALTCNT && off + 4 > IO.HALTCNT) {
        const haltOff = IO.HALTCNT - off;
        const haltVal = (val >>> (haltOff * 8)) & 0xff;
        if (haltVal & 0x80) this.halted = true;
      }
      // DMA enable check (if write covers any DMA control register)
      for (let i = 0; i < 4; i++) {
        if (this.isDmaCntOff(off + i)) { this.checkDmaEnable(); break; }
      }
      // Timer data write: notify GBA for each TMxD covered by this 32-bit write
      if (this.timerWriteCallback) {
        for (let i = 0; i < 4; i++) {
          const ti = this.timerIndexForOff(off + i);
          if (ti >= 0) {
            const fullVal = this.ioView.getUint16(IO.TM0D + ti * 4, true);
            this.timerWriteCallback(ti, fullVal);
          }
        }
      }
    }
  }

  // Check if any DMA channel is enabled and trigger callback
  checkDmaEnable() {
    for (let ch = 0; ch < 4; ch++) {
      const off = IO.DMA0CNT_H + ch * 12;
      if (this.readIO16(off) & 0x8000) {
        if (this.dmaEnableCallback) this.dmaEnableCallback();
        return;
      }
    }
  }

  // ---- Convenience palette reads (for PPU) ----
  paletteColor16(index: number): number {
    const o = (index & 0xff) * 2;
    return this.palette[o] | (this.palette[o + 1] << 8);
  }
  paletteBg16(index: number): number {
    const o = (index & 0xff) * 2;
    return this.palette[o] | (this.palette[o + 1] << 8);
  }
  paletteObj16(index: number): number {
    const o = 0x200 + (index & 0xff) * 2;
    return this.palette[o] | (this.palette[o + 1] << 8);
  }

  // ---- Save/Load state ----
  saveState() {
    return {
      ewram: this.ewram.slice(),
      iwram: this.iwram.slice(),
      io: this.io.slice(),
      palette: this.palette.slice(),
      vram: this.vram.slice(),
      oam: this.oam.slice(),
      sram: this.sram.slice(),
      flashState: this.flashState,
      flashCmd: this.flashCmd,
      flashWritePending: this.flashWritePending,
      flashBankPending: this.flashBankPending,
      flashBank: this.flashBank,
      lastBiosPc: this.lastBiosPc,
      r15Shadow: this.r15Shadow,
      halted: this.halted,
    };
  }

  loadState(s: {
    ewram: Uint8Array; iwram: Uint8Array; io: Uint8Array;
    palette: Uint8Array; vram: Uint8Array; oam: Uint8Array; sram: Uint8Array;
    flashState: number; flashCmd: number; flashWritePending: boolean;
    flashBankPending: boolean; flashBank: number;
    lastBiosPc: number; r15Shadow: number; halted: boolean;
  }) {
    this.ewram.set(s.ewram);
    this.iwram.set(s.iwram);
    this.io.set(s.io);
    this.palette.set(s.palette);
    this.vram.set(s.vram);
    this.oam.set(s.oam);
    this.sram.set(s.sram);
    this.flashState = s.flashState;
    this.flashCmd = s.flashCmd;
    this.flashWritePending = s.flashWritePending;
    this.flashBankPending = s.flashBankPending;
    this.flashBank = s.flashBank;
    this.lastBiosPc = s.lastBiosPc;
    this.r15Shadow = s.r15Shadow;
    this.halted = s.halted;
  }
}
