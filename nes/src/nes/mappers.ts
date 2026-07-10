import { Cartridge, Mirror } from './cartridge';

export interface MapperResult {
  mapped: boolean;
  data: number;
}

export abstract class Mapper {
  protected prgBanks: number;
  protected chrBanks: number;
  protected cart: Cartridge;
  
  // IRQ signals for scanline counter (MMC3)
  public irqActive: boolean = false;

  constructor(prgBanks: number, chrBanks: number, cart: Cartridge) {
    this.prgBanks = prgBanks;
    this.chrBanks = chrBanks;
    this.cart = cart;
  }

  abstract cpuRead(addr: number): MapperResult;
  abstract cpuWrite(addr: number, data: number): { mapped: boolean };
  abstract ppuRead(addr: number): MapperResult;
  abstract ppuWrite(addr: number, data: number): { mapped: boolean };
  
  public tickScanline() {} // Optional scanline hook
}

// -------------------------------------------------------------
// MAPPER 0 (NROM)
// -------------------------------------------------------------
export class Mapper0 extends Mapper {
  private ram: Uint8Array = new Uint8Array(8192);

  cpuRead(addr: number): MapperResult {
    if (addr >= 0x6000 && addr <= 0x7FFF) {
      return { mapped: true, data: this.ram[addr - 0x6000] };
    }
    if (addr >= 0x8000 && addr <= 0xFFFF) {
      // 16KB ROM mirroring check (if only 1 PRG bank, mirror 0x8000-0xBFFF to 0xC000-0xFFFF)
      const mappedAddr = addr & (this.prgBanks > 1 ? 0x7FFF : 0x3FFF);
      return { mapped: true, data: this.cart.prgROM[mappedAddr] };
    }
    return { mapped: false, data: 0 };
  }

  cpuWrite(addr: number, data: number): { mapped: boolean } {
    if (addr >= 0x6000 && addr <= 0x7FFF) {
      this.ram[addr - 0x6000] = data;
      return { mapped: true };
    }
    if (addr >= 0x8000 && addr <= 0xFFFF) {
      const mappedAddr = addr & (this.prgBanks > 1 ? 0x7FFF : 0x3FFF);
      this.cart.prgROM[mappedAddr] = data; // Flash write
      return { mapped: true };
    }
    return { mapped: false };
  }

  ppuRead(addr: number): MapperResult {
    if (addr >= 0x0000 && addr <= 0x1FFF) {
      return { mapped: true, data: this.cart.chrROM[addr] };
    }
    return { mapped: false, data: 0 };
  }

  ppuWrite(addr: number, data: number): { mapped: boolean } {
    if (addr >= 0x0000 && addr <= 0x1FFF) {
      this.cart.chrROM[addr] = data;
      return { mapped: true };
    }
    return { mapped: false };
  }
}

// -------------------------------------------------------------
// MAPPER 4 (MMC3)
// -------------------------------------------------------------
export class Mapper4 extends Mapper {
  // MMC3 configuration state
  private targetRegister: number = 0;
  private prgBankMode: number = 0;
  private chrA12Inversion: number = 0;
  
  // 8 registers storing page configuration indexes
  private registers: Uint8Array = new Uint8Array(8);
  // Optional cartridge RAM (8KB) mapped at 0x6000-0x7FFF
  private ram: Uint8Array = new Uint8Array(8192);

  // MMC3 IRQ scanline counter state
  private irqLatch: number = 0;
  private irqCounter: number = 0;
  private irqEnable: boolean = false;
  private irqReload: boolean = false;
  private irqPending: boolean = false;

  private prgBanksCount: number;
  private chrBanksCount: number;

  constructor(prgBanks: number, chrBanks: number, cart: Cartridge) {
    super(prgBanks, chrBanks, cart);
    this.prgBanksCount = prgBanks * 2; // 8KB units
    this.chrBanksCount = chrBanks * 8; // 1KB units
    
    this.reset();
  }

  private reset() {
    this.targetRegister = 0;
    this.prgBankMode = 0;
    this.chrA12Inversion = 0;
    this.registers.fill(0);
    this.ram.fill(0);
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqEnable = false;
    this.irqReload = false;
    this.irqPending = false;
    this.irqActive = false;
  }

  // Scanline tick hook invoked by PPU to decrements counter
  public tickScanline() {
    if (this.irqCounter === 0 || this.irqReload) {
      this.irqCounter = this.irqLatch;
      this.irqReload = false;
    } else {
      this.irqCounter--;
    }

    if (this.irqCounter === 0) {
      if (this.irqEnable) {
        this.irqPending = true;
        this.irqActive = true;
      }
    }
  }

  cpuRead(addr: number): MapperResult {
    // PRG RAM access at $6000-$7FFF
    if (addr >= 0x6000 && addr <= 0x7FFF) {
      return { mapped: true, data: this.ram[addr & 0x1FFF] };
    }
    
    // PRG ROM access at $8000-$FFFF
    if (addr >= 0x8000 && addr <= 0xFFFF) {
      let bank = 0;
      if (addr >= 0x8000 && addr <= 0x9FFF) {
        bank = this.prgBankMode === 0 ? this.registers[6] : this.prgBanksCount - 2;
      } else if (addr >= 0xA000 && addr <= 0xBFFF) {
        bank = this.registers[7];
      } else if (addr >= 0xC000 && addr <= 0xDFFF) {
        bank = this.prgBankMode === 0 ? this.prgBanksCount - 2 : this.registers[6];
      } else if (addr >= 0xE000 && addr <= 0xFFFF) {
        bank = this.prgBanksCount - 1;
      }

      bank = bank % this.prgBanksCount;
      const mappedAddr = bank * 8192 + (addr & 0x1FFF);
      return { mapped: true, data: this.cart.prgROM[mappedAddr] };
    }

    return { mapped: false, data: 0 };
  }

  cpuWrite(addr: number, data: number): { mapped: boolean } {
    // PRG RAM write
    if (addr >= 0x6000 && addr <= 0x7FFF) {
      this.ram[addr & 0x1FFF] = data;
      return { mapped: true };
    }

    // MMC3 registers mapping
    if (addr >= 0x8000 && addr <= 0xFFFF) {
      const isOdd = (addr & 1) !== 0;
      
      if (addr >= 0x8000 && addr <= 0x9FFF) {
        if (!isOdd) {
          // Bank select
          this.targetRegister = data & 0x07;
          this.prgBankMode = (data & 0x40) >> 6;
          this.chrA12Inversion = (data & 0x80) >> 7;
        } else {
          // Bank data
          this.registers[this.targetRegister] = data;
        }
      } 
      else if (addr >= 0xA000 && addr <= 0xBFFF) {
        if (!isOdd) {
          // Mirroring selection
          if ((data & 1) === 0) {
            this.cart.mirror = Mirror.VERTICAL;
          } else {
            this.cart.mirror = Mirror.HORIZONTAL;
          }
        }
        // Odd addresses: PRG RAM protect (ignored)
      } 
      else if (addr >= 0xC000 && addr <= 0xDFFF) {
        if (!isOdd) {
          // IRQ Latch
          this.irqLatch = data;
        } else {
          // IRQ Reload
          this.irqReload = true;
        }
      } 
      else if (addr >= 0xE000 && addr <= 0xFFFF) {
        if (!isOdd) {
          // IRQ Disable & Acknowledge
          this.irqEnable = false;
          this.irqPending = false;
          this.irqActive = false;
        } else {
          // IRQ Enable
          this.irqEnable = true;
          if (this.irqPending) {
            this.irqActive = true;
          }
        }
      }
      return { mapped: true };
    }

    return { mapped: false };
  }

  ppuRead(addr: number): MapperResult {
    if (addr >= 0x0000 && addr <= 0x1FFF) {
      let bank = 0;
      if (this.chrA12Inversion === 0) {
        if (addr >= 0x0000 && addr <= 0x03FF) bank = this.registers[0] & 0xFE;
        else if (addr >= 0x0400 && addr <= 0x07FF) bank = this.registers[0] | 0x01;
        else if (addr >= 0x0800 && addr <= 0x0BFF) bank = this.registers[1] & 0xFE;
        else if (addr >= 0x0C00 && addr <= 0x0FFF) bank = this.registers[1] | 0x01;
        else if (addr >= 0x1000 && addr <= 0x13FF) bank = this.registers[2];
        else if (addr >= 0x1400 && addr <= 0x17FF) bank = this.registers[3];
        else if (addr >= 0x1800 && addr <= 0x1BFF) bank = this.registers[4];
        else if (addr >= 0x1C00 && addr <= 0x1FFF) bank = this.registers[5];
      } else {
        if (addr >= 0x0000 && addr <= 0x03FF) bank = this.registers[2];
        else if (addr >= 0x0400 && addr <= 0x07FF) bank = this.registers[3];
        else if (addr >= 0x0800 && addr <= 0x0BFF) bank = this.registers[4];
        else if (addr >= 0x0C00 && addr <= 0x0FFF) bank = this.registers[5];
        else if (addr >= 0x1000 && addr <= 0x13FF) bank = this.registers[0] & 0xFE;
        else if (addr >= 0x1400 && addr <= 0x17FF) bank = this.registers[0] | 0x01;
        else if (addr >= 0x1800 && addr <= 0x1BFF) bank = this.registers[1] & 0xFE;
        else if (addr >= 0x1C00 && addr <= 0x1FFF) bank = this.registers[1] | 0x01;
      }

      const maxBanks = this.chrBanksCount > 0 ? this.chrBanksCount : 8;
      bank = bank % maxBanks;
      const mappedAddr = bank * 1024 + (addr & 0x03FF);
      return { mapped: true, data: this.cart.chrROM[mappedAddr] };
    }

    return { mapped: false, data: 0 };
  }

  ppuWrite(addr: number, data: number): { mapped: boolean } {
    if (addr >= 0x0000 && addr <= 0x1FFF) {
      let bank = 0;
      if (this.chrA12Inversion === 0) {
        if (addr >= 0x0000 && addr <= 0x03FF) bank = this.registers[0] & 0xFE;
        else if (addr >= 0x0400 && addr <= 0x07FF) bank = this.registers[0] | 0x01;
        else if (addr >= 0x0800 && addr <= 0x0BFF) bank = this.registers[1] & 0xFE;
        else if (addr >= 0x0C00 && addr <= 0x0FFF) bank = this.registers[1] | 0x01;
        else if (addr >= 0x1000 && addr <= 0x13FF) bank = this.registers[2];
        else if (addr >= 0x1400 && addr <= 0x17FF) bank = this.registers[3];
        else if (addr >= 0x1800 && addr <= 0x1BFF) bank = this.registers[4];
        else if (addr >= 0x1C00 && addr <= 0x1FFF) bank = this.registers[5];
      } else {
        if (addr >= 0x0000 && addr <= 0x03FF) bank = this.registers[2];
        else if (addr >= 0x0400 && addr <= 0x07FF) bank = this.registers[3];
        else if (addr >= 0x0800 && addr <= 0x0BFF) bank = this.registers[4];
        else if (addr >= 0x0C00 && addr <= 0x0FFF) bank = this.registers[5];
        else if (addr >= 0x1000 && addr <= 0x13FF) bank = this.registers[0] & 0xFE;
        else if (addr >= 0x1400 && addr <= 0x17FF) bank = this.registers[0] | 0x01;
        else if (addr >= 0x1800 && addr <= 0x1BFF) bank = this.registers[1] & 0xFE;
        else if (addr >= 0x1C00 && addr <= 0x1FFF) bank = this.registers[1] | 0x01;
      }

      const maxBanks = this.chrBanksCount > 0 ? this.chrBanksCount : 8;
      bank = bank % maxBanks;
      const mappedAddr = bank * 1024 + (addr & 0x03FF);
      this.cart.chrROM[mappedAddr] = data;
      return { mapped: true };
    }

    return { mapped: false };
  }
}
