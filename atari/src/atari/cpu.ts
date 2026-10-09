// MOS 6507 CPU (Atari 2600)
// Complete NMOS 6502/6507 execution engine with accurate decimal mode (BCD),
// cycle-counted addressing modes, page-crossing penalties, WSYNC halt, and illegal opcodes.

export enum CpuFlags {
    C = 1 << 0, // Carry
    Z = 1 << 1, // Zero
    I = 1 << 2, // Interrupt Disable
    D = 1 << 3, // Decimal Mode
    B = 1 << 4, // Break
    U = 1 << 5, // Unused (always 1 in P)
    V = 1 << 6, // Overflow
    N = 1 << 7  // Negative
}

export interface BusInterface {
    read(addr: number): number;
    write(addr: number, data: number): void;
}

export class CPU {
    // Registers
    public a = 0;       // Accumulator (8-bit)
    public x = 0;       // X index (8-bit)
    public y = 0;       // Y index (8-bit)
    public sp = 0xFD;   // Stack pointer (8-bit)
    public pc = 0xF000; // Program counter (16-bit, 13-bit address bus)
    public status = 0x24; // Status register (U=1, I=1 by default)

    // Status flag constants (backward compatibility)
    public static C = CpuFlags.C;
    public static Z = CpuFlags.Z;
    public static I = CpuFlags.I;
    public static D = CpuFlags.D;
    public static B = CpuFlags.B;
    public static U = CpuFlags.U;
    public static V = CpuFlags.V;
    public static N = CpuFlags.N;

    // Cycle tracking & synchronization
    public cycles = 0;
    public totalCycles = 0;
    public wsyncHalt = false; // WSYNC latch set by bus/TIA

    // Bus interface
    private bus: BusInterface;

    constructor(bus: BusInterface) {
        this.bus = bus;
    }

    public connectBus(bus: BusInterface): void {
        this.bus = bus;
    }

    public reset(): void {
        this.a = 0;
        this.x = 0;
        this.y = 0;
        this.sp = 0xFD;
        this.status = 0x24; // Unused bit and Interrupt bit set
        this.cycles = 0;
        this.totalCycles = 0;
        this.wsyncHalt = false;

        // Reset vector at $FFFC-$FFFD (13-bit: $1FFC-$1FFD)
        const lo = this.read(0xFFFC);
        const hi = this.read(0xFFFD);
        this.pc = (hi << 8) | lo;
    }

    public read(addr: number): number {
        return this.bus.read(addr & 0x1FFF);
    }

    public write(addr: number, data: number): void {
        this.bus.write(addr & 0x1FFF, data & 0xFF);
    }

    // Advance 1 CPU cycle
    public clock(): void {
        if (this.wsyncHalt) {
            this.totalCycles++;
            return;
        }

        if (this.cycles === 0) {
            const opcode = this.read(this.pc);
            this.pc = (this.pc + 1) & 0xFFFF;
            this.cycles = this.stepInstruction(opcode);
        }

        this.cycles--;
        this.totalCycles++;
    }

    // Flag helpers
    private getFlag(f: CpuFlags): boolean {
        return (this.status & f) !== 0;
    }

    private setFlag(f: CpuFlags, val: boolean): void {
        if (val) this.status |= f;
        else this.status &= ~f;
    }

    private setZN(val: number): void {
        const v = val & 0xFF;
        this.setFlag(CpuFlags.Z, v === 0);
        this.setFlag(CpuFlags.N, (v & 0x80) !== 0);
    }

    // Stack operations
    private push(val: number): void {
        this.write(0x0100 | (this.sp & 0xFF), val);
        this.sp = (this.sp - 1) & 0xFF;
    }

    private pop(): number {
        this.sp = (this.sp + 1) & 0xFF;
        return this.read(0x0100 | (this.sp & 0xFF));
    }

    // Addressing mode helpers returning [effectiveAddress, pageCrossed]
    private addrZeroPage(): number {
        const addr = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        return addr & 0xFF;
    }

    private addrZeroPageX(): number {
        const addr = (this.read(this.pc) + this.x) & 0xFF;
        this.pc = (this.pc + 1) & 0xFFFF;
        return addr;
    }

    private addrZeroPageY(): number {
        const addr = (this.read(this.pc) + this.y) & 0xFF;
        this.pc = (this.pc + 1) & 0xFFFF;
        return addr;
    }

    private addrAbsolute(): number {
        const lo = this.read(this.pc);
        const hi = this.read((this.pc + 1) & 0xFFFF);
        this.pc = (this.pc + 2) & 0xFFFF;
        return ((hi << 8) | lo) & 0xFFFF;
    }

    private addrAbsoluteX(): [number, boolean] {
        const base = this.addrAbsolute();
        const eff = (base + this.x) & 0xFFFF;
        return [eff, (base & 0xFF00) !== (eff & 0xFF00)];
    }

    private addrAbsoluteY(): [number, boolean] {
        const base = this.addrAbsolute();
        const eff = (base + this.y) & 0xFFFF;
        return [eff, (base & 0xFF00) !== (eff & 0xFF00)];
    }

    private addrIndirectX(): number {
        const ptr = (this.read(this.pc) + this.x) & 0xFF;
        this.pc = (this.pc + 1) & 0xFFFF;
        const lo = this.read(ptr);
        const hi = this.read((ptr + 1) & 0xFF);
        return ((hi << 8) | lo) & 0xFFFF;
    }

    private addrIndirectY(): [number, boolean] {
        const ptr = this.read(this.pc) & 0xFF;
        this.pc = (this.pc + 1) & 0xFFFF;
        const lo = this.read(ptr);
        const hi = this.read((ptr + 1) & 0xFF);
        const base = ((hi << 8) | lo) & 0xFFFF;
        const eff = (base + this.y) & 0xFFFF;
        return [eff, (base & 0xFF00) !== (eff & 0xFF00)];
    }

    // Branch helper (+1 cycle taken, +1 cycle if page boundary crossed)
    private branch(condition: boolean): number {
        let offset = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        if (offset & 0x80) offset -= 256;

        if (!condition) return 2;

        const oldPC = this.pc;
        this.pc = (this.pc + offset) & 0xFFFF;
        const pageCrossed = (oldPC & 0xFF00) !== (this.pc & 0xFF00);
        return 3 + (pageCrossed ? 1 : 0);
    }

    // ADC with accurate BCD (Decimal) mode
    private execADC(m: number): void {
        const c = this.getFlag(CpuFlags.C) ? 1 : 0;
        if (this.getFlag(CpuFlags.D)) {
            let al = (this.a & 0x0F) + (m & 0x0F) + c;
            let ah = (this.a >> 4) + (m >> 4);
            if (al > 9) {
                al = (al + 6) & 0x0F;
                ah++;
            }
            const v = (~(this.a ^ m) & (this.a ^ ((ah << 4) | al)) & 0x80) !== 0;
            this.setFlag(CpuFlags.V, v);
            const carry = ah > 9;
            if (carry) ah = (ah + 6) & 0x0F;
            const res = ((ah << 4) | al) & 0xFF;
            this.setFlag(CpuFlags.C, carry);
            this.setZN(res);
            this.a = res;
        } else {
            const sum = this.a + m + c;
            const v = (~(this.a ^ m) & (this.a ^ sum) & 0x80) !== 0;
            this.setFlag(CpuFlags.V, v);
            this.setFlag(CpuFlags.C, sum > 0xFF);
            this.a = sum & 0xFF;
            this.setZN(this.a);
        }
    }

    // SBC with accurate BCD (Decimal) mode
    private execSBC(m: number): void {
        const c = this.getFlag(CpuFlags.C) ? 1 : 0;
        if (this.getFlag(CpuFlags.D)) {
            let al = (this.a & 0x0F) - (m & 0x0F) - (1 - c);
            let ah = (this.a >> 4) - (m >> 4);
            if (al < 0) {
                al = (al - 6) & 0x0F;
                ah--;
            }
            if (ah < 0) {
                ah = (ah - 6) & 0x0F;
            }
            const diff = this.a - m - (1 - c);
            const v = ((this.a ^ m) & (this.a ^ diff) & 0x80) !== 0;
            this.setFlag(CpuFlags.V, v);
            this.setFlag(CpuFlags.C, diff >= 0);
            const res = ((ah << 4) | al) & 0xFF;
            this.setZN(res);
            this.a = res;
        } else {
            const diff = this.a - m - (1 - c);
            const v = ((this.a ^ m) & (this.a ^ diff) & 0x80) !== 0;
            this.setFlag(CpuFlags.V, v);
            this.setFlag(CpuFlags.C, diff >= 0);
            this.a = diff & 0xFF;
            this.setZN(this.a);
        }
    }

    // Main 6502/6507 instruction execution
    private stepInstruction(op: number): number {
        switch (op) {
            // ---- ADC ----
            case 0x69: { this.execADC(this.read(this.pc++)); return 2; }
            case 0x65: { this.execADC(this.read(this.addrZeroPage())); return 3; }
            case 0x75: { this.execADC(this.read(this.addrZeroPageX())); return 4; }
            case 0x6D: { this.execADC(this.read(this.addrAbsolute())); return 4; }
            case 0x7D: { const [a, cross] = this.addrAbsoluteX(); this.execADC(this.read(a)); return 4 + (cross ? 1 : 0); }
            case 0x79: { const [a, cross] = this.addrAbsoluteY(); this.execADC(this.read(a)); return 4 + (cross ? 1 : 0); }
            case 0x61: { this.execADC(this.read(this.addrIndirectX())); return 6; }
            case 0x71: { const [a, cross] = this.addrIndirectY(); this.execADC(this.read(a)); return 5 + (cross ? 1 : 0); }

            // ---- AND ----
            case 0x29: { this.a &= this.read(this.pc++); this.setZN(this.a); return 2; }
            case 0x25: { this.a &= this.read(this.addrZeroPage()); this.setZN(this.a); return 3; }
            case 0x35: { this.a &= this.read(this.addrZeroPageX()); this.setZN(this.a); return 4; }
            case 0x2D: { this.a &= this.read(this.addrAbsolute()); this.setZN(this.a); return 4; }
            case 0x3D: { const [a, cross] = this.addrAbsoluteX(); this.a &= this.read(a); this.setZN(this.a); return 4 + (cross ? 1 : 0); }
            case 0x39: { const [a, cross] = this.addrAbsoluteY(); this.a &= this.read(a); this.setZN(this.a); return 4 + (cross ? 1 : 0); }
            case 0x21: { this.a &= this.read(this.addrIndirectX()); this.setZN(this.a); return 6; }
            case 0x31: { const [a, cross] = this.addrIndirectY(); this.a &= this.read(a); this.setZN(this.a); return 5 + (cross ? 1 : 0); }

            // ---- ASL ----
            case 0x0A: { this.setFlag(CpuFlags.C, (this.a & 0x80) !== 0); this.a = (this.a << 1) & 0xFF; this.setZN(this.a); return 2; }
            case 0x06: { const a = this.addrZeroPage(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.setZN(v); return 5; }
            case 0x16: { const a = this.addrZeroPageX(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.setZN(v); return 6; }
            case 0x0E: { const a = this.addrAbsolute(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.setZN(v); return 6; }
            case 0x1E: { const [a] = this.addrAbsoluteX(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.setZN(v); return 7; }

            // ---- Branches ----
            case 0x90: return this.branch(!this.getFlag(CpuFlags.C)); // BCC
            case 0xB0: return this.branch(this.getFlag(CpuFlags.C));  // BCS
            case 0xF0: return this.branch(this.getFlag(CpuFlags.Z));  // BEQ
            case 0x30: return this.branch(this.getFlag(CpuFlags.N));  // BMI
            case 0xD0: return this.branch(!this.getFlag(CpuFlags.Z)); // BNE
            case 0x10: return this.branch(!this.getFlag(CpuFlags.N)); // BPL
            case 0x50: return this.branch(!this.getFlag(CpuFlags.V)); // BVC
            case 0x70: return this.branch(this.getFlag(CpuFlags.V));  // BVS

            // ---- BIT ----
            case 0x24: { const v = this.read(this.addrZeroPage()); this.setFlag(CpuFlags.Z, (this.a & v) === 0); this.setFlag(CpuFlags.N, (v & 0x80) !== 0); this.setFlag(CpuFlags.V, (v & 0x40) !== 0); return 3; }
            case 0x2C: { const v = this.read(this.addrAbsolute()); this.setFlag(CpuFlags.Z, (this.a & v) === 0); this.setFlag(CpuFlags.N, (v & 0x80) !== 0); this.setFlag(CpuFlags.V, (v & 0x40) !== 0); return 4; }

            // ---- BRK ----
            case 0x00: {
                this.pc = (this.pc + 1) & 0xFFFF;
                this.push((this.pc >> 8) & 0xFF);
                this.push(this.pc & 0xFF);
                this.push(this.status | CpuFlags.B | CpuFlags.U);
                this.setFlag(CpuFlags.I, true);
                this.pc = this.read(0xFFFE) | (this.read(0xFFFF) << 8);
                return 7;
            }

            // ---- Clear/Set Flags ----
            case 0x18: { this.setFlag(CpuFlags.C, false); return 2; } // CLC
            case 0xD8: { this.setFlag(CpuFlags.D, false); return 2; } // CLD
            case 0x58: { this.setFlag(CpuFlags.I, false); return 2; } // CLI
            case 0xB8: { this.setFlag(CpuFlags.V, false); return 2; } // CLV
            case 0x38: { this.setFlag(CpuFlags.C, true); return 2; }  // SEC
            case 0xF8: { this.setFlag(CpuFlags.D, true); return 2; }  // SED
            case 0x78: { this.setFlag(CpuFlags.I, true); return 2; }  // SEI

            // ---- CMP ----
            case 0xC9: { const v = this.read(this.pc++); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 2; }
            case 0xC5: { const v = this.read(this.addrZeroPage()); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 3; }
            case 0xD5: { const v = this.read(this.addrZeroPageX()); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 4; }
            case 0xCD: { const v = this.read(this.addrAbsolute()); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 4; }
            case 0xDD: { const [a, cross] = this.addrAbsoluteX(); const v = this.read(a); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 4 + (cross ? 1 : 0); }
            case 0xD9: { const [a, cross] = this.addrAbsoluteY(); const v = this.read(a); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 4 + (cross ? 1 : 0); }
            case 0xC1: { const v = this.read(this.addrIndirectX()); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 6; }
            case 0xD1: { const [a, cross] = this.addrIndirectY(); const v = this.read(a); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 5 + (cross ? 1 : 0); }

            // ---- CPX ----
            case 0xE0: { const v = this.read(this.pc++); this.setFlag(CpuFlags.C, this.x >= v); this.setZN(this.x - v); return 2; }
            case 0xE4: { const v = this.read(this.addrZeroPage()); this.setFlag(CpuFlags.C, this.x >= v); this.setZN(this.x - v); return 3; }
            case 0xEC: { const v = this.read(this.addrAbsolute()); this.setFlag(CpuFlags.C, this.x >= v); this.setZN(this.x - v); return 4; }

            // ---- CPY ----
            case 0xC0: { const v = this.read(this.pc++); this.setFlag(CpuFlags.C, this.y >= v); this.setZN(this.y - v); return 2; }
            case 0xC4: { const v = this.read(this.addrZeroPage()); this.setFlag(CpuFlags.C, this.y >= v); this.setZN(this.y - v); return 3; }
            case 0xCC: { const v = this.read(this.addrAbsolute()); this.setFlag(CpuFlags.C, this.y >= v); this.setZN(this.y - v); return 4; }

            // ---- DEC ----
            case 0xC6: { const a = this.addrZeroPage(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setZN(v); return 5; }
            case 0xD6: { const a = this.addrZeroPageX(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setZN(v); return 6; }
            case 0xCE: { const a = this.addrAbsolute(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setZN(v); return 6; }
            case 0xDE: { const [a] = this.addrAbsoluteX(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setZN(v); return 7; }

            // ---- DEX / DEY ----
            case 0xCA: { this.x = (this.x - 1) & 0xFF; this.setZN(this.x); return 2; }
            case 0x88: { this.y = (this.y - 1) & 0xFF; this.setZN(this.y); return 2; }

            // ---- EOR ----
            case 0x49: { this.a ^= this.read(this.pc++); this.setZN(this.a); return 2; }
            case 0x45: { this.a ^= this.read(this.addrZeroPage()); this.setZN(this.a); return 3; }
            case 0x55: { this.a ^= this.read(this.addrZeroPageX()); this.setZN(this.a); return 4; }
            case 0x4D: { this.a ^= this.read(this.addrAbsolute()); this.setZN(this.a); return 4; }
            case 0x5D: { const [a, cross] = this.addrAbsoluteX(); this.a ^= this.read(a); this.setZN(this.a); return 4 + (cross ? 1 : 0); }
            case 0x59: { const [a, cross] = this.addrAbsoluteY(); this.a ^= this.read(a); this.setZN(this.a); return 4 + (cross ? 1 : 0); }
            case 0x41: { this.a ^= this.read(this.addrIndirectX()); this.setZN(this.a); return 6; }
            case 0x51: { const [a, cross] = this.addrIndirectY(); this.a ^= this.read(a); this.setZN(this.a); return 5 + (cross ? 1 : 0); }

            // ---- INC ----
            case 0xE6: { const a = this.addrZeroPage(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.setZN(v); return 5; }
            case 0xF6: { const a = this.addrZeroPageX(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.setZN(v); return 6; }
            case 0xEE: { const a = this.addrAbsolute(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.setZN(v); return 6; }
            case 0xFE: { const [a] = this.addrAbsoluteX(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.setZN(v); return 7; }

            // ---- INX / INY ----
            case 0xE8: { this.x = (this.x + 1) & 0xFF; this.setZN(this.x); return 2; }
            case 0xC8: { this.y = (this.y + 1) & 0xFF; this.setZN(this.y); return 2; }

            // ---- JMP ----
            case 0x4C: { this.pc = this.addrAbsolute(); return 3; }
            case 0x6C: {
                const ptr = this.addrAbsolute();
                const lo = this.read(ptr);
                // 6502 page-boundary bug on indirect jump
                const hi = this.read((ptr & 0xFF00) | ((ptr + 1) & 0xFF));
                this.pc = ((hi << 8) | lo) & 0xFFFF;
                return 5;
            }

            // ---- JSR / RTS ----
            case 0x20: {
                const target = this.addrAbsolute();
                const ret = (this.pc - 1) & 0xFFFF;
                this.push((ret >> 8) & 0xFF);
                this.push(ret & 0xFF);
                this.pc = target;
                return 6;
            }
            case 0x60: {
                const lo = this.pop();
                const hi = this.pop();
                this.pc = (((hi << 8) | lo) + 1) & 0xFFFF;
                return 6;
            }

            // ---- LDA ----
            case 0xA9: { this.a = this.read(this.pc++); this.setZN(this.a); return 2; }
            case 0xA5: { this.a = this.read(this.addrZeroPage()); this.setZN(this.a); return 3; }
            case 0xB5: { this.a = this.read(this.addrZeroPageX()); this.setZN(this.a); return 4; }
            case 0xAD: { this.a = this.read(this.addrAbsolute()); this.setZN(this.a); return 4; }
            case 0xBD: { const [a, cross] = this.addrAbsoluteX(); this.a = this.read(a); this.setZN(this.a); return 4 + (cross ? 1 : 0); }
            case 0xB9: { const [a, cross] = this.addrAbsoluteY(); this.a = this.read(a); this.setZN(this.a); return 4 + (cross ? 1 : 0); }
            case 0xA1: { this.a = this.read(this.addrIndirectX()); this.setZN(this.a); return 6; }
            case 0xB1: { const [a, cross] = this.addrIndirectY(); this.a = this.read(a); this.setZN(this.a); return 5 + (cross ? 1 : 0); }

            // ---- LDX ----
            case 0xA2: { this.x = this.read(this.pc++); this.setZN(this.x); return 2; }
            case 0xA6: { this.x = this.read(this.addrZeroPage()); this.setZN(this.x); return 3; }
            case 0xB6: { this.x = this.read(this.addrZeroPageY()); this.setZN(this.x); return 4; }
            case 0xAE: { this.x = this.read(this.addrAbsolute()); this.setZN(this.x); return 4; }
            case 0xBE: { const [a, cross] = this.addrAbsoluteY(); this.x = this.read(a); this.setZN(this.x); return 4 + (cross ? 1 : 0); }

            // ---- LDY ----
            case 0xA0: { this.y = this.read(this.pc++); this.setZN(this.y); return 2; }
            case 0xA4: { this.y = this.read(this.addrZeroPage()); this.setZN(this.y); return 3; }
            case 0xB4: { this.y = this.read(this.addrZeroPageX()); this.setZN(this.y); return 4; }
            case 0xAC: { this.y = this.read(this.addrAbsolute()); this.setZN(this.y); return 4; }
            case 0xBC: { const [a, cross] = this.addrAbsoluteX(); this.y = this.read(a); this.setZN(this.y); return 4 + (cross ? 1 : 0); }

            // ---- LSR ----
            case 0x4A: { this.setFlag(CpuFlags.C, (this.a & 1) !== 0); this.a >>= 1; this.setZN(this.a); return 2; }
            case 0x46: { const a = this.addrZeroPage(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.setZN(v); return 5; }
            case 0x56: { const a = this.addrZeroPageX(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.setZN(v); return 6; }
            case 0x4E: { const a = this.addrAbsolute(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.setZN(v); return 6; }
            case 0x5E: { const [a] = this.addrAbsoluteX(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.setZN(v); return 7; }

            // ---- NOP ----
            case 0xEA: return 2;

            // ---- ORA ----
            case 0x09: { this.a |= this.read(this.pc++); this.setZN(this.a); return 2; }
            case 0x05: { this.a |= this.read(this.addrZeroPage()); this.setZN(this.a); return 3; }
            case 0x15: { this.a |= this.read(this.addrZeroPageX()); this.setZN(this.a); return 4; }
            case 0x0D: { this.a |= this.read(this.addrAbsolute()); this.setZN(this.a); return 4; }
            case 0x1D: { const [a, cross] = this.addrAbsoluteX(); this.a |= this.read(a); this.setZN(this.a); return 4 + (cross ? 1 : 0); }
            case 0x19: { const [a, cross] = this.addrAbsoluteY(); this.a |= this.read(a); this.setZN(this.a); return 4 + (cross ? 1 : 0); }
            case 0x01: { this.a |= this.read(this.addrIndirectX()); this.setZN(this.a); return 6; }
            case 0x11: { const [a, cross] = this.addrIndirectY(); this.a |= this.read(a); this.setZN(this.a); return 5 + (cross ? 1 : 0); }

            // ---- Register Transfers ----
            case 0xAA: { this.x = this.a; this.setZN(this.x); return 2; } // TAX
            case 0x8A: { this.a = this.x; this.setZN(this.a); return 2; } // TXA
            case 0xA8: { this.y = this.a; this.setZN(this.y); return 2; } // TAY
            case 0x98: { this.a = this.y; this.setZN(this.a); return 2; } // TYA
            case 0xBA: { this.x = this.sp; this.setZN(this.x); return 2; } // TSX
            case 0x9A: { this.sp = this.x; return 2; }                   // TXS

            // ---- Stack Push / Pull ----
            case 0x48: { this.push(this.a); return 3; } // PHA
            case 0x68: { this.a = this.pop(); this.setZN(this.a); return 4; } // PLA
            case 0x08: { this.push(this.status | CpuFlags.B | CpuFlags.U); return 3; } // PHP
            case 0x28: { this.status = (this.pop() | CpuFlags.U) & ~CpuFlags.B; return 4; } // PLP

            // ---- ROL ----
            case 0x2A: { const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (this.a & 0x80) !== 0); this.a = ((this.a << 1) | c) & 0xFF; this.setZN(this.a); return 2; }
            case 0x26: { const a = this.addrZeroPage(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.setZN(v); return 5; }
            case 0x36: { const a = this.addrZeroPageX(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.setZN(v); return 6; }
            case 0x2E: { const a = this.addrAbsolute(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.setZN(v); return 6; }
            case 0x3E: { const [a] = this.addrAbsoluteX(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.setZN(v); return 7; }

            // ---- ROR ----
            case 0x6A: { const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (this.a & 1) !== 0); this.a = (this.a >> 1) | c; this.setZN(this.a); return 2; }
            case 0x66: { const a = this.addrZeroPage(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.setZN(v); return 5; }
            case 0x76: { const a = this.addrZeroPageX(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.setZN(v); return 6; }
            case 0x6E: { const a = this.addrAbsolute(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.setZN(v); return 6; }
            case 0x7E: { const [a] = this.addrAbsoluteX(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.setZN(v); return 7; }

            // ---- RTI ----
            case 0x40: {
                this.status = (this.pop() | CpuFlags.U) & ~CpuFlags.B;
                const lo = this.pop();
                const hi = this.pop();
                this.pc = (hi << 8) | lo;
                return 6;
            }

            // ---- SBC ----
            case 0xE9: case 0xEB: { this.execSBC(this.read(this.pc++)); return 2; }
            case 0xE5: { this.execSBC(this.read(this.addrZeroPage())); return 3; }
            case 0xF5: { this.execSBC(this.read(this.addrZeroPageX())); return 4; }
            case 0xED: { this.execSBC(this.read(this.addrAbsolute())); return 4; }
            case 0xFD: { const [a, cross] = this.addrAbsoluteX(); this.execSBC(this.read(a)); return 4 + (cross ? 1 : 0); }
            case 0xF9: { const [a, cross] = this.addrAbsoluteY(); this.execSBC(this.read(a)); return 4 + (cross ? 1 : 0); }
            case 0xE1: { this.execSBC(this.read(this.addrIndirectX())); return 6; }
            case 0xF1: { const [a, cross] = this.addrIndirectY(); this.execSBC(this.read(a)); return 5 + (cross ? 1 : 0); }

            // ---- STA ----
            case 0x85: { this.write(this.addrZeroPage(), this.a); return 3; }
            case 0x95: { this.write(this.addrZeroPageX(), this.a); return 4; }
            case 0x8D: { this.write(this.addrAbsolute(), this.a); return 4; }
            case 0x9D: { const [a] = this.addrAbsoluteX(); this.write(a, this.a); return 5; }
            case 0x99: { const [a] = this.addrAbsoluteY(); this.write(a, this.a); return 5; }
            case 0x81: { this.write(this.addrIndirectX(), this.a); return 6; }
            case 0x91: { const [a] = this.addrIndirectY(); this.write(a, this.a); return 6; }

            // ---- STX ----
            case 0x86: { this.write(this.addrZeroPage(), this.x); return 3; }
            case 0x96: { this.write(this.addrZeroPageY(), this.x); return 4; }
            case 0x8E: { this.write(this.addrAbsolute(), this.x); return 4; }

            // ---- STY ----
            case 0x84: { this.write(this.addrZeroPage(), this.y); return 3; }
            case 0x94: { this.write(this.addrZeroPageX(), this.y); return 4; }
            case 0x8C: { this.write(this.addrAbsolute(), this.y); return 4; }

            // ==========================================
            // Common Illegal / Unofficial Opcodes
            // ==========================================
            // LAX: Load A and X simultaneously
            case 0xA7: { this.a = this.x = this.read(this.addrZeroPage()); this.setZN(this.a); return 3; }
            case 0xB7: { this.a = this.x = this.read(this.addrZeroPageY()); this.setZN(this.a); return 4; }
            case 0xAF: { this.a = this.x = this.read(this.addrAbsolute()); this.setZN(this.a); return 4; }
            case 0xBF: { const [a, cross] = this.addrAbsoluteY(); this.a = this.x = this.read(a); this.setZN(this.a); return 4 + (cross ? 1 : 0); }
            case 0xA3: { this.a = this.x = this.read(this.addrIndirectX()); this.setZN(this.a); return 6; }
            case 0xB3: { const [a, cross] = this.addrIndirectY(); this.a = this.x = this.read(a); this.setZN(this.a); return 5 + (cross ? 1 : 0); }

            // SAX: Store A & X
            case 0x87: { this.write(this.addrZeroPage(), this.a & this.x); return 3; }
            case 0x97: { this.write(this.addrZeroPageY(), this.a & this.x); return 4; }
            case 0x8F: { this.write(this.addrAbsolute(), this.a & this.x); return 4; }
            case 0x83: { this.write(this.addrIndirectX(), this.a & this.x); return 6; }

            // DCP: DEC then CMP
            case 0xC7: { const a = this.addrZeroPage(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 5; }
            case 0xD7: { const a = this.addrZeroPageX(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 6; }
            case 0xCF: { const a = this.addrAbsolute(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 6; }
            case 0xDF: { const [a] = this.addrAbsoluteX(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 7; }
            case 0xDB: { const [a] = this.addrAbsoluteY(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 7; }
            case 0xC3: { const a = this.addrIndirectX(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 8; }
            case 0xD3: { const [a] = this.addrIndirectY(); const v = (this.read(a) - 1) & 0xFF; this.write(a, v); this.setFlag(CpuFlags.C, this.a >= v); this.setZN(this.a - v); return 8; }

            // ISC: INC then SBC
            case 0xE7: { const a = this.addrZeroPage(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.execSBC(v); return 5; }
            case 0xF7: { const a = this.addrZeroPageX(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.execSBC(v); return 6; }
            case 0xEF: { const a = this.addrAbsolute(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.execSBC(v); return 6; }
            case 0xFF: { const [a] = this.addrAbsoluteX(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.execSBC(v); return 7; }
            case 0xFB: { const [a] = this.addrAbsoluteY(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.execSBC(v); return 7; }
            case 0xE3: { const a = this.addrIndirectX(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.execSBC(v); return 8; }
            case 0xF3: { const [a] = this.addrIndirectY(); const v = (this.read(a) + 1) & 0xFF; this.write(a, v); this.execSBC(v); return 8; }

            // SLO: ASL then ORA
            case 0x07: { const a = this.addrZeroPage(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.a |= v; this.setZN(this.a); return 5; }
            case 0x17: { const a = this.addrZeroPageX(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.a |= v; this.setZN(this.a); return 6; }
            case 0x0F: { const a = this.addrAbsolute(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.a |= v; this.setZN(this.a); return 6; }
            case 0x1F: { const [a] = this.addrAbsoluteX(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.a |= v; this.setZN(this.a); return 7; }
            case 0x1B: { const [a] = this.addrAbsoluteY(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.a |= v; this.setZN(this.a); return 7; }
            case 0x03: { const a = this.addrIndirectX(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.a |= v; this.setZN(this.a); return 8; }
            case 0x13: { const [a] = this.addrIndirectY(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = (v << 1) & 0xFF; this.write(a, v); this.a |= v; this.setZN(this.a); return 8; }

            // RLA: ROL then AND
            case 0x27: { const a = this.addrZeroPage(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.a &= v; this.setZN(this.a); return 5; }
            case 0x37: { const a = this.addrZeroPageX(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.a &= v; this.setZN(this.a); return 6; }
            case 0x2F: { const a = this.addrAbsolute(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.a &= v; this.setZN(this.a); return 6; }
            case 0x3F: { const [a] = this.addrAbsoluteX(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.a &= v; this.setZN(this.a); return 7; }
            case 0x3B: { const [a] = this.addrAbsoluteY(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.a &= v; this.setZN(this.a); return 7; }
            case 0x23: { const a = this.addrIndirectX(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.a &= v; this.setZN(this.a); return 8; }
            case 0x33: { const [a] = this.addrIndirectY(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 1 : 0; this.setFlag(CpuFlags.C, (v & 0x80) !== 0); v = ((v << 1) | c) & 0xFF; this.write(a, v); this.a &= v; this.setZN(this.a); return 8; }

            // SRE: LSR then EOR
            case 0x47: { const a = this.addrZeroPage(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.a ^= v; this.setZN(this.a); return 5; }
            case 0x57: { const a = this.addrZeroPageX(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.a ^= v; this.setZN(this.a); return 6; }
            case 0x4F: { const a = this.addrAbsolute(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.a ^= v; this.setZN(this.a); return 6; }
            case 0x5F: { const [a] = this.addrAbsoluteX(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.a ^= v; this.setZN(this.a); return 7; }
            case 0x5B: { const [a] = this.addrAbsoluteY(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.a ^= v; this.setZN(this.a); return 7; }
            case 0x43: { const a = this.addrIndirectX(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.a ^= v; this.setZN(this.a); return 8; }
            case 0x53: { const [a] = this.addrIndirectY(); let v = this.read(a); this.setFlag(CpuFlags.C, (v & 1) !== 0); v >>= 1; this.write(a, v); this.a ^= v; this.setZN(this.a); return 8; }

            // RRA: ROR then ADC
            case 0x67: { const a = this.addrZeroPage(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.execADC(v); return 5; }
            case 0x77: { const a = this.addrZeroPageX(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.execADC(v); return 6; }
            case 0x6F: { const a = this.addrAbsolute(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.execADC(v); return 6; }
            case 0x7F: { const [a] = this.addrAbsoluteX(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.execADC(v); return 7; }
            case 0x7B: { const [a] = this.addrAbsoluteY(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.execADC(v); return 7; }
            case 0x63: { const a = this.addrIndirectX(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.execADC(v); return 8; }
            case 0x73: { const [a] = this.addrIndirectY(); let v = this.read(a); const c = this.getFlag(CpuFlags.C) ? 0x80 : 0; this.setFlag(CpuFlags.C, (v & 1) !== 0); v = (v >> 1) | c; this.write(a, v); this.execADC(v); return 8; }

            // 1-byte illegal NOPs
            case 0x1A: case 0x3A: case 0x5A: case 0x7A: case 0xDA: case 0xFA:
                return 2;

            // 2-byte illegal NOPs
            case 0x80: case 0x82: case 0x89: case 0xC2: case 0xE2:
            case 0x04: case 0x44: case 0x64:
                this.pc = (this.pc + 1) & 0xFFFF;
                return 3;
            case 0x14: case 0x34: case 0x54: case 0x74: case 0xD4: case 0xF4:
                this.pc = (this.pc + 1) & 0xFFFF;
                return 4;

            // 3-byte illegal NOPs
            case 0x0C:
                this.pc = (this.pc + 2) & 0xFFFF;
                return 4;
            case 0x1C: case 0x3C: case 0x5C: case 0x7C: case 0xDC: case 0xFC:
                this.pc = (this.pc + 2) & 0xFFFF;
                return 4;

            default:
                // Unimplemented or rare opcode
                return 2;
        }
    }
}