// Atari 2600 Memory Bus
// Maps addresses to TIA, PIA, and Cartridge

import { CPU } from './cpu';
import { TIA } from './tia';
import { PIA } from './pia';
import { Cartridge } from './cartridge';

export class Bus {
    public cpu!: CPU;
    public tia: TIA = new TIA();
    public pia: PIA = new PIA();
    public cart: Cartridge | null = null;

    constructor() {
        this.cpu = new CPU(this);
    }

    public insertCartridge(cart: Cartridge) {
        this.cart = cart;
    }

    public read(addr: number): number {
        addr &= 0x1FFF;

        // TIA registers: $0000-$003F (writes only, reads return open bus)
        if (addr < 0x0040) {
            return 0xFF;
        }

        // TIA read registers: $0040-$007F
        if (addr < 0x0080) {
            return this.tia.read(addr);
        }

        // PIA RAM: $0080-$00FF
        if (addr < 0x0100) {
            return this.pia.read(addr);
        }

        // PIA registers: $0100-$01FF
        if (addr < 0x0200) {
            return this.pia.read(addr);
        }

        // PIA RAM mirror: $0200-$02FF
        if (addr < 0x0300) {
            return this.pia.read(addr);
        }

        // PIA registers mirror: $0300-$03FF
        if (addr < 0x0400) {
            return this.pia.read(addr);
        }

        // Cartridge: $1000-$1FFF
        if (addr >= 0x1000 && this.cart) {
            return this.cart.read(addr);
        }

        return 0xFF;
    }

    public write(addr: number, data: number) {
        addr &= 0x1FFF;

        // TIA registers: $0000-$003F
        if (addr < 0x0040) {
            this.tia.write(addr, data);
            // WSYNC: CPU must halt until end of current scanline
            if ((addr & 0x3F) === 0x02) {
                this.cpu.wsyncHalt = true;
            }
            return;
        }

        // TIA read registers (writes ignored)
        if (addr < 0x0080) {
            return;
        }

        // PIA RAM: $0080-$00FF
        if (addr < 0x0100) {
            this.pia.write(addr, data);
            return;
        }

        // PIA registers: $0100-$01FF
        if (addr < 0x0200) {
            this.pia.write(addr, data);
            return;
        }

        // PIA RAM mirror: $0200-$02FF
        if (addr < 0x0300) {
            this.pia.write(addr, data);
            return;
        }

        // PIA registers mirror: $0300-$03FF
        if (addr < 0x0400) {
            this.pia.write(addr, data);
            return;
        }

        // Cartridge: $1000-$1FFF
        if (addr >= 0x1000 && this.cart) {
            this.cart.write(addr, data);
            return;
        }
    }

    public clock() {
        this.tia.clock();
        this.pia.clock();
        // Release WSYNC halt when TIA reaches end of scanline
        if (this.cpu.wsyncHalt && !this.tia.wsyncRequested) {
            this.cpu.wsyncHalt = false;
        }
    }

    public reset() {
        this.tia.reset();
        this.pia.reset();
        if (this.cart) {
            this.cart.reset();
        }
        this.cpu.reset();
    }
}