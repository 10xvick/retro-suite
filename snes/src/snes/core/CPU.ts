import { Bus } from './Bus';
import { Disassembler } from './Disassembler';

// Processor Status Flags (P Register)
export enum CPUFlags {
  Carry = 0x01,
  Zero = 0x02,
  InterruptDisable = 0x04,
  Decimal = 0x08,
  IndexSize = 0x10,       // 0 = 16-bit, 1 = 8-bit (Native mode only)
  AccumulatorSize = 0x20, // 0 = 16-bit, 1 = 8-bit (Native mode only)
  Overflow = 0x40,
  Negative = 0x80
}

export class CPU {
  private bus: Bus;

  // Registers
  public a: number = 0;   // Accumulator (8-bit or 16-bit)
  public x: number = 0;   // X Index Register (8-bit or 16-bit)
  public y: number = 0;   // Y Index Register (8-bit or 16-bit)
  public s: number = 0;   // Stack Pointer (16-bit)
  public d: number = 0;   // Direct Page Register (16-bit)
  public db: number = 0;  // Data Bank Register (8-bit)
  public pb: number = 0;  // Program Bank Register (8-bit)
  public p: number = 0;   // Status Register (8-bit)
  public pc: number = 0;
  public pcHistory: number[] = new Array(100).fill(0);
  public pcHistoryIdx: number = 0;  // Program Counter (16-bit)

  public e: number = 1;   // Emulation Mode flag (0 = Native, 1 = Emulation)

  // Diagnostics / debugger helpers
  public cycles: number = 0;
  public totalCycles: number = 0;
  public lastInstructionDisassembly: string = '';
  public lastInstructionAddress: number = 0;
  public lastInstructionBank: number = 0;

  // WAI (Wait for Interrupt) state — CPU halts here until NMI/IRQ fires
  public waiting: boolean = false;

  // NMI pending latch — set by frame loop at VBlank, cleared when NMI is serviced
  public nmiPending: boolean = false;

  constructor(bus: Bus) {
    this.bus = bus;
    this.bus.cpu = this;
    this.reset();
  }

  public reset() {
    this.e = 1; // Start in 6502 Emulation mode
    
    // Status flags initial: Index and Accumulator select are set to 8-bit in Emulation mode
    this.p = CPUFlags.InterruptDisable | CPUFlags.IndexSize | CPUFlags.AccumulatorSize;
    
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.s = 0x01FF; // Stack starts at page 1 ($0100 - $01FF) in Emulation mode
    this.d = 0;
    this.db = 0;
    this.pb = 0;

    // Fetch RESET vector from vector table at $00:FFFC-$00:FFFD
    this.pc = this.bus.readWord(0, 0xFFFC);
    if (this.pc === 0) {
      this.pc = 0x8000; // Fallback to start of LoROM Bank 0
    }
    
    this.cycles = 0;
    this.totalCycles = 0;
    this.waiting = false;
    this.nmiPending = false;
    this.lastInstructionDisassembly = 'RESET';
    this.lastInstructionAddress = this.pc;
    this.lastInstructionBank = this.pb;
  }

  // Helpers to check status flags
  public getFlag(flag: CPUFlags): boolean {
    return (this.p & flag) !== 0;
  }

  public setFlag(flag: CPUFlags, value: boolean) {
    if (value) {
      this.p |= flag;
    } else {
      this.p &= ~flag;
    }
    if (flag === CPUFlags.IndexSize && value) {
      this.updateRegisterSizes();
    }
  }

  // Determine Accumulator width (8-bit or 16-bit)
  // Accumulator is 8-bit if Emulation Mode is active, OR if Native Mode has A-size flag set.
  public isAcc8(): boolean {
    return this.e === 1 || this.getFlag(CPUFlags.AccumulatorSize);
  }

  // Determine Index registers width (8-bit or 16-bit)
  public isIndex8(): boolean {
    return this.e === 1 || this.getFlag(CPUFlags.IndexSize);
  }

  private updateRegisterSizes() {
    if (this.isIndex8()) {
      this.x &= 0xFF;
      this.y &= 0xFF;
    }
  }

  // Set Negative and Zero flags based on result (8-bit or 16-bit size checks)
  private updateNZFlags(val: number, is8Bit: boolean) {
    const mask = is8Bit ? 0xFF : 0xFFFF;
    const signBit = is8Bit ? 0x80 : 0x8000;
    val &= mask;
    this.setFlag(CPUFlags.Zero, val === 0);
    this.setFlag(CPUFlags.Negative, (val & signBit) !== 0);
  }

  // Bus helpers
  public read(bank: number, addr: number): number {
    return this.bus.readByte(bank, addr);
  }

  public write(bank: number, addr: number, val: number) {
    this.bus.writeByte(bank, addr, val);
  }

  // Read word/byte based on register width
  private readOperandByte(): number {
    const val = this.read(this.pb, this.pc);
    this.pc = (this.pc + 1) & 0xFFFF;
    return val;
  }

  private readOperandWord(): number {
    const low = this.readOperandByte();
    const high = this.readOperandByte();
    return low | (high << 8);
  }

  // Push values to Stack (respecting Emulation vs Native stack limits)
  private pushByte(val: number) {
    this.write(0, this.s, val);
    if (this.e === 1) {
      // Emulation mode Stack is hardlocked to page 1 ($0100-$01FF)
      const low = (this.s - 1) & 0xFF;
      this.s = 0x0100 | low;
    } else {
      this.s = (this.s - 1) & 0xFFFF;
    }
  }

  private pushWord(val: number) {
    this.pushByte((val >> 8) & 0xFF);
    this.pushByte(val & 0xFF);
  }

  // Pop values from Stack
  private popByte(): number {
    if (this.e === 1) {
      const low = (this.s + 1) & 0xFF;
      this.s = 0x0100 | low;
    } else {
      this.s = (this.s + 1) & 0xFFFF;
    }
    return this.read(0, this.s);
  }

  private popWord(): number {
    const low = this.popByte();
    const high = this.popByte();
    return low | (high << 8);
  }

  // Execute a single step of the CPU
  public step(): number {
    // Check for pending NMI at instruction boundary
    if (this.nmiPending && this.bus.nmiEnabled) {
      this.nmiPending = false;
      const cycles = this.e === 1 ? 8 : 7;
      this.cycles += cycles;
      this.totalCycles += cycles;
      this.triggerNmi();
      return this.cycles;
    }

    this.pcHistory[this.pcHistoryIdx] = this.pc;
    this.pcHistoryIdx = (this.pcHistoryIdx + 1) % 100;
    // If CPU is halted via WAI, spin until NMI/IRQ wakes it
    if (this.waiting) {
      // Allow NMI to wake the CPU
      if (this.nmiPending && this.bus.nmiEnabled) {
        this.nmiPending = false;
        const cycles = this.e === 1 ? 8 : 7;
        this.cycles += cycles;
        this.totalCycles += cycles;
        this.triggerNmi();
        return this.cycles;
      }
      // Allow a pending IRQ to wake the CPU
      if (this.bus.irqActive && (this.p & CPUFlags.InterruptDisable) === 0) {
        this.waiting = false;
        this.triggerIrq();
        const cycles = this.e === 1 ? 8 : 7;
        this.cycles += cycles;
        this.totalCycles += cycles;
        return this.cycles;
      }
      // Still waiting — consume minimal cycles without advancing PC
      this.cycles += 2;
      this.totalCycles += 2;
      return 2;
    }

    // Check for pending NMI again (in case it was set while not in WAI)
    if (this.nmiPending && this.bus.nmiEnabled) {
      this.nmiPending = false;
      const cycles = this.e === 1 ? 8 : 7;
      this.cycles += cycles;
      this.totalCycles += cycles;
      this.triggerNmi();
      return this.cycles;
    }

    // Check for pending IRQ
    if (this.bus.irqActive && (this.p & CPUFlags.InterruptDisable) === 0) {
      this.triggerIrq();
      const cycles = this.e === 1 ? 8 : 7;
      this.cycles += cycles;
      this.totalCycles += cycles;
      return this.cycles;
    }

    const startPc = this.pc;
    const startPb = this.pb;
    
    // Log history
    this.lastInstructionAddress = startPc;
    this.lastInstructionBank = startPb;

    // Fetch Opcode
    const opcode = this.readOperandByte();
    let opCycles = 2; // Default cycles

    switch (opcode) {
      // --- BRK: Software Break
      case 0x00: { // BRK
        // BRK is a 2-byte instruction, skip the signature byte
        const returnPc = (this.pc + 1) & 0xFFFF;
        this.pc = returnPc;

        if (this.e === 0) {
          // Native mode: push PB, PC, P
          this.pushByte(this.pb);
          this.pushWord(returnPc);
          this.pushByte(this.p);
        } else {
          // Emulation mode: push PC, P (with B flag set on stack)
          this.pushWord(returnPc);
          this.pushByte(this.p | 0x10); // Set Break flag (bit 4) on stack
        }

        // Set Interrupt Disable and Clear Decimal Mode
        this.setFlag(CPUFlags.InterruptDisable, true);
        this.setFlag(CPUFlags.Decimal, false);

        this.pb = 0;
        const vectorAddr = this.e === 1 ? 0xFFFE : 0xFFE6;
        this.pc = this.bus.readWord(0, vectorAddr);
        opCycles = this.e === 1 ? 8 : 7;
        break;
      }

      // --- SEP: Set Status Bits (REP/SEP is how 65816 sets 8-bit/16-bit register sizes)
      case 0xE2: { // SEP #imm
        const mask = this.readOperandByte();
        this.p |= mask;
        // In Emulation mode index/acc size remains 8-bit
        if (this.e === 1) {
          this.p |= CPUFlags.IndexSize | CPUFlags.AccumulatorSize;
        }
        this.updateRegisterSizes();
        opCycles = 3;
        break;
      }
      // --- REP: Reset Status Bits
      case 0xC2: { // REP #imm
        const mask = this.readOperandByte();
        this.p &= ~mask;
        if (this.e === 1) {
          this.p |= CPUFlags.IndexSize | CPUFlags.AccumulatorSize;
        }
        this.updateRegisterSizes();
        opCycles = 3;
        break;
      }
      // --- SEC: Set Carry
      case 0x38: {
        this.setFlag(CPUFlags.Carry, true);
        opCycles = 2;
        break;
      }
      // --- CLC: Clear Carry
      case 0x18: {
        this.setFlag(CPUFlags.Carry, false);
        opCycles = 2;
        break;
      }
      // --- SED: Set Decimal Mode
      case 0xF8: {
        this.setFlag(CPUFlags.Decimal, true);
        opCycles = 2;
        break;
      }
      // --- CLD: Clear Decimal Mode
      case 0xD8: {
        this.setFlag(CPUFlags.Decimal, false);
        opCycles = 2;
        break;
      }
      // --- SEI: Set Interrupt Disable
      case 0x78: {
        this.setFlag(CPUFlags.InterruptDisable, true);
        opCycles = 2;
        break;
      }
      // --- CLI: Clear Interrupt Disable
      case 0x58: {
        this.setFlag(CPUFlags.InterruptDisable, false);
        opCycles = 2;
        break;
      }
      // --- XCE: Exchange Carry & Emulation (crucial for Native Mode transitions!)
      case 0xFB: {
        const carry = this.getFlag(CPUFlags.Carry) ? 1 : 0;
        const emu = this.e;
        this.e = carry;
        this.setFlag(CPUFlags.Carry, emu === 1);
        if (this.e === 1) {
          // Force registers back to 8-bit in emulation mode
          this.p |= CPUFlags.IndexSize | CPUFlags.AccumulatorSize;
          this.s = (this.s & 0xFF) | 0x0100;
        }
        this.updateRegisterSizes();
        opCycles = 6;
        break;
      }
      
      // --- NOP: No Operation
      case 0xEA: {
        opCycles = 2;
        break;
      }

      // --- LDA: Load Accumulator
      case 0xA3: { // LDA sr, S
        const offset = this.readOperandByte();
        const addr = (this.s + offset) & 0xFFFF;
        if (this.isAcc8()) {
          this.a = (this.a & 0xFF00) | this.read(0, addr);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 4;
        } else {
          this.a = this.read(0, addr) | (this.read(0, (addr + 1) & 0xFFFF) << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 5;
        }
        break;
      }
      case 0xA9: { // LDA #imm (8 or 16 bit)
        if (this.isAcc8()) {
          this.a = (this.a & 0xFF00) | this.readOperandByte();
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 2;
        } else {
          this.a = this.readOperandWord();
          this.updateNZFlags(this.a, false);
          opCycles = 3;
        }
        break;
      }
      case 0xAD: { // LDA abs ($FFFF)
        const addr = this.readOperandWord();
        const bank = this.db;
        if (this.isAcc8()) {
          this.a = (this.a & 0xFF00) | this.read(bank, addr);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 4;
        } else {
          this.a = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 5;
        }
        break;
      }
      case 0xA5: { // LDA direct ($FF)
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        if (this.isAcc8()) {
          this.a = (this.a & 0xFF00) | this.read(0, addr);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 3;
        } else {
          this.a = this.read(0, addr) | (this.read(0, addr + 1) << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 4;
        }
        break;
      }
      case 0xB7: { // LDA [direct],Y
        const { bank, addr } = this.readDpIndirectLongIndexedYAddr();
        if (this.isAcc8()) {
          this.a = (this.a & 0xFF00) | this.read(bank, addr);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 6;
        } else {
          const low = this.read(bank, addr);
          const nextOffset = (addr + 1) & 0xFFFF;
          const nextBank = nextOffset === 0 ? (bank + 1) & 0xFF : bank;
          const high = this.read(nextBank, nextOffset);
          this.a = low | (high << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 7;
        }
        break;
      }
      case 0xA7: { // LDA [dp]
        const { bank, addr } = this.readDpIndirectLongAddr();
        if (this.isAcc8()) {
          this.a = (this.a & 0xFF00) | this.read(bank, addr);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 6;
        } else {
          const low = this.read(bank, addr);
          const nextOffset = (addr + 1) & 0xFFFF;
          const nextBank = nextOffset === 0 ? (bank + 1) & 0xFF : bank;
          const high = this.read(nextBank, nextOffset);
          this.a = low | (high << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 7;
        }
        break;
      }

      // --- LDX: Load X Register
      case 0xA2: { // LDX #imm
        if (this.isIndex8()) {
          this.x = this.readOperandByte();
          this.updateNZFlags(this.x, true);
          opCycles = 2;
        } else {
          this.x = this.readOperandWord();
          this.updateNZFlags(this.x, false);
          opCycles = 3;
        }
        break;
      }
      case 0xA6: { // LDX dp
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        if (this.isIndex8()) {
          this.x = this.read(0, addr);
          this.updateNZFlags(this.x, true);
          opCycles = 3;
        } else {
          this.x = this.read(0, addr) | (this.read(0, (addr + 1) & 0xFFFF) << 8);
          this.updateNZFlags(this.x, false);
          opCycles = 4;
        }
        break;
      }
      case 0xA4: { // LDY dp
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        if (this.isIndex8()) {
          this.y = this.read(0, addr);
          this.updateNZFlags(this.y, true);
          opCycles = 3;
        } else {
          this.y = this.read(0, addr) | (this.read(0, (addr + 1) & 0xFFFF) << 8);
          this.updateNZFlags(this.y, false);
          opCycles = 4;
        }
        break;
      }
      case 0xAE: { // LDX abs
        const addr = this.readOperandWord();
        const bank = this.db;
        if (this.isIndex8()) {
          this.x = this.read(bank, addr);
          this.updateNZFlags(this.x, true);
          opCycles = 4;
        } else {
          this.x = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          this.updateNZFlags(this.x, false);
          opCycles = 5;
        }
        break;
      }
      case 0xBE: { // LDX abs, Y
        const base = this.readOperandWord();
        const addr = (base + this.y) & 0xFFFF;
        const bank = this.db;
        if (this.isIndex8()) {
          this.x = this.read(bank, addr);
          this.updateNZFlags(this.x, true);
          opCycles = 4;
        } else {
          this.x = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          this.updateNZFlags(this.x, false);
          opCycles = 5;
        }
        break;
      }

      // --- LDY: Load Y Register
      case 0xA0: { // LDY #imm
        if (this.isIndex8()) {
          this.y = this.readOperandByte();
          this.updateNZFlags(this.y, true);
          opCycles = 2;
        } else {
          this.y = this.readOperandWord();
          this.updateNZFlags(this.y, false);
          opCycles = 3;
        }
        break;
      }
      case 0xAC: { // LDY abs
        const addr = this.readOperandWord();
        const bank = this.db;
        if (this.isIndex8()) {
          this.y = this.read(bank, addr);
          this.updateNZFlags(this.y, true);
          opCycles = 4;
        } else {
          this.y = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          this.updateNZFlags(this.y, false);
          opCycles = 5;
        }
        break;
      }
      case 0xBC: { // LDY abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        if (this.isIndex8()) {
          this.y = this.read(bank, addr);
          this.updateNZFlags(this.y, true);
          opCycles = 4;
        } else {
          this.y = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          this.updateNZFlags(this.y, false);
          opCycles = 5;
        }
        break;
      }

      // --- STA: Store Accumulator
      case 0x8D: { // STA abs
        const addr = this.readOperandWord();
        const bank = this.db;
        if (this.isAcc8()) {
          this.write(bank, addr, this.a & 0xFF);
          opCycles = 4;
        } else {
          this.write(bank, addr, this.a & 0xFF);
          this.write(bank, addr + 1, (this.a >> 8) & 0xFF);
          opCycles = 5;
        }
        break;
      }
      case 0x85: { // STA direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        if (this.isAcc8()) {
          this.write(0, addr, this.a & 0xFF);
          opCycles = 3;
        } else {
          this.write(0, addr, this.a & 0xFF);
          this.write(0, addr + 1, (this.a >> 8) & 0xFF);
          opCycles = 4;
        }
        break;
      }
      case 0x95: { // STA direct, X
        const offset = this.readOperandByte();
        const addr = (this.d + offset + this.x) & 0xFFFF;
        if (this.isAcc8()) {
          this.write(0, addr, this.a & 0xFF);
          opCycles = 4;
        } else {
          this.write(0, addr, this.a & 0xFF);
          this.write(0, addr + 1, (this.a >> 8) & 0xFF);
          opCycles = 5;
        }
        break;
      }
      case 0x9D: { // STA abs, x
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        if (this.isAcc8()) {
          this.write(bank, addr, this.a & 0xFF);
          opCycles = 5;
        } else {
          this.write(bank, addr, this.a & 0xFF);
          this.write(bank, addr + 1, (this.a >> 8) & 0xFF);
          opCycles = 6;
        }
        break;
      }
      case 0x97: { // STA [dp], Y
        const { bank, addr } = this.readDpIndirectLongIndexedYAddr();
        if (this.isAcc8()) {
          this.write(bank, addr, this.a & 0xFF);
          opCycles = 6;
        } else {
          this.write(bank, addr, this.a & 0xFF);
          const nextOffset = (addr + 1) & 0xFFFF;
          const nextBank = nextOffset === 0 ? (bank + 1) & 0xFF : bank;
          this.write(nextBank, nextOffset, (this.a >> 8) & 0xFF);
          opCycles = 7;
        }
        break;
      }

      // --- STX: Store X
      case 0x8E: { // STX abs
        const addr = this.readOperandWord();
        if (this.isIndex8()) {
          this.write(this.db, addr, this.x & 0xFF);
          opCycles = 4;
        } else {
          this.write(this.db, addr, this.x & 0xFF);
          this.write(this.db, addr + 1, (this.x >> 8) & 0xFF);
          opCycles = 5;
        }
        break;
      }
      case 0x86: { // STX direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        if (this.isIndex8()) {
          this.write(0, addr, this.x & 0xFF);
          opCycles = 3;
        } else {
          this.write(0, addr, this.x & 0xFF);
          this.write(0, addr + 1, (this.x >> 8) & 0xFF);
          opCycles = 4;
        }
        break;
      }

      // --- STY: Store Y
      case 0x8C: { // STY abs
        const addr = this.readOperandWord();
        if (this.isIndex8()) {
          this.write(this.db, addr, this.y & 0xFF);
          opCycles = 4;
        } else {
          this.write(this.db, addr, this.y & 0xFF);
          this.write(this.db, addr + 1, (this.y >> 8) & 0xFF);
          opCycles = 5;
        }
        break;
      }
      case 0x84: { // STY direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        if (this.isIndex8()) {
          this.write(0, addr, this.y & 0xFF);
          opCycles = 3;
        } else {
          this.write(0, addr, this.y & 0xFF);
          this.write(0, addr + 1, (this.y >> 8) & 0xFF);
          opCycles = 4;
        }
        break;
      }

      // --- STZ: Store Zero to memory (custom 65C816 instruction)
      case 0x9C: { // STZ abs
        const addr = this.readOperandWord();
        const bank = this.db;
        if (this.isAcc8()) {
          this.write(bank, addr, 0);
          opCycles = 4;
        } else {
          this.write(bank, addr, 0);
          this.write(bank, addr + 1, 0);
          opCycles = 5;
        }
        break;
      }
      case 0x9E: { // STZ abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        if (this.isAcc8()) {
          this.write(bank, addr, 0);
          opCycles = 5;
        } else {
          this.write(bank, addr, 0);
          this.write(bank, addr + 1, 0);
          opCycles = 6;
        }
        break;
      }
      case 0x64: { // STZ direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        if (this.isAcc8()) {
          this.write(0, addr, 0);
          opCycles = 3;
        } else {
          this.write(0, addr, 0);
          this.write(0, addr + 1, 0);
          opCycles = 4;
        }
        break;
      }
      case 0x74: { // STZ direct, X
        const offset = this.readOperandByte();
        const addr = (this.d + offset + this.x) & 0xFFFF;
        if (this.isAcc8()) {
          this.write(0, addr, 0);
          opCycles = 4;
        } else {
          this.write(0, addr, 0);
          this.write(0, addr + 1, 0);
          opCycles = 5;
        }
        break;
      }

      // --- Long Store / Load Accumulator Opcodes
      case 0x8F: { // STA long
        const addrLow = this.readOperandByte();
        const addrHigh = this.readOperandByte();
        const addrBank = this.readOperandByte();
        const targetBank = addrBank;
        const targetOffset = addrLow | (addrHigh << 8);
        
        if (this.isAcc8()) {
          this.write(targetBank, targetOffset, this.a & 0xFF);
          opCycles = 5;
        } else {
          this.write(targetBank, targetOffset, this.a & 0xFF);
          const nextOffset = (targetOffset + 1) & 0xFFFF;
          const nextBank = nextOffset === 0 ? (targetBank + 1) & 0xFF : targetBank;
          this.write(nextBank, nextOffset, (this.a >> 8) & 0xFF);
          opCycles = 6;
        }
        break;
      }
      case 0x9F: { // STA long, X
        const addrLow = this.readOperandByte();
        const addrHigh = this.readOperandByte();
        const addrBank = this.readOperandByte();
        const baseAddr = addrLow | (addrHigh << 8) | (addrBank << 16);
        const targetAddr = (baseAddr + this.x) & 0xFFFFFF;
        const targetBank = (targetAddr >> 16) & 0xFF;
        const targetOffset = targetAddr & 0xFFFF;
        
        if (this.isAcc8()) {
          this.write(targetBank, targetOffset, this.a & 0xFF);
          opCycles = 5;
        } else {
          this.write(targetBank, targetOffset, this.a & 0xFF);
          const nextAddr = (targetAddr + 1) & 0xFFFFFF;
          this.write((nextAddr >> 16) & 0xFF, nextAddr & 0xFFFF, (this.a >> 8) & 0xFF);
          opCycles = 6;
        }
        break;
      }
      case 0xAF: { // LDA long
        const addrLow = this.readOperandByte();
        const addrHigh = this.readOperandByte();
        const addrBank = this.readOperandByte();
        const targetBank = addrBank;
        const targetOffset = addrLow | (addrHigh << 8);
        
        if (this.isAcc8()) {
          this.a = (this.a & 0xFF00) | this.read(targetBank, targetOffset);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 5;
        } else {
          const lowVal = this.read(targetBank, targetOffset);
          const nextOffset = (targetOffset + 1) & 0xFFFF;
          const nextBank = nextOffset === 0 ? (targetBank + 1) & 0xFF : targetBank;
          const highVal = this.read(nextBank, nextOffset);
          this.a = lowVal | (highVal << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 6;
        }
        break;
      }
      case 0xBF: { // LDA long, X
        const addrLow = this.readOperandByte();
        const addrHigh = this.readOperandByte();
        const addrBank = this.readOperandByte();
        const baseAddr = addrLow | (addrHigh << 8) | (addrBank << 16);
        const targetAddr = (baseAddr + this.x) & 0xFFFFFF;
        const targetBank = (targetAddr >> 16) & 0xFF;
        const targetOffset = targetAddr & 0xFFFF;
        
        if (this.isAcc8()) {
          this.a = (this.a & 0xFF00) | this.read(targetBank, targetOffset);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 5;
        } else {
          const lowVal = this.read(targetBank, targetOffset);
          const nextAddr = (targetAddr + 1) & 0xFFFFFF;
          const highVal = this.read((nextAddr >> 16) & 0xFF, nextAddr & 0xFFFF);
          this.a = lowVal | (highVal << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 6;
        }
        break;
      }

      // --- Exchange B and A
      case 0xEB: { // XBA
        const low = this.a & 0xFF;
        const high = (this.a >> 8) & 0xFF;
        this.a = (low << 8) | high;
        this.updateNZFlags(high, true);
        opCycles = 3;
        break;
      }

      // --- Direct Page Registers Transfers
      case 0x5B: { // TCD
        this.d = this.a;
        this.updateNZFlags(this.d, false);
        opCycles = 2;
        break;
      }
      case 0x7B: { // TDC
        this.a = this.d;
        this.updateNZFlags(this.a, false);
        opCycles = 2;
        break;
      }

      // --- Stack / Accumulator Stack Transfers
      case 0x1B: { // TCS
        this.s = this.a;
        opCycles = 2;
        break;
      }
      case 0x3B: { // TSC
        this.a = this.s;
        this.updateNZFlags(this.a, false);
        opCycles = 2;
        break;
      }

      // --- Bank Register Stack Operations
      case 0xAB: { // PLB
        this.db = this.popByte();
        this.updateNZFlags(this.db, true);
        opCycles = 4;
        break;
      }
      case 0x8B: { // PHB
        this.pushByte(this.db);
        opCycles = 3;
        break;
      }
      case 0x0B: { // PHD
        this.pushWord(this.d);
        opCycles = 4;
        break;
      }
      case 0x2B: { // PLD
        this.d = this.popWord();
        this.updateNZFlags(this.d, false);
        opCycles = 5;
        break;
      }
      case 0x4B: { // PHK
        this.pushByte(this.pb);
        opCycles = 3;
        break;
      }

      // --- TAX: Transfer Accumulator to X
      case 0xAA: {
        this.x = this.isIndex8() ? (this.a & 0xFF) : this.a;
        this.updateNZFlags(this.x, this.isIndex8());
        opCycles = 2;
        break;
      }
      // --- TXA: Transfer X to Accumulator
      case 0x8A: {
        this.a = this.isAcc8() ? (this.x & 0xFF) : this.x;
        this.updateNZFlags(this.isAcc8() ? (this.a & 0xFF) : this.a, this.isAcc8());
        opCycles = 2;
        break;
      }
      // --- TAY: Transfer Accumulator to Y
      case 0xA8: {
        this.y = this.isIndex8() ? (this.a & 0xFF) : this.a;
        this.updateNZFlags(this.y, this.isIndex8());
        opCycles = 2;
        break;
      }
      // --- TYA: Transfer Y to Accumulator
      case 0x98: {
        this.a = this.isAcc8() ? (this.y & 0xFF) : this.y;
        this.updateNZFlags(this.isAcc8() ? (this.a & 0xFF) : this.a, this.isAcc8());
        opCycles = 2;
        break;
      }
      // --- TXS: Transfer X to Stack Pointer
      case 0x9A: {
        this.s = this.x; // s is always 16-bit in Native Mode, or 8-bit page 1 in Emulation Mode
        if (this.e === 1) {
          this.s = 0x0100 | (this.s & 0xFF);
        }
        opCycles = 2;
        break;
      }
      // --- TSX: Transfer Stack to X
      case 0xBA: {
        this.x = this.isIndex8() ? (this.s & 0xFF) : this.s;
        this.updateNZFlags(this.x, this.isIndex8());
        opCycles = 2;
        break;
      }
      // --- TXY: Transfer X to Y
      case 0x9B: {
        this.y = this.isIndex8() ? (this.x & 0xFF) : this.x;
        this.updateNZFlags(this.y, this.isIndex8());
        opCycles = 2;
        break;
      }
      // --- TYX: Transfer Y to X
      case 0xBB: {
        this.x = this.isIndex8() ? (this.y & 0xFF) : this.y;
        this.updateNZFlags(this.x, this.isIndex8());
        opCycles = 2;
        break;
      }

      // --- INC: Increment Accumulator
      case 0x1A: {
        const is8 = this.isAcc8();
        const mask = is8 ? 0xFF : 0xFFFF;
        const val = is8 ? (this.a & 0xFF) : this.a;
        const inc = (val + 1) & mask;
        this.a = is8 ? (this.a & 0xFF00) | inc : inc;
        this.updateNZFlags(inc, is8);
        opCycles = 2;
        break;
      }
      // --- INX: Increment X
      case 0xE8: {
        const is8 = this.isIndex8();
        const mask = is8 ? 0xFF : 0xFFFF;
        this.x = (this.x + 1) & mask;
        this.updateNZFlags(this.x, is8);
        opCycles = 2;
        break;
      }
      // --- INY: Increment Y
      case 0xC8: {
        const is8 = this.isIndex8();
        const mask = is8 ? 0xFF : 0xFFFF;
        this.y = (this.y + 1) & mask;
        this.updateNZFlags(this.y, is8);
        opCycles = 2;
        break;
      }

      // --- DEC: Decrement Accumulator
      case 0x3A: {
        const is8 = this.isAcc8();
        const mask = is8 ? 0xFF : 0xFFFF;
        const val = is8 ? (this.a & 0xFF) : this.a;
        const dec = (val - 1) & mask;
        this.a = is8 ? (this.a & 0xFF00) | dec : dec;
        this.updateNZFlags(dec, is8);
        opCycles = 2;
        break;
      }
      case 0xC6: { // DEC dp
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(0, addr);
          const dec = (val - 1) & 0xFF;
          this.write(0, addr, dec);
          this.updateNZFlags(dec, true);
          opCycles = 5;
        } else {
          const val = this.read(0, addr) | (this.read(0, addr + 1) << 8);
          const dec = (val - 1) & 0xFFFF;
          this.write(0, addr, dec & 0xFF);
          this.write(0, addr + 1, (dec >> 8) & 0xFF);
          this.updateNZFlags(dec, false);
          opCycles = 6;
        }
        break;
      }
      case 0xE6: { // INC dp
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(0, addr);
          const inc = (val + 1) & 0xFF;
          this.write(0, addr, inc);
          this.updateNZFlags(inc, true);
          opCycles = 5;
        } else {
          const val = this.read(0, addr) | (this.read(0, addr + 1) << 8);
          const inc = (val + 1) & 0xFFFF;
          this.write(0, addr, inc & 0xFF);
          this.write(0, addr + 1, (inc >> 8) & 0xFF);
          this.updateNZFlags(inc, false);
          opCycles = 6;
        }
        break;
      }
      // --- DEX: Decrement X
      case 0xCA: {
        const is8 = this.isIndex8();
        const mask = is8 ? 0xFF : 0xFFFF;
        this.x = (this.x - 1) & mask;
        this.updateNZFlags(this.x, is8);
        opCycles = 2;
        break;
      }
      // --- DEY: Decrement Y
      case 0x88: {
        const is8 = this.isIndex8();
        const mask = is8 ? 0xFF : 0xFFFF;
        this.y = (this.y - 1) & mask;
        this.updateNZFlags(this.y, is8);
        opCycles = 2;
        break;
      }

      // --- BIT: Bit Test (Immediate mode only updates Zero flag)
      case 0x89: { // BIT #imm
        const is8 = this.isAcc8();
        const val = is8 ? this.readOperandByte() : this.readOperandWord();
        const reg = is8 ? (this.a & 0xFF) : this.a;
        const res = reg & val;
        this.setFlag(CPUFlags.Zero, res === 0);
        opCycles = is8 ? 2 : 3;
        break;
      }

      // --- CMP: Compare Accumulator with memory
      case 0xC9: { // CMP #imm
        const is8 = this.isAcc8();
        const val = is8 ? this.readOperandByte() : this.readOperandWord();
        const reg = is8 ? (this.a & 0xFF) : this.a;
        const sub = reg - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 2 : 3;
        break;
      }
      case 0xCD: { // CMP abs
        const addr = this.readOperandWord();
        const bank = this.db;
        const is8 = this.isAcc8();
        const val = is8 ? this.read(bank, addr) : (this.read(bank, addr) | (this.read(bank, addr + 1) << 8));
        const reg = is8 ? (this.a & 0xFF) : this.a;
        const sub = reg - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 4 : 5;
        break;
      }
      case 0xDF: { // CMP long, X
        const addrLow = this.readOperandByte();
        const addrHigh = this.readOperandByte();
        const addrBank = this.readOperandByte();
        const baseAddr = addrLow | (addrHigh << 8) | (addrBank << 16);
        const targetAddr = (baseAddr + this.x) & 0xFFFFFF;
        const targetBank = (targetAddr >> 16) & 0xFF;
        const targetOffset = targetAddr & 0xFFFF;
        const is8 = this.isAcc8();
        let val = 0;
        if (is8) {
          val = this.read(targetBank, targetOffset);
        } else {
          const lowVal = this.read(targetBank, targetOffset);
          const nextAddr = (targetAddr + 1) & 0xFFFFFF;
          const highVal = this.read((nextAddr >> 16) & 0xFF, nextAddr & 0xFFFF);
          val = lowVal | (highVal << 8);
        }
        const reg = is8 ? (this.a & 0xFF) : this.a;
        const sub = reg - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 5 : 6;
        break;
      }
      case 0xDD: { // CMP abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        const val = is8 ? this.read(bank, addr) : (this.read(bank, addr) | (this.read(bank, addr + 1) << 8));
        const reg = is8 ? (this.a & 0xFF) : this.a;
        const sub = reg - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 4 : 5;
        break;
      }
      case 0xD9: { // CMP abs, Y
        const base = this.readOperandWord();
        const addr = (base + this.y) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        const val = is8 ? this.read(bank, addr) : (this.read(bank, addr) | (this.read(bank, addr + 1) << 8));
        const reg = is8 ? (this.a & 0xFF) : this.a;
        const sub = reg - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 4 : 5;
        break;
      }

      // --- ADC: Add with Carry
      case 0x69: { // ADC #imm
        const is8 = this.isAcc8();
        const val = is8 ? this.readOperandByte() : this.readOperandWord();
        this.adcVal(val, is8);
        opCycles = is8 ? 2 : 3;
        break;
      }

      // --- AND: Logical AND
      case 0x29: { // AND #imm
        const is8 = this.isAcc8();
        const val = is8 ? this.readOperandByte() : this.readOperandWord();
        const reg = is8 ? (this.a & 0xFF) : this.a;
        const res = reg & val;
        this.a = is8 ? (this.a & 0xFF00) | res : res;
        this.updateNZFlags(res, is8);
        opCycles = is8 ? 2 : 3;
        break;
      }
      case 0x3F: { // AND long, X
        const addrLow = this.readOperandByte();
        const addrHigh = this.readOperandByte();
        const addrBank = this.readOperandByte();
        const baseAddr = addrLow | (addrHigh << 8) | (addrBank << 16);
        const targetAddr = (baseAddr + this.x) & 0xFFFFFF;
        const targetBank = (targetAddr >> 16) & 0xFF;
        const targetOffset = targetAddr & 0xFFFF;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(targetBank, targetOffset);
          const res = (this.a & 0xFF) & val;
          this.a = (this.a & 0xFF00) | res;
          this.updateNZFlags(res, true);
          opCycles = 5;
        } else {
          const lowVal = this.read(targetBank, targetOffset);
          const nextAddr = (targetAddr + 1) & 0xFFFFFF;
          const highVal = this.read((nextAddr >> 16) & 0xFF, nextAddr & 0xFFFF);
          const val = lowVal | (highVal << 8);
          const res = this.a & val;
          this.a = res;
          this.updateNZFlags(res, false);
          opCycles = 6;
        }
        break;
      }

      // --- ORA: Logical Inclusive OR
      case 0x09: { // ORA #imm
        const is8 = this.isAcc8();
        const val = is8 ? this.readOperandByte() : this.readOperandWord();
        const reg = is8 ? (this.a & 0xFF) : this.a;
        const res = reg | val;
        this.a = is8 ? (this.a & 0xFF00) | res : res;
        this.updateNZFlags(res, is8);
        opCycles = is8 ? 2 : 3;
        break;
      }
      case 0x05: { // ORA dp
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(0, addr);
          const res = (this.a & 0xFF) | val;
          this.a = (this.a & 0xFF00) | res;
          this.updateNZFlags(res, true);
          opCycles = 3;
        } else {
          const val = this.read(0, addr) | (this.read(0, addr + 1) << 8);
          const res = this.a | val;
          this.a = res;
          this.updateNZFlags(res, false);
          opCycles = 4;
        }
        break;
      }
      case 0x0D: { // ORA abs
        const addr = this.readOperandWord();
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = (this.a & 0xFF) | val;
          this.a = (this.a & 0xFF00) | res;
          this.updateNZFlags(res, true);
          opCycles = 4;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.a | val;
          this.a = res;
          this.updateNZFlags(res, false);
          opCycles = 5;
        }
        break;
      }
      case 0x19: { // ORA abs, Y
        const base = this.readOperandWord();
        const addr = (base + this.y) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = (this.a & 0xFF) | val;
          this.a = (this.a & 0xFF00) | res;
          this.updateNZFlags(res, true);
          opCycles = 4;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.a | val;
          this.a = res;
          this.updateNZFlags(res, false);
          opCycles = 5;
        }
        break;
      }
      case 0x1D: { // ORA abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = (this.a & 0xFF) | val;
          this.a = (this.a & 0xFF00) | res;
          this.updateNZFlags(res, true);
          opCycles = 4;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.a | val;
          this.a = res;
          this.updateNZFlags(res, false);
          opCycles = 5;
        }
        break;
      }
      case 0x03: { // ORA sr, S
        const offset = this.readOperandByte();
        const addr = (this.s + offset) & 0xFFFF;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(0, addr);
          const res = (this.a & 0xFF) | val;
          this.a = (this.a & 0xFF00) | res;
          this.updateNZFlags(res, true);
          opCycles = 4;
        } else {
          const val = this.read(0, addr) | (this.read(0, (addr + 1) & 0xFFFF) << 8);
          const res = this.a | val;
          this.a = res;
          this.updateNZFlags(res, false);
          opCycles = 5;
        }
        break;
      }
      case 0x15: { // ORA dp, X
        const offset = this.readOperandByte();
        const addr = (this.d + offset + this.x) & 0xFFFF;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(0, addr);
          const res = (this.a & 0xFF) | val;
          this.a = (this.a & 0xFF00) | res;
          this.updateNZFlags(res, true);
          opCycles = 4;
        } else {
          const val = this.read(0, addr) | (this.read(0, (addr + 1) & 0xFFFF) << 8);
          const res = this.a | val;
          this.a = res;
          this.updateNZFlags(res, false);
          opCycles = 5;
        }
        break;
      }

      // --- EOR: Logical Exclusive OR
      case 0x49: { // EOR #imm
        const is8 = this.isAcc8();
        const val = is8 ? this.readOperandByte() : this.readOperandWord();
        const reg = is8 ? (this.a & 0xFF) : this.a;
        const res = reg ^ val;
        this.a = is8 ? (this.a & 0xFF00) | res : res;
        this.updateNZFlags(res, is8);
        opCycles = is8 ? 2 : 3;
        break;
      }
      case 0x4D: { // EOR abs
        const addr = this.readOperandWord();
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = (this.a & 0xFF) ^ val;
          this.a = (this.a & 0xFF00) | res;
          this.updateNZFlags(res, true);
          opCycles = 4;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.a ^ val;
          this.a = res;
          this.updateNZFlags(res, false);
          opCycles = 5;
        }
        break;
      }

      // --- JMP: Jump
      case 0x4C: { // JMP abs ($FFFF)
        this.pc = this.readOperandWord();
        opCycles = 3;
        break;
      }

      // --- JSR: Jump to Subroutine
      case 0x20: { // JSR abs
        const dest = this.readOperandWord();
        // Push return address - 1 (6502 convention)
        const retAddr = (this.pc - 1) & 0xFFFF;
        this.pushWord(retAddr);
        this.pc = dest;
        opCycles = 6;
        break;
      }
      
      // --- JSL: Jump to Subroutine Long (Push PB, then push PC-1)
      case 0x22: { // JSL long
        const destAddr = this.readOperandWord();
        const destBank = this.readOperandByte();
        // Push current PB bank
        this.pushByte(this.pb);
        // Push return PC - 1
        const retAddr = (this.pc - 1) & 0xFFFF;
        this.pushWord(retAddr);
        // Set new PC and Bank
        this.pb = destBank;
        this.pc = destAddr;
        opCycles = 8;
        break;
      }
      case 0xFC: { // JSR (abs, X)
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const dest = this.read(this.pb, addr) | (this.read(this.pb, (addr + 1) & 0xFFFF) << 8);
        const retAddr = (this.pc - 1) & 0xFFFF;
        this.pushWord(retAddr);
        this.pc = dest;
        opCycles = 8;
        break;
      }

      // --- JML: Jump Long (absolute long)
      case 0x5C: {
        const destAddr = this.readOperandWord();
        const destBank = this.readOperandByte();
        this.pc = destAddr;
        this.pb = destBank;
        opCycles = 4;
        break;
      }

      // --- RTI: Return from Interrupt
      case 0x40: {
        this.p = this.popByte();
        this.pc = this.popWord();
        if (this.e === 0) {
          this.pb = this.popByte();
        } else {
          this.p |= CPUFlags.IndexSize | CPUFlags.AccumulatorSize;
        }
        this.updateRegisterSizes();
        opCycles = 6;
        break;
      }

      // --- RTS: Return from Subroutine
      case 0x60: {
        const retAddr = this.popWord();
        this.pc = (retAddr + 1) & 0xFFFF;
        opCycles = 6;
        break;
      }

      // --- RTL: Return from Subroutine Long
      case 0x6B: {
        const retAddr = this.popWord();
        const retBank = this.popByte();
        this.pb = retBank;
        this.pc = (retAddr + 1) & 0xFFFF;
        opCycles = 6;
        break;
      }

      // --- Branches (8-bit signed relative offsets)
      case 0x50: { // BVC rel
        opCycles = this.handleBranch(!this.getFlag(CPUFlags.Overflow));
        break;
      }
      case 0x70: { // BVS rel
        opCycles = this.handleBranch(this.getFlag(CPUFlags.Overflow));
        break;
      }
      case 0xD0: { // BNE rel
        opCycles = this.handleBranch(!this.getFlag(CPUFlags.Zero));
        break;
      }
      case 0xF0: { // BEQ rel
        opCycles = this.handleBranch(this.getFlag(CPUFlags.Zero));
        break;
      }
      case 0x90: { // BCC rel
        opCycles = this.handleBranch(!this.getFlag(CPUFlags.Carry));
        break;
      }
      case 0xB0: { // BCS rel
        opCycles = this.handleBranch(this.getFlag(CPUFlags.Carry));
        break;
      }
      case 0x10: { // BPL rel
        opCycles = this.handleBranch(!this.getFlag(CPUFlags.Negative));
        break;
      }
      case 0x30: { // BMI rel
        opCycles = this.handleBranch(this.getFlag(CPUFlags.Negative));
        break;
      }
      case 0x80: { // BRA rel (Branch Always)
        opCycles = this.handleBranch(true);
        break;
      }

      // --- PHA: Push Accumulator
      case 0x48: {
        if (this.isAcc8()) {
          this.pushByte(this.a & 0xFF);
          opCycles = 3;
        } else {
          this.pushWord(this.a);
          opCycles = 4;
        }
        break;
      }
      // --- PLA: Pop Accumulator
      case 0x68: {
        if (this.isAcc8()) {
          const val = this.popByte();
          this.a = (this.a & 0xFF00) | val;
          this.updateNZFlags(val, true);
          opCycles = 4;
        } else {
          this.a = this.popWord();
          this.updateNZFlags(this.a, false);
          opCycles = 5;
        }
        break;
      }
      // --- PHX: Push X
      case 0xDA: {
        if (this.isIndex8()) {
          this.pushByte(this.x & 0xFF);
          opCycles = 3;
        } else {
          this.pushWord(this.x);
          opCycles = 4;
        }
        break;
      }
      // --- PLX: Pop X
      case 0xFA: {
        if (this.isIndex8()) {
          this.x = this.popByte();
          this.updateNZFlags(this.x, true);
          opCycles = 4;
        } else {
          this.x = this.popWord();
          this.updateNZFlags(this.x, false);
          opCycles = 5;
        }
        break;
      }
      // --- PHY: Push Y
      case 0x5A: {
        if (this.isIndex8()) {
          this.pushByte(this.y & 0xFF);
          opCycles = 3;
        } else {
          this.pushWord(this.y);
          opCycles = 4;
        }
        break;
      }
      // --- PLY: Pop Y
      case 0x7A: {
        if (this.isIndex8()) {
          this.y = this.popByte();
          this.updateNZFlags(this.y, true);
          opCycles = 4;
        } else {
          this.y = this.popWord();
          this.updateNZFlags(this.y, false);
          opCycles = 5;
        }
        break;
      }

      // --- PHP: Push Processor Status (Status flags)
      case 0x08: {
        this.pushByte(this.p);
        opCycles = 3;
        break;
      }
      // --- PLP: Pop Processor Status
      case 0x28: {
        this.p = this.popByte();
        if (this.e === 1) {
          // Emulation mode forces 8-bit registers always
          this.p |= CPUFlags.IndexSize | CPUFlags.AccumulatorSize;
        }
        this.updateRegisterSizes();
        opCycles = 4;
        break;
      }

      // --- WAI: Wait for Interrupt (used in game loops to wait for VBlank!)
      case 0xCB: {
        // Halt CPU execution until NMI or IRQ fires. PC already advanced past
        // this opcode, so when the interrupt fires it will RTI to the next instruction.
        this.waiting = true;
        opCycles = 3;
        break;
      }

      // --- ASL: Arithmetic Shift Left
      case 0x0A: { // ASL A
        const is8 = this.isAcc8();
        const val = is8 ? (this.a & 0xFF) : this.a;
        const res = this.aslVal(val, is8);
        this.a = is8 ? (this.a & 0xFF00) | res : res;
        opCycles = 2;
        break;
      }
      case 0x06: { // ASL direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(0, addr);
          const res = this.aslVal(val, true);
          this.write(0, addr, res);
          opCycles = 5;
        } else {
          const val = this.read(0, addr) | (this.read(0, addr + 1) << 8);
          const res = this.aslVal(val, false);
          this.write(0, addr, res & 0xFF);
          this.write(0, addr + 1, (res >> 8) & 0xFF);
          opCycles = 6;
        }
        break;
      }
      case 0x0E: { // ASL abs
        const addr = this.readOperandWord();
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = this.aslVal(val, true);
          this.write(bank, addr, res);
          opCycles = 6;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.aslVal(val, false);
          this.write(bank, addr, res & 0xFF);
          this.write(bank, addr + 1, (res >> 8) & 0xFF);
          opCycles = 7;
        }
        break;
      }
      case 0x1E: { // ASL abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = this.aslVal(val, true);
          this.write(bank, addr, res);
          opCycles = 7;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.aslVal(val, false);
          this.write(bank, addr, res & 0xFF);
          this.write(bank, addr + 1, (res >> 8) & 0xFF);
          opCycles = 8;
        }
        break;
      }

      // --- LSR: Logical Shift Right
      case 0x4A: { // LSR A
        const is8 = this.isAcc8();
        const val = is8 ? (this.a & 0xFF) : this.a;
        const res = this.lsrVal(val, is8);
        this.a = is8 ? (this.a & 0xFF00) | res : res;
        opCycles = 2;
        break;
      }
      case 0x46: { // LSR direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(0, addr);
          const res = this.lsrVal(val, true);
          this.write(0, addr, res);
          opCycles = 5;
        } else {
          const val = this.read(0, addr) | (this.read(0, addr + 1) << 8);
          const res = this.lsrVal(val, false);
          this.write(0, addr, res & 0xFF);
          this.write(0, addr + 1, (res >> 8) & 0xFF);
          opCycles = 6;
        }
        break;
      }
      case 0x4E: { // LSR abs
        const addr = this.readOperandWord();
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = this.lsrVal(val, true);
          this.write(bank, addr, res);
          opCycles = 6;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.lsrVal(val, false);
          this.write(bank, addr, res & 0xFF);
          this.write(bank, addr + 1, (res >> 8) & 0xFF);
          opCycles = 7;
        }
        break;
      }
      case 0x5E: { // LSR abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = this.lsrVal(val, true);
          this.write(bank, addr, res);
          opCycles = 7;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.lsrVal(val, false);
          this.write(bank, addr, res & 0xFF);
          this.write(bank, addr + 1, (res >> 8) & 0xFF);
          opCycles = 8;
        }
        break;
      }

      // --- ROL: Rotate Left
      case 0x2A: { // ROL A
        const is8 = this.isAcc8();
        const val = is8 ? (this.a & 0xFF) : this.a;
        const res = this.rolVal(val, is8);
        this.a = is8 ? (this.a & 0xFF00) | res : res;
        opCycles = 2;
        break;
      }
      case 0x26: { // ROL direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(0, addr);
          const res = this.rolVal(val, true);
          this.write(0, addr, res);
          opCycles = 5;
        } else {
          const val = this.read(0, addr) | (this.read(0, addr + 1) << 8);
          const res = this.rolVal(val, false);
          this.write(0, addr, res & 0xFF);
          this.write(0, addr + 1, (res >> 8) & 0xFF);
          opCycles = 6;
        }
        break;
      }
      case 0x2E: { // ROL abs
        const addr = this.readOperandWord();
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = this.rolVal(val, true);
          this.write(bank, addr, res);
          opCycles = 6;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.rolVal(val, false);
          this.write(bank, addr, res & 0xFF);
          this.write(bank, addr + 1, (res >> 8) & 0xFF);
          opCycles = 7;
        }
        break;
      }
      case 0x3E: { // ROL abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = this.rolVal(val, true);
          this.write(bank, addr, res);
          opCycles = 7;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.rolVal(val, false);
          this.write(bank, addr, res & 0xFF);
          this.write(bank, addr + 1, (res >> 8) & 0xFF);
          opCycles = 8;
        }
        break;
      }

      // --- ROR: Rotate Right
      case 0x6A: { // ROR A
        const is8 = this.isAcc8();
        const val = is8 ? (this.a & 0xFF) : this.a;
        const res = this.rorVal(val, is8);
        this.a = is8 ? (this.a & 0xFF00) | res : res;
        opCycles = 2;
        break;
      }
      case 0x66: { // ROR direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(0, addr);
          const res = this.rorVal(val, true);
          this.write(0, addr, res);
          opCycles = 5;
        } else {
          const val = this.read(0, addr) | (this.read(0, addr + 1) << 8);
          const res = this.rorVal(val, false);
          this.write(0, addr, res & 0xFF);
          this.write(0, addr + 1, (res >> 8) & 0xFF);
          opCycles = 6;
        }
        break;
      }
      case 0x6E: { // ROR abs
        const addr = this.readOperandWord();
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = this.rorVal(val, true);
          this.write(bank, addr, res);
          opCycles = 6;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.rorVal(val, false);
          this.write(bank, addr, res & 0xFF);
          this.write(bank, addr + 1, (res >> 8) & 0xFF);
          opCycles = 7;
        }
        break;
      }
      case 0x7E: { // ROR abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const res = this.rorVal(val, true);
          this.write(bank, addr, res);
          opCycles = 7;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const res = this.rorVal(val, false);
          this.write(bank, addr, res & 0xFF);
          this.write(bank, addr + 1, (res >> 8) & 0xFF);
          opCycles = 8;
        }
        break;
      }

      // --- CPX: Compare X
      case 0xE0: { // CPX #imm
        const is8 = this.isIndex8();
        const val = is8 ? this.readOperandByte() : this.readOperandWord();
        const sub = this.x - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 2 : 3;
        break;
      }
      case 0xE4: { // CPX direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isIndex8();
        const val = is8 ? this.read(0, addr) : (this.read(0, addr) | (this.read(0, addr + 1) << 8));
        const sub = this.x - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 3 : 4;
        break;
      }
      case 0xEC: { // CPX abs
        const addr = this.readOperandWord();
        const is8 = this.isIndex8();
        const val = is8 ? this.read(this.db, addr) : (this.read(this.db, addr) | (this.read(this.db, addr + 1) << 8));
        const sub = this.x - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 4 : 5;
        break;
      }

      // --- CPY: Compare Y
      case 0xC0: { // CPY #imm
        const is8 = this.isIndex8();
        const val = is8 ? this.readOperandByte() : this.readOperandWord();
        const sub = this.y - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 2 : 3;
        break;
      }
      case 0xC4: { // CPY direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isIndex8();
        const val = is8 ? this.read(0, addr) : (this.read(0, addr) | (this.read(0, addr + 1) << 8));
        const sub = this.y - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 3 : 4;
        break;
      }
      case 0xCC: { // CPY abs
        const addr = this.readOperandWord();
        const is8 = this.isIndex8();
        const val = is8 ? this.read(this.db, addr) : (this.read(this.db, addr) | (this.read(this.db, addr + 1) << 8));
        const sub = this.y - val;
        this.setFlag(CPUFlags.Carry, sub >= 0);
        this.updateNZFlags(sub, is8);
        opCycles = is8 ? 4 : 5;
        break;
      }

      // --- SBC: Subtract with Carry
      case 0xE9: { // SBC #imm
        const is8 = this.isAcc8();
        const val = is8 ? this.readOperandByte() : this.readOperandWord();
        this.sbcVal(val, is8);
        opCycles = is8 ? 2 : 3;
        break;
      }
      case 0xE5: { // SBC direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isAcc8();
        const val = is8 ? this.read(0, addr) : (this.read(0, addr) | (this.read(0, addr + 1) << 8));
        this.sbcVal(val, is8);
        opCycles = is8 ? 3 : 4;
        break;
      }
      case 0xED: { // SBC abs
        const addr = this.readOperandWord();
        const is8 = this.isAcc8();
        const val = is8 ? this.read(this.db, addr) : (this.read(this.db, addr) | (this.read(this.db, addr + 1) << 8));
        this.sbcVal(val, is8);
        opCycles = is8 ? 4 : 5;
        break;
      }
      case 0xFD: { // SBC abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const is8 = this.isAcc8();
        const val = is8 ? this.read(this.db, addr) : (this.read(this.db, addr) | (this.read(this.db, addr + 1) << 8));
        this.sbcVal(val, is8);
        opCycles = is8 ? 4 : 5; // simplified page cycle
        break;
      }
      case 0xF9: { // SBC abs, Y
        const base = this.readOperandWord();
        const addr = (base + this.y) & 0xFFFF;
        const is8 = this.isAcc8();
        const val = is8 ? this.read(this.db, addr) : (this.read(this.db, addr) | (this.read(this.db, addr + 1) << 8));
        this.sbcVal(val, is8);
        opCycles = is8 ? 4 : 5;
        break;
      }
      case 0xE1: { // SBC (direct, X)
        const target = this.readDpIndexedXIndirectAddr();
        const is8 = this.isAcc8();
        const val = is8 ? this.read(target.bank, target.addr) : (this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8));
        this.sbcVal(val, is8);
        opCycles = is8 ? 6 : 7;
        break;
      }
      case 0xF1: { // SBC (direct), Y
        const target = this.readDpIndirectYAddr();
        const is8 = this.isAcc8();
        const val = is8 ? this.read(target.bank, target.addr) : (this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8));
        this.sbcVal(val, is8);
        opCycles = is8 ? 5 : 6;
        break;
      }
      case 0xF2: { // SBC (direct)
        const target = this.readDpIndirectAddr();
        const is8 = this.isAcc8();
        const val = is8 ? this.read(target.bank, target.addr) : (this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8));
        this.sbcVal(val, is8);
        opCycles = is8 ? 5 : 6;
        break;
      }
      case 0xFF: { // SBC long, X
        const addrLow = this.readOperandByte();
        const addrHigh = this.readOperandByte();
        const addrBank = this.readOperandByte();
        const baseAddr = addrLow | (addrHigh << 8) | (addrBank << 16);
        const targetAddr = (baseAddr + this.x) & 0xFFFFFF;
        const targetBank = (targetAddr >> 16) & 0xFF;
        const targetOffset = targetAddr & 0xFFFF;
        const is8 = this.isAcc8();
        let val = 0;
        if (is8) {
          val = this.read(targetBank, targetOffset);
        } else {
          const lowVal = this.read(targetBank, targetOffset);
          const nextAddr = (targetAddr + 1) & 0xFFFFFF;
          const highVal = this.read((nextAddr >> 16) & 0xFF, nextAddr & 0xFFFF);
          val = lowVal | (highVal << 8);
        }
        this.sbcVal(val, is8);
        opCycles = is8 ? 5 : 6;
        break;
      }

      // --- ADC extra modes
      case 0x65: { // ADC direct
        const offset = this.readOperandByte();
        const addr = (this.d + offset) & 0xFFFF;
        const is8 = this.isAcc8();
        const val = is8 ? this.read(0, addr) : (this.read(0, addr) | (this.read(0, addr + 1) << 8));
        this.adcVal(val, is8);
        opCycles = is8 ? 3 : 4;
        break;
      }
      case 0x6D: { // ADC abs
        const addr = this.readOperandWord();
        const is8 = this.isAcc8();
        const val = is8 ? this.read(this.db, addr) : (this.read(this.db, addr) | (this.read(this.db, addr + 1) << 8));
        this.adcVal(val, is8);
        opCycles = is8 ? 4 : 5;
        break;
      }
      case 0x7D: { // ADC abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const is8 = this.isAcc8();
        const val = is8 ? this.read(this.db, addr) : (this.read(this.db, addr) | (this.read(this.db, addr + 1) << 8));
        this.adcVal(val, is8);
        opCycles = is8 ? 4 : 5;
        break;
      }
      case 0x79: { // ADC abs, Y
        const base = this.readOperandWord();
        const addr = (base + this.y) & 0xFFFF;
        const is8 = this.isAcc8();
        const val = is8 ? this.read(this.db, addr) : (this.read(this.db, addr) | (this.read(this.db, addr + 1) << 8));
        this.adcVal(val, is8);
        opCycles = is8 ? 4 : 5;
        break;
      }
      case 0x7F: { // ADC long, X
        const addrLow = this.readOperandByte();
        const addrHigh = this.readOperandByte();
        const addrBank = this.readOperandByte();
        const baseAddr = addrLow | (addrHigh << 8) | (addrBank << 16);
        const targetAddr = (baseAddr + this.x) & 0xFFFFFF;
        const targetBank = (targetAddr >> 16) & 0xFF;
        const targetOffset = targetAddr & 0xFFFF;
        const is8 = this.isAcc8();
        
        let val = 0;
        if (is8) {
          val = this.read(targetBank, targetOffset);
        } else {
          const lowVal = this.read(targetBank, targetOffset);
          const nextAddr = (targetAddr + 1) & 0xFFFFFF;
          const highVal = this.read((nextAddr >> 16) & 0xFF, nextAddr & 0xFFFF);
          val = lowVal | (highVal << 8);
        }
        this.adcVal(val, is8);
        opCycles = is8 ? 5 : 6;
        break;
      }
      case 0x61: { // ADC (direct, X)
        const target = this.readDpIndexedXIndirectAddr();
        const is8 = this.isAcc8();
        const val = is8 ? this.read(target.bank, target.addr) : (this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8));
        this.adcVal(val, is8);
        opCycles = is8 ? 6 : 7;
        break;
      }
      case 0x67: { // ADC [dp]
        const target = this.readDpIndirectLongAddr();
        const is8 = this.isAcc8();
        const val = is8 ? this.read(target.bank, target.addr) : (this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8));
        this.adcVal(val, is8);
        opCycles = is8 ? 6 : 7;
        break;
      }
      case 0x71: { // ADC (direct), Y
        const target = this.readDpIndirectYAddr();
        const is8 = this.isAcc8();
        const val = is8 ? this.read(target.bank, target.addr) : (this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8));
        this.adcVal(val, is8);
        opCycles = is8 ? 5 : 6;
        break;
      }
      case 0x72: { // ADC (direct)
        const target = this.readDpIndirectAddr();
        const is8 = this.isAcc8();
        const val = is8 ? this.read(target.bank, target.addr) : (this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8));
        this.adcVal(val, is8);
        opCycles = is8 ? 5 : 6;
        break;
      }

      // --- LDA extra modes
      case 0xB2: { // LDA (direct)
        const target = this.readDpIndirectAddr();
        const is8 = this.isAcc8();
        if (is8) {
          this.a = (this.a & 0xFF00) | this.read(target.bank, target.addr);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 5;
        } else {
          this.a = this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 6;
        }
        break;
      }
      case 0xB1: { // LDA (direct), Y
        const target = this.readDpIndirectYAddr();
        const is8 = this.isAcc8();
        if (is8) {
          this.a = (this.a & 0xFF00) | this.read(target.bank, target.addr);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 5;
        } else {
          this.a = this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 6;
        }
        break;
      }
      case 0xA1: { // LDA (direct, X)
        const target = this.readDpIndexedXIndirectAddr();
        const is8 = this.isAcc8();
        if (is8) {
          this.a = (this.a & 0xFF00) | this.read(target.bank, target.addr);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 6;
        } else {
          this.a = this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 7;
        }
        break;
      }
      case 0xBD: { // LDA abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          this.a = (this.a & 0xFF00) | this.read(bank, addr);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 4;
        } else {
          this.a = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 5;
        }
        break;
      }
      case 0xB9: { // LDA abs, Y
        const base = this.readOperandWord();
        const addr = (base + this.y) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          this.a = (this.a & 0xFF00) | this.read(bank, addr);
          this.updateNZFlags(this.a & 0xFF, true);
          opCycles = 4;
        } else {
          this.a = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          this.updateNZFlags(this.a, false);
          opCycles = 5;
        }
        break;
      }

      // --- STA extra modes
      case 0x92: { // STA (direct)
        const target = this.readDpIndirectAddr();
        const is8 = this.isAcc8();
        if (is8) {
          this.write(target.bank, target.addr, this.a & 0xFF);
          opCycles = 5;
        } else {
          this.write(target.bank, target.addr, this.a & 0xFF);
          this.write(target.bank, (target.addr + 1) & 0xFFFF, (this.a >> 8) & 0xFF);
          opCycles = 6;
        }
        break;
      }
      case 0x91: { // STA (direct), Y
        const target = this.readDpIndirectYAddr();
        const is8 = this.isAcc8();
        if (is8) {
          this.write(target.bank, target.addr, this.a & 0xFF);
          opCycles = 5;
        } else {
          this.write(target.bank, target.addr, this.a & 0xFF);
          this.write(target.bank, (target.addr + 1) & 0xFFFF, (this.a >> 8) & 0xFF);
          opCycles = 6;
        }
        break;
      }
      case 0x81: { // STA (direct, X)
        const target = this.readDpIndexedXIndirectAddr();
        const is8 = this.isAcc8();
        if (is8) {
          this.write(target.bank, target.addr, this.a & 0xFF);
          opCycles = 6;
        } else {
          this.write(target.bank, target.addr, this.a & 0xFF);
          this.write(target.bank, (target.addr + 1) & 0xFFFF, (this.a >> 8) & 0xFF);
          opCycles = 7;
        }
        break;
      }
      case 0x99: { // STA abs, Y
        const base = this.readOperandWord();
        const addr = (base + this.y) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          this.write(bank, addr, this.a & 0xFF);
          opCycles = 5;
        } else {
          this.write(bank, addr, this.a & 0xFF);
          this.write(bank, addr + 1, (this.a >> 8) & 0xFF);
          opCycles = 6;
        }
        break;
      }

      // --- Misc / New instructions
      case 0xF4: { // PEA (Push Effective Absolute Address)
        const val = this.readOperandWord();
        this.pushWord(val);
        opCycles = 4;
        break;
      }
      case 0xFE: { // INC abs, X
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const inc = (val + 1) & 0xFF;
          this.write(bank, addr, inc);
          this.updateNZFlags(inc, true);
          opCycles = 7;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const inc = (val + 1) & 0xFFFF;
          this.write(bank, addr, inc & 0xFF);
          this.write(bank, addr + 1, (inc >> 8) & 0xFF);
          this.updateNZFlags(inc, false);
          opCycles = 8;
        }
        break;
      }
      case 0xCE: { // DEC abs
        const addr = this.readOperandWord();
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const dec = (val - 1) & 0xFF;
          this.write(bank, addr, dec);
          this.updateNZFlags(dec, true);
          opCycles = 6;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const dec = (val - 1) & 0xFFFF;
          this.write(bank, addr, dec & 0xFF);
          this.write(bank, addr + 1, (dec >> 8) & 0xFF);
          this.updateNZFlags(dec, false);
          opCycles = 7;
        }
        break;
      }
      case 0xEE: { // INC abs
        const addr = this.readOperandWord();
        const bank = this.db;
        const is8 = this.isAcc8();
        if (is8) {
          const val = this.read(bank, addr);
          const inc = (val + 1) & 0xFF;
          this.write(bank, addr, inc);
          this.updateNZFlags(inc, true);
          opCycles = 6;
        } else {
          const val = this.read(bank, addr) | (this.read(bank, addr + 1) << 8);
          const inc = (val + 1) & 0xFFFF;
          this.write(bank, addr, inc & 0xFF);
          this.write(bank, addr + 1, (inc >> 8) & 0xFF);
          this.updateNZFlags(inc, false);
          opCycles = 7;
        }
        break;
      }
      case 0x7C: { // JMP (abs, X)
        const base = this.readOperandWord();
        const addr = (base + this.x) & 0xFFFF;
        this.pc = this.read(this.pb, addr) | (this.read(this.pb, (addr + 1) & 0xFFFF) << 8);
        opCycles = 6;
        break;
      }

      // --- Block Moves
      case 0x54: { // MVN destBank, srcBank (Copies next, increments X and Y)
        const destBank = this.readOperandByte();
        const srcBank = this.readOperandByte();
        
        // Update DBR to destination bank
        this.db = destBank;
        
        const count = (this.a & 0xFFFF) + 1;
        const mask = this.isIndex8() ? 0xFF : 0xFFFF;
        this.x &= mask;
        this.y &= mask;
        
        for (let i = 0; i < count; i++) {
          const val = this.read(srcBank, this.x);
          this.write(destBank, this.y, val);
          
          this.x = (this.x + 1) & mask;
          this.y = (this.y + 1) & mask;
        }
        
        // Accumulator ends at 0xFFFF
        this.a = 0xFFFF;
        
        // MVN takes 7 cycles per byte transfer plus 7 cycles overhead
        opCycles = 7 * count + 7;
        break;
      }
      case 0x44: { // MVP destBank, srcBank (Copies previous, decrements X and Y)
        const destBank = this.readOperandByte();
        const srcBank = this.readOperandByte();
        
        // Update DBR to destination bank
        this.db = destBank;
        
        const count = (this.a & 0xFFFF) + 1;
        const mask = this.isIndex8() ? 0xFF : 0xFFFF;
        this.x &= mask;
        this.y &= mask;
        
        for (let i = 0; i < count; i++) {
          const val = this.read(srcBank, this.x);
          this.write(destBank, this.y, val);
          
          this.x = (this.x - 1) & mask;
          this.y = (this.y - 1) & mask;
        }
        
        // Accumulator ends at 0xFFFF
        this.a = 0xFFFF;
        
        // MVP takes 7 cycles per byte transfer plus 7 cycles overhead
        opCycles = 7 * count + 7;
        break;
      }

      // --- ORA Opcodes (Missing)
      case 0x01: { this.oraVal(this.readMemoryValue(this.readDpIndexedXIndirectAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0x07: { this.oraVal(this.readMemoryValue(this.readDpIndirectLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0x0F: { this.oraVal(this.readMemoryValue(this.readLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0x11: { this.oraVal(this.readMemoryValue(this.readDpIndirectYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0x12: { this.oraVal(this.readMemoryValue(this.readDpIndirectAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0x13: { this.oraVal(this.readMemoryValue(this.readSrIndYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 7; break; }
      case 0x17: { this.oraVal(this.readMemoryValue(this.readDpIndirectLongIndexedYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0x1F: { this.oraVal(this.readMemoryValue(this.readLongXAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }

      // --- AND Opcodes (Missing)
      case 0x21: { this.andVal(this.readMemoryValue(this.readDpIndexedXIndirectAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0x23: { this.andVal(this.readMemoryValue(this.readSrAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0x25: { this.andVal(this.readMemoryValue(this.readDpAddr(), this.isAcc8()), this.isAcc8()); opCycles = 3; break; }
      case 0x27: { this.andVal(this.readMemoryValue(this.readDpIndirectLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0x2D: { this.andVal(this.readMemoryValue({ bank: this.db, addr: this.readOperandWord() }, this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0x2F: { this.andVal(this.readMemoryValue(this.readLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0x31: { this.andVal(this.readMemoryValue(this.readDpIndirectYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0x32: { this.andVal(this.readMemoryValue(this.readDpIndirectAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0x33: { this.andVal(this.readMemoryValue(this.readSrIndYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 7; break; }
      case 0x35: { this.andVal(this.readMemoryValue(this.readDpXAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0x37: { this.andVal(this.readMemoryValue(this.readDpIndirectLongIndexedYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0x39: { this.andVal(this.readMemoryValue(this.readAbsYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0x3D: { this.andVal(this.readMemoryValue(this.readAbsXAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }

      // --- EOR Opcodes (Missing)
      case 0x41: { this.eorVal(this.readMemoryValue(this.readDpIndexedXIndirectAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0x43: { this.eorVal(this.readMemoryValue(this.readSrAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0x45: { this.eorVal(this.readMemoryValue(this.readDpAddr(), this.isAcc8()), this.isAcc8()); opCycles = 3; break; }
      case 0x47: { this.eorVal(this.readMemoryValue(this.readDpIndirectLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0x4F: { this.eorVal(this.readMemoryValue(this.readLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0x51: { this.eorVal(this.readMemoryValue(this.readDpIndirectYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0x52: { this.eorVal(this.readMemoryValue(this.readDpIndirectAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0x53: { this.eorVal(this.readMemoryValue(this.readSrIndYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 7; break; }
      case 0x55: { this.eorVal(this.readMemoryValue(this.readDpXAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0x57: { this.eorVal(this.readMemoryValue(this.readDpIndirectLongIndexedYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0x59: { this.eorVal(this.readMemoryValue(this.readAbsYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0x5D: { this.eorVal(this.readMemoryValue(this.readAbsXAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0x5F: { this.eorVal(this.readMemoryValue(this.readLongXAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }

      // --- ADC Opcodes (Missing)
      case 0x63: { this.adcVal(this.readMemoryValue(this.readSrAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0x6F: { this.adcVal(this.readMemoryValue(this.readLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0x73: { this.adcVal(this.readMemoryValue(this.readSrIndYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 7; break; }
      case 0x75: { this.adcVal(this.readMemoryValue(this.readDpXAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0x77: { this.adcVal(this.readMemoryValue(this.readDpIndirectLongIndexedYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }

      // --- SBC Opcodes (Missing)
      case 0xE3: { this.sbcVal(this.readMemoryValue(this.readSrAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0xE7: { this.sbcVal(this.readMemoryValue(this.readDpIndirectLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0xEF: { this.sbcVal(this.readMemoryValue(this.readLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0xF3: { this.sbcVal(this.readMemoryValue(this.readSrIndYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 7; break; }
      case 0xF5: { this.sbcVal(this.readMemoryValue(this.readDpXAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0xF7: { this.sbcVal(this.readMemoryValue(this.readDpIndirectLongIndexedYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }

      // --- CMP Opcodes (Missing)
      case 0xC1: { this.cmpVal(this.readMemoryValue(this.readDpIndexedXIndirectAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0xC3: { this.cmpVal(this.readMemoryValue(this.readSrAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0xC5: { this.cmpVal(this.readMemoryValue(this.readDpAddr(), this.isAcc8()), this.isAcc8()); opCycles = 3; break; }
      case 0xC7: { this.cmpVal(this.readMemoryValue(this.readDpIndirectLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }
      case 0xCF: { this.cmpVal(this.readMemoryValue(this.readLongAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0xD1: { this.cmpVal(this.readMemoryValue(this.readDpIndirectYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0xD2: { this.cmpVal(this.readMemoryValue(this.readDpIndirectAddr(), this.isAcc8()), this.isAcc8()); opCycles = 5; break; }
      case 0xD3: { this.cmpVal(this.readMemoryValue(this.readSrIndYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 7; break; }
      case 0xD5: { this.cmpVal(this.readMemoryValue(this.readDpXAddr(), this.isAcc8()), this.isAcc8()); opCycles = 4; break; }
      case 0xD7: { this.cmpVal(this.readMemoryValue(this.readDpIndirectLongIndexedYAddr(), this.isAcc8()), this.isAcc8()); opCycles = 6; break; }

      // --- COP, TSB, TRB, Shifts, Branches, and control (Missing)
      case 0x02: {
        const operand = this.readOperandByte(); // dummy payload
        if (this.e === 0) {
          this.pushByte(this.pb);
          this.pushWord(this.pc);
          this.pushByte(this.p);
        } else {
          this.pushWord(this.pc);
          this.pushByte(this.p);
        }
        this.setFlag(CPUFlags.InterruptDisable, true);
        this.setFlag(CPUFlags.Decimal, false);
        this.pb = 0;
        this.pc = this.bus.readWord(0, this.e === 1 ? 0xFFF4 : 0xFFE4);
        opCycles = 7;
        break;
      }
      case 0x04: {
        const target = this.readDpAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const reg = is8 ? (this.a & 0xFF) : this.a;
        this.setFlag(CPUFlags.Zero, (reg & val) === 0);
        this.writeValue(target.bank, target.addr, val | reg);
        opCycles = is8 ? 5 : 7;
        break;
      }
      case 0x0C: {
        const target = { bank: this.db, addr: this.readOperandWord() };
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const reg = is8 ? (this.a & 0xFF) : this.a;
        this.setFlag(CPUFlags.Zero, (reg & val) === 0);
        this.writeValue(target.bank, target.addr, val | reg);
        opCycles = is8 ? 6 : 8;
        break;
      }
      case 0x14: {
        const target = this.readDpAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const reg = is8 ? (this.a & 0xFF) : this.a;
        this.setFlag(CPUFlags.Zero, (reg & val) === 0);
        this.writeValue(target.bank, target.addr, val & ~reg);
        opCycles = is8 ? 5 : 7;
        break;
      }
      case 0x1C: {
        const target = { bank: this.db, addr: this.readOperandWord() };
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const reg = is8 ? (this.a & 0xFF) : this.a;
        this.setFlag(CPUFlags.Zero, (reg & val) === 0);
        this.writeValue(target.bank, target.addr, val & ~reg);
        opCycles = is8 ? 6 : 8;
        break;
      }
      case 0x16: {
        const target = this.readDpXAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const res = this.aslVal(val, is8);
        this.writeValue(target.bank, target.addr, res);
        opCycles = is8 ? 6 : 8;
        break;
      }
      case 0x24: {
        const target = this.readDpAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const reg = is8 ? (this.a & 0xFF) : this.a;
        this.setFlag(CPUFlags.Zero, (reg & val) === 0);
        const signBit = is8 ? 0x80 : 0x8000;
        const overflowBit = is8 ? 0x40 : 0x4000;
        this.setFlag(CPUFlags.Negative, (val & signBit) !== 0);
        this.setFlag(CPUFlags.Overflow, (val & overflowBit) !== 0);
        opCycles = is8 ? 3 : 4;
        break;
      }
      case 0x2C: {
        const target = { bank: this.db, addr: this.readOperandWord() };
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const reg = is8 ? (this.a & 0xFF) : this.a;
        this.setFlag(CPUFlags.Zero, (reg & val) === 0);
        const signBit = is8 ? 0x80 : 0x8000;
        const overflowBit = is8 ? 0x40 : 0x4000;
        this.setFlag(CPUFlags.Negative, (val & signBit) !== 0);
        this.setFlag(CPUFlags.Overflow, (val & overflowBit) !== 0);
        opCycles = is8 ? 4 : 5;
        break;
      }
      case 0x34: {
        const target = this.readDpXAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const reg = is8 ? (this.a & 0xFF) : this.a;
        this.setFlag(CPUFlags.Zero, (reg & val) === 0);
        const signBit = is8 ? 0x80 : 0x8000;
        const overflowBit = is8 ? 0x40 : 0x4000;
        this.setFlag(CPUFlags.Negative, (val & signBit) !== 0);
        this.setFlag(CPUFlags.Overflow, (val & overflowBit) !== 0);
        opCycles = is8 ? 4 : 5;
        break;
      }
      case 0x3C: {
        const target = this.readAbsXAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const reg = is8 ? (this.a & 0xFF) : this.a;
        this.setFlag(CPUFlags.Zero, (reg & val) === 0);
        const signBit = is8 ? 0x80 : 0x8000;
        const overflowBit = is8 ? 0x40 : 0x4000;
        this.setFlag(CPUFlags.Negative, (val & signBit) !== 0);
        this.setFlag(CPUFlags.Overflow, (val & overflowBit) !== 0);
        opCycles = is8 ? 4 : 5;
        break;
      }
      case 0x36: {
        const target = this.readDpXAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const res = this.rolVal(val, is8);
        this.writeValue(target.bank, target.addr, res);
        opCycles = is8 ? 6 : 8;
        break;
      }
      case 0x42: {
        this.readOperandByte(); // ignore dummy byte
        opCycles = 2;
        break;
      }
      case 0x56: {
        const target = this.readDpXAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const res = this.lsrVal(val, is8);
        this.writeValue(target.bank, target.addr, res);
        opCycles = is8 ? 6 : 8;
        break;
      }
      case 0x62: {
        const disp = this.readOperandWord();
        const signedDisp = disp > 32767 ? disp - 65536 : disp;
        const addr = (this.pc + signedDisp) & 0xFFFF;
        this.pushWord(addr);
        opCycles = 6;
        break;
      }
      case 0x6C: {
        const addr = this.readOperandWord();
        this.pc = this.read(0, addr) | (this.read(0, (addr + 1) & 0xFFFF) << 8);
        opCycles = 5;
        break;
      }
      case 0x76: {
        const target = this.readDpXAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const res = this.rorVal(val, is8);
        this.writeValue(target.bank, target.addr, res);
        opCycles = is8 ? 6 : 8;
        break;
      }
      case 0x82: {
        const offset = this.readOperandWord();
        const signedOffset = offset > 32767 ? offset - 65536 : offset;
        this.pc = (this.pc + signedOffset) & 0xFFFF;
        opCycles = 4;
        break;
      }
      case 0x83: {
        const target = this.readSrAddr();
        const val = this.isAcc8() ? (this.a & 0xFF) : this.a;
        this.writeValue(target.bank, target.addr, val);
        opCycles = 4;
        break;
      }
      case 0x87: {
        const target = this.readDpIndirectLongAddr();
        const val = this.isAcc8() ? (this.a & 0xFF) : this.a;
        this.writeValue(target.bank, target.addr, val);
        opCycles = 6;
        break;
      }
      case 0x93: {
        const target = this.readSrIndYAddr();
        const val = this.isAcc8() ? (this.a & 0xFF) : this.a;
        this.writeValue(target.bank, target.addr, val);
        opCycles = 7;
        break;
      }
      case 0x94: {
        const target = this.readDpXAddr();
        const val = this.isIndex8() ? (this.y & 0xFF) : this.y;
        if (this.isIndex8()) {
          this.write(target.bank, target.addr, val);
        } else {
          this.write(target.bank, target.addr, val & 0xFF);
          this.write(target.bank, (target.addr + 1) & 0xFFFF, (val >> 8) & 0xFF);
        }
        opCycles = 4;
        break;
      }
      case 0x96: {
        const target = this.readDpYAddr();
        const val = this.isIndex8() ? (this.x & 0xFF) : this.x;
        if (this.isIndex8()) {
          this.write(target.bank, target.addr, val);
        } else {
          this.write(target.bank, target.addr, val & 0xFF);
          this.write(target.bank, (target.addr + 1) & 0xFFFF, (val >> 8) & 0xFF);
        }
        opCycles = 4;
        break;
      }
      case 0xB3: {
        const target = this.readSrIndYAddr();
        this.a = this.isAcc8() ? (this.a & 0xFF00) | this.read(target.bank, target.addr) : this.readMemoryValue(target, false);
        this.updateNZFlags(this.isAcc8() ? (this.a & 0xFF) : this.a, this.isAcc8());
        opCycles = 7;
        break;
      }
      case 0xB4: {
        const target = this.readDpXAddr();
        this.y = this.isIndex8() ? this.read(target.bank, target.addr) : (this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8));
        this.updateNZFlags(this.isIndex8() ? (this.y & 0xFF) : this.y, this.isIndex8());
        opCycles = 4;
        break;
      }
      case 0xB5: {
        const target = this.readDpXAddr();
        this.a = this.isAcc8() ? (this.a & 0xFF00) | this.read(target.bank, target.addr) : this.readMemoryValue(target, false);
        this.updateNZFlags(this.isAcc8() ? (this.a & 0xFF) : this.a, this.isAcc8());
        opCycles = 4;
        break;
      }
      case 0xB6: {
        const target = this.readDpYAddr();
        this.x = this.isIndex8() ? this.read(target.bank, target.addr) : (this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8));
        this.updateNZFlags(this.isIndex8() ? (this.x & 0xFF) : this.x, this.isIndex8());
        opCycles = 4;
        break;
      }
      case 0xB8: {
        this.setFlag(CPUFlags.Overflow, false);
        opCycles = 2;
        break;
      }
      case 0xD4: {
        const offset = this.readOperandByte();
        const dpAddr = (this.d + offset) & 0xFFFF;
        const addr = this.read(0, dpAddr) | (this.read(0, (dpAddr + 1) & 0xFFFF) << 8);
        this.pushWord(addr);
        opCycles = 6;
        break;
      }
      case 0xD6: {
        const target = this.readDpXAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const mask = is8 ? 0xFF : 0xFFFF;
        const res = (val - 1) & mask;
        this.updateNZFlags(res, is8);
        this.writeValue(target.bank, target.addr, res);
        opCycles = is8 ? 6 : 8;
        break;
      }
      case 0xDB: {
        this.pc = (this.pc - 1) & 0xFFFF; // Halt execution
        opCycles = 3;
        break;
      }
      case 0xDC: {
        const addr = this.readOperandWord();
        const low = this.read(0, addr);
        const high = this.read(0, (addr + 1) & 0xFFFF);
        const bank = this.read(0, (addr + 2) & 0xFFFF);
        this.pb = bank;
        this.pc = low | (high << 8);
        opCycles = 6;
        break;
      }
      case 0xDE: {
        const target = this.readAbsXAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const mask = is8 ? 0xFF : 0xFFFF;
        const res = (val - 1) & mask;
        this.updateNZFlags(res, is8);
        this.writeValue(target.bank, target.addr, res);
        opCycles = is8 ? 7 : 8;
        break;
      }
      case 0xF6: {
        const target = this.readDpXAddr();
        const is8 = this.isAcc8();
        const val = this.readMemoryValue(target, is8);
        const mask = is8 ? 0xFF : 0xFFFF;
        const res = (val + 1) & mask;
        this.updateNZFlags(res, is8);
        this.writeValue(target.bank, target.addr, res);
        opCycles = is8 ? 6 : 8;
        break;
      }

      // --- Unimplemented Opcode Fallback
      default: {
        const opcodeAddr = (startPc) & 0xFFFF;
        const res = Disassembler.disassemble(
          this.bus,
          startPb,
          opcodeAddr,
          this.isAcc8(),
          this.isIndex8()
        );
        throw new Error(`Unimplemented SNES opcode: 0x${opcode.toString(16).toUpperCase()} (${res.disassembly}) at PB:PC = ${startPb.toString(16).toUpperCase()}:${opcodeAddr.toString(16).toUpperCase()}`);
      }
    }

    this.cycles += opCycles;
    this.totalCycles += opCycles;
    return opCycles;
  }

  private sbcVal(val: number, is8: boolean) {
    const reg = is8 ? (this.a & 0xFF) : this.a;
    const carry = this.getFlag(CPUFlags.Carry) ? 1 : 0;
    const borrow = 1 - carry;
    
    if (this.getFlag(CPUFlags.Decimal)) {
      if (is8) {
        // 8-bit BCD subtraction
        const binResult = reg - val - borrow;
        const overflow = ((reg ^ val) & (reg ^ binResult) & 0x80) !== 0;
        this.setFlag(CPUFlags.Overflow, overflow);

        let ln = (reg & 0x0F) - (val & 0x0F) - borrow;
        let hn = (reg & 0xF0) - (val & 0xF0) - (ln < 0 ? 0x10 : 0);
        
        if (ln < 0) {
          ln = (ln - 6) & 0x0F;
        }
        if (hn < 0) {
          hn = (hn - 0x60);
        }
        
        this.setFlag(CPUFlags.Carry, hn >= 0);
        const bcdResult = (hn & 0xF0) | (ln & 0x0F);
        this.a = (this.a & 0xFF00) | bcdResult;
        this.updateNZFlags(bcdResult, true);
      } else {
        // 16-bit BCD subtraction
        const binResult = reg - val - borrow;
        const overflow = ((reg ^ val) & (reg ^ binResult) & 0x8000) !== 0;
        this.setFlag(CPUFlags.Overflow, overflow);

        let d0 = (reg & 0xF) - (val & 0xF) - borrow;
        let d1 = ((reg >> 4) & 0xF) - ((val >> 4) & 0xF) - (d0 < 0 ? 1 : 0);
        let d2 = ((reg >> 8) & 0xF) - ((val >> 8) & 0xF) - (d1 < 0 ? 1 : 0);
        let d3 = ((reg >> 12) & 0xF) - ((val >> 12) & 0xF) - (d2 < 0 ? 1 : 0);
        
        if (d0 < 0) d0 = (d0 - 6) & 0xF;
        if (d1 < 0) d1 = (d1 - 6) & 0xF;
        if (d2 < 0) d2 = (d2 - 6) & 0xF;
        
        this.setFlag(CPUFlags.Carry, d3 >= 0);
        if (d3 < 0) d3 = (d3 - 6) & 0xF;
        
        const bcdResult = d0 | (d1 << 4) | (d2 << 8) | (d3 << 12);
        this.a = bcdResult;
        this.updateNZFlags(bcdResult, false);
      }
    } else {
      // Binary subtraction
      let result = reg - val - borrow;
      const mask = is8 ? 0xFF : 0xFFFF;
      const signBit = is8 ? 0x80 : 0x8000;
      this.setFlag(CPUFlags.Carry, result >= 0);
      const overflow = ((reg ^ val) & (reg ^ result) & signBit) !== 0;
      this.setFlag(CPUFlags.Overflow, overflow);
      result &= mask;
      this.a = is8 ? (this.a & 0xFF00) | result : result;
      this.updateNZFlags(result, is8);
    }
  }

  private aslVal(val: number, is8: boolean): number {
    const mask = is8 ? 0xFF : 0xFFFF;
    const carryBit = is8 ? 0x80 : 0x8000;
    this.setFlag(CPUFlags.Carry, (val & carryBit) !== 0);
    const result = (val << 1) & mask;
    this.updateNZFlags(result, is8);
    return result;
  }

  private lsrVal(val: number, is8: boolean): number {
    this.setFlag(CPUFlags.Carry, (val & 1) !== 0);
    const result = val >> 1;
    this.updateNZFlags(result, is8);
    return result;
  }

  private rolVal(val: number, is8: boolean): number {
    const carry = this.getFlag(CPUFlags.Carry) ? 1 : 0;
    const carryBit = is8 ? 0x80 : 0x8000;
    const mask = is8 ? 0xFF : 0xFFFF;
    this.setFlag(CPUFlags.Carry, (val & carryBit) !== 0);
    const result = ((val << 1) | carry) & mask;
    this.updateNZFlags(result, is8);
    return result;
  }

  private rorVal(val: number, is8: boolean): number {
    const carry = this.getFlag(CPUFlags.Carry) ? 1 : 0;
    const highBit = is8 ? 0x80 : 0x8000;
    this.setFlag(CPUFlags.Carry, (val & 1) !== 0);
    const result = (val >> 1) | (carry ? highBit : 0);
    this.updateNZFlags(result, is8);
    return result;
  }

  private readDpIndirectAddr(): { bank: number, addr: number } {
    const offset = this.readOperandByte();
    const dpAddr = (this.d + offset) & 0xFFFF;
    const targetAddr = this.read(0, dpAddr) | (this.read(0, dpAddr + 1) << 8);
    return { bank: this.db, addr: targetAddr };
  }

  private readDpIndirectYAddr(): { bank: number, addr: number } {
    const offset = this.readOperandByte();
    const dpAddr = (this.d + offset) & 0xFFFF;
    const baseAddr = this.read(0, dpAddr) | (this.read(0, dpAddr + 1) << 8);
    const targetAddr = (baseAddr + this.y) & 0xFFFF;
    return { bank: this.db, addr: targetAddr };
  }

  private readDpIndexedXIndirectAddr(): { bank: number, addr: number } {
    const offset = this.readOperandByte();
    const dpAddr = (this.d + offset + this.x) & 0xFFFF;
    const targetAddr = this.read(0, dpAddr) | (this.read(0, dpAddr + 1) << 8);
    return { bank: this.db, addr: targetAddr };
  }

  private readDpIndirectLongIndexedYAddr(): { bank: number, addr: number } {
    const offset = this.readOperandByte();
    const dpAddr = (this.d + offset) & 0xFFFF;
    const low = this.read(0, dpAddr);
    const high = this.read(0, (dpAddr + 1) & 0xFFFF);
    const bank = this.read(0, (dpAddr + 2) & 0xFFFF);
    const baseAddr = low | (high << 8) | (bank << 16);
    const targetAddr = (baseAddr + this.y) & 0xFFFFFF;
    return { bank: (targetAddr >> 16) & 0xFF, addr: targetAddr & 0xFFFF };
  }

  private readDpIndirectLongAddr(): { bank: number, addr: number } {
    const offset = this.readOperandByte();
    const dpAddr = (this.d + offset) & 0xFFFF;
    const low = this.read(0, dpAddr);
    const high = this.read(0, (dpAddr + 1) & 0xFFFF);
    const bank = this.read(0, (dpAddr + 2) & 0xFFFF);
    return { bank, addr: low | (high << 8) };
  }

  private readMemoryValue(target: { bank: number, addr: number }, is8: boolean): number {
    return is8 ? this.read(target.bank, target.addr) : (this.read(target.bank, target.addr) | (this.read(target.bank, (target.addr + 1) & 0xFFFF) << 8));
  }

  private writeValue(bank: number, addr: number, val: number) {
    if (this.isAcc8()) {
      this.write(bank, addr, val & 0xFF);
    } else {
      this.write(bank, addr, val & 0xFF);
      this.write(bank, (addr + 1) & 0xFFFF, (val >> 8) & 0xFF);
    }
  }

  private readDpAddr(): { bank: number, addr: number } {
    const offset = this.readOperandByte();
    return { bank: 0, addr: (this.d + offset) & 0xFFFF };
  }

  private readDpXAddr(): { bank: number, addr: number } {
    const offset = this.readOperandByte();
    return { bank: 0, addr: (this.d + offset + this.x) & 0xFFFF };
  }

  private readDpYAddr(): { bank: number, addr: number } {
    const offset = this.readOperandByte();
    return { bank: 0, addr: (this.d + offset + this.y) & 0xFFFF };
  }

  private readAbsXAddr(): { bank: number, addr: number } {
    const base = this.readOperandWord();
    return { bank: this.db, addr: (base + this.x) & 0xFFFF };
  }

  private readAbsYAddr(): { bank: number, addr: number } {
    const base = this.readOperandWord();
    return { bank: this.db, addr: (base + this.y) & 0xFFFF };
  }

  private readLongAddr(): { bank: number, addr: number } {
    const low = this.readOperandByte();
    const high = this.readOperandByte();
    const bank = this.readOperandByte();
    return { bank, addr: low | (high << 8) };
  }

  private readLongXAddr(): { bank: number, addr: number } {
    const low = this.readOperandByte();
    const high = this.readOperandByte();
    const bank = this.readOperandByte();
    const base = low | (high << 8) | (bank << 16);
    const target = (base + this.x) & 0xFFFFFF;
    return { bank: (target >> 16) & 0xFF, addr: target & 0xFFFF };
  }

  private readSrAddr(): { bank: number, addr: number } {
    const offset = this.readOperandByte();
    return { bank: 0, addr: (this.s + offset) & 0xFFFF };
  }

  private readSrIndYAddr(): { bank: number, addr: number } {
    const offset = this.readOperandByte();
    const base = (this.s + offset) & 0xFFFF;
    const addr = this.read(0, base) | (this.read(0, (base + 1) & 0xFFFF) << 8);
    return { bank: this.db, addr: (addr + this.y) & 0xFFFF };
  }

  private oraVal(val: number, is8: boolean) {
    const reg = is8 ? (this.a & 0xFF) : this.a;
    const res = reg | val;
    this.a = is8 ? (this.a & 0xFF00) | res : res;
    this.updateNZFlags(res, is8);
  }

  private andVal(val: number, is8: boolean) {
    const reg = is8 ? (this.a & 0xFF) : this.a;
    const res = reg & val;
    this.a = is8 ? (this.a & 0xFF00) | res : res;
    this.updateNZFlags(res, is8);
  }

  private eorVal(val: number, is8: boolean) {
    const reg = is8 ? (this.a & 0xFF) : this.a;
    const res = reg ^ val;
    this.a = is8 ? (this.a & 0xFF00) | res : res;
    this.updateNZFlags(res, is8);
  }

  private adcVal(val: number, is8: boolean) {
    const reg = is8 ? (this.a & 0xFF) : this.a;
    const carry = this.getFlag(CPUFlags.Carry) ? 1 : 0;
    
    if (this.getFlag(CPUFlags.Decimal)) {
      if (is8) {
        // 8-bit BCD addition
        let ln = (reg & 0x0F) + (val & 0x0F) + carry;
        let hn = (reg & 0xF0) + (val & 0xF0) + (ln > 9 ? 0x10 : 0);
        
        // Overflow flag is calculated on binary addition of reg and val
        const binResult = reg + val + carry;
        const overflow = ((reg ^ binResult) & (val ^ binResult) & 0x80) !== 0;
        this.setFlag(CPUFlags.Overflow, overflow);
        
        if (ln > 9) {
          ln = (ln + 6) & 0x0F;
        }
        if (hn > 0x90) {
          hn = (hn + 0x60);
        }
        
        this.setFlag(CPUFlags.Carry, hn > 0xFF);
        const bcdResult = (hn & 0xF0) | (ln & 0x0F);
        this.a = (this.a & 0xFF00) | bcdResult;
        this.updateNZFlags(bcdResult, true);
      } else {
        // 16-bit BCD addition
        const binResult = reg + val + carry;
        const overflow = ((reg ^ binResult) & (val ^ binResult) & 0x8000) !== 0;
        this.setFlag(CPUFlags.Overflow, overflow);

        let d0 = (reg & 0xF) + (val & 0xF) + carry;
        let d1 = ((reg >> 4) & 0xF) + ((val >> 4) & 0xF) + (d0 > 9 ? 1 : 0);
        let d2 = ((reg >> 8) & 0xF) + ((val >> 8) & 0xF) + (d1 > 9 ? 1 : 0);
        let d3 = ((reg >> 12) & 0xF) + ((val >> 12) & 0xF) + (d2 > 9 ? 1 : 0);
        
        if (d0 > 9) d0 = (d0 + 6) & 0xF;
        if (d1 > 9) d1 = (d1 + 6) & 0xF;
        if (d2 > 9) d2 = (d2 + 6) & 0xF;
        
        this.setFlag(CPUFlags.Carry, d3 > 9);
        if (d3 > 9) d3 = (d3 + 6) & 0xF;
        
        const bcdResult = d0 | (d1 << 4) | (d2 << 8) | (d3 << 12);
        this.a = bcdResult;
        this.updateNZFlags(bcdResult, false);
      }
    } else {
      // Binary addition
      let result = reg + val + carry;
      const mask = is8 ? 0xFF : 0xFFFF;
      const overflowMask = is8 ? 0x80 : 0x8000;
      this.setFlag(CPUFlags.Carry, result > mask);
      const overflow = ((reg ^ result) & (val ^ result) & overflowMask) !== 0;
      this.setFlag(CPUFlags.Overflow, overflow);
      result &= mask;
      this.a = is8 ? (this.a & 0xFF00) | result : result;
      this.updateNZFlags(result, is8);
    }
  }

  private cmpVal(val: number, is8: boolean) {
    const reg = is8 ? (this.a & 0xFF) : this.a;
    const sub = reg - val;
    this.setFlag(CPUFlags.Carry, sub >= 0);
    this.updateNZFlags(sub, is8);
  }

  private handleBranch(condition: boolean): number {
    const offset = this.readOperandByte();
    // Offset is signed 8-bit
    const signedOffset = offset > 127 ? offset - 256 : offset;
    let cycles = 2;

    if (condition) {
      cycles += 1;
      const oldPc = this.pc;
      this.pc = (this.pc + signedOffset) & 0xFFFF;
      // Cross page boundary cycle check
      if ((oldPc & 0xFF00) !== (this.pc & 0xFF00)) {
        cycles += 1;
      }
    }
    return cycles;
  }

  public triggerNmi(): void {
    // Wake CPU if it was halted by WAI
    this.waiting = false;

    // Push registers to stack based on native vs emulation mode
    if (this.e === 0) {
      // Native mode: push PB, PC, P
      this.pushByte(this.pb);
      this.pushWord(this.pc);
      this.pushByte(this.p);
    } else {
      // Emulation mode: push PC, P (no PB)
      this.pushWord(this.pc);
      this.pushByte(this.p);
    }
    
    // Set Interrupt Disable and Clear Decimal Mode
    this.setFlag(CPUFlags.InterruptDisable, true);
    this.setFlag(CPUFlags.Decimal, false);
    
    this.pb = 0;
    // NMI vector is at $FFEA in Native mode, or $FFFA in Emulation mode
    const vectorAddr = this.e === 1 ? 0xFFFA : 0xFFEA;
    this.pc = this.bus.readWord(0, vectorAddr);
  }

  public triggerIrq() {
    // Wake CPU if it was halted by WAI
    this.waiting = false;

    // Push registers to stack based on native vs emulation mode
    if (this.e === 0) {
      // Native mode: push PB, PC, P
      this.pushByte(this.pb);
      this.pushWord(this.pc);
      this.pushByte(this.p);
    } else {
      // Emulation mode: push PC, P (no PB)
      this.pushWord(this.pc);
      this.pushByte(this.p);
    }
    
    // Set Interrupt Disable and Clear Decimal Mode
    this.setFlag(CPUFlags.InterruptDisable, true);
    this.setFlag(CPUFlags.Decimal, false);
    
    this.pb = 0;
    // IRQ vector is at $FFEE in Native mode, or $FFFE in Emulation mode
    const vectorAddr = this.e === 1 ? 0xFFFE : 0xFFEE;
    this.pc = this.bus.readWord(0, vectorAddr);
  }
}
