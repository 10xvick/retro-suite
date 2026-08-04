// MOS 6507 CPU - a simplified 6502 with 13-bit address bus (8KB addressable)
// Used in the Atari 2600. Same instruction set as 6502 but no NMI/IRQ pins.

export class CPU {
    // Registers
    public a = 0;      // Accumulator
    public x = 0;      // X index
    public y = 0;      // Y index
    public sp = 0xFD;  // Stack pointer
    public pc = 0xF000; // Program counter
    public status = 0x20; // Status register (bit 5 always set)

    // Status flags
    public static C = 0x01; // Carry
    public static Z = 0x02; // Zero
    public static I = 0x04; // Interrupt disable
    public static D = 0x08; // Decimal
    public static B = 0x10; // Break
    public static U = 0x20; // Unused
    public static V = 0x40; // Overflow
    public static N = 0x80; // Negative

    // Cycle counter
    public cycles = 0;
    public totalCycles = 0;
    public wsyncHalt = false; // Set by bus when WSYNC write occurs; cleared at end of scanline

    // Bus reference
    private bus: any;

    // Instruction state
    private fetched = 0;
    private temp = 0;
    private addrAbs = 0;
    private addrRel = 0;
    private opcode = 0;

    constructor(bus: any) {
        this.bus = bus;
    }

    public connectBus(bus: any) {
        this.bus = bus;
    }

    public reset() {
        this.a = 0;
        this.x = 0;
        this.y = 0;
        this.sp = 0xFD;
        this.status = 0x20;
        this.cycles = 0;
        this.totalCycles = 0;
        // Read reset vector from $FFFC-$FFFD
        this.pc = this.read(0xFFFC) | (this.read(0xFFFD) << 8);
    }

    public read(addr: number): number {
        return this.bus.read(addr & 0x1FFF);
    }

    public write(addr: number, data: number) {
        this.bus.write(addr & 0x1FFF, data);
    }

    public clock() {
        if (this.cycles === 0) {
            this.opcode = this.read(this.pc);
            this.pc = (this.pc + 1) & 0xFFFF;
            this.cycles = this.execute(this.opcode);
        }
        this.cycles--;
        this.totalCycles++;
    }

    // Flag helpers
    private getFlag(flag: number): boolean {
        return (this.status & flag) !== 0;
    }

    private setFlag(flag: number, value: boolean) {
        if (value) {
            this.status |= flag;
        } else {
            this.status &= ~flag;
        }
    }

    // Addressing modes
    private imp(): number { this.fetched = this.a; return 0; }
    private imm(): number { this.addrAbs = this.pc++; return 0; }
    private zp(): number { this.addrAbs = this.read(this.pc) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF; return 0; }
    private zpx(): number { this.addrAbs = (this.read(this.pc) + this.x) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF; return 0; }
    private zpy(): number { this.addrAbs = (this.read(this.pc) + this.y) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF; return 0; }
    private abs(): number {
        const lo = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const hi = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        this.addrAbs = lo | (hi << 8);
        return 0;
    }
    private abx(): number {
        const lo = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const hi = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        this.addrAbs = (lo | (hi << 8)) + this.x;
        if ((this.addrAbs & 0xFF00) !== (hi << 8)) return 1;
        return 0;
    }
    private aby(): number {
        const lo = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const hi = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        this.addrAbs = (lo | (hi << 8)) + this.y;
        if ((this.addrAbs & 0xFF00) !== (hi << 8)) return 1;
        return 0;
    }
    private ind(): number {
        const ptr = this.read(this.pc) | (this.read((this.pc + 1) & 0xFFFF) << 8);
        this.pc = (this.pc + 2) & 0xFFFF;
        // 6502 bug: page wrap not handled on indirect
        const lo = this.read(ptr & 0xFFFF);
        const hi = this.read(((ptr & 0xFF00) | ((ptr + 1) & 0xFF)) & 0xFFFF);
        this.addrAbs = lo | (hi << 8);
        return 0;
    }
    private izx(): number {
        const zp = (this.read(this.pc) + this.x) & 0xFF;
        this.pc = (this.pc + 1) & 0xFFFF;
        const lo = this.read(zp & 0xFF);
        const hi = this.read((zp + 1) & 0xFF);
        this.addrAbs = lo | (hi << 8);
        return 0;
    }
    private izy(): number {
        const zp = this.read(this.pc) & 0xFF;
        this.pc = (this.pc + 1) & 0xFFFF;
        const lo = this.read(zp & 0xFF);
        const hi = this.read((zp + 1) & 0xFF);
        this.addrAbs = (lo | (hi << 8)) + this.y;
        if ((this.addrAbs & 0xFF00) !== (hi << 8)) return 1;
        return 0;
    }
    private rel(): number {
        this.addrRel = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        if (this.addrRel & 0x80) {
            this.addrRel |= 0xFF00;
        }
        return 0;
    }

    // Instruction helpers
    private fetch(): number {
        if (this.opcode >= 0x20 && this.opcode <= 0x2F) {
            // Handle special cases for JSR, BIT, etc.
        }
        if (this.opcode === 0x00 || this.opcode === 0x40 || this.opcode === 0x60) {
            this.fetched = this.a;
        } else {
            this.fetched = this.read(this.addrAbs);
        }
        return this.fetched;
    }

    private fetchNoRead(): number {
        this.fetched = this.a;
        return this.fetched;
    }

    // Instructions
    private ADC(): number {
        this.fetch();
        const a = this.a;
        const m = this.fetched;
        const c = this.getFlag(CPU.C) ? 1 : 0;
        const result = a + m + c;
        this.setFlag(CPU.C, result > 0xFF);
        this.setFlag(CPU.Z, (result & 0xFF) === 0);
        this.setFlag(CPU.V, (~(a ^ m) & (a ^ result) & 0x80) !== 0);
        this.setFlag(CPU.N, (result & 0x80) !== 0);
        this.a = result & 0xFF;
        return 1;
    }

    private AND(): number {
        this.fetch();
        this.a &= this.fetched;
        this.setFlag(CPU.Z, this.a === 0);
        this.setFlag(CPU.N, (this.a & 0x80) !== 0);
        return 1;
    }

    private ASL(): number {
        this.fetch();
        this.setFlag(CPU.C, (this.fetched & 0x80) !== 0);
        this.fetched = (this.fetched << 1) & 0xFF;
        this.setFlag(CPU.Z, this.fetched === 0);
        this.setFlag(CPU.N, (this.fetched & 0x80) !== 0);
        if (this.opcode === 0x0A) {
            this.a = this.fetched;
        } else {
            this.write(this.addrAbs, this.fetched);
        }
        return 0;
    }

    private BCC(): number {
        if (!this.getFlag(CPU.C)) {
            this.cycles++;
            this.addrAbs = (this.pc + this.addrRel) & 0xFFFF;
            if ((this.addrAbs & 0xFF00) !== (this.pc & 0xFF00)) this.cycles++;
            this.pc = this.addrAbs;
        }
        return 0;
    }

    private BCS(): number {
        if (this.getFlag(CPU.C)) {
            this.cycles++;
            this.addrAbs = (this.pc + this.addrRel) & 0xFFFF;
            if ((this.addrAbs & 0xFF00) !== (this.pc & 0xFF00)) this.cycles++;
            this.pc = this.addrAbs;
        }
        return 0;
    }

    private BEQ(): number {
        if (this.getFlag(CPU.Z)) {
            this.cycles++;
            this.addrAbs = (this.pc + this.addrRel) & 0xFFFF;
            if ((this.addrAbs & 0xFF00) !== (this.pc & 0xFF00)) this.cycles++;
            this.pc = this.addrAbs;
        }
        return 0;
    }

    private BIT(): number {
        this.fetch();
        const result = this.a & this.fetched;
        this.setFlag(CPU.Z, result === 0);
        this.setFlag(CPU.N, (this.fetched & 0x80) !== 0);
        this.setFlag(CPU.V, (this.fetched & 0x40) !== 0);
        return 0;
    }

    private BMI(): number {
        if (this.getFlag(CPU.N)) {
            this.cycles++;
            this.addrAbs = (this.pc + this.addrRel) & 0xFFFF;
            if ((this.addrAbs & 0xFF00) !== (this.pc & 0xFF00)) this.cycles++;
            this.pc = this.addrAbs;
        }
        return 0;
    }

    private BNE(): number {
        if (!this.getFlag(CPU.Z)) {
            this.cycles++;
            this.addrAbs = (this.pc + this.addrRel) & 0xFFFF;
            if ((this.addrAbs & 0xFF00) !== (this.pc & 0xFF00)) this.cycles++;
            this.pc = this.addrAbs;
        }
        return 0;
    }

    private BPL(): number {
        if (!this.getFlag(CPU.N)) {
            this.cycles++;
            this.addrAbs = (this.pc + this.addrRel) & 0xFFFF;
            if ((this.addrAbs & 0xFF00) !== (this.pc & 0xFF00)) this.cycles++;
            this.pc = this.addrAbs;
        }
        return 0;
    }

    private BRK(): number {
        this.pc = (this.pc + 1) & 0xFFFF;
        this.setFlag(CPU.I, true);
        this.write(0x0100 + this.sp, (this.pc >> 8) & 0xFF);
        this.sp = (this.sp - 1) & 0xFF;
        this.write(0x0100 + this.sp, this.pc & 0xFF);
        this.sp = (this.sp - 1) & 0xFF;
        this.setFlag(CPU.B, true);
        this.write(0x0100 + this.sp, this.status);
        this.sp = (this.sp - 1) & 0xFF;
        this.setFlag(CPU.B, false);
        this.pc = this.read(0xFFFE) | (this.read(0xFFFF) << 8);
        return 0;
    }

    private BVC(): number {
        if (!this.getFlag(CPU.V)) {
            this.cycles++;
            this.addrAbs = (this.pc + this.addrRel) & 0xFFFF;
            if ((this.addrAbs & 0xFF00) !== (this.pc & 0xFF00)) this.cycles++;
            this.pc = this.addrAbs;
        }
        return 0;
    }

    private BVS(): number {
        if (this.getFlag(CPU.V)) {
            this.cycles++;
            this.addrAbs = (this.pc + this.addrRel) & 0xFFFF;
            if ((this.addrAbs & 0xFF00) !== (this.pc & 0xFF00)) this.cycles++;
            this.pc = this.addrAbs;
        }
        return 0;
    }

    private CLC(): number { this.setFlag(CPU.C, false); return 0; }
    private CLD(): number { this.setFlag(CPU.D, false); return 0; }
    private CLI(): number { this.setFlag(CPU.I, false); return 0; }
    private CLV(): number { this.setFlag(CPU.V, false); return 0; }

    private CMP(): number {
        this.fetch();
        const result = this.a - this.fetched;
        this.setFlag(CPU.C, this.a >= this.fetched);
        this.setFlag(CPU.Z, (result & 0xFF) === 0);
        this.setFlag(CPU.N, (result & 0x80) !== 0);
        return 1;
    }

    private CPX(): number {
        this.fetch();
        const result = this.x - this.fetched;
        this.setFlag(CPU.C, this.x >= this.fetched);
        this.setFlag(CPU.Z, (result & 0xFF) === 0);
        this.setFlag(CPU.N, (result & 0x80) !== 0);
        return 0;
    }

    private CPY(): number {
        this.fetch();
        const result = this.y - this.fetched;
        this.setFlag(CPU.C, this.y >= this.fetched);
        this.setFlag(CPU.Z, (result & 0xFF) === 0);
        this.setFlag(CPU.N, (result & 0x80) !== 0);
        return 0;
    }

    private DEC(): number {
        this.fetch();
        this.fetched = (this.fetched - 1) & 0xFF;
        this.write(this.addrAbs, this.fetched);
        this.setFlag(CPU.Z, this.fetched === 0);
        this.setFlag(CPU.N, (this.fetched & 0x80) !== 0);
        return 0;
    }

    private DEX(): number {
        this.x = (this.x - 1) & 0xFF;
        this.setFlag(CPU.Z, this.x === 0);
        this.setFlag(CPU.N, (this.x & 0x80) !== 0);
        return 0;
    }

    private DEY(): number {
        this.y = (this.y - 1) & 0xFF;
        this.setFlag(CPU.Z, this.y === 0);
        this.setFlag(CPU.N, (this.y & 0x80) !== 0);
        return 0;
    }

    private EOR(): number {
        this.fetch();
        this.a ^= this.fetched;
        this.setFlag(CPU.Z, this.a === 0);
        this.setFlag(CPU.N, (this.a & 0x80) !== 0);
        return 1;
    }

    private INC(): number {
        this.fetch();
        this.fetched = (this.fetched + 1) & 0xFF;
        this.write(this.addrAbs, this.fetched);
        this.setFlag(CPU.Z, this.fetched === 0);
        this.setFlag(CPU.N, (this.fetched & 0x80) !== 0);
        return 0;
    }

    private INX(): number {
        this.x = (this.x + 1) & 0xFF;
        this.setFlag(CPU.Z, this.x === 0);
        this.setFlag(CPU.N, (this.x & 0x80) !== 0);
        return 0;
    }

    private INY(): number {
        this.y = (this.y + 1) & 0xFF;
        this.setFlag(CPU.Z, this.y === 0);
        this.setFlag(CPU.N, (this.y & 0x80) !== 0);
        return 0;
    }

    private JMP(): number {
        this.pc = this.addrAbs;
        return 0;
    }

    private JSR(): number {
        this.pc = (this.pc - 1) & 0xFFFF;
        this.write(0x0100 + this.sp, (this.pc >> 8) & 0xFF);
        this.sp = (this.sp - 1) & 0xFF;
        this.write(0x0100 + this.sp, this.pc & 0xFF);
        this.sp = (this.sp - 1) & 0xFF;
        this.pc = this.addrAbs;
        return 0;
    }

    private LDA(): number {
        this.fetch();
        this.a = this.fetched;
        this.setFlag(CPU.Z, this.a === 0);
        this.setFlag(CPU.N, (this.a & 0x80) !== 0);
        return 1;
    }

    private LDX(): number {
        this.fetch();
        this.x = this.fetched;
        this.setFlag(CPU.Z, this.x === 0);
        this.setFlag(CPU.N, (this.x & 0x80) !== 0);
        return 1;
    }

    private LDY(): number {
        this.fetch();
        this.y = this.fetched;
        this.setFlag(CPU.Z, this.y === 0);
        this.setFlag(CPU.N, (this.y & 0x80) !== 0);
        return 1;
    }

    private LSR(): number {
        this.fetch();
        this.setFlag(CPU.C, (this.fetched & 0x01) !== 0);
        this.fetched = (this.fetched >> 1) & 0xFF;
        this.setFlag(CPU.Z, this.fetched === 0);
        this.setFlag(CPU.N, false);
        if (this.opcode === 0x4A) {
            this.a = this.fetched;
        } else {
            this.write(this.addrAbs, this.fetched);
        }
        return 0;
    }

    private NOP(): number { return 0; }

    private ORA(): number {
        this.fetch();
        this.a |= this.fetched;
        this.setFlag(CPU.Z, this.a === 0);
        this.setFlag(CPU.N, (this.a & 0x80) !== 0);
        return 1;
    }

    private PHA(): number {
        this.write(0x0100 + this.sp, this.a);
        this.sp = (this.sp - 1) & 0xFF;
        return 0;
    }

    private PHP(): number {
        this.setFlag(CPU.B, true);
        this.write(0x0100 + this.sp, this.status);
        this.setFlag(CPU.B, false);
        this.sp = (this.sp - 1) & 0xFF;
        return 0;
    }

    private PLA(): number {
        this.sp = (this.sp + 1) & 0xFF;
        this.a = this.read(0x0100 + this.sp);
        this.setFlag(CPU.Z, this.a === 0);
        this.setFlag(CPU.N, (this.a & 0x80) !== 0);
        return 0;
    }

    private PLP(): number {
        this.sp = (this.sp + 1) & 0xFF;
        this.status = this.read(0x0100 + this.sp);
        this.setFlag(CPU.U, true);
        return 0;
    }

    private ROL(): number {
        this.fetch();
        const c = this.getFlag(CPU.C) ? 1 : 0;
        this.setFlag(CPU.C, (this.fetched & 0x80) !== 0);
        this.fetched = ((this.fetched << 1) | c) & 0xFF;
        this.setFlag(CPU.Z, this.fetched === 0);
        this.setFlag(CPU.N, (this.fetched & 0x80) !== 0);
        if (this.opcode === 0x2A) {
            this.a = this.fetched;
        } else {
            this.write(this.addrAbs, this.fetched);
        }
        return 0;
    }

    private ROR(): number {
        this.fetch();
        const c = this.getFlag(CPU.C) ? 0x80 : 0;
        this.setFlag(CPU.C, (this.fetched & 0x01) !== 0);
        this.fetched = ((this.fetched >> 1) | c) & 0xFF;
        this.setFlag(CPU.Z, this.fetched === 0);
        this.setFlag(CPU.N, (this.fetched & 0x80) !== 0);
        if (this.opcode === 0x6A) {
            this.a = this.fetched;
        } else {
            this.write(this.addrAbs, this.fetched);
        }
        return 0;
    }

    private RTI(): number {
        this.sp = (this.sp + 1) & 0xFF;
        this.status = this.read(0x0100 + this.sp);
        this.setFlag(CPU.U, true);
        this.sp = (this.sp + 1) & 0xFF;
        this.pc = this.read(0x0100 + this.sp);
        this.sp = (this.sp + 1) & 0xFF;
        this.pc |= this.read(0x0100 + this.sp) << 8;
        return 0;
    }

    private RTS(): number {
        this.sp = (this.sp + 1) & 0xFF;
        this.pc = this.read(0x0100 + this.sp);
        this.sp = (this.sp + 1) & 0xFF;
        this.pc |= this.read(0x0100 + this.sp) << 8;
        this.pc = (this.pc + 1) & 0xFFFF;
        return 0;
    }

    private SBC(): number {
        this.fetch();
        const a = this.a;
        const m = this.fetched;
        const c = this.getFlag(CPU.C) ? 1 : 0;
        const result = a - m - (1 - c);
        this.setFlag(CPU.C, result >= 0);
        this.setFlag(CPU.Z, (result & 0xFF) === 0);
        this.setFlag(CPU.V, ((a ^ m) & (a ^ result) & 0x80) !== 0);
        this.setFlag(CPU.N, (result & 0x80) !== 0);
        this.a = result & 0xFF;
        return 1;
    }

    private SEC(): number { this.setFlag(CPU.C, true); return 0; }
    private SED(): number { this.setFlag(CPU.D, true); return 0; }
    private SEI(): number { this.setFlag(CPU.I, true); return 0; }

    private STA(): number {
        this.write(this.addrAbs, this.a);
        return 0;
    }

    private STX(): number {
        this.write(this.addrAbs, this.x);
        return 0;
    }

    private STY(): number {
        this.write(this.addrAbs, this.y);
        return 0;
    }

    private TAX(): number {
        this.x = this.a;
        this.setFlag(CPU.Z, this.x === 0);
        this.setFlag(CPU.N, (this.x & 0x80) !== 0);
        return 0;
    }

    private TAY(): number {
        this.y = this.a;
        this.setFlag(CPU.Z, this.y === 0);
        this.setFlag(CPU.N, (this.y & 0x80) !== 0);
        return 0;
    }

    private TSX(): number {
        this.x = this.sp;
        this.setFlag(CPU.Z, this.x === 0);
        this.setFlag(CPU.N, (this.x & 0x80) !== 0);
        return 0;
    }

    private TXA(): number {
        this.a = this.x;
        this.setFlag(CPU.Z, this.a === 0);
        this.setFlag(CPU.N, (this.a & 0x80) !== 0);
        return 0;
    }

    private TXS(): number {
        this.sp = this.x;
        return 0;
    }

    private TYA(): number {
        this.a = this.y;
        this.setFlag(CPU.Z, this.a === 0);
        this.setFlag(CPU.N, (this.a & 0x80) !== 0);
        return 0;
    }

    // Execute an opcode, return cycle count
    private execute(opcode: number): number {
        let extraCycles = 0;

        switch (opcode) {
            // ADC
            case 0x69: this.imm(); extraCycles = this.ADC(); break;
            case 0x65: this.zp(); extraCycles = this.ADC(); break;
            case 0x75: this.zpx(); extraCycles = this.ADC(); break;
            case 0x6D: this.abs(); extraCycles = this.ADC(); break;
            case 0x7D: extraCycles = this.abx(); extraCycles += this.ADC(); break;
            case 0x79: extraCycles = this.aby(); extraCycles += this.ADC(); break;
            case 0x61: this.izx(); extraCycles = this.ADC(); break;
            case 0x71: extraCycles = this.izy(); extraCycles += this.ADC(); break;

            // AND
            case 0x29: this.imm(); extraCycles = this.AND(); break;
            case 0x25: this.zp(); extraCycles = this.AND(); break;
            case 0x35: this.zpx(); extraCycles = this.AND(); break;
            case 0x2D: this.abs(); extraCycles = this.AND(); break;
            case 0x3D: extraCycles = this.abx(); extraCycles += this.AND(); break;
            case 0x39: extraCycles = this.aby(); extraCycles += this.AND(); break;
            case 0x21: this.izx(); extraCycles = this.AND(); break;
            case 0x31: extraCycles = this.izy(); extraCycles += this.AND(); break;

            // ASL
            case 0x0A: this.imp(); this.ASL(); break;
            case 0x06: this.zp(); this.ASL(); break;
            case 0x16: this.zpx(); this.ASL(); break;
            case 0x0E: this.abs(); this.ASL(); break;
            case 0x1E: this.abx(); this.ASL(); break;

            // Branches
            case 0x90: this.rel(); this.BCC(); break;
            case 0xB0: this.rel(); this.BCS(); break;
            case 0xF0: this.rel(); this.BEQ(); break;
            case 0x30: this.rel(); this.BMI(); break;
            case 0xD0: this.rel(); this.BNE(); break;
            case 0x10: this.rel(); this.BPL(); break;
            case 0x50: this.rel(); this.BVC(); break;
            case 0x70: this.rel(); this.BVS(); break;

            // BIT
            case 0x24: this.zp(); this.BIT(); break;
            case 0x2C: this.abs(); this.BIT(); break;

            // BRK
            case 0x00: this.imp(); this.BRK(); break;

            // Clear flags
            case 0x18: this.imp(); this.CLC(); break;
            case 0xD8: this.imp(); this.CLD(); break;
            case 0x58: this.imp(); this.CLI(); break;
            case 0xB8: this.imp(); this.CLV(); break;

            // CMP
            case 0xC9: this.imm(); extraCycles = this.CMP(); break;
            case 0xC5: this.zp(); extraCycles = this.CMP(); break;
            case 0xD5: this.zpx(); extraCycles = this.CMP(); break;
            case 0xCD: this.abs(); extraCycles = this.CMP(); break;
            case 0xDD: extraCycles = this.abx(); extraCycles += this.CMP(); break;
            case 0xD9: extraCycles = this.aby(); extraCycles += this.CMP(); break;
            case 0xC1: this.izx(); extraCycles = this.CMP(); break;
            case 0xD1: extraCycles = this.izy(); extraCycles += this.CMP(); break;

            // CPX
            case 0xE0: this.imm(); this.CPX(); break;
            case 0xE4: this.zp(); this.CPX(); break;
            case 0xEC: this.abs(); this.CPX(); break;

            // CPY
            case 0xC0: this.imm(); this.CPY(); break;
            case 0xC4: this.zp(); this.CPY(); break;
            case 0xCC: this.abs(); this.CPY(); break;

            // DEC
            case 0xC6: this.zp(); this.DEC(); break;
            case 0xD6: this.zpx(); this.DEC(); break;
            case 0xCE: this.abs(); this.DEC(); break;
            case 0xDE: this.abx(); this.DEC(); break;

            // DEX/DEY
            case 0xCA: this.imp(); this.DEX(); break;
            case 0x88: this.imp(); this.DEY(); break;

            // EOR
            case 0x49: this.imm(); extraCycles = this.EOR(); break;
            case 0x45: this.zp(); extraCycles = this.EOR(); break;
            case 0x55: this.zpx(); extraCycles = this.EOR(); break;
            case 0x4D: this.abs(); extraCycles = this.EOR(); break;
            case 0x5D: extraCycles = this.abx(); extraCycles += this.EOR(); break;
            case 0x59: extraCycles = this.aby(); extraCycles += this.EOR(); break;
            case 0x41: this.izx(); extraCycles = this.EOR(); break;
            case 0x51: extraCycles = this.izy(); extraCycles += this.EOR(); break;

            // INC
            case 0xE6: this.zp(); this.INC(); break;
            case 0xF6: this.zpx(); this.INC(); break;
            case 0xEE: this.abs(); this.INC(); break;
            case 0xFE: this.abx(); this.INC(); break;

            // INX/INY
            case 0xE8: this.imp(); this.INX(); break;
            case 0xC8: this.imp(); this.INY(); break;

            // JMP
            case 0x4C: this.abs(); this.JMP(); break;
            case 0x6C: this.ind(); this.JMP(); break;

            // JSR
            case 0x20: this.abs(); this.JSR(); break;

            // LDA
            case 0xA9: this.imm(); extraCycles = this.LDA(); break;
            case 0xA5: this.zp(); extraCycles = this.LDA(); break;
            case 0xB5: this.zpx(); extraCycles = this.LDA(); break;
            case 0xAD: this.abs(); extraCycles = this.LDA(); break;
            case 0xBD: extraCycles = this.abx(); extraCycles += this.LDA(); break;
            case 0xB9: extraCycles = this.aby(); extraCycles += this.LDA(); break;
            case 0xA1: this.izx(); extraCycles = this.LDA(); break;
            case 0xB1: extraCycles = this.izy(); extraCycles += this.LDA(); break;

            // LDX
            case 0xA2: this.imm(); extraCycles = this.LDX(); break;
            case 0xA6: this.zp(); extraCycles = this.LDX(); break;
            case 0xB6: this.zpy(); extraCycles = this.LDX(); break;
            case 0xAE: this.abs(); extraCycles = this.LDX(); break;
            case 0xBE: extraCycles = this.aby(); extraCycles += this.LDX(); break;

            // LDY
            case 0xA0: this.imm(); extraCycles = this.LDY(); break;
            case 0xA4: this.zp(); extraCycles = this.LDY(); break;
            case 0xB4: this.zpx(); extraCycles = this.LDY(); break;
            case 0xAC: this.abs(); extraCycles = this.LDY(); break;
            case 0xBC: extraCycles = this.abx(); extraCycles += this.LDY(); break;

            // LSR
            case 0x4A: this.imp(); this.LSR(); break;
            case 0x46: this.zp(); this.LSR(); break;
            case 0x56: this.zpx(); this.LSR(); break;
            case 0x4E: this.abs(); this.LSR(); break;
            case 0x5E: this.abx(); this.LSR(); break;

            // NOP
            case 0xEA: this.imp(); this.NOP(); break;

            // ORA
            case 0x09: this.imm(); extraCycles = this.ORA(); break;
            case 0x05: this.zp(); extraCycles = this.ORA(); break;
            case 0x15: this.zpx(); extraCycles = this.ORA(); break;
            case 0x0D: this.abs(); extraCycles = this.ORA(); break;
            case 0x1D: extraCycles = this.abx(); extraCycles += this.ORA(); break;
            case 0x19: extraCycles = this.aby(); extraCycles += this.ORA(); break;
            case 0x01: this.izx(); extraCycles = this.ORA(); break;
            case 0x11: extraCycles = this.izy(); extraCycles += this.ORA(); break;

            // Stack ops
            case 0x48: this.imp(); this.PHA(); break;
            case 0x08: this.imp(); this.PHP(); break;
            case 0x68: this.imp(); this.PLA(); break;
            case 0x28: this.imp(); this.PLP(); break;

            // ROL
            case 0x2A: this.imp(); this.ROL(); break;
            case 0x26: this.zp(); this.ROL(); break;
            case 0x36: this.zpx(); this.ROL(); break;
            case 0x2E: this.abs(); this.ROL(); break;
            case 0x3E: this.abx(); this.ROL(); break;

            // ROR
            case 0x6A: this.imp(); this.ROR(); break;
            case 0x66: this.zp(); this.ROR(); break;
            case 0x76: this.zpx(); this.ROR(); break;
            case 0x6E: this.abs(); this.ROR(); break;
            case 0x7E: this.abx(); this.ROR(); break;

            // RTI/RTS
            case 0x40: this.imp(); this.RTI(); break;
            case 0x60: this.imp(); this.RTS(); break;

            // SBC
            case 0xE9: this.imm(); extraCycles = this.SBC(); break;
            case 0xE5: this.zp(); extraCycles = this.SBC(); break;
            case 0xF5: this.zpx(); extraCycles = this.SBC(); break;
            case 0xED: this.abs(); extraCycles = this.SBC(); break;
            case 0xFD: extraCycles = this.abx(); extraCycles += this.SBC(); break;
            case 0xF9: extraCycles = this.aby(); extraCycles += this.SBC(); break;
            case 0xE1: this.izx(); extraCycles = this.SBC(); break;
            case 0xF1: extraCycles = this.izy(); extraCycles += this.SBC(); break;

            // Set flags
            case 0x38: this.imp(); this.SEC(); break;
            case 0xF8: this.imp(); this.SED(); break;
            case 0x78: this.imp(); this.SEI(); break;

            // STA
            case 0x85: this.zp(); this.STA(); break;
            case 0x95: this.zpx(); this.STA(); break;
            case 0x8D: this.abs(); this.STA(); break;
            case 0x9D: this.abx(); this.STA(); break;
            case 0x99: this.aby(); this.STA(); break;
            case 0x81: this.izx(); this.STA(); break;
            case 0x91: this.izy(); this.STA(); break;

            // STX
            case 0x86: this.zp(); this.STX(); break;
            case 0x96: this.zpy(); this.STX(); break;
            case 0x8E: this.abs(); this.STX(); break;

            // STY
            case 0x84: this.zp(); this.STY(); break;
            case 0x94: this.zpx(); this.STY(); break;
            case 0x8C: this.abs(); this.STY(); break;

            // Transfers
            case 0xAA: this.imp(); this.TAX(); break;
            case 0xA8: this.imp(); this.TAY(); break;
            case 0xBA: this.imp(); this.TSX(); break;
            case 0x8A: this.imp(); this.TXA(); break;
            case 0x9A: this.imp(); this.TXS(); break;
            case 0x98: this.imp(); this.TYA(); break;

            default:
                // Illegal opcodes - treat as NOP
                this.imp();
                this.NOP();
                break;
        }

        // Base cycle counts per addressing mode
        const baseCycles: Record<number, number> = {
            0x69: 2, 0x65: 3, 0x75: 4, 0x6D: 4, 0x7D: 4, 0x79: 4, 0x61: 6, 0x71: 5,
            0x29: 2, 0x25: 3, 0x35: 4, 0x2D: 4, 0x3D: 4, 0x39: 4, 0x21: 6, 0x31: 5,
            0x0A: 2, 0x06: 5, 0x16: 6, 0x0E: 6, 0x1E: 7,
            0x90: 2, 0xB0: 2, 0xF0: 2, 0x30: 2, 0xD0: 2, 0x10: 2, 0x50: 2, 0x70: 2,
            0x24: 3, 0x2C: 4,
            0x00: 7,
            0x18: 2, 0xD8: 2, 0x58: 2, 0xB8: 2,
            0xC9: 2, 0xC5: 3, 0xD5: 4, 0xCD: 4, 0xDD: 4, 0xD9: 4, 0xC1: 6, 0xD1: 5,
            0xE0: 2, 0xE4: 3, 0xEC: 4,
            0xC0: 2, 0xC4: 3, 0xCC: 4,
            0xC6: 5, 0xD6: 6, 0xCE: 6, 0xDE: 7,
            0xCA: 2, 0x88: 2,
            0x49: 2, 0x45: 3, 0x55: 4, 0x4D: 4, 0x5D: 4, 0x59: 4, 0x41: 6, 0x51: 5,
            0xE6: 5, 0xF6: 6, 0xEE: 6, 0xFE: 7,
            0xE8: 2, 0xC8: 2,
            0x4C: 3, 0x6C: 5,
            0x20: 6,
            0xA9: 2, 0xA5: 3, 0xB5: 4, 0xAD: 4, 0xBD: 4, 0xB9: 4, 0xA1: 6, 0xB1: 5,
            0xA2: 2, 0xA6: 3, 0xB6: 4, 0xAE: 4, 0xBE: 4,
            0xA0: 2, 0xA4: 3, 0xB4: 4, 0xAC: 4, 0xBC: 4,
            0x4A: 2, 0x46: 5, 0x56: 6, 0x4E: 6, 0x5E: 7,
            0xEA: 2,
            0x09: 2, 0x05: 3, 0x15: 4, 0x0D: 4, 0x1D: 4, 0x19: 4, 0x01: 6, 0x11: 5,
            0x48: 3, 0x08: 3, 0x68: 4, 0x28: 4,
            0x2A: 2, 0x26: 5, 0x36: 6, 0x2E: 6, 0x3E: 7,
            0x6A: 2, 0x66: 5, 0x76: 6, 0x6E: 6, 0x7E: 7,
            0x40: 6, 0x60: 6,
            0xE9: 2, 0xE5: 3, 0xF5: 4, 0xED: 4, 0xFD: 4, 0xF9: 4, 0xE1: 6, 0xF1: 5,
            0x38: 2, 0xF8: 2, 0x78: 2,
            0x85: 3, 0x95: 4, 0x8D: 4, 0x9D: 5, 0x99: 5, 0x81: 6, 0x91: 6,
            0x86: 3, 0x96: 4, 0x8E: 4,
            0x84: 3, 0x94: 4, 0x8C: 4,
            0xAA: 2, 0xA8: 2, 0xBA: 2, 0x8A: 2, 0x9A: 2, 0x98: 2
        };

        const base = baseCycles[opcode] ?? 2;
        return base + extraCycles;
    }
}