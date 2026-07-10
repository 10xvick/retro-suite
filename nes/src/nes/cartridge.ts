import { Mapper, Mapper0, Mapper4 } from './mappers';

export enum Mirror {
  HORIZONTAL = 0,
  VERTICAL = 1,
  FOUR_SCREEN = 2,
  SINGLE_SCREEN_LOW = 3,
  SINGLE_SCREEN_HIGH = 4
}

export class Cartridge {
  public prgROM: Uint8Array = new Uint8Array(0);
  public chrROM: Uint8Array = new Uint8Array(0);
  public mapperId: number = 0;
  public prgBanks: number = 0;
  public chrBanks: number = 0;
  public mirror: Mirror = Mirror.HORIZONTAL;
  public mapper!: Mapper;

  constructor(arrayBuffer: ArrayBuffer) {
    this.parseINES(arrayBuffer);
  }

  private parseINES(arrayBuffer: ArrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    
    // Check iNES Magic Constant "NES\x1A"
    if (data[0] !== 0x4E || data[1] !== 0x45 || data[2] !== 0x53 || data[3] !== 0x1A) {
      throw new Error("Invalid iNES file format: Header mismatch!");
    }

    // Number of 16KB PRG ROM banks
    this.prgBanks = data[4];
    // Number of 8KB CHR ROM banks (if 0, CHR RAM is used)
    this.chrBanks = data[5];

    // Mirroring & Mapper parsing
    const flags6 = data[6];
    const flags7 = data[7];

    const verticalMirror = (flags6 & 0x01) !== 0;
    const fourScreen = (flags6 & 0x08) !== 0;
    
    if (fourScreen) {
      this.mirror = Mirror.FOUR_SCREEN;
    } else {
      this.mirror = verticalMirror ? Mirror.VERTICAL : Mirror.HORIZONTAL;
    }

    // Calculate Mapper ID from upper/lower nibbles
    this.mapperId = ((flags7 >> 4) << 4) | (flags6 >> 4);

    // Skip trainer if present (512 bytes)
    const hasTrainer = (flags6 & 0x04) !== 0;
    let fileOffset = 16 + (hasTrainer ? 512 : 0);

    // Extract PRG ROM data
    const prgSize = this.prgBanks * 16384;
    this.prgROM = new Uint8Array(arrayBuffer, fileOffset, prgSize);
    fileOffset += prgSize;

    // Extract CHR ROM data or allocate CHR RAM (8KB)
    if (this.chrBanks === 0) {
      this.chrROM = new Uint8Array(8192); // 8KB CHR RAM
    } else {
      const chrSize = this.chrBanks * 8192;
      this.chrROM = new Uint8Array(arrayBuffer, fileOffset, chrSize);
    }

    // Initialize the appropriate mapper
    console.log(`Loading Cartridge: Mapper ${this.mapperId}, Mirror Mode: ${Mirror[this.mirror]}`);
    switch (this.mapperId) {
      case 0:
        this.mapper = new Mapper0(this.prgBanks, this.chrBanks, this);
        break;
      case 4:
        this.mapper = new Mapper4(this.prgBanks, this.chrBanks, this);
        break;
      default:
        // Fallback to Mapper 0
        console.warn(`Unsupported Mapper ${this.mapperId}. Falling back to Mapper 0.`);
        this.mapper = new Mapper0(this.prgBanks, this.chrBanks, this);
        break;
    }
  }

  // Routing registers read/write through the mapper
  public cpuRead(addr: number): number {
    const mapped = this.mapper.cpuRead(addr);
    if (mapped.mapped) {
      return mapped.data;
    }
    return 0;
  }

  public cpuWrite(addr: number, data: number): boolean {
    const mapped = this.mapper.cpuWrite(addr, data);
    return mapped.mapped;
  }

  public ppuRead(addr: number): number {
    const mapped = this.mapper.ppuRead(addr);
    if (mapped.mapped) {
      return mapped.data;
    }
    return 0;
  }

  public ppuWrite(addr: number, data: number): boolean {
    const mapped = this.mapper.ppuWrite(addr, data);
    return mapped.mapped;
  }
}
