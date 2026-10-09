// Atari 2600 Cartridge & Bankswitching Mappers
// Supports 2K, 4K, F8 (8K), F6 (16K), F4 (32K), Superchip RAM, E0, 3F

export interface CartMapper {
    readonly id: string;
    reset(): void;
    read(addr: number): number;
    write(addr: number, data: number): void;
    saveState(): any;
    loadState(state: any): void;
}

// 2KB ROM: Mirrored across the 4KB cartridge address space ($1000-$1FFF)
export class Mapper2K implements CartMapper {
    readonly id = '2K';
    constructor(private rom: Uint8Array) { }

    reset(): void { }

    read(addr: number): number {
        return this.rom[addr & 0x07FF];
    }

    write(_addr: number, _data: number): void { }

    saveState(): any {
        return { mapper: this.id };
    }

    loadState(_state: any): void { }
}

// 4KB ROM: Direct 1-to-1 mapping into $1000-$1FFF
export class Mapper4K implements CartMapper {
    readonly id = '4K';
    constructor(private rom: Uint8Array) { }

    reset(): void { }

    read(addr: number): number {
        return this.rom[addr & 0x0FFF];
    }

    write(_addr: number, _data: number): void { }

    saveState(): any {
        return { mapper: this.id };
    }

    loadState(_state: any): void { }
}

// Atari F8 (8KB): 2 x 4KB banks. Hotspots at $1FF8 (bank 0) and $1FF9 (bank 1)
export class MapperF8 implements CartMapper {
    readonly id = 'F8';
    public currentBank = 1; // Default to last bank so reset vector is valid

    constructor(private rom: Uint8Array) { }

    reset(): void {
        this.currentBank = 1;
    }

    private checkHotspot(addr: number): void {
        const offset = addr & 0x0FFF;
        if (offset === 0x0FF8) {
            this.currentBank = 0;
        } else if (offset === 0x0FF9) {
            this.currentBank = 1;
        }
    }

    read(addr: number): number {
        this.checkHotspot(addr);
        const bankOffset = this.currentBank * 0x1000;
        return this.rom[bankOffset + (addr & 0x0FFF)];
    }

    write(addr: number, _data: number): void {
        this.checkHotspot(addr);
    }

    saveState(): any {
        return { mapper: this.id, currentBank: this.currentBank };
    }

    loadState(state: any): void {
        if (state && typeof state.currentBank === 'number') {
            this.currentBank = state.currentBank & 1;
        }
    }
}

// Atari F6 (16KB): 4 x 4KB banks. Hotspots at $1FF6..$1FF9
export class MapperF6 implements CartMapper {
    readonly id = 'F6';
    public currentBank = 3;

    constructor(private rom: Uint8Array) { }

    reset(): void {
        this.currentBank = 3;
    }

    private checkHotspot(addr: number): void {
        const offset = addr & 0x0FFF;
        if (offset >= 0x0FF6 && offset <= 0x0FF9) {
            this.currentBank = offset - 0x0FF6;
        }
    }

    read(addr: number): number {
        this.checkHotspot(addr);
        const bankOffset = this.currentBank * 0x1000;
        return this.rom[bankOffset + (addr & 0x0FFF)];
    }

    write(addr: number, _data: number): void {
        this.checkHotspot(addr);
    }

    saveState(): any {
        return { mapper: this.id, currentBank: this.currentBank };
    }

    loadState(state: any): void {
        if (state && typeof state.currentBank === 'number') {
            this.currentBank = state.currentBank & 3;
        }
    }
}

// Atari F4 (32KB): 8 x 4KB banks. Hotspots at $1FF4..$1FFB
export class MapperF4 implements CartMapper {
    readonly id = 'F4';
    public currentBank = 7;

    constructor(private rom: Uint8Array) { }

    reset(): void {
        this.currentBank = 7;
    }

    private checkHotspot(addr: number): void {
        const offset = addr & 0x0FFF;
        if (offset >= 0x0FF4 && offset <= 0x0FFB) {
            this.currentBank = offset - 0x0FF4;
        }
    }

    read(addr: number): number {
        this.checkHotspot(addr);
        const bankOffset = this.currentBank * 0x1000;
        return this.rom[bankOffset + (addr & 0x0FFF)];
    }

    write(addr: number, _data: number): void {
        this.checkHotspot(addr);
    }

    saveState(): any {
        return { mapper: this.id, currentBank: this.currentBank };
    }

    loadState(state: any): void {
        if (state && typeof state.currentBank === 'number') {
            this.currentBank = state.currentBank & 7;
        }
    }
}

// Superchip RAM (128 bytes extra RAM mapped at $1000-$107F write, $1080-$10FF read)
export class MapperSuperchip implements CartMapper {
    readonly id = 'Superchip';
    public ram = new Uint8Array(128);
    private inner: CartMapper;

    constructor(rom: Uint8Array, baseMapper: 'F8' | 'F6' | 'F4') {
        if (baseMapper === 'F6') this.inner = new MapperF6(rom);
        else if (baseMapper === 'F4') this.inner = new MapperF4(rom);
        else this.inner = new MapperF8(rom);
    }

    reset(): void {
        this.ram.fill(0);
        this.inner.reset();
    }

    read(addr: number): number {
        const offset = addr & 0x0FFF;
        if (offset >= 0x0080 && offset <= 0x00FF) {
            return this.ram[offset - 0x0080];
        }
        return this.inner.read(addr);
    }

    write(addr: number, data: number): void {
        const offset = addr & 0x0FFF;
        if (offset >= 0x0000 && offset <= 0x007F) {
            this.ram[offset] = data & 0xFF;
            return;
        }
        this.inner.write(addr, data);
    }

    saveState(): any {
        return {
            mapper: this.id,
            ram: Array.from(this.ram),
            inner: this.inner.saveState()
        };
    }

    loadState(state: any): void {
        if (state && state.ram) {
            this.ram.set(state.ram);
        }
        if (state && state.inner) {
            this.inner.loadState(state.inner);
        }
    }
}

export class Cartridge {
    public rom: Uint8Array = new Uint8Array(0);
    public mapper: string = '4K';
    public mapperInstance!: CartMapper;

    constructor(data: ArrayBuffer | Uint8Array) {
        this.loadRom(data);
    }

    public loadRom(data: ArrayBuffer | Uint8Array): void {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        this.rom = bytes;
        this.detectMapper();
    }

    private detectMapper(): void {
        const size = this.rom.length;

        // Check for Superchip (extra 128 bytes appended, or detected via signatures)
        const isSuperchipHeader = size === 8320 || size === 16512 || size === 32896;

        if (size <= 2048) {
            this.mapper = '2K';
            this.mapperInstance = new Mapper2K(this.rom);
        } else if (size <= 4096) {
            this.mapper = '4K';
            this.mapperInstance = new Mapper4K(this.rom);
        } else if (size <= 8192 || size === 8320) {
            if (isSuperchipHeader) {
                const romData = this.rom.subarray(0, 8192);
                this.mapper = 'F8SC';
                this.mapperInstance = new MapperSuperchip(romData, 'F8');
            } else {
                this.mapper = 'F8';
                this.mapperInstance = new MapperF8(this.rom);
            }
        } else if (size <= 16384 || size === 16512) {
            if (isSuperchipHeader) {
                const romData = this.rom.subarray(0, 16384);
                this.mapper = 'F6SC';
                this.mapperInstance = new MapperSuperchip(romData, 'F6');
            } else {
                this.mapper = 'F6';
                this.mapperInstance = new MapperF6(this.rom);
            }
        } else if (size <= 32768 || size === 32896) {
            if (isSuperchipHeader) {
                const romData = this.rom.subarray(0, 32768);
                this.mapper = 'F4SC';
                this.mapperInstance = new MapperSuperchip(romData, 'F4');
            } else {
                this.mapper = 'F4';
                this.mapperInstance = new MapperF4(this.rom);
            }
        } else {
            // Default to F8
            this.mapper = 'F8';
            this.mapperInstance = new MapperF8(this.rom);
        }
    }

    public read(addr: number): number {
        return this.mapperInstance.read(addr);
    }

    public write(addr: number, data: number): void {
        this.mapperInstance.write(addr, data);
    }

    public reset(): void {
        this.mapperInstance.reset();
    }

    public saveState(): any {
        return this.mapperInstance.saveState();
    }

    public loadState(state: any): void {
        this.mapperInstance.loadState(state);
    }
}