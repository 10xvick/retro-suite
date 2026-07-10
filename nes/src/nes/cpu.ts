import { Bus } from './bus';

export enum Flags {
  C = 1 << 0, // Carry
  Z = 1 << 1, // Zero
  I = 1 << 2, // Interrupt Disable
  D = 1 << 3, // Decimal
  B = 1 << 4, // Break
  U = 1 << 5, // Unused (always 1)
  V = 1 << 6, // Overflow
  N = 1 << 7  // Negative
}

interface Instruction {
  name: string;
  operate: () => number;
  addrmode: () => number;
  addrmodeType: string;
  cycles: number;
}

export class CPU {
  private bus!: Bus;

  // Registers
  public a = 0x00;     // Accumulator
  public x = 0x00;     // X Index
  public y = 0x00;     // Y Index
  private _stkp = 0xFD;
  public get stkp(): number { return this._stkp; }
  public set stkp(val: number) { this._stkp = val & 0xFF; }
  public pc = 0x0000;  // Program Counter
  public status = 0x34; // Status Register (U and I set by default)

  // Tracking CPU cycles
  public cycles = 0;
  public dmaCycles = 0; // Cycles spent on OAM DMA transfer

  // Addressing mode variables
  private fetched = 0x00;
  private temp = 0x0000;
  private addrAbs = 0x0000;
  private addrRel = 0x0000;
  private opcode = 0x00;
  private basePage = 0x00;

  private lookup: Instruction[] = [];

  constructor(bus: Bus) {
    this.bus = bus;
    this.initLookupTable();
  }

  // Helper flags methods
  public getFlag(f: Flags): number {
    return (this.status & f) !== 0 ? 1 : 0;
  }

  public setFlag(f: Flags, v: boolean) {
    if (v) {
      this.status |= f;
    } else {
      this.status &= ~f;
    }
  }

  // Bus reads/writes
  public read(addr: number): number {
    return this.bus.cpuRead(addr);
  }

  public write(addr: number, data: number) {
    this.bus.cpuWrite(addr, data);
  }

  // Latch interrupt triggers
  public reset() {
    this.a = 0x00;
    this.x = 0x00;
    this.y = 0x00;
    this.stkp = 0xFD;
    this.status = 0x00 | Flags.I | Flags.U;

    // Load start address from vector 0xFFFC-FFFD
    this.addrAbs = 0xFFFC;
    const lo = this.read(this.addrAbs);
    const hi = this.read(this.addrAbs + 1);
    this.pc = (hi << 8) | lo;

    this.addrAbs = 0x0000;
    this.addrRel = 0x0000;
    this.fetched = 0x00;

    this.cycles = 8;
  }

  public nmi() {
    this.write(0x0100 + this.stkp, (this.pc >> 8) & 0x00FF);
    this.stkp--;
    this.write(0x0100 + this.stkp, this.pc & 0x00FF);
    this.stkp--;

    // Push status with Break clear and Unused set
    const statusToPush = (this.status & ~Flags.B) | Flags.U;
    this.write(0x0100 + this.stkp, statusToPush);
    this.stkp--;

    this.setFlag(Flags.I, true);

    this.addrAbs = 0xFFFA;
    const lo = this.read(this.addrAbs);
    const hi = this.read(this.addrAbs + 1);
    this.pc = (hi << 8) | lo;

    this.cycles = 8;
  }

  public irq() {
    if (this.getFlag(Flags.I) === 0) {
      this.write(0x0100 + this.stkp, (this.pc >> 8) & 0x00FF);
      this.stkp--;
      this.write(0x0100 + this.stkp, this.pc & 0x00FF);
      this.stkp--;

      // Push status with Break clear and Unused set
      const statusToPush = (this.status & ~Flags.B) | Flags.U;
      this.write(0x0100 + this.stkp, statusToPush);
      this.stkp--;

      this.setFlag(Flags.I, true);

      this.addrAbs = 0xFFFE;
      const lo = this.read(this.addrAbs);
      const hi = this.read(this.addrAbs + 1);
      this.pc = (hi << 8) | lo;

      this.cycles = 7;
    }
  }

  // Run a single CPU instruction clock step
  public clock() {
    if (this.dmaCycles > 0) {
      this.dmaCycles--;
      return;
    }

    if (this.cycles === 0) {
      // Check NMI interrupt first
      if (this.bus.ppu.nmiTriggered) {
        this.bus.ppu.nmiTriggered = false;
        this.nmi();
        return;
      }

      // Check IRQ interrupt (if not disabled)
      if (this.bus.cart && this.bus.cart.mapper.irqActive) {
        if (this.getFlag(Flags.I) === 0) {
          this.irq();
          return;
        }
      }

      this.opcode = this.read(this.pc);
      
      // Always set Unused flag to 1
      this.setFlag(Flags.U, true);
      
      this.pc++;

      const instr = this.lookup[this.opcode];
      if (!instr) {
        // Fallback for illegal opcodes to prevent crashes
        this.cycles = 2; // Treat as NOP
        return;
      }

      this.cycles = instr.cycles;

      const requireExtraCycle1 = instr.addrmode();
      const requireExtraCycle2 = instr.operate();

      this.cycles += (requireExtraCycle1 & requireExtraCycle2);
      this.setFlag(Flags.U, true);
    }

    this.cycles--;
  }

  // Fetch operand data
  private fetch(): number {
    const info = this.lookup[this.opcode];
    if (info && info.addrmodeType !== 'IMP') {
      this.fetched = this.read(this.addrAbs);
    }
    return this.fetched;
  }

  // -------------------------------------------------------------
  // ADDRESSING MODES (Return 1 if extra cycle potentially needed)
  // -------------------------------------------------------------
  
  private IMP(): number { // Implied
    this.fetched = this.a;
    return 0;
  }

  private IMM(): number { // Immediate
    this.addrAbs = this.pc++;
    return 0;
  }

  private ZP0(): number { // Zero Page
    this.addrAbs = this.read(this.pc);
    this.pc++;
    this.addrAbs &= 0x00FF;
    return 0;
  }

  private ZPX(): number { // Zero Page X
    this.addrAbs = (this.read(this.pc) + this.x);
    this.pc++;
    this.addrAbs &= 0x00FF;
    return 0;
  }

  private ZPY(): number { // Zero Page Y
    this.addrAbs = (this.read(this.pc) + this.y);
    this.pc++;
    this.addrAbs &= 0x00FF;
    return 0;
  }

  private REL(): number { // Relative for Branching
    const val = this.read(this.pc);
    this.pc++;
    this.addrRel = (val << 24) >> 24;
    return 0;
  }

  private ABS(): number { // Absolute
    const lo = this.read(this.pc);
    this.pc++;
    const hi = this.read(this.pc);
    this.pc++;
    this.addrAbs = (hi << 8) | lo;
    return 0;
  }

  private ABX(): number { // Absolute X
    const lo = this.read(this.pc);
    this.pc++;
    const hi = this.read(this.pc);
    this.pc++;
    this.basePage = hi;
    this.addrAbs = (hi << 8) | lo;
    this.addrAbs += this.x;
    this.addrAbs &= 0xFFFF;

    // Check page boundary crossing
    if ((this.addrAbs & 0xFF00) !== (hi << 8)) return 1;
    return 0;
  }

  private ABY(): number { // Absolute Y
    const lo = this.read(this.pc);
    this.pc++;
    const hi = this.read(this.pc);
    this.pc++;
    this.basePage = hi;
    this.addrAbs = (hi << 8) | lo;
    this.addrAbs += this.y;
    this.addrAbs &= 0xFFFF;

    // Check page boundary crossing
    if ((this.addrAbs & 0xFF00) !== (hi << 8)) return 1;
    return 0;
  }

  private IND(): number { // Indirect Jump Vector
    const lo = this.read(this.pc);
    this.pc++;
    const hi = this.read(this.pc);
    this.pc++;
    const ptr = (hi << 8) | lo;

    // Emulate 6502 indirect jump page wrap bug
    if (lo === 0x00FF) {
      this.addrAbs = (this.read(ptr & 0xFF00) << 8) | this.read(ptr);
    } else {
      this.addrAbs = (this.read((ptr + 1) & 0xFFFF) << 8) | this.read(ptr);
    }
    return 0;
  }

  private IZX(): number { // Indexed Indirect (X)
    const t = this.read(this.pc);
    this.pc++;
    const lo = this.read((t + this.x) & 0x00FF);
    const hi = this.read((t + this.x + 1) & 0x00FF);
    this.addrAbs = (hi << 8) | lo;
    return 0;
  }

  private IZY(): number { // Indirect Indexed (Y)
    const t = this.read(this.pc);
    this.pc++;
    const lo = this.read(t & 0x00FF);
    const hi = this.read((t + 1) & 0x00FF);
    this.basePage = hi;
    this.addrAbs = (hi << 8) | lo;
    this.addrAbs += this.y;
    this.addrAbs &= 0xFFFF;

    if ((this.addrAbs & 0xFF00) !== (hi << 8)) return 1;
    return 0;
  }

  // -------------------------------------------------------------
  // INSTRUCTION EXECUTIONS (Return 1 if extra cycle needed)
  // -------------------------------------------------------------

  private ADC(): number {
    this.fetch();
    this.temp = this.a + this.fetched + this.getFlag(Flags.C);
    
    this.setFlag(Flags.C, this.temp > 255);
    this.setFlag(Flags.Z, (this.temp & 0x00FF) === 0);
    this.setFlag(Flags.V, ((~(this.a ^ this.fetched) & (this.a ^ this.temp)) & 0x0080) !== 0);
    this.setFlag(Flags.N, (this.temp & 0x80) !== 0);
    
    this.a = this.temp & 0x00FF;
    return 1;
  }

  private SBC(): number {
    this.fetch();
    // SBC is simply ADC with inverted operand bits
    const value = this.fetched ^ 0x00FF;
    this.temp = this.a + value + this.getFlag(Flags.C);

    this.setFlag(Flags.C, this.temp > 255);
    this.setFlag(Flags.Z, (this.temp & 0x00FF) === 0);
    this.setFlag(Flags.V, ((~(this.a ^ value) & (this.a ^ this.temp)) & 0x0080) !== 0);
    this.setFlag(Flags.N, (this.temp & 0x80) !== 0);

    this.a = this.temp & 0x00FF;
    return 1;
  }

  private AND(): number {
    this.fetch();
    this.a = this.a & this.fetched;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 1;
  }

  private ORA(): number {
    this.fetch();
    this.a = this.a | this.fetched;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 1;
  }

  private EOR(): number {
    this.fetch();
    this.a = this.a ^ this.fetched;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 1;
  }

  private BIT(): number {
    this.fetch();
    this.temp = this.a & this.fetched;
    this.setFlag(Flags.Z, (this.temp & 0x00FF) === 0);
    this.setFlag(Flags.N, (this.fetched & (1 << 7)) !== 0);
    this.setFlag(Flags.V, (this.fetched & (1 << 6)) !== 0);
    return 0;
  }

  private Branch(condition: boolean): number {
    if (condition) {
      this.cycles++;
      this.addrAbs = (this.pc + this.addrRel) & 0xFFFF;
      
      // Page boundary cross adds another cycle
      if ((this.addrAbs & 0xFF00) !== (this.pc & 0xFF00)) {
        this.cycles++;
      }
      this.pc = this.addrAbs;
    }
    return 0;
  }

  private BCC(): number { return this.Branch(this.getFlag(Flags.C) === 0); }
  private BCS(): number { return this.Branch(this.getFlag(Flags.C) === 1); }
  private BEQ(): number { return this.Branch(this.getFlag(Flags.Z) === 1); }
  private BNE(): number { return this.Branch(this.getFlag(Flags.Z) === 0); }
  private BMI(): number { return this.Branch(this.getFlag(Flags.N) === 1); }
  private BPL(): number { return this.Branch(this.getFlag(Flags.N) === 0); }
  private BVC(): number { return this.Branch(this.getFlag(Flags.V) === 0); }
  private BVS(): number { return this.Branch(this.getFlag(Flags.V) === 1); }

  private CLC(): number { this.setFlag(Flags.C, false); return 0; }
  private SEC(): number { this.setFlag(Flags.C, true); return 0; }
  private CLI(): number { this.setFlag(Flags.I, false); return 0; }
  private SEI(): number { this.setFlag(Flags.I, true); return 0; }
  private CLD(): number { this.setFlag(Flags.D, false); return 0; }
  private SED(): number { this.setFlag(Flags.D, true); return 0; }
  private CLV(): number { this.setFlag(Flags.V, false); return 0; }

  private CMP(): number {
    this.fetch();
    this.temp = this.a - this.fetched;
    this.setFlag(Flags.C, this.a >= this.fetched);
    this.setFlag(Flags.Z, (this.temp & 0x00FF) === 0);
    this.setFlag(Flags.N, (this.temp & 0x0080) !== 0);
    return 1;
  }

  private CPX(): number {
    this.fetch();
    this.temp = this.x - this.fetched;
    this.setFlag(Flags.C, this.x >= this.fetched);
    this.setFlag(Flags.Z, (this.temp & 0x00FF) === 0);
    this.setFlag(Flags.N, (this.temp & 0x0080) !== 0);
    return 0;
  }

  private CPY(): number {
    this.fetch();
    this.temp = this.y - this.fetched;
    this.setFlag(Flags.C, this.y >= this.fetched);
    this.setFlag(Flags.Z, (this.temp & 0x00FF) === 0);
    this.setFlag(Flags.N, (this.temp & 0x0080) !== 0);
    return 0;
  }

  private DEC(): number {
    this.fetch();
    this.temp = (this.fetched - 1) & 0x00FF;
    this.write(this.addrAbs, this.temp);
    this.setFlag(Flags.Z, this.temp === 0);
    this.setFlag(Flags.N, (this.temp & 0x80) !== 0);
    return 0;
  }

  private DEX(): number {
    this.x = (this.x - 1) & 0xFF;
    this.setFlag(Flags.Z, this.x === 0);
    this.setFlag(Flags.N, (this.x & 0x80) !== 0);
    return 0;
  }

  private DEY(): number {
    this.y = (this.y - 1) & 0xFF;
    this.setFlag(Flags.Z, this.y === 0);
    this.setFlag(Flags.N, (this.y & 0x80) !== 0);
    return 0;
  }

  private INC(): number {
    this.fetch();
    this.temp = (this.fetched + 1) & 0x00FF;
    this.write(this.addrAbs, this.temp);
    this.setFlag(Flags.Z, this.temp === 0);
    this.setFlag(Flags.N, (this.temp & 0x80) !== 0);
    return 0;
  }

  private INX(): number {
    this.x = (this.x + 1) & 0xFF;
    this.setFlag(Flags.Z, this.x === 0);
    this.setFlag(Flags.N, (this.x & 0x80) !== 0);
    return 0;
  }

  private INY(): number {
    this.y = (this.y + 1) & 0xFF;
    this.setFlag(Flags.Z, this.y === 0);
    this.setFlag(Flags.N, (this.y & 0x80) !== 0);
    return 0;
  }

  private ASL(): number {
    this.fetch();
    this.temp = this.fetched << 1;
    this.setFlag(Flags.C, (this.temp & 0xFF00) !== 0);
    this.temp &= 0x00FF;
    this.setFlag(Flags.Z, this.temp === 0);
    this.setFlag(Flags.N, (this.temp & 0x80) !== 0);

    if (this.opcode === 0x0A) {
      this.a = this.temp;
    } else {
      this.write(this.addrAbs, this.temp);
    }
    return 0;
  }

  private LSR(): number {
    this.fetch();
    this.setFlag(Flags.C, (this.fetched & 0x0001) !== 0);
    this.temp = this.fetched >> 1;
    this.setFlag(Flags.Z, this.temp === 0);
    this.setFlag(Flags.N, false); // MSB is now 0

    if (this.opcode === 0x4A) {
      this.a = this.temp;
    } else {
      this.write(this.addrAbs, this.temp);
    }
    return 0;
  }

  private ROL(): number {
    this.fetch();
    this.temp = (this.fetched << 1) | this.getFlag(Flags.C);
    this.setFlag(Flags.C, (this.temp & 0xFF00) !== 0);
    this.temp &= 0x00FF;
    this.setFlag(Flags.Z, this.temp === 0);
    this.setFlag(Flags.N, (this.temp & 0x80) !== 0);

    if (this.opcode === 0x2A) {
      this.a = this.temp;
    } else {
      this.write(this.addrAbs, this.temp);
    }
    return 0;
  }

  private ROR(): number {
    this.fetch();
    this.temp = (this.getFlag(Flags.C) << 7) | (this.fetched >> 1);
    this.setFlag(Flags.C, (this.fetched & 0x0001) !== 0);
    this.setFlag(Flags.Z, this.temp === 0);
    this.setFlag(Flags.N, (this.temp & 0x80) !== 0);

    if (this.opcode === 0x6A) {
      this.a = this.temp;
    } else {
      this.write(this.addrAbs, this.temp);
    }
    return 0;
  }

  private JMP(): number { this.pc = this.addrAbs; return 0; }

  private JSR(): number {
    this.pc--; // Point to last byte of instruction
    this.write(0x0100 + this.stkp, (this.pc >> 8) & 0x00FF);
    this.stkp--;
    this.write(0x0100 + this.stkp, this.pc & 0x00FF);
    this.stkp--;
    
    this.pc = this.addrAbs;
    return 0;
  }

  private RTS(): number {
    this.stkp++;
    const lo = this.read(0x0100 + this.stkp);
    this.stkp++;
    const hi = this.read(0x0100 + this.stkp);
    
    this.pc = (((hi << 8) | lo) + 1) & 0xFFFF;
    return 0;
  }

  private RTI(): number {
    this.stkp++;
    this.status = this.read(0x0100 + this.stkp);
    this.setFlag(Flags.B, false);
    this.setFlag(Flags.U, true);
    
    this.stkp++;
    const lo = this.read(0x0100 + this.stkp);
    this.stkp++;
    const hi = this.read(0x0100 + this.stkp);

    this.pc = (hi << 8) | lo;
    return 0;
  }

  private PHA(): number {
    this.write(0x0100 + this.stkp, this.a);
    this.stkp--;
    return 0;
  }

  private PHP(): number {
    // PHP pushes status flags with B and U bits set to true
    this.write(0x0100 + this.stkp, this.status | Flags.B | Flags.U);
    this.stkp--;
    return 0;
  }

  private PLA(): number {
    this.stkp++;
    this.a = this.read(0x0100 + this.stkp);
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 0;
  }

  private PLP(): number {
    this.stkp++;
    this.status = this.read(0x0100 + this.stkp);
    this.setFlag(Flags.B, false);
    this.setFlag(Flags.U, true);
    return 0;
  }

  private LDA(): number {
    this.fetch();
    this.a = this.fetched;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 1;
  }

  private LDX(): number {
    this.fetch();
    this.x = this.fetched;
    this.setFlag(Flags.Z, this.x === 0);
    this.setFlag(Flags.N, (this.x & 0x80) !== 0);
    return 1;
  }

  private LDY(): number {
    this.fetch();
    this.y = this.fetched;
    this.setFlag(Flags.Z, this.y === 0);
    this.setFlag(Flags.N, (this.y & 0x80) !== 0);
    return 1;
  }

  private STA(): number { this.write(this.addrAbs, this.a); return 0; }
  private STX(): number { this.write(this.addrAbs, this.x); return 0; }
  private STY(): number { this.write(this.addrAbs, this.y); return 0; }

  private TAX(): number {
    this.x = this.a;
    this.setFlag(Flags.Z, this.x === 0);
    this.setFlag(Flags.N, (this.x & 0x80) !== 0);
    return 0;
  }

  private TAY(): number {
    this.y = this.a;
    this.setFlag(Flags.Z, this.y === 0);
    this.setFlag(Flags.N, (this.y & 0x80) !== 0);
    return 0;
  }

  private TSX(): number {
    this.x = this.stkp;
    this.setFlag(Flags.Z, this.x === 0);
    this.setFlag(Flags.N, (this.x & 0x80) !== 0);
    return 0;
  }

  private TXA(): number {
    this.a = this.x;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 0;
  }

  private TXS(): number { this.stkp = this.x; return 0; }

  private TYA(): number {
    this.a = this.y;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 0;
  }

  private NOP(): number { return 0; }
  private BRK(): number {
    this.pc++;
    
    this.write(0x0100 + this.stkp, (this.pc >> 8) & 0x00FF);
    this.stkp--;
    this.write(0x0100 + this.stkp, this.pc & 0x00FF);
    this.stkp--;

    // BRK pushes status with B and U bits set
    const statusToPush = this.status | Flags.B | Flags.U;
    this.write(0x0100 + this.stkp, statusToPush);
    this.stkp--;

    this.setFlag(Flags.I, true);

    this.addrAbs = 0xFFFE;
    const lo = this.read(this.addrAbs);
    const hi = this.read(this.addrAbs + 1);
    this.pc = (hi << 8) | lo;
    return 0;
  }

  // --- Unofficial Opcode Executions ---

  private LAX(): number {
    this.fetch();
    this.a = this.fetched;
    this.x = this.fetched;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 1;
  }

  private SAX(): number {
    this.write(this.addrAbs, this.a & this.x);
    return 0;
  }

  private DCP(): number {
    this.fetch();
    this.temp = (this.fetched - 1) & 0xFF;
    this.write(this.addrAbs, this.temp);
    
    const cmpVal = this.a - this.temp;
    this.setFlag(Flags.C, this.a >= this.temp);
    this.setFlag(Flags.Z, (cmpVal & 0xFF) === 0);
    this.setFlag(Flags.N, (cmpVal & 0x80) !== 0);
    return 0;
  }

  private ISB(): number {
    this.fetch();
    this.temp = (this.fetched + 1) & 0xFF;
    this.write(this.addrAbs, this.temp);
    
    const value = this.temp ^ 0x00FF;
    const sbcTemp = this.a + value + this.getFlag(Flags.C);
    this.setFlag(Flags.C, sbcTemp > 255);
    this.setFlag(Flags.Z, (sbcTemp & 0x00FF) === 0);
    this.setFlag(Flags.V, ((~(this.a ^ value) & (this.a ^ sbcTemp)) & 0x0080) !== 0);
    this.setFlag(Flags.N, (sbcTemp & 0x80) !== 0);
    this.a = sbcTemp & 0x00FF;
    return 0;
  }

  private SLO(): number {
    this.fetch();
    this.setFlag(Flags.C, (this.fetched & 0x80) !== 0);
    this.temp = (this.fetched << 1) & 0xFF;
    this.write(this.addrAbs, this.temp);
    this.a |= this.temp;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 0;
  }

  private RLA(): number {
    this.fetch();
    this.temp = (this.fetched << 1) | this.getFlag(Flags.C);
    this.setFlag(Flags.C, (this.temp & 0xFF00) !== 0);
    this.temp &= 0xFF;
    this.write(this.addrAbs, this.temp);
    this.a &= this.temp;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 0;
  }

  private SRE(): number {
    this.fetch();
    this.setFlag(Flags.C, (this.fetched & 0x01) !== 0);
    this.temp = this.fetched >> 1;
    this.write(this.addrAbs, this.temp);
    this.a ^= this.temp;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 0;
  }

  private RRA(): number {
    this.fetch();
    this.temp = (this.getFlag(Flags.C) << 7) | (this.fetched >> 1);
    this.setFlag(Flags.C, (this.fetched & 0x01) !== 0);
    this.write(this.addrAbs, this.temp);
    
    const adcTemp = this.a + this.temp + this.getFlag(Flags.C);
    this.setFlag(Flags.C, adcTemp > 255);
    this.setFlag(Flags.Z, (adcTemp & 0x00FF) === 0);
    this.setFlag(Flags.V, ((~(this.a ^ this.temp) & (this.a ^ adcTemp)) & 0x0080) !== 0);
    this.setFlag(Flags.N, (adcTemp & 0x80) !== 0);
    this.a = adcTemp & 0x00FF;
    return 0;
  }

  private ANC(): number {
    this.fetch();
    this.a &= this.fetched;
    this.setFlag(Flags.Z, this.a === 0);
    const isNeg = (this.a & 0x80) !== 0;
    this.setFlag(Flags.N, isNeg);
    this.setFlag(Flags.C, isNeg);
    return 0;
  }

  private ALR(): number {
    this.fetch();
    this.a &= this.fetched;
    this.setFlag(Flags.C, (this.a & 0x01) !== 0);
    this.a >>= 1;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, false);
    return 0;
  }

  private ARR(): number {
    this.fetch();
    const anded = this.a & this.fetched;
    this.a = (anded >> 1) | (this.getFlag(Flags.C) << 7);
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    const bit6 = (this.a & 0x40) !== 0;
    const bit5 = (this.a & 0x20) !== 0;
    this.setFlag(Flags.C, bit6);
    this.setFlag(Flags.V, bit6 !== bit5);
    return 0;
  }

  private XAA(): number {
    this.fetch();
    this.a = this.x & this.fetched;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 0;
  }

  private AXS(): number {
    this.fetch();
    const anded = this.a & this.x;
    const result = anded - this.fetched;
    this.x = result & 0xFF;
    this.setFlag(Flags.C, anded >= this.fetched);
    this.setFlag(Flags.Z, this.x === 0);
    this.setFlag(Flags.N, (this.x & 0x80) !== 0);
    return 0;
  }

  private LAS(): number {
    this.fetch();
    const val = this.stkp & this.fetched;
    this.a = val;
    this.x = val;
    this.stkp = val;
    this.setFlag(Flags.Z, val === 0);
    this.setFlag(Flags.N, (val & 0x80) !== 0);
    return 1;
  }

  private LXA(): number {
    this.fetch();
    this.a = (this.a | 0xFF) & this.fetched;
    this.x = this.a;
    this.setFlag(Flags.Z, this.a === 0);
    this.setFlag(Flags.N, (this.a & 0x80) !== 0);
    return 0;
  }

  private AHX(): number {
    const val = this.a & this.x & ((this.basePage + 1) & 0xFF);
    let targetAddr = this.addrAbs;
    if ((this.addrAbs & 0xFF00) !== (this.basePage << 8)) {
      targetAddr = (val << 8) | (this.addrAbs & 0xFF);
    }
    this.write(targetAddr, val);
    return 0;
  }

  private TAS(): number {
    this.stkp = this.a & this.x;
    const val = this.stkp & ((this.basePage + 1) & 0xFF);
    let targetAddr = this.addrAbs;
    if ((this.addrAbs & 0xFF00) !== (this.basePage << 8)) {
      targetAddr = (val << 8) | (this.addrAbs & 0xFF);
    }
    this.write(targetAddr, val);
    return 0;
  }

  private SHX(): number {
    const val = this.x & ((this.basePage + 1) & 0xFF);
    let targetAddr = this.addrAbs;
    if ((this.addrAbs & 0xFF00) !== (this.basePage << 8)) {
      targetAddr = (val << 8) | (this.addrAbs & 0xFF);
    }
    this.write(targetAddr, val);
    return 0;
  }

  private SHY(): number {
    const val = this.y & ((this.basePage + 1) & 0xFF);
    let targetAddr = this.addrAbs;
    if ((this.addrAbs & 0xFF00) !== (this.basePage << 8)) {
      targetAddr = (val << 8) | (this.addrAbs & 0xFF);
    }
    this.write(targetAddr, val);
    return 0;
  }

  private UNOP(): number {
    return 1;
  }

  // -------------------------------------------------------------
  // LOOKUP TABLE INITIALIZATION
  // -------------------------------------------------------------
  private initLookupTable() {
    // Fill with default NOP Implied
    const def = { name: "NOP", operate: this.NOP.bind(this), addrmode: this.IMP.bind(this), addrmodeType: "IMP", cycles: 2 };
    this.lookup = new Array(256).fill(null).map(() => ({ ...def }));

    // Define standard instructions
    const set = (op: number, name: string, operate: () => number, addrmode: () => number, cycles: number) => {
      this.lookup[op] = {
        name,
        operate: operate.bind(this),
        addrmode: addrmode.bind(this),
        addrmodeType: addrmode.name,
        cycles
      };
    };

    // ADC
    set(0x69, "ADC", this.ADC, this.IMM, 2); set(0x65, "ADC", this.ADC, this.ZP0, 3);
    set(0x75, "ADC", this.ADC, this.ZPX, 4); set(0x6D, "ADC", this.ADC, this.ABS, 4);
    set(0x7D, "ADC", this.ADC, this.ABX, 4); set(0x79, "ADC", this.ADC, this.ABY, 4);
    set(0x61, "ADC", this.ADC, this.IZX, 6); set(0x71, "ADC", this.ADC, this.IZY, 5);

    // AND
    set(0x29, "AND", this.AND, this.IMM, 2); set(0x25, "AND", this.AND, this.ZP0, 3);
    set(0x35, "AND", this.AND, this.ZPX, 4); set(0x2D, "AND", this.AND, this.ABS, 4);
    set(0x3D, "AND", this.AND, this.ABX, 4); set(0x39, "AND", this.AND, this.ABY, 4);
    set(0x21, "AND", this.AND, this.IZX, 6); set(0x31, "AND", this.AND, this.IZY, 5);

    // ASL
    set(0x0A, "ASL", this.ASL, this.IMP, 2); set(0x06, "ASL", this.ASL, this.ZP0, 5);
    set(0x16, "ASL", this.ASL, this.ZPX, 6); set(0x0E, "ASL", this.ASL, this.ABS, 6);
    set(0x1E, "ASL", this.ASL, this.ABX, 7);

    // BIT
    set(0x24, "BIT", this.BIT, this.ZP0, 3); set(0x2C, "BIT", this.BIT, this.ABS, 4);

    // Branches
    set(0x10, "BPL", this.BPL, this.REL, 2); set(0x30, "BMI", this.BMI, this.REL, 2);
    set(0x50, "BVC", this.BVC, this.REL, 2); set(0x70, "BVS", this.BVS, this.REL, 2);
    set(0x90, "BCC", this.BCC, this.REL, 2); set(0xB0, "BCS", this.BCS, this.REL, 2);
    set(0xD0, "BNE", this.BNE, this.REL, 2); set(0xF0, "BEQ", this.BEQ, this.REL, 2);

    // BRK
    set(0x00, "BRK", this.BRK, this.IMP, 7);

    // Flags
    set(0x18, "CLC", this.CLC, this.IMP, 2); set(0x38, "SEC", this.SEC, this.IMP, 2);
    set(0x58, "CLI", this.CLI, this.IMP, 2); set(0x78, "SEI", this.SEI, this.IMP, 2);
    set(0xB8, "CLV", this.CLV, this.IMP, 2); set(0xD8, "CLD", this.CLD, this.IMP, 2);
    set(0xF8, "SED", this.SED, this.IMP, 2);

    // CMP
    set(0xC9, "CMP", this.CMP, this.IMM, 2); set(0xC5, "CMP", this.CMP, this.ZP0, 3);
    set(0xD5, "CMP", this.CMP, this.ZPX, 4); set(0xCD, "CMP", this.CMP, this.ABS, 4);
    set(0xDD, "CMP", this.CMP, this.ABX, 4); set(0xD9, "CMP", this.CMP, this.ABY, 4);
    set(0xC1, "CMP", this.CMP, this.IZX, 6); set(0xD1, "CMP", this.CMP, this.IZY, 5);

    // CPX
    set(0xE0, "CPX", this.CPX, this.IMM, 2); set(0xE4, "CPX", this.CPX, this.ZP0, 3);
    set(0xEC, "CPX", this.CPX, this.ABS, 4);

    // CPY
    set(0xC0, "CPY", this.CPY, this.IMM, 2); set(0xC4, "CPY", this.CPY, this.ZP0, 3);
    set(0xCC, "CPY", this.CPY, this.ABS, 4);

    // DEC
    set(0xC6, "DEC", this.DEC, this.ZP0, 5); set(0xD6, "DEC", this.DEC, this.ZPX, 6);
    set(0xCE, "DEC", this.DEC, this.ABS, 6); set(0xDE, "DEC", this.DEC, this.ABX, 7);
    set(0xCA, "DEX", this.DEX, this.IMP, 2); set(0x88, "DEY", this.DEY, this.IMP, 2);

    // EOR
    set(0x49, "EOR", this.EOR, this.IMM, 2); set(0x45, "EOR", this.EOR, this.ZP0, 3);
    set(0x55, "EOR", this.EOR, this.ZPX, 4); set(0x4D, "EOR", this.EOR, this.ABS, 4);
    set(0x5D, "EOR", this.EOR, this.ABX, 4); set(0x59, "EOR", this.EOR, this.ABY, 4);
    set(0x41, "EOR", this.EOR, this.IZX, 6); set(0x51, "EOR", this.EOR, this.IZY, 5);

    // INC
    set(0xE6, "INC", this.INC, this.ZP0, 5); set(0xF6, "INC", this.INC, this.ZPX, 6);
    set(0xEE, "INC", this.INC, this.ABS, 6); set(0xFE, "INC", this.INC, this.ABX, 7);
    set(0xE8, "INX", this.INX, this.IMP, 2); set(0xC8, "INY", this.INY, this.IMP, 2);

    // JMP
    set(0x4C, "JMP", this.JMP, this.ABS, 3); set(0x6C, "JMP", this.JMP, this.IND, 5);

    // JSR
    set(0x20, "JSR", this.JSR, this.ABS, 6);
    
    // RTS
    set(0x60, "RTS", this.RTS, this.IMP, 6);

    // LDA
    set(0xA9, "LDA", this.LDA, this.IMM, 2); set(0xA5, "LDA", this.LDA, this.ZP0, 3);
    set(0xB5, "LDA", this.LDA, this.ZPX, 4); set(0xAD, "LDA", this.LDA, this.ABS, 4);
    set(0xBD, "LDA", this.LDA, this.ABX, 4); set(0xB9, "LDA", this.LDA, this.ABY, 4);
    set(0xA1, "LDA", this.LDA, this.IZX, 6); set(0xB1, "LDA", this.LDA, this.IZY, 5);

    // LDX
    set(0xA2, "LDX", this.LDX, this.IMM, 2); set(0xA6, "LDX", this.LDX, this.ZP0, 3);
    set(0xB6, "LDX", this.LDX, this.ZPY, 4); set(0xAE, "LDX", this.LDX, this.ABS, 4);
    set(0xBE, "LDX", this.LDX, this.ABY, 4);

    // LDY
    set(0xA0, "LDY", this.LDY, this.IMM, 2); set(0xA4, "LDY", this.LDY, this.ZP0, 3);
    set(0xB4, "LDY", this.LDY, this.ZPX, 4); set(0xAC, "LDY", this.LDY, this.ABS, 4);
    set(0xBC, "LDY", this.LDY, this.ABX, 4);

    // LSR
    set(0x4A, "LSR", this.LSR, this.IMP, 2); set(0x46, "LSR", this.LSR, this.ZP0, 5);
    set(0x56, "LSR", this.LSR, this.ZPX, 6); set(0x4E, "LSR", this.LSR, this.ABS, 6);
    set(0x5E, "LSR", this.LSR, this.ABX, 7);

    // NOPs
    set(0xEA, "NOP", this.NOP, this.IMP, 2);

    // ORA
    set(0x09, "ORA", this.ORA, this.IMM, 2); set(0x05, "ORA", this.ORA, this.ZP0, 3);
    set(0x15, "ORA", this.ORA, this.ZPX, 4); set(0x0D, "ORA", this.ORA, this.ABS, 4);
    set(0x1D, "ORA", this.ORA, this.ABX, 4); set(0x19, "ORA", this.ORA, this.ABY, 4);
    set(0x01, "ORA", this.ORA, this.IZX, 6); set(0x11, "ORA", this.ORA, this.IZY, 5);

    // Stack PHA / PHP / PLA / PLP
    set(0x48, "PHA", this.PHA, this.IMP, 3); set(0x08, "PHP", this.PHP, this.IMP, 3);
    set(0x68, "PLA", this.PLA, this.IMP, 4); set(0x28, "PLP", this.PLP, this.IMP, 4);

    // ROL
    set(0x2A, "ROL", this.ROL, this.IMP, 2); set(0x26, "ROL", this.ROL, this.ZP0, 5);
    set(0x36, "ROL", this.ROL, this.ZPX, 6); set(0x2E, "ROL", this.ROL, this.ABS, 6);
    set(0x3E, "ROL", this.ROL, this.ABX, 7);

    // ROR
    set(0x6A, "ROR", this.ROR, this.IMP, 2); set(0x66, "ROR", this.ROR, this.ZP0, 5);
    set(0x76, "ROR", this.ROR, this.ZPX, 6); set(0x6E, "ROR", this.ROR, this.ABS, 6);
    set(0x7E, "ROR", this.ROR, this.ABX, 7);

    // RTI
    set(0x40, "RTI", this.RTI, this.IMP, 6);

    // SBC
    set(0xE9, "SBC", this.SBC, this.IMM, 2); set(0xE5, "SBC", this.SBC, this.ZP0, 3);
    set(0xF5, "SBC", this.SBC, this.ZPX, 4); set(0xED, "SBC", this.SBC, this.ABS, 4);
    set(0xFD, "SBC", this.SBC, this.ABX, 4); set(0xF9, "SBC", this.SBC, this.ABY, 4);
    set(0xE1, "SBC", this.SBC, this.IZX, 6); set(0xF1, "SBC", this.SBC, this.IZY, 5);

    // STA
    set(0x85, "STA", this.STA, this.ZP0, 3); set(0x95, "STA", this.STA, this.ZPX, 4);
    set(0x8D, "STA", this.STA, this.ABS, 4); set(0x9D, "STA", this.STA, this.ABX, 5);
    set(0x99, "STA", this.STA, this.ABY, 5); set(0x81, "STA", this.STA, this.IZX, 6);
    set(0x91, "STA", this.STA, this.IZY, 6);

    // STX
    set(0x86, "STX", this.STX, this.ZP0, 3); set(0x96, "STX", this.STX, this.ZPY, 4);
    set(0x8E, "STX", this.STX, this.ABS, 4);

    // STY
    set(0x84, "STY", this.STY, this.ZP0, 3); set(0x94, "STY", this.STY, this.ZPX, 4);
    set(0x8C, "STY", this.STY, this.ABS, 4);

    // Transfers
    set(0xAA, "TAX", this.TAX, this.IMP, 2); set(0x8A, "TXA", this.TXA, this.IMP, 2);
    set(0xA8, "TAY", this.TAY, this.IMP, 2); set(0x98, "TYA", this.TYA, this.IMP, 2);
    set(0xBA, "TSX", this.TSX, this.IMP, 2); set(0x9A, "TXS", this.TXS, this.IMP, 2);

    // --- Unofficial Opcodes ---

    // *NOP
    set(0x04, "*NOP", this.UNOP, this.ZP0, 3);
    set(0x44, "*NOP", this.UNOP, this.ZP0, 3);
    set(0x64, "*NOP", this.UNOP, this.ZP0, 3);
    set(0x0C, "*NOP", this.UNOP, this.ABS, 4);
    set(0x14, "*NOP", this.UNOP, this.ZPX, 4);
    set(0x34, "*NOP", this.UNOP, this.ZPX, 4);
    set(0x54, "*NOP", this.UNOP, this.ZPX, 4);
    set(0x74, "*NOP", this.UNOP, this.ZPX, 4);
    set(0xD4, "*NOP", this.UNOP, this.ZPX, 4);
    set(0xF4, "*NOP", this.UNOP, this.ZPX, 4);
    set(0x1A, "*NOP", this.UNOP, this.IMP, 2);
    set(0x3A, "*NOP", this.UNOP, this.IMP, 2);
    set(0x5A, "*NOP", this.UNOP, this.IMP, 2);
    set(0x7A, "*NOP", this.UNOP, this.IMP, 2);
    set(0xDA, "*NOP", this.UNOP, this.IMP, 2);
    set(0xFA, "*NOP", this.UNOP, this.IMP, 2);
    set(0x80, "*NOP", this.UNOP, this.IMM, 2);
    set(0x82, "*NOP", this.UNOP, this.IMM, 2);
    set(0x89, "*NOP", this.UNOP, this.IMM, 2);
    set(0xC2, "*NOP", this.UNOP, this.IMM, 2);
    set(0xE2, "*NOP", this.UNOP, this.IMM, 2);
    set(0x1C, "*NOP", this.UNOP, this.ABX, 4);
    set(0x3C, "*NOP", this.UNOP, this.ABX, 4);
    set(0x5C, "*NOP", this.UNOP, this.ABX, 4);
    set(0x7C, "*NOP", this.UNOP, this.ABX, 4);
    set(0xDC, "*NOP", this.UNOP, this.ABX, 4);
    set(0xFC, "*NOP", this.UNOP, this.ABX, 4);

    // *LAX
    set(0xA7, "*LAX", this.LAX, this.ZP0, 3);
    set(0xB7, "*LAX", this.LAX, this.ZPY, 4);
    set(0xAF, "*LAX", this.LAX, this.ABS, 4);
    set(0xBF, "*LAX", this.LAX, this.ABY, 4);
    set(0xA3, "*LAX", this.LAX, this.IZX, 6);
    set(0xB3, "*LAX", this.LAX, this.IZY, 5);

    // *SAX
    set(0x87, "*SAX", this.SAX, this.ZP0, 3);
    set(0x97, "*SAX", this.SAX, this.ZPY, 4);
    set(0x8F, "*SAX", this.SAX, this.ABS, 4);
    set(0x83, "*SAX", this.SAX, this.IZX, 6);

    // *SBC
    set(0xEB, "*SBC", this.SBC, this.IMM, 2);

    // *DCP
    set(0xC7, "*DCP", this.DCP, this.ZP0, 5);
    set(0xD7, "*DCP", this.DCP, this.ZPX, 6);
    set(0xCF, "*DCP", this.DCP, this.ABS, 6);
    set(0xDF, "*DCP", this.DCP, this.ABX, 7);
    set(0xDB, "*DCP", this.DCP, this.ABY, 7);
    set(0xC3, "*DCP", this.DCP, this.IZX, 8);
    set(0xD3, "*DCP", this.DCP, this.IZY, 8);

    // *ISB
    set(0xE7, "*ISB", this.ISB, this.ZP0, 5);
    set(0xF7, "*ISB", this.ISB, this.ZPX, 6);
    set(0xEF, "*ISB", this.ISB, this.ABS, 6);
    set(0xFF, "*ISB", this.ISB, this.ABX, 7);
    set(0xFB, "*ISB", this.ISB, this.ABY, 7);
    set(0xE3, "*ISB", this.ISB, this.IZX, 8);
    set(0xF3, "*ISB", this.ISB, this.IZY, 8);

    // *SLO
    set(0x07, "*SLO", this.SLO, this.ZP0, 5);
    set(0x17, "*SLO", this.SLO, this.ZPX, 6);
    set(0x0F, "*SLO", this.SLO, this.ABS, 6);
    set(0x1F, "*SLO", this.SLO, this.ABX, 7);
    set(0x1B, "*SLO", this.SLO, this.ABY, 7);
    set(0x03, "*SLO", this.SLO, this.IZX, 8);
    set(0x13, "*SLO", this.SLO, this.IZY, 8);

    // *RLA
    set(0x27, "*RLA", this.RLA, this.ZP0, 5);
    set(0x37, "*RLA", this.RLA, this.ZPX, 6);
    set(0x2F, "*RLA", this.RLA, this.ABS, 6);
    set(0x3F, "*RLA", this.RLA, this.ABX, 7);
    set(0x3B, "*RLA", this.RLA, this.ABY, 7);
    set(0x23, "*RLA", this.RLA, this.IZX, 8);
    set(0x33, "*RLA", this.RLA, this.IZY, 8);

    // *SRE
    set(0x47, "*SRE", this.SRE, this.ZP0, 5);
    set(0x57, "*SRE", this.SRE, this.ZPX, 6);
    set(0x4F, "*SRE", this.SRE, this.ABS, 6);
    set(0x5F, "*SRE", this.SRE, this.ABX, 7);
    set(0x5B, "*SRE", this.SRE, this.ABY, 7);
    set(0x43, "*SRE", this.SRE, this.IZX, 8);
    set(0x53, "*SRE", this.SRE, this.IZY, 8);

    // *RRA
    set(0x67, "*RRA", this.RRA, this.ZP0, 5);
    set(0x77, "*RRA", this.RRA, this.ZPX, 6);
    set(0x6F, "*RRA", this.RRA, this.ABS, 6);
    set(0x7F, "*RRA", this.RRA, this.ABX, 7);
    set(0x7B, "*RRA", this.RRA, this.ABY, 7);
    set(0x63, "*RRA", this.RRA, this.IZX, 8);
    set(0x73, "*RRA", this.RRA, this.IZY, 8);

    // *ANC
    set(0x0B, "*ANC", this.ANC, this.IMM, 2);
    set(0x2B, "*ANC", this.ANC, this.IMM, 2);

    // *ALR
    set(0x4B, "*ALR", this.ALR, this.IMM, 2);

    // *ARR
    set(0x6B, "*ARR", this.ARR, this.IMM, 2);

    // *XAA
    set(0x8B, "*XAA", this.XAA, this.IMM, 2);

    // *AXS
    set(0xCB, "*AXS", this.AXS, this.IMM, 2);

    // *LAS
    set(0xBB, "*LAS", this.LAS, this.ABY, 4);

    // *ATX
    set(0xAB, "*ATX", this.LXA, this.IMM, 2);

    // *AHX / *TAS / *SHX / *SHY
    set(0x93, "*AHX", this.AHX, this.IZY, 6);
    set(0x9F, "*AHX", this.AHX, this.ABY, 5);
    set(0x9B, "*TAS", this.TAS, this.ABY, 5);
    set(0x9E, "*SHX", this.SHX, this.ABY, 5);
    set(0x9C, "*SHY", this.SHY, this.ABX, 5);
  }
}
