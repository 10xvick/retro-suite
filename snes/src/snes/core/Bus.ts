import { Cartridge } from './Cartridge';

export interface PpuPortDevice {
  bus: any;
  currentScanline: number;
  readRegister(addr: number): number;
  writeRegister(addr: number, val: number): void;
}

export interface ApuPortDevice {
  reset(): void;
  read(addr: number, wram3: number, cpu: { pc: number; pb: number; cycles: number } | null): number;
  write(addr: number, val: number, cycles: number): void;
}

export class Bus {
  public cartridge: Cartridge | null = null;
  public ppu: PpuPortDevice;
  public openBusValue: number = 0;
  
  // 128KB WRAM
  public wram = new Uint8Array(128 * 1024);

  // Controller inputs for Controller 1 and 2
  // Formatted as 16-bit auto-joypad read values:
  // Bit 15: B, 14: Y, 13: Select, 12: Start, 11: Up, 10: Down, 9: Left, 8: Right
  // Bit 7: A, 6: X, 5: L, 4: R, 3-0: Unused
  public controller1State: number = 0;
  public controller2State: number = 0;

  private controllerStrobe: number = 0;
  private controller1Shift: number = 0;
  private controller2Shift: number = 0;

  // DMA & CPU Control registers
  private dmaRegisters = new Uint8Array(0x80); // $4300 - $437F
  private vblankToggle: boolean = false;
  public nmiEnabled: boolean = false;
  public nmiActive: boolean = false;
  public virqEnabled: boolean = false;
  public hirqEnabled: boolean = false;
  public htime: number = 0; // Target horizontal dot (0-339)
  public vtime: number = 0; // Target vertical scanline (0-261)
  public irqActive: boolean = false;
  private hdmaEnable: number = 0;
  public cpu: any = null;
  public memsel: number = 0;

  // HDMA registers and states
  public hdmaTablePtr = new Uint16Array(8);
  public hdmaBank = new Uint8Array(8);
  public hdmaActive = new Uint8Array(8); // 1 = active, 0 = inactive
  public hdmaLineCounter = new Uint8Array(8);
  public hdmaRepeat = new Uint8Array(8); // 1 = repeat, 0 = single
  public hdmaDoTransfer = new Uint8Array(8); // 1 = transfer on this line, 0 = skip
  public hdmaIndirectPtr = new Uint16Array(8);
  public hdmaIndirectBank = new Uint8Array(8);

  // Audio domain bridge for APU ports ($2140 - $2143)
  private apuBridge: ApuPortDevice;

  // WRAM registers ($2180-$2183)
  private wramAddressRegister: number = 0;

  // CPU Multiplication/Division registers
  private cpuMultiplicand: number = 0;
  private cpuMultiplier: number = 0;
  private cpuDividend: number = 0;
  private cpuDivisor: number = 0;
  private cpuQuotient: number = 0;
  private cpuResult: number = 0; // Shared product / remainder register

  constructor(ppu: PpuPortDevice, apuBridge: ApuPortDevice) {
    this.ppu = ppu;
    this.apuBridge = apuBridge;
    this.ppu.bus = this;
  }

  public loadCartridge(cartridge: Cartridge) {
    this.cartridge = cartridge;
  }

  public reset() {
    this.openBusValue = 0;
    this.wram.fill(0);
    this.controller1State = 0;
    this.controller2State = 0;
    this.controllerStrobe = 0;
    this.controller1Shift = 0;
    this.dmaRegisters.fill(0);
    this.vblankToggle = false;
    this.nmiEnabled = false;
    this.nmiActive = false;
    this.virqEnabled = false;
    this.hirqEnabled = false;
    this.htime = 0;
    this.vtime = 0;
    this.irqActive = false;
    this.hdmaEnable = 0;
    this.memsel = 0;
    this.hdmaTablePtr.fill(0);
    this.hdmaBank.fill(0);
    this.hdmaActive.fill(0);
    this.hdmaLineCounter.fill(0);
    this.hdmaRepeat.fill(0);
    this.hdmaDoTransfer.fill(0);
    this.hdmaIndirectPtr.fill(0);
    this.hdmaIndirectBank.fill(0);
    this.apuBridge.reset();
    this.wramAddressRegister = 0;
    this.cpuMultiplicand = 0;
    this.cpuMultiplier = 0;
    this.cpuDividend = 0;
    this.cpuDivisor = 0;
    this.cpuQuotient = 0;
    this.cpuResult = 0;
  }

  public readByte(bank: number, addr: number): number {
    bank &= 0xFF;
    addr &= 0xFFFF;
    const val = this.readByteInternal(bank, addr);
    if (val !== -1 && val !== undefined && !isNaN(val)) {
      this.openBusValue = val & 0xFF;
      return val;
    }
    return 0; // Return 0 as safe fallback for unmapped / write-only reads
  }

  private readByteInternal(bank: number, addr: number): number {
    // Bank 7E/7F: WRAM
    if (bank === 0x7E) {
      return this.wram[addr];
    }
    if (bank === 0x7F) {
      return this.wram[0x10000 + addr];
    }

    // Mirror of Low RAM ($0000-$1FFF) in banks $00-$3F and $80-$BF
    const isSystemBank = (bank >= 0x00 && bank <= 0x3F) || (bank >= 0x80 && bank <= 0xBF);
    if (isSystemBank) {
      if (addr < 0x2000) {
        return this.wram[addr]; // Low RAM mirror (8KB)
      }

      // PPU Registers ($2100 - $213F)
      if (addr >= 0x2100 && addr <= 0x213F) {
        return this.ppu.readRegister(addr);
      }

      // WRAM Registers ($2180 - $2183)
      if (addr >= 0x2180 && addr <= 0x2183) {
        if (addr === 0x2180) {
          const val = this.wram[this.wramAddressRegister];
          this.wramAddressRegister = (this.wramAddressRegister + 1) & 0x1FFFF;
          return val;
        }
        return -1; // $2181-$2183 are write-only (open bus)
      }

      // APU Ports ($2140 - $2143)
      if (addr >= 0x2140 && addr <= 0x2143) {
        return this.apuBridge.read(
          addr,
          this.wram[3],
          this.cpu ? { pc: this.cpu.pc, pb: this.cpu.pb, cycles: this.cpu.totalCycles } : null
        );
      }

      // CPU Registers ($4000 - $42FF)
      if (addr >= 0x4000 && addr <= 0x42FF) {
        return this.readCpuRegister(addr);
      }

      // DMA Channel Registers ($4300 - $437F)
      if (addr >= 0x4300 && addr <= 0x437F) {
        return this.dmaRegisters[addr - 0x4300];
      }
    }

    // ROM/SRAM Reading: LoROM / HiROM mapping
    if (this.cartridge) {
      if (this.cartridge.header.isLoROM) {
        // LoROM SRAM in system banks ($00-$3F, $80-$BF) at $6000-$7FFF
        const isSystemBank = (bank >= 0x00 && bank <= 0x3F) || (bank >= 0x80 && bank <= 0xBF);
        if (isSystemBank && addr >= 0x6000 && addr <= 0x7FFF) {
          const sramOffset = (addr - 0x6000) % this.cartridge.sram.length;
          return this.cartridge.sram[sramOffset];
        }
        // LoROM SRAM in SRAM banks ($70-$7D, $F0-$FF) at $0000-$7FFF
        const isSramBank = (bank >= 0x70 && bank <= 0x7D) || (bank >= 0xF0 && bank <= 0xFF);
        if (isSramBank && addr < 0x8000) {
          const sramOffset = (((bank & 0x0F) * 0x8000) + addr) % this.cartridge.sram.length;
          return this.cartridge.sram[sramOffset];
        }

        const isRomBank = (bank >= 0x00 && bank <= 0x7D) || (bank >= 0x80 && bank <= 0xFF);
        if (isRomBank && addr >= 0x8000) {
          const romOffset = ((bank & 0x7F) * 0x8000) + (addr - 0x8000);
          if (romOffset < this.cartridge.rom.length) {
            return this.cartridge.rom[romOffset];
          }
        }
      } else {
        // HiROM SRAM in system banks ($20-$3F, $A0-$BF) at $6000-$7FFF
        const isSramBank = (bank >= 0x20 && bank <= 0x3F) || (bank >= 0xA0 && bank <= 0xBF);
        if (isSramBank && addr >= 0x6000 && addr <= 0x7FFF) {
          const sramOffset = (((bank & 0x1F) * 0x2000) + (addr - 0x6000)) % this.cartridge.sram.length;
          return this.cartridge.sram[sramOffset];
        }

        // HiROM: Correct mapping for banks and address ranges
        let romOffset = -1;
        
        // Upper banks ($00-$3F, $80-$BF) with restricted address range ($8000-$FFFF)
        if ((bank <= 0x3F || (bank >= 0x80 && bank <= 0xBF)) && addr >= 0x8000) {
          romOffset = ((bank & 0x3F) << 16) | addr;
        }
        // Full 64KB banks ($40-$7D)
        else if (bank >= 0x40 && bank <= 0x7D) {
          romOffset = ((bank - 0x40) << 16) | addr;
        }
        // Mirrored full banks ($C0-$FF)
        else if (bank >= 0xC0) {
          romOffset = ((bank - 0xC0) << 16) | addr;
        }
        
        if (romOffset >= 0 && romOffset < this.cartridge.rom.length) {
          return this.cartridge.rom[romOffset];
        }
      }
    }

    return -1; // Open Bus
  }

  public writeByte(bank: number, addr: number, val: number) {
    bank &= 0xFF;
    addr &= 0xFFFF;
    val &= 0xFF;
    this.openBusValue = val;

    // Bank 7E/7F: WRAM
    if (bank === 0x7E) {
      this.wram[addr] = val;
      return;
    }
    if (bank === 0x7F) {
      this.wram[0x10000 + addr] = val;
      return;
    }

    // Cartridge SRAM writes
    if (this.cartridge) {
      if (this.cartridge.header.isLoROM) {
        // LoROM SRAM in system banks ($00-$3F, $80-$BF) at $6000-$7FFF
        const isSystemBank = (bank >= 0x00 && bank <= 0x3F) || (bank >= 0x80 && bank <= 0xBF);
        if (isSystemBank && addr >= 0x6000 && addr <= 0x7FFF) {
          const sramOffset = (addr - 0x6000) % this.cartridge.sram.length;
          this.cartridge.sram[sramOffset] = val;
          return;
        }
        // LoROM SRAM in SRAM banks ($70-$7D, $F0-$FF) at $0000-$7FFF
        const isSramBank = (bank >= 0x70 && bank <= 0x7D) || (bank >= 0xF0 && bank <= 0xFF);
        if (isSramBank && addr < 0x8000) {
          const sramOffset = (((bank & 0x0F) * 0x8000) + addr) % this.cartridge.sram.length;
          this.cartridge.sram[sramOffset] = val;
          return;
        }
      } else {
        // HiROM SRAM in system banks ($20-$3F, $A0-$BF) at $6000-$7FFF
        const isSramBank = (bank >= 0x20 && bank <= 0x3F) || (bank >= 0xA0 && bank <= 0xBF);
        if (isSramBank && addr >= 0x6000 && addr <= 0x7FFF) {
          const sramOffset = (((bank & 0x1F) * 0x2000) + (addr - 0x6000)) % this.cartridge.sram.length;
          this.cartridge.sram[sramOffset] = val;
          return;
        }
      }
    }

    // System banks low-memory mapping
    const isSystemBank = (bank >= 0x00 && bank <= 0x3F) || (bank >= 0x80 && bank <= 0xBF);
    if (isSystemBank) {
      if (addr < 0x2000) {
        this.wram[addr] = val;
        return;
      }

      // PPU Registers ($2100 - $213F)
      if (addr >= 0x2100 && addr <= 0x213F) {
        this.ppu.writeRegister(addr, val);
        return;
      }

      // WRAM Registers ($2180 - $2183)
      if (addr >= 0x2180 && addr <= 0x2183) {
        if (addr === 0x2180) {
          this.wram[this.wramAddressRegister] = val;
          this.wramAddressRegister = (this.wramAddressRegister + 1) & 0x1FFFF;
        } else if (addr === 0x2181) {
          this.wramAddressRegister = (this.wramAddressRegister & 0x1FF00) | val;
        } else if (addr === 0x2182) {
          this.wramAddressRegister = (this.wramAddressRegister & 0x100FF) | (val << 8);
        } else if (addr === 0x2183) {
          this.wramAddressRegister = (this.wramAddressRegister & 0x0FFFF) | ((val & 1) << 16);
        }
        return;
      }

      // APU Ports ($2140 - $2143)
      if (addr >= 0x2140 && addr <= 0x2143) {
        this.apuBridge.write(addr, val, this.cpu ? this.cpu.totalCycles : 0);
        return;
      }

      // CPU Registers ($4000 - $42FF)
      if (addr >= 0x4000 && addr <= 0x42FF) {
        this.writeCpuRegister(addr, val);
        return;
      }

      // DMA Channel Registers ($4300 - $437F)
      if (addr >= 0x4300 && addr <= 0x437F) {
        this.dmaRegisters[addr - 0x4300] = val;
        return;
      }
    }
  }

  public readWord(bank: number, addr: number): number {
    const low = this.readByte(bank, addr);
    const high = this.readByte(bank, addr + 1);
    return low | (high << 8);
  }

  public writeWord(bank: number, addr: number, val: number) {
    this.writeByte(bank, addr, val & 0xFF);
    this.writeByte(bank, addr + 1, (val >> 8) & 0xFF);
  }

  private readCpuRegister(addr: number): number {
    // $4016: Joypad 1 read
    if (addr === 0x4016) {
      if (this.controllerStrobe & 1) {
        return (this.controller1State & 0x8000) ? 1 : 0;
      }
      if (this.controller1Shift >= 16) {
        return 1;
      }
      const bit = (this.controller1State >> (15 - this.controller1Shift)) & 1;
      this.controller1Shift++;
      return bit;
    }

    // $4017: Joypad 2 read
    if (addr === 0x4017) {
      if (this.controllerStrobe & 1) {
        return (this.controller2State & 0x8000) ? 1 : 0;
      }
      if (this.controller2Shift >= 16) {
        return 1;
      }
      const bit = (this.controller2State >> (15 - this.controller2Shift)) & 1;
      this.controller2Shift++;
      return bit;
    }

    // $4210: RDNMI (Read NMI status)
    if (addr === 0x4210) {
      // Bit 7: NMI active.
      // Bits 6-4: Open bus. When read via absolute addressing (e.g. bit.w $4210),
      // the high byte of the address (0x42) is on the data bus, returning bit 6 as 1.
      // Bits 3-0: CPU version (version 2).
      const result = (this.nmiActive ? 0x80 : 0x00) | 0x40 | 0x02; // version 2
      this.nmiActive = false;
      return result;
    }

    // $4211: TIMEUP
    if (addr === 0x4211) {
      const result = this.irqActive ? 0x80 : 0x00;
      this.irqActive = false;
      return result;
    }

    // $4212: CPU Status (VBlank/HBlank status)
    if (addr === 0x4212) {
      let status = 0;
      // Bit 7: VBlank status (1 if sy >= 224)
      if (this.ppu && this.ppu.currentScanline >= 224) {
        status |= 0x80;
      }
      // Bit 6: HBlank status (estimate based on CPU cycles in current scanline)
      const sy = this.ppu ? this.ppu.currentScanline : 0;
      const scanlineStartCycles = Math.floor((sy * 59666) / 262);
      const cpuCycles = this.cpu ? this.cpu.cycles : 0;
      const currentCyclesInScanline = cpuCycles - scanlineStartCycles;
      const hblankStart = 130;
      if (currentCyclesInScanline >= hblankStart) {
        status |= 0x40;
      }
      // Bit 0: Auto-Joypad Read busy status — active from scanline 224 through 226 (approx. 3 scanlines)
      if (this.ppu && this.ppu.currentScanline >= 224 && this.ppu.currentScanline <= 226) {
        status |= 0x01;
      }
      return status;
    }

    // $420C: HDMA Enable Register
    if (addr === 0x420C) {
      return this.hdmaEnable;
    }

    // $420D: MEMSEL Register
    if (addr === 0x420D) {
      return this.memsel;
    }

    // $4218-$4219: Joypad 1 auto-read registers
    if (addr === 0x4218) {
      return this.controller1State & 0xFF;
    }
    if (addr === 0x4219) {
      return (this.controller1State >> 8) & 0xFF;
    }

    // $421A-$421B: Joypad 2 auto-read
    if (addr === 0x421A) {
      return this.controller2State & 0xFF;
    }
    if (addr === 0x421B) {
      return (this.controller2State >> 8) & 0xFF;
    }

    // $4214-$4215: Division Quotient
    if (addr === 0x4214) {
      return this.cpuQuotient & 0xFF;
    }
    if (addr === 0x4215) {
      return (this.cpuQuotient >> 8) & 0xFF;
    }

    // $4216-$4217: Multiplication Product / Division Remainder
    if (addr === 0x4216) {
      return this.cpuResult & 0xFF;
    }
    if (addr === 0x4217) {
      return (this.cpuResult >> 8) & 0xFF;
    }

    return -1;
  }

  private writeCpuRegister(addr: number, val: number) {
    // $4016: Joypad strobe
    if (addr === 0x4016) {
      this.controllerStrobe = val & 1;
      if (this.controllerStrobe) {
        this.controller1Shift = 0;
        this.controller2Shift = 0;
      }
    }

    // $4200: CPU Control (Interrupt Enable)
    if (addr === 0x4200) {
      const newNmiEnabled = (val & 0x80) !== 0;
      if (!this.nmiEnabled && newNmiEnabled && this.nmiActive && this.cpu) {
        this.cpu.nmiPending = true;
      }
      this.nmiEnabled = newNmiEnabled;
      this.virqEnabled = (val & 0x20) !== 0;
      this.hirqEnabled = (val & 0x10) !== 0;
    }

    // $4207: HTIMEL
    if (addr === 0x4207) {
      this.htime = (this.htime & 0x0100) | val;
    }

    // $4208: HTIMEH
    if (addr === 0x4208) {
      this.htime = (this.htime & 0x00FF) | ((val & 1) << 8);
    }

    // $4209: VTIMEL
    if (addr === 0x4209) {
      this.vtime = (this.vtime & 0x0100) | val;
    }

    // $420A: VTIMEH
    if (addr === 0x420A) {
      this.vtime = (this.vtime & 0x00FF) | ((val & 1) << 8);
    }

    // $4202: Multiplicand
    if (addr === 0x4202) {
      this.cpuMultiplicand = val;
    }

    // $4203: Multiplier (triggers multiplication)
    if (addr === 0x4203) {
      this.cpuMultiplier = val;
      this.cpuResult = this.cpuMultiplicand * this.cpuMultiplier;
    }

    // $4204: Dividend Low
    if (addr === 0x4204) {
      this.cpuDividend = (this.cpuDividend & 0xFF00) | val;
    }

    // $4205: Dividend High
    if (addr === 0x4205) {
      this.cpuDividend = (this.cpuDividend & 0x00FF) | (val << 8);
    }

    // $4206: Divisor (triggers division)
    if (addr === 0x4206) {
      this.cpuDivisor = val;
      if (this.cpuDivisor === 0) {
        this.cpuQuotient = 0xFFFF;
        this.cpuResult = this.cpuDividend;
      } else {
        this.cpuQuotient = Math.floor(this.cpuDividend / this.cpuDivisor) & 0xFFFF;
        this.cpuResult = (this.cpuDividend % this.cpuDivisor) & 0xFFFF;
      }
    }

    // $420B: DMA Enable Trigger
    if (addr === 0x420B) {
      this.executeDma(val);
    }

    // $420C: HDMA Enable
    if (addr === 0x420C) {
      this.hdmaEnable = val;
    }

    // $420D: MEMSEL Register
    if (addr === 0x420D) {
      this.memsel = val & 1;
    }
  }

  private executeDma(val: number) {
    for (let c = 0; c < 8; c++) {
      if ((val & (1 << c)) !== 0) {
        const base = c * 0x10;
        const param = this.dmaRegisters[base];
        const bBusAddr = this.dmaRegisters[base + 1] + 0x2100;
        const aBusAddr = this.dmaRegisters[base + 2] | (this.dmaRegisters[base + 3] << 8);
        const aBusBank = this.dmaRegisters[base + 4];
        let count = this.dmaRegisters[base + 5] | (this.dmaRegisters[base + 6] << 8);
        if (count === 0) count = 0x10000;

        const direction = (param & 0x80) === 0; // 0 = A-to-B, 1 = B-to-A
        const step = (param >> 3) & 3; // 0 = increment, 2 = decrement, 1/3 = fixed
        const transferMode = param & 7;

        let src = aBusAddr;
        for (let i = 0; i < count; i++) {
          let regOffset = 0;
          switch (transferMode) {
            case 0: regOffset = 0; break;
            case 1: regOffset = i % 2; break;
            case 2: regOffset = 0; break;
            case 3: regOffset = (i >> 1) % 2; break;
            case 4: regOffset = i % 4; break;
            case 5: regOffset = i % 2; break;
            case 6: regOffset = 0; break;
            case 7: regOffset = (i >> 1) % 2; break;
            default: regOffset = 0; break;
          }
          const targetBBus = bBusAddr + regOffset;

          if (direction) {
            const data = this.readByte(aBusBank, src);
            this.writeByte(0, targetBBus, data);
          } else {
            const data = this.readByte(0, targetBBus);
            this.writeByte(aBusBank, src, data);
          }

          if (step === 0) src = (src + 1) & 0xFFFF;
          else if (step === 2) src = (src - 1) & 0xFFFF;
        }

        // Update DMA registers after completion
        this.dmaRegisters[base + 2] = src & 0xFF;
        this.dmaRegisters[base + 3] = (src >> 8) & 0xFF;
        this.dmaRegisters[base + 5] = 0;
        this.dmaRegisters[base + 6] = 0;
      }
    }
  }

  public initHdma() {
    const val = this.readByte(0, 0x420C); // Read HDMA enable register
    for (let c = 0; c < 8; c++) {
      if ((val & (1 << c)) !== 0) {
        const base = c * 0x10;
        const dmap = this.dmaRegisters[base];
        const isIndirect = (dmap & 0x40) !== 0;

        // Load A-Bus start address from $43X2-$43X3
        const addrLow = this.dmaRegisters[base + 2];
        const addrHigh = this.dmaRegisters[base + 3];
        const bank = this.dmaRegisters[base + 4]; // A1B

        this.hdmaTablePtr[c] = addrLow | (addrHigh << 8);
        this.hdmaBank[c] = bank;
        this.hdmaActive[c] = 1;

        // Read first line counter byte
        let ptr = this.hdmaTablePtr[c];
        const lineByte = this.readByte(bank, ptr);
        ptr = (ptr + 1) & 0xFFFF;
        this.hdmaTablePtr[c] = ptr;

        if (lineByte === 0) {
          this.hdmaActive[c] = 0;
          continue;
        }

        this.hdmaLineCounter[c] = lineByte & 0x7F;
        this.hdmaRepeat[c] = (lineByte & 0x80) !== 0 ? 1 : 0;
        this.hdmaDoTransfer[c] = 1;

        if (isIndirect) {
          // Read 16-bit indirect pointer address from the table
          const indirLow = this.readByte(bank, ptr);
          ptr = (ptr + 1) & 0xFFFF;
          const indirHigh = this.readByte(bank, ptr);
          ptr = (ptr + 1) & 0xFFFF;
          this.hdmaTablePtr[c] = ptr;

          this.hdmaIndirectPtr[c] = indirLow | (indirHigh << 8);
          this.hdmaIndirectBank[c] = this.dmaRegisters[base + 7]; // DASB ($43X7)
        }
      } else {
        this.hdmaActive[c] = 0;
      }
    }
  }

  public executeHdmaScanline(sy: number) {
    const val = this.hdmaEnable; // Check if enabled
    for (let c = 0; c < 8; c++) {
      if ((val & (1 << c)) !== 0 && this.hdmaActive[c] === 1) {
        const base = c * 0x10;
        const dmap = this.dmaRegisters[base];
        const isIndirect = (dmap & 0x40) !== 0;
        const bBusAddr = this.dmaRegisters[base + 1] + 0x2100;
        const transferMode = dmap & 7;

        if (this.hdmaDoTransfer[c] === 1) {
          // Perform transfer
          let numBytes = 1;
          let offsets = [0];
          switch (transferMode) {
            case 0: numBytes = 1; offsets = [0]; break; // 1 byte to $21XX
            case 1: numBytes = 2; offsets = [0, 1]; break; // 2 bytes to $21XX, $21XX+1
            case 2: numBytes = 2; offsets = [0, 0]; break; // 2 bytes to $21XX, $21XX
            case 3: numBytes = 4; offsets = [0, 0, 1, 1]; break; // 4 bytes to $21XX, $21XX, $21XX+1, $21XX+1
            case 4: numBytes = 4; offsets = [0, 1, 2, 3]; break; // 4 bytes to $21XX, $21XX+1, $21XX+2, $21XX+3
            case 5: numBytes = 4; offsets = [0, 1, 0, 1]; break; // 4 bytes to $21XX, $21XX+1, $21XX, $21XX+1
            case 6: numBytes = 2; offsets = [0, 0]; break; // Mirrors mode 2 pattern
            case 7: numBytes = 4; offsets = [0, 0, 1, 1]; break; // Mirrors mode 3 pattern
            default: numBytes = 1; offsets = [0]; break;
          }

          let srcBank = this.hdmaBank[c];
          let srcAddr = 0;

          if (isIndirect) {
            srcBank = this.hdmaIndirectBank[c];
            srcAddr = this.hdmaIndirectPtr[c];
          } else {
            srcAddr = this.hdmaTablePtr[c];
          }

          for (let i = 0; i < numBytes; i++) {
            const data = this.readByte(srcBank, srcAddr);
            srcAddr = (srcAddr + 1) & 0xFFFF;
            const targetBBus = bBusAddr + offsets[i];
            this.writeByte(0, targetBBus, data);
          }

          if (isIndirect) {
            this.hdmaIndirectPtr[c] = srcAddr;
          } else {
            this.hdmaTablePtr[c] = srcAddr;
          }
        }
      }
    }

    // Now decrement the line counter and update states for the NEXT scanline
    for (let c = 0; c < 8; c++) {
      if ((val & (1 << c)) !== 0 && this.hdmaActive[c] === 1) {
        this.hdmaLineCounter[c]--;

        // Check if we need to load a new block
        if (this.hdmaLineCounter[c] === 0) {
          const base = c * 0x10;
          const dmap = this.dmaRegisters[base];
          const isIndirect = (dmap & 0x40) !== 0;
          const bank = this.hdmaBank[c];
          let ptr = this.hdmaTablePtr[c];

          const lineByte = this.readByte(bank, ptr);
          ptr = (ptr + 1) & 0xFFFF;
          this.hdmaTablePtr[c] = ptr;

          if (lineByte === 0) {
            this.hdmaActive[c] = 0;
            continue;
          }

          this.hdmaLineCounter[c] = lineByte & 0x7F;
          this.hdmaRepeat[c] = (lineByte & 0x80) !== 0 ? 1 : 0;
          this.hdmaDoTransfer[c] = 1;

          if (isIndirect) {
            const indirLow = this.readByte(bank, ptr);
            ptr = (ptr + 1) & 0xFFFF;
            const indirHigh = this.readByte(bank, ptr);
            ptr = (ptr + 1) & 0xFFFF;
            this.hdmaTablePtr[c] = ptr;

            this.hdmaIndirectPtr[c] = indirLow | (indirHigh << 8);
          }
        } else {
          // If repeat mode is false, we only transfer on the first line of the block.
          // Subsequent lines in this block do NOT perform transfer.
          this.hdmaDoTransfer[c] = this.hdmaRepeat[c];
        }
      }
    }
  }
}
