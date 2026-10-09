// Atari 2600 Modular Emulator Facade
// High-level API for running the Atari 2600 system standalone or inside retro-suit

import { Bus } from './bus';
import { Cartridge } from './cartridge';
import { Controller } from './controller';
import { CPU } from './cpu';
import { TIA } from './tia';
import { PIA } from './pia';

export interface AtariState {
    coreId: 'atari';
    cpu: {
        a: number;
        x: number;
        y: number;
        sp: number;
        pc: number;
        status: number;
        cycles: number;
        totalCycles: number;
    };
    piaRam: number[];
    piaControllerState: number;
    tia: any;
    cart: any;
}

export class Atari2600 {
    public bus: Bus;
    public romLoaded = false;

    constructor() {
        this.bus = new Bus();
    }

    public get cpu(): CPU { return this.bus.cpu; }
    public get tia(): TIA { return this.bus.tia; }
    public get pia(): PIA { return this.bus.pia; }
    public get cart(): Cartridge | null { return this.bus.cart; }
    public get controller(): Controller { return this.bus.controller; }

    public loadRom(data: ArrayBuffer | Uint8Array): void {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const size = bytes.length;

        const isPow2 = (n: number) => n >= 2048 && (n & (n - 1)) === 0;
        const isSuperchip = size > 128 && isPow2(size - 128);
        if (!isPow2(size) && !isSuperchip) {
            throw new Error(`Invalid Atari ROM size: ${size} bytes`);
        }

        const head = bytes.subarray(0, 16);
        const sig = String.fromCharCode(...head).toLowerCase();
        if (sig.includes('<!doctype') || sig.includes('<html')) {
            throw new Error('Invalid Atari ROM: HTML/text payload detected');
        }

        const cart = new Cartridge(bytes);
        this.bus.insertCartridge(cart);
        this.bus.reset();
        this.romLoaded = true;
    }

    public reset(): void {
        this.bus.reset();
    }

    public setInput(snesControllerState: number): void {
        this.bus.joystick = snesControllerState;
    }

    public runFrame(controllerState: number = 0): { pixels: Uint32Array; frameStartBlank: boolean } {
        if (!this.romLoaded) {
            return {
                pixels: new Uint32Array(160 * 192),
                frameStartBlank: true,
            };
        }

        this.bus.joystick = controllerState;
        this.bus.runFrame();

        const pixels = new Uint32Array(160 * 192);
        pixels.set(this.bus.tia.framebuffer.subarray(0, 160 * 192));

        return {
            pixels,
            frameStartBlank: false,
        };
    }

    public get audioSamplesAvailable(): number {
        return this.bus.tia.audioSamplesAvailable;
    }

    public drainAudio(outBuf: Float32Array): number {
        return this.bus.tia.drainAudio(outBuf);
    }

    public saveState(): AtariState | null {
        if (!this.romLoaded) return null;
        const cpu = this.bus.cpu;
        return {
            coreId: 'atari',
            cpu: {
                a: cpu.a,
                x: cpu.x,
                y: cpu.y,
                sp: cpu.sp,
                pc: cpu.pc,
                status: cpu.status,
                cycles: cpu.cycles,
                totalCycles: cpu.totalCycles,
            },
            piaRam: Array.from(this.bus.pia.ram),
            piaControllerState: this.bus.pia.controllerState,
            tia: this.bus.tia.saveState(),
            cart: this.bus.cart?.saveState() ?? null,
        };
    }

    public loadState(state: AtariState): void {
        if (!state || state.coreId !== 'atari' || !this.romLoaded) return;

        const pc = state.cpu?.pc;
        if (typeof pc !== 'number' || (pc & 0x1000) === 0 || !state.piaRam || !state.tia) {
            throw new Error('Corrupt Atari autosave: PC outside ROM space');
        }

        const cpu = this.bus.cpu;
        cpu.a = state.cpu.a;
        cpu.x = state.cpu.x;
        cpu.y = state.cpu.y;
        cpu.sp = state.cpu.sp;
        cpu.pc = state.cpu.pc;
        cpu.status = state.cpu.status;
        cpu.cycles = state.cpu.cycles;
        cpu.totalCycles = state.cpu.totalCycles;
        cpu.wsyncHalt = false;

        this.bus.pia.ram.set(state.piaRam);
        this.bus.pia.controllerState = state.piaControllerState ?? 0xFF;

        this.bus.tia.loadState(state.tia);
        if (this.bus.cart && state.cart) {
            this.bus.cart.loadState(state.cart);
        }
    }
}

// Alias for consistency with other core naming conventions
export const AtariEmulator = Atari2600;
