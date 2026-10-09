import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    Bus,
    CPU,
    TIA,
    PIA,
    Cartridge,
    Controller,
    Atari2600,
    Mapper2K,
    Mapper4K,
    MapperF8,
    MapperF6,
    MapperF4,
    MapperSuperchip,
    CpuFlags
} from '../index';

describe('Atari 2600 Modular Core Suite', () => {
    describe('MOS 6507 CPU Unit Tests', () => {
        let bus: Bus;
        let cpu: CPU;

        beforeEach(() => {
            bus = new Bus();
            cpu = bus.cpu;
        });

        it('should initialize and reset registers properly', () => {
            // Write a dummy reset vector into RAM/Cartridge
            // Cartridge space $FFFC-$FFFD (13-bit: $1FFC-$1FFD)
            const rom = new Uint8Array(4096);
            rom[0x0FFC] = 0x00;
            rom[0x0FFD] = 0xF0;
            const cart = new Cartridge(rom);
            bus.insertCartridge(cart);
            bus.reset();

            expect(cpu.pc).toBe(0xF000);
            expect(cpu.sp).toBe(0xFD);
            expect(cpu.status & CpuFlags.U).toBeTruthy();
            expect(cpu.status & CpuFlags.I).toBeTruthy();
        });

        it('should correctly execute official instructions and addressing modes', () => {
            const rom = new Uint8Array(4096);
            let idx = 0;
            // LDA #$42
            rom[idx++] = 0xA9; rom[idx++] = 0x42;
            // STA $80 (PIA RAM)
            rom[idx++] = 0x85; rom[idx++] = 0x80;
            // LDX #$05
            rom[idx++] = 0xA2; rom[idx++] = 0x05;
            // INX
            rom[idx++] = 0xE8;
            // TXA
            rom[idx++] = 0x8A;
            // Reset vector -> $F000
            rom[0x0FFC] = 0x00; rom[0x0FFD] = 0xF0;

            bus.insertCartridge(new Cartridge(rom));
            bus.reset();

            for (let i = 0; i < 20; i++) cpu.clock();

            expect(bus.read(0x0080)).toBe(0x42);
            expect(cpu.x).toBe(0x06);
            expect(cpu.a).toBe(0x06);
        });

        it('should correctly perform BCD / Decimal mode ADC and SBC', () => {
            const rom = new Uint8Array(4096);
            let idx = 0;
            // SED (Set decimal)
            rom[idx++] = 0xF8;
            // CLC
            rom[idx++] = 0x18;
            // LDA #$05
            rom[idx++] = 0xA9; rom[idx++] = 0x05;
            // ADC #$05 -> In decimal mode, 5 + 5 = 10 (0x10)
            rom[idx++] = 0x69; rom[idx++] = 0x05;
            // SEC
            rom[idx++] = 0x38;
            // SBC #$02 -> In decimal mode, 0x10 - 0x02 = 0x08
            rom[idx++] = 0xE9; rom[idx++] = 0x02;

            rom[0x0FFC] = 0x00; rom[0x0FFD] = 0xF0;
            bus.insertCartridge(new Cartridge(rom));
            bus.reset();

            for (let i = 0; i < 30; i++) cpu.clock();

            expect(cpu.a).toBe(0x08);
            expect(cpu.status & CpuFlags.C).toBeTruthy();
        });

        it('should support illegal / unofficial opcodes used by Atari games', () => {
            const rom = new Uint8Array(4096);
            let idx = 0;
            // Write 0x77 into zero page RAM $80
            rom[0x0080] = 0x77;
            // LAX $80 (opcode $A7) -> loads both A and X with ($80)
            rom[idx++] = 0xA7; rom[idx++] = 0x80;
            // SAX $81 (opcode $87) -> stores A & X into $81
            rom[idx++] = 0x87; rom[idx++] = 0x81;
            // NOP illegal 2-byte ($80 #$12)
            rom[idx++] = 0x80; rom[idx++] = 0x12;

            rom[0x0FFC] = 0x00; rom[0x0FFD] = 0xF0;
            bus.insertCartridge(new Cartridge(rom));
            bus.reset();
            // Pre-seed RAM
            bus.write(0x80, 0x77);

            for (let i = 0; i < 20; i++) cpu.clock();

            expect(cpu.a).toBe(0x77);
            expect(cpu.x).toBe(0x77);
            expect(bus.read(0x81)).toBe(0x77);
        });

        it('should halt on WSYNC and release at scanline end', () => {
            const rom = new Uint8Array(4096);
            let idx = 0;
            // STA WSYNC (addr $02)
            rom[idx++] = 0x85; rom[idx++] = 0x02;
            // INX
            rom[idx++] = 0xE8;

            rom[0x0FFC] = 0x00; rom[0x0FFD] = 0xF0;
            bus.insertCartridge(new Cartridge(rom));
            bus.reset();

            // Step STA WSYNC
            for (let i = 0; i < 3; i++) {
                cpu.clock();
                bus.clock();
            }

            expect(cpu.wsyncHalt).toBe(true);

            // Clock until scanline end
            while (cpu.wsyncHalt) {
                cpu.clock();
                bus.clock();
            }

            expect(cpu.wsyncHalt).toBe(false);
        });
    });

    describe('PIA (RIOT 6532) Unit Tests', () => {
        let pia: PIA;

        beforeEach(() => {
            pia = new PIA();
        });

        it('should accurately read, write, and mirror 128 bytes RAM', () => {
            pia.write(0x0080, 0xAB);
            // $0080 is RAM offset 0
            expect(pia.read(0x0080)).toBe(0xAB);
            // Stack page mirror $0180
            expect(pia.read(0x0180)).toBe(0xAB);

            pia.write(0x01FF, 0xCD);
            // $01FF is RAM offset 127
            expect(pia.read(0x00FF)).toBe(0xCD);
            expect(pia.read(0x01FF)).toBe(0xCD);
        });

        it('should correctly count down timer intervals and flag underflow', () => {
            // Write timer with interval 8 clocks: $0295
            pia.write(0x0295, 10);
            expect(pia.timer).toBe(10);
            expect(pia.timerInterval).toBe(8);

            // Clock 80 cycles
            for (let i = 0; i < 80; i++) pia.clock();

            expect(pia.timer).toBe(0);
            expect(pia.timerUnderflow).toBe(false);

            // Clock 8 more cycles -> underflow occurs
            for (let i = 0; i < 8; i++) pia.clock();

            expect(pia.timerUnderflow).toBe(true);
            expect(pia.read(0x0285)).toBe(0x80); // TIMINT bit 7 set

            // In underflow mode, decrements every 1 clock
            for (let i = 0; i < 5; i++) pia.clock();
            expect(pia.timer).toBe(0xFA); // 255 - 5 = 250 (0xFA)

            // Reading INTIM clears underflow flag
            expect(pia.read(0x0284)).toBe(0xFA);
            expect(pia.read(0x0285)).toBe(0x00);
        });

        it('should handle SWCHA and SWCHB I/O data and direction registers', () => {
            // SWACNT set low nibble as input, high nibble as output
            pia.write(0x0281, 0xF0);
            pia.controllerState = 0x55;
            pia.write(0x0280, 0xA0);

            // High nibble from written swcha (0xA0), low nibble from controllerState (0x05)
            expect(pia.read(0x0280)).toBe(0xA5);
        });
    });

    describe('Cartridge & Mappers Unit Tests', () => {
        it('should mirror 2KB ROM across 4KB cartridge address space', () => {
            const rom = new Uint8Array(2048);
            rom[0x0100] = 0x99;
            const mapper = new Mapper2K(rom);

            expect(mapper.read(0x1100)).toBe(0x99);
            expect(mapper.read(0x1900)).toBe(0x99);
        });

        it('should correctly switch F8 banks on reads and writes to $1FF8 / $1FF9', () => {
            const rom = new Uint8Array(8192);
            // Bank 0 at offset 0
            rom[0x0100] = 0x11;
            // Bank 1 at offset 4096
            rom[4096 + 0x0100] = 0x22;

            const cart = new Cartridge(rom);
            expect(cart.mapper).toBe('F8');

            // Default on reset is bank 1
            cart.reset();
            expect(cart.read(0x1100)).toBe(0x22);

            // Access $1FF8 (read) switches to bank 0
            cart.read(0x1FF8);
            expect(cart.read(0x1100)).toBe(0x11);

            // Access $1FF9 (write) switches to bank 1
            cart.write(0x1FF9, 0);
            expect(cart.read(0x1100)).toBe(0x22);
        });

        it('should handle Superchip RAM write $1000-$107F and read $1080-$10FF', () => {
            const rom = new Uint8Array(8320); // 8KB + 128 bytes Superchip
            const cart = new Cartridge(rom);
            expect(cart.mapper).toBe('F8SC');

            cart.write(0x1010, 0x7E); // write to RAM offset 0x10
            expect(cart.read(0x1090)).toBe(0x7E); // read from RAM offset 0x10 (0x1080 + 0x10)
        });
    });

    describe('TIA Unit Tests', () => {
        let tia: TIA;

        beforeEach(() => {
            tia = new TIA();
        });

        it('should correctly configure registers, playfield, and players', () => {
            // Configure playfield
            tia.write(0x0D, 0xF0); // PF0
            tia.write(0x0E, 0xAA); // PF1
            tia.write(0x0F, 0x55); // PF2
            expect(tia.pf0).toBe(0xF0);
            expect(tia.pf1).toBe(0xAA);
            expect(tia.pf2).toBe(0x55);

            // Configure player colors
            tia.write(0x06, 0x86); // COLUP0
            tia.write(0x09, 0x14); // COLUBK
            expect(tia.p0col).toBe(0x86);
            expect(tia.bcol).toBe(0x14);
        });

        it('should produce audio samples and drain cleanly', () => {
            tia.audv[0] = 12;
            tia.audc[0] = 4; // pure tone
            tia.audf[0] = 2;

            // Clock 1 frame of color clocks (3579545 / 60 = ~59659 clocks)
            const clocksPerFrame = Math.floor(3579545 / 60);
            for (let i = 0; i < clocksPerFrame; i++) {
                (tia as any).clockColor();
            }

            expect(tia.audioSamplesAvailable).toBeGreaterThan(450);

            const buf = new Float32Array(tia.audioSamplesAvailable);
            const drained = tia.drainAudio(buf);
            expect(drained).toBe(buf.length);
            expect(tia.audioSamplesAvailable).toBe(0);

            let maxAmp = 0;
            for (let i = 0; i < buf.length; i++) maxAmp = Math.max(maxAmp, Math.abs(buf[i]));
            expect(maxAmp).toBeGreaterThan(0.1);
        });
    });

    describe('Integration & Pac-Man ROM Test', () => {
        const ROM_PATH = path.join(__dirname, '../../../atari/public/Pac-Man.a26');

        it('should load Pac-Man, execute 120 frames, and render high quality visual output', () => {
            expect(fs.existsSync(ROM_PATH)).toBe(true);
            const romBuf = fs.readFileSync(ROM_PATH);

            const atari = new Atari2600();
            atari.loadRom(romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength));

            expect(atari.romLoaded).toBe(true);
            expect(atari.cart?.mapper).toBe('4K');

            const seenColors = new Set<number>();
            // Run 120 frames
            for (let f = 0; f < 120; f++) {
                const res = atari.runFrame(0);
                expect(res.frameStartBlank).toBe(false);
                expect(res.pixels.length).toBe(160 * 192);

                if (f > 60) {
                    for (let i = 0; i < 160 * 192; i += 4) {
                        const rgb = res.pixels[i] & 0xFFFFFF;
                        if (rgb !== 0) seenColors.add(rgb);
                    }
                }
            }

            const fb = atari.bus.tia.framebuffer;
            let nonBlack = 0;
            for (let i = 0; i < 160 * 192; i++) {
                const rgb = fb[i] & 0xFFFFFF;
                if (rgb !== 0) nonBlack++;
            }

            // Expect vivid playfield maze rendering with distinct Atari colors
            expect(nonBlack).toBeGreaterThan(160 * 192 * 0.4);
            expect(seenColors.size).toBeGreaterThanOrEqual(4);

            // Test Save State & Load State
            const state = atari.saveState();
            expect(state).not.toBeNull();
            expect(state?.coreId).toBe('atari');
            expect(state!.cpu.pc & 0x1000).not.toBe(0);

            // Advance further and reload state
            atari.runFrame(0);
            atari.loadState(state!);
            expect(atari.bus.cpu.pc).toBe(state!.cpu.pc);
            expect(atari.bus.cpu.a).toBe(state!.cpu.a);
        });
    });
});
