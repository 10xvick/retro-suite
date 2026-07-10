export interface CartridgeHeader {
  title: string;
  romSpeed: number; // Speed bits
  romType: string;
  romSize: number; // Bytes
  ramSize: number; // Bytes
  countryCode: number;
  licenseeCode: number;
  version: number;
  checksum: number;
  checksumComplement: number;
  nativeResetVector: number;
  emuResetVector: number;
  isLoROM: boolean;
}

export class Cartridge {
  public rom: Uint8Array;
  public sram!: Uint8Array;
  public hasSMCHeader: boolean = false;
  public header!: CartridgeHeader;

  constructor(fileData: Uint8Array) {
    // Detect and strip 512-byte SMC copiers header if present
    // Try both offset 0 and offset 512 to see which has a valid SNES header
    const checkHeader = (data: Uint8Array, baseOffset: number): boolean => {
      if (data.length < baseOffset + 0x10000) return false; // Need at least enough for HiROM header
      
      // Check LoROM header at offset baseOffset + 0x7FC0
      const loChecksum = data[baseOffset + 0x7FDE] | (data[baseOffset + 0x7FDF] << 8);
      const loCheckComp = data[baseOffset + 0x7FDC] | (data[baseOffset + 0x7FDD] << 8);
      const loValid = (loChecksum + loCheckComp) === 0xFFFF;
      
      // Check HiROM header at offset baseOffset + 0xFFC0
      const hiChecksum = data[baseOffset + 0xFFDE] | (data[baseOffset + 0xFFDF] << 8);
      const hiCheckComp = data[baseOffset + 0xFFDC] | (data[baseOffset + 0xFFDD] << 8);
      const hiValid = (hiChecksum + hiCheckComp) === 0xFFFF;
      
      return loValid || hiValid;
    };
    
    // Prefer offset 512 if it has valid header, otherwise use offset 0
    if (fileData.length >= 512 + 0x10000 && checkHeader(fileData, 512)) {
      this.hasSMCHeader = true;
      this.rom = fileData.slice(512);
    } else {
      this.hasSMCHeader = false;
      this.rom = fileData;
    }

    this.parseHeader();
    const sramSize = Math.max(32768, this.header.ramSize); // Allocate at least 32KB
    this.sram = new Uint8Array(sramSize);
  }

  private parseHeader() {
    // SNES header can be at:
    // - $7FC0 (32704) in LoROM (Bank 0 Offset 0x7FC0)
    // - $FFC0 (65472) in HiROM (Bank 0 Offset 0xFFC0)
    let headerOffset = 0x7FC0;
    let isLoROM = true;

    // Check if the checksum matches in HiROM offset
    // Checksum is verified: Checksum + Complement = 0xFFFF
    const loChecksumComp = this.readWord(0x7FC0 + 0x1C);
    const loChecksum = this.readWord(0x7FC0 + 0x1E);
    const hiChecksumComp = this.readWord(0xFFC0 + 0x1C);
    const hiChecksum = this.readWord(0xFFC0 + 0x1E);

    const loValid = (loChecksum + loChecksumComp) === 0xFFFF;
    const hiValid = (hiChecksum + hiChecksumComp) === 0xFFFF;

    if (hiValid && !loValid) {
      headerOffset = 0xFFC0;
      isLoROM = false;
    } else {
      // Fallback: Check the map mode byte at 0x7FD5 vs 0xFFD5
      const mapModeLo = this.rom[0x7FD5];
      const mapModeHi = this.rom[0xFFD5];
      // 0x20 = LoROM, 0x21 = HiROM
      if ((mapModeHi & 0x0F) === 1 || mapModeHi === 0x21) {
        headerOffset = 0xFFC0;
        isLoROM = false;
      }
    }

    // Read details
    let titleStr = '';
    for (let i = 0; i < 21; i++) {
      const charCode = this.rom[headerOffset + i];
      if (charCode >= 32 && charCode < 127) {
        titleStr += String.fromCharCode(charCode);
      } else {
        titleStr += ' ';
      }
    }
    titleStr = titleStr.trim();

    const mapMode = this.rom[headerOffset + 0x15];
    const romTypeVal = this.rom[headerOffset + 0x16];
    const romSizeVal = this.rom[headerOffset + 0x17];
    const ramSizeVal = this.rom[headerOffset + 0x18];
    const country = this.rom[headerOffset + 0x19];
    const licensee = this.rom[headerOffset + 0x1A];
    const version = this.rom[headerOffset + 0x1B];

    // ROM and RAM size calculations
    const romSizeBytes = romSizeVal > 0 ? (1 << romSizeVal) * 1024 : this.rom.length;
    const ramSizeBytes = ramSizeVal > 0 ? (1 << ramSizeVal) * 1024 : 0;

    // Vectors (Native and Emulation Reset vectors are critical)
    // Native reset vector is at $FFFC-$FFFD of Bank 0. (Offset in header is 0x3C in emulation bank, or just 0xFFFC relative to Bank 0)
    // Emulation reset vector is at $FFFC-$FFFD in emulation bank.
    // In LoROM, $FFFC corresponds to headerOffset + 0x3C
    const nativeResetVector = this.readWord(headerOffset + 0x3C);
    const emuResetVector = this.readWord(headerOffset + 0x3C); // Often mapped at the same relative position

    this.header = {
      title: titleStr || 'Untitled SNES Game',
      romSpeed: (mapMode & 0x10) ? 120 : 200, // fastrom vs slowrom (ns)
      romType: this.getROMTypeString(romTypeVal),
      romSize: romSizeBytes,
      ramSize: ramSizeBytes,
      countryCode: country,
      licenseeCode: licensee,
      version: version,
      checksum: isLoROM ? loChecksum : hiChecksum,
      checksumComplement: isLoROM ? loChecksumComp : hiChecksumComp,
      nativeResetVector,
      emuResetVector,
      isLoROM
    };
  }

  private readWord(addr: number): number {
    if (addr + 1 >= this.rom.length) return 0;
    return this.rom[addr] | (this.rom[addr + 1] << 8);
  }

  private getROMTypeString(type: number): string {
    switch (type) {
      case 0x00: return 'ROM only';
      case 0x01: return 'ROM & RAM';
      case 0x02: return 'ROM, RAM & Battery';
      case 0x03: return 'ROM & DSP-1';
      case 0x04: return 'ROM, RAM & DSP-1';
      case 0x05: return 'ROM, RAM, Battery & DSP-1';
      case 0x13: return 'ROM & Super FX';
      case 0x14: return 'ROM, RAM & Super FX';
      case 0x15: return 'ROM, RAM, Battery & Super FX';
      case 0x25: return 'ROM & SDD-1';
      case 0x35: return 'ROM & SA-1';
      case 0xE3: return 'ROM & Game Boy Game Link';
      default: return `ROM & Custom Chip (0x${type.toString(16).toUpperCase()})`;
    }
  }
}
