// Atari 2600 Cartridge
// Handles ROM loading and bankswitching

export class Cartridge {
    public rom: Uint8Array = new Uint8Array(0);
    public mapper: string = '2K';
    public bankCount = 1;
    public currentBank = 0;

    constructor(data: ArrayBuffer) {
        this.loadRom(data);
    }

    public loadRom(data: ArrayBuffer) {
        const bytes = new Uint8Array(data);
        this.rom = bytes;

        // Detect mapper based on ROM size
        if (bytes.length <= 2048) {
            this.mapper = '2K';
            this.bankCount = 1;
        } else if (bytes.length <= 4096) {
            this.mapper = '4K';
            this.bankCount = 1;
        } else if (bytes.length <= 8192) {
            this.mapper = 'F8';
            this.bankCount = 2;
        } else if (bytes.length <= 16384) {
            this.mapper = 'F6';
            this.bankCount = 4;
        } else if (bytes.length <= 32768) {
            this.mapper = 'F4';
            this.bankCount = 8;
        } else {
            this.mapper = 'F8';
            this.bankCount = 2;
        }
    }

    public read(addr: number): number {
        addr &= 0x1FFF;

        // 2K ROM: mirrored at $F000-$F7FF and $F800-$FFFF
        if (this.mapper === '2K') {
            return this.rom[addr & 0x07FF];
        }

        // 4K ROM: at $F000-$FFFF
        if (this.mapper === '4K') {
            return this.rom[addr & 0x0FFF];
        }

        // Bankswitched ROMs
        if (this.mapper === 'F8' || this.mapper === 'F6' || this.mapper === 'F4') {
            // $F000-$F7FF: current bank
            if (addr < 0x1000) {
                const bankOffset = this.currentBank * 0x1000;
                return this.rom[bankOffset + (addr & 0x0FFF)];
            }
            // $F800-$FFFF: last bank
            const lastBankOffset = (this.bankCount - 1) * 0x1000;
            return this.rom[lastBankOffset + (addr & 0x0FFF)];
        }

        return 0xFF;
    }

    public write(addr: number, data: number) {
        addr &= 0x1FFF;

        // Bankswitching: writes to $FFF8-$FFFF select banks
        if (this.mapper === 'F8') {
            if (addr >= 0x1FF8 && addr <= 0x1FF9) {
                this.currentBank = addr - 0x1FF8;
            }
        } else if (this.mapper === 'F6') {
            if (addr >= 0x1FF6 && addr <= 0x1FF9) {
                this.currentBank = addr - 0x1FF6;
            }
        } else if (this.mapper === 'F4') {
            if (addr >= 0x1FF4 && addr <= 0x1FFB) {
                this.currentBank = addr - 0x1FF4;
            }
        }
    }

    public reset() {
        this.currentBank = 0;
    }
}