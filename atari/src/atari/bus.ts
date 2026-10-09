// Atari 2600 System Bus
// Maps 13-bit address space ($0000-$1FFF) to TIA, PIA, and Cartridge

import { CPU } from './cpu';
import { TIA } from './tia';
import { PIA } from './pia';
import { Cartridge } from './cartridge';
import { Controller } from './controller';

export class Bus {
    public cpu!: CPU;
    public tia: TIA = new TIA();
    public pia: PIA = new PIA();
    public controller: Controller = new Controller();
    public cart: Cartridge | null = null;

    constructor() {
        this.cpu = new CPU(this);
    }

    public insertCartridge(cart: Cartridge): void {
        this.cart = cart;
    }

    public read(addr: number): number {
        addr &= 0x1FFF;

        // Cartridge ROM space: A12 = 1 ($1000-$1FFF)
        if (addr >= 0x1000) {
            return this.cart ? this.cart.read(addr) : 0xFF;
        }

        // Internal peripherals: A12 = 0 ($0000-$0FFF)
        // Bit 7 (A7) distinguishes TIA vs PIA:
        // A7 = 0 -> TIA ($0000-$007F, $0100-$017F, $0200-$027F, etc.)
        // A7 = 1 -> PIA ($0080-$00FF, $0180-$01FF, $0280-$02FF, etc.)
        if ((addr & 0x0080) === 0) {
            // TIA read registers ($00-$0D)
            return this.tia.read(addr & 0x0F);
        } else {
            // PIA RAM ($0080-$00FF, $0180-$01FF) or I/O/Timer ($0280-$02FF)
            return this.pia.read(addr);
        }
    }

    public write(addr: number, data: number): void {
        addr &= 0x1FFF;
        data &= 0xFF;

        // Cartridge space: A12 = 1 ($1000-$1FFF)
        if (addr >= 0x1000) {
            if (this.cart) this.cart.write(addr, data);
            return;
        }

        // Internal peripherals: A12 = 0 ($0000-$0FFF)
        if ((addr & 0x0080) === 0) {
            // TIA write registers ($00-$3F)
            this.tia.write(addr & 0x3F, data);
            // WSYNC strobe ($02): halt CPU until scanline ends
            if ((addr & 0x3F) === 0x02) {
                this.cpu.wsyncHalt = true;
            }
        } else {
            // PIA RAM or I/O/Timer
            this.pia.write(addr, data);
        }
    }

    // Advance 1 CPU cycle = 3 TIA color clocks + 1 PIA clock
    public clock(): void {
        this.tia.clock();
        this.pia.clock();

        // Release WSYNC halt when TIA reaches scanline end
        if (this.cpu.wsyncHalt && !this.tia.wsyncRequested) {
            this.cpu.wsyncHalt = false;
        }
    }

    // Latch controller state from retro-suit InputHandler
    public set joystick(state: number) {
        this.controller.setControllerState(state);
        this.pia.controllerState = this.controller.swcha;
        this.pia.consoleSwitches = this.controller.swchb;
        this.tia.inpt4 = this.controller.inpt4;
        this.tia.inpt5 = this.controller.inpt5;
    }

    // Run one full video frame until TIA asserts frameComplete
    public runFrame(): void {
        this.tia.frameComplete = false;
        while (!this.tia.frameComplete) {
            this.cpu.clock();
            this.clock();
        }
    }

    public reset(): void {
        this.controller.reset();
        this.tia.reset();
        this.pia.reset();
        if (this.cart) {
            this.cart.reset();
        }
        this.cpu.reset();
    }
}