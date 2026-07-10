// Sharp LR35902 CPU (Game Boy CPU, similar to Z80 but stripped down).
// Runs at ~4.19 MHz. Each instruction takes a multiple of 4 T-cycles (1 M-cycle).
//
// Registers:
//   A (8-bit accumulator), F (flags: Z N H C in bits 7,6,5,4)
//   B C D E H L (8-bit general purpose)
//   SP (16-bit stack pointer), PC (16-bit program counter)
//   AF BC DE HL (16-bit register pairs; HL is the only one with arithmetic ops)
//
// We model the CPU with a "cycle-accurate enough" model: every opcode returns
// its M-cycle count. The main loop then advances PPU/Timer/Serial by that many
// M-cycles. This is accurate enough to pass Blargg's tests and run commercial games.
//
// Flags: bit 7 = Zero, bit 6 = Subtract, bit 5 = Half-carry, bit 4 = Carry.
// Unused bits 0-3 are always 0.

import { MMU } from "./mmu";

export class CPU {
  // Registers
  a: number = 0x01;
  b: number = 0x00;
  c: number = 0x13;
  d: number = 0x00;
  e: number = 0xD8;
  h: number = 0x01;
  l: number = 0x4D;
  sp: number = 0xFFFE;
  pc: number = 0x0100;
  f: number = 0xB0;     // Z=1, N=0, H=1, C=0 (matches post-boot state)

  // IME: Interrupt Master Enable (delayed by EI via imeScheduled)
  ime: boolean = false;
  imeScheduled: boolean = false;

  // Halt state
  halted: boolean = false;
  haltBug: boolean = false;

  // Stop state
  stopped: boolean = false;

  // Cycle accounting
  totalCycles: number = 0;   // Total M-cycles executed
  tickedCycles: number = 0;

  mmu: MMU;

  // Interrupt bit constants
  static readonly VBLANK = 0;
  static readonly STAT = 1;
  static readonly TIMER = 2;
  static readonly SERIAL = 3;
  static readonly JOYPAD = 4;

  constructor(mmu: MMU) {
    this.mmu = mmu;
  }

  private tick(cycles: number) {
    this.tickedCycles += cycles;
    this.mmu.tick(cycles);
  }

  reset() {
    this.a = 0x01; this.f = 0xB0;
    this.b = 0x00; this.c = 0x13;
    this.d = 0x00; this.e = 0xD8;
    this.h = 0x01; this.l = 0x4D;
    this.sp = 0xFFFE;
    this.pc = 0x0100;
    this.ime = false;
    this.imeScheduled = false;
    this.halted = false;
    this.haltBug = false;
    this.stopped = false;
    this.totalCycles = 0;
    this.tickedCycles = 0;
  }

  // Reset to post-CGB-boot state. The Game Boy Color boot ROM leaves the
  // CPU in a different state than the DMG boot ROM. A=0x11 signals CGB mode
  // to the game; the game checks this to decide whether to use CGB features.
  resetCGB() {
    this.a = 0x11; this.f = 0x80;       // A=0x11 (CGB indicator), Z flag set
    this.b = 0x00; this.c = 0x00;
    this.d = 0xFF; this.e = 0x56;
    this.h = 0x00; this.l = 0x0D;
    this.sp = 0xFFFE;
    this.pc = 0x0100;
    this.ime = false;
    this.imeScheduled = false;
    this.halted = false;
    this.haltBug = false;
    this.stopped = false;
    this.totalCycles = 0;
    this.tickedCycles = 0;
  }

  // 16-bit register accessors
  get af(): number { return (this.a << 8) | (this.f & 0xF0); }
  set af(v: number) { this.a = v >> 8; this.f = v & 0xF0; }
  get bc(): number { return (this.b << 8) | this.c; }
  set bc(v: number) { this.b = v >> 8; this.c = v & 0xFF; }
  get de(): number { return (this.d << 8) | this.e; }
  set de(v: number) { this.d = v >> 8; this.e = v & 0xFF; }
  get hl(): number { return (this.h << 8) | this.l; }
  set hl(v: number) { this.h = v >> 8; this.l = v & 0xFF; }

  // Flag helpers
  get flagZ(): boolean { return (this.f & 0x80) !== 0; }
  set flagZ(v: boolean) { if (v) this.f |= 0x80; else this.f &= ~0x80; }
  get flagN(): boolean { return (this.f & 0x40) !== 0; }
  set flagN(v: boolean) { if (v) this.f |= 0x40; else this.f &= ~0x40; }
  get flagH(): boolean { return (this.f & 0x20) !== 0; }
  set flagH(v: boolean) { if (v) this.f |= 0x20; else this.f &= ~0x20; }
  get flagC(): boolean { return (this.f & 0x10) !== 0; }
  set flagC(v: boolean) { if (v) this.f |= 0x10; else this.f &= ~0x10; }

  requestInterrupt(_bit: number) {
    // Wake CPU from HALT on any pending interrupt (regardless of IME)
    this.halted = false;
  }

  // Memory access helpers (all return M-cycle counts)
  private read8(addr: number): number {
    this.tick(1);
    return this.mmu.read(addr);
  }
  private write8(addr: number, value: number) {
    this.tick(1);
    this.mmu.write(addr, value);
  }
  private write16(addr: number, value: number) {
    this.write8(addr, value & 0xFF);
    this.write8(addr + 1, value >> 8);
  }

  // Fetch operands
  private fetch8(): number {
    this.tick(1);
    if (this.haltBug) {
      this.haltBug = false;
      return this.mmu.read(this.pc);
    }
    const v = this.mmu.read(this.pc);
    this.pc = (this.pc + 1) & 0xFFFF;
    return v;
  }
  private fetch16(): number {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return (hi << 8) | lo;
  }

  // Push/pop stack
  private push16(v: number) {
    this.sp = (this.sp - 1) & 0xFFFF;
    this.write8(this.sp, v >> 8);
    this.sp = (this.sp - 1) & 0xFFFF;
    this.write8(this.sp, v & 0xFF);
  }
  private pop16(): number {
    const lo = this.read8(this.sp);
    this.sp = (this.sp + 1) & 0xFFFF;
    const hi = this.read8(this.sp);
    this.sp = (this.sp + 1) & 0xFFFF;
    return (hi << 8) | lo;
  }

  // Check and service interrupts. Returns number of M-cycles spent (5 if served, 0 if not).
  private handleInterrupts(): number {
    if (this.imeScheduled) {
      this.ime = true;
      this.imeScheduled = false;
      return 0;
    }
    if (!this.ime) return 0;
    const pending = this.mmu.ie & this.mmu.if_;
    if (pending === 0) return 0;

    // Find highest-priority (lowest bit) interrupt
    for (let i = 0; i < 5; i++) {
      if (pending & (1 << i)) {
        // Disable IME, clear the IF bit, push PC, jump to vector
        this.ime = false;
        this.mmu.if_ &= ~(1 << i);
        this.push16(this.pc);
        const vectors = [0x0040, 0x0048, 0x0050, 0x0058, 0x0060];
        this.pc = vectors[i];
        this.halted = false;
        return 5;   // 5 M-cycles (20 T-cycles)
      }
    }
    return 0;
  }

  // Execute one instruction (or handle interrupts). Returns M-cycles consumed.
  step(): number {
    if (this.stopped) {
      // STOP instruction waits for joypad interrupt; we just spin
      this.mmu.tick(1);
      return 1;
    }

    let cycles = 0;
    this.tickedCycles = 0;

    // Service interrupts first (also unhalts CPU if a pending interrupt exists)
    if (this.halted) {
      const pending = this.mmu.ie & this.mmu.if_;
      if (pending !== 0) {
        this.halted = false;
      } else {
        // Stay halted - consume 1 M-cycle
        this.mmu.tick(1);
        this.totalCycles++;
        return 1;
      }
    }

    cycles = this.handleInterrupts();
    if (cycles > 0) {
      const extra = cycles - this.tickedCycles;
      if (extra > 0) {
        this.mmu.tick(extra);
      }
      this.totalCycles += cycles;
      return cycles;
    }

    // Fetch and execute opcode
    const opcode = this.fetch8();
    cycles = this.execute(opcode);

    const extra = cycles - this.tickedCycles;
    if (extra > 0) {
      this.mmu.tick(extra);
    }

    this.totalCycles += cycles;
    return cycles;
  }

  // Main opcode dispatch
  private execute(opcode: number): number {
    // 8-bit register table for indexed access
    const getR = (n: number): number => {
      switch (n) {
        case 0: return this.b;
        case 1: return this.c;
        case 2: return this.d;
        case 3: return this.e;
        case 4: return this.h;
        case 5: return this.l;
        case 6: return this.read8(this.hl);   // (HL) - 1 extra M-cycle on read
        case 7: return this.a;
      }
      return 0;
    };
    const setR = (n: number, v: number) => {
      switch (n) {
        case 0: this.b = v; break;
        case 1: this.c = v; break;
        case 2: this.d = v; break;
        case 3: this.e = v; break;
        case 4: this.h = v; break;
        case 5: this.l = v; break;
        case 6: this.write8(this.hl, v); break;
        case 7: this.a = v; break;
      }
    };

    switch (opcode) {
      // ============= 0x00-0x3F: misc, loads, stack =============

      case 0x00: return 1;                                  // NOP
      case 0x01: this.bc = this.fetch16(); return 3;        // LD BC,d16
      case 0x02: this.write8(this.bc, this.a); return 2;    // LD (BC),A
      case 0x03: this.bc = (this.bc + 1) & 0xFFFF; return 2; // INC BC
      case 0x04: this.b = this.aluInc(this.b); return 1;    // INC B
      case 0x05: this.b = this.aluDec(this.b); return 1;    // DEC B
      case 0x06: this.b = this.fetch8(); return 2;          // LD B,d8
      case 0x07: this.aluRlca(); return 1;                  // RLCA
      case 0x08: { const a = this.fetch16(); this.write16(a, this.sp); return 5; } // LD (a16),SP
      case 0x09: this.aluAddHl(this.bc); return 2;          // ADD HL,BC
      case 0x0A: this.a = this.read8(this.bc); return 2;    // LD A,(BC)
      case 0x0B: this.bc = (this.bc - 1) & 0xFFFF; return 2; // DEC BC
      case 0x0C: this.c = this.aluInc(this.c); return 1;    // INC C
      case 0x0D: this.c = this.aluDec(this.c); return 1;    // DEC C
      case 0x0E: this.c = this.fetch8(); return 2;          // LD C,d8
      case 0x0F: this.aluRrca(); return 1;                  // RRCA

      case 0x10: { // STOP d8
        this.fetch8();
        // CGB: if KEY1 bit 0 is set, STOP switches speed instead of halting
        if ((this.mmu as any).cgbMode && ((this.mmu as any).key1 & 0x01)) {
          const mmu = this.mmu as any;
          mmu.doubleSpeed = !mmu.doubleSpeed;
          mmu.key1 = (mmu.doubleSpeed ? 0x80 : 0x00);
          mmu.ppu.doubleSpeed = mmu.doubleSpeed;
          mmu.apu.doubleSpeed = mmu.doubleSpeed;
        } else {
          this.stopped = true;
        }
        return 2;
      }
      case 0x11: this.de = this.fetch16(); return 3;        // LD DE,d16
      case 0x12: this.write8(this.de, this.a); return 2;    // LD (DE),A
      case 0x13: this.de = (this.de + 1) & 0xFFFF; return 2; // INC DE
      case 0x14: this.d = this.aluInc(this.d); return 1;    // INC D
      case 0x15: this.d = this.aluDec(this.d); return 1;    // DEC D
      case 0x16: this.d = this.fetch8(); return 2;          // LD D,d8
      case 0x17: this.aluRla(); return 1;                   // RLA
      case 0x18: return this.jrRelative(true, this.fetch8());  // JR r8
      case 0x19: this.aluAddHl(this.de); return 2;          // ADD HL,DE
      case 0x1A: this.a = this.read8(this.de); return 2;    // LD A,(DE)
      case 0x1B: this.de = (this.de - 1) & 0xFFFF; return 2; // DEC DE
      case 0x1C: this.e = this.aluInc(this.e); return 1;    // INC E
      case 0x1D: this.e = this.aluDec(this.e); return 1;    // DEC E
      case 0x1E: this.e = this.fetch8(); return 2;          // LD E,d8
      case 0x1F: this.aluRra(); return 1;                   // RRA

      case 0x20: return this.jrRelative(!this.flagZ, this.fetch8()); // JR NZ,r8
      case 0x21: this.hl = this.fetch16(); return 3;        // LD HL,d16
      case 0x22: this.write8(this.hl, this.a); this.hl = (this.hl + 1) & 0xFFFF; return 2; // LD (HL+),A
      case 0x23: this.hl = (this.hl + 1) & 0xFFFF; return 2; // INC HL
      case 0x24: this.h = this.aluInc(this.h); return 1;    // INC H
      case 0x25: this.h = this.aluDec(this.h); return 1;    // DEC H
      case 0x26: this.h = this.fetch8(); return 2;          // LD H,d8
      case 0x27: this.aluDaa(); return 1;                   // DAA
      case 0x28: return this.jrRelative(this.flagZ, this.fetch8()); // JR Z,r8
      case 0x29: this.aluAddHl(this.hl); return 2;          // ADD HL,HL
      case 0x2A: this.a = this.read8(this.hl); this.hl = (this.hl + 1) & 0xFFFF; return 2; // LD A,(HL+)
      case 0x2B: this.hl = (this.hl - 1) & 0xFFFF; return 2; // DEC HL
      case 0x2C: this.l = this.aluInc(this.l); return 1;    // INC L
      case 0x2D: this.l = this.aluDec(this.l); return 1;    // DEC L
      case 0x2E: this.l = this.fetch8(); return 2;          // LD L,d8
      case 0x2F: this.a = ~this.a & 0xFF; this.flagN = true; this.flagH = true; return 1; // CPL

      case 0x30: return this.jrRelative(!this.flagC, this.fetch8()); // JR NC,r8
      case 0x31: this.sp = this.fetch16(); return 3;        // LD SP,d16
      case 0x32: this.write8(this.hl, this.a); this.hl = (this.hl - 1) & 0xFFFF; return 2; // LD (HL-),A
      case 0x33: this.sp = (this.sp + 1) & 0xFFFF; return 2; // INC SP
      case 0x34: { const v = this.aluInc(this.read8(this.hl)); this.write8(this.hl, v); return 3; } // INC (HL)
      case 0x35: { const v = this.aluDec(this.read8(this.hl)); this.write8(this.hl, v); return 3; } // DEC (HL)
      case 0x36: this.write8(this.hl, this.fetch8()); return 3; // LD (HL),d8
      case 0x37: this.flagN = false; this.flagH = false; this.flagC = true; return 1; // SCF
      case 0x38: return this.jrRelative(this.flagC, this.fetch8()); // JR C,r8
      case 0x39: this.aluAddHl(this.sp); return 2;          // ADD HL,SP
      case 0x3A: this.a = this.read8(this.hl); this.hl = (this.hl - 1) & 0xFFFF; return 2; // LD A,(HL-)
      case 0x3B: this.sp = (this.sp - 1) & 0xFFFF; return 2; // DEC SP
      case 0x3C: this.a = this.aluInc(this.a); return 1;    // INC A
      case 0x3D: this.a = this.aluDec(this.a); return 1;    // DEC A
      case 0x3E: this.a = this.fetch8(); return 2;          // LD A,d8
      case 0x3F: this.flagN = false; this.flagH = false; this.flagC = !this.flagC; return 1; // CCF

      // ============= 0x40-0x7F: 8-bit LD r,r' (0x76 = HALT) =============
      case 0x40: case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x46: case 0x47:
      case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C: case 0x4D: case 0x4E: case 0x4F:
      case 0x50: case 0x51: case 0x52: case 0x53: case 0x54: case 0x55: case 0x56: case 0x57:
      case 0x58: case 0x59: case 0x5A: case 0x5B: case 0x5C: case 0x5D: case 0x5E: case 0x5F:
      case 0x60: case 0x61: case 0x62: case 0x63: case 0x64: case 0x65: case 0x66: case 0x67:
      case 0x68: case 0x69: case 0x6A: case 0x6B: case 0x6C: case 0x6D: case 0x6E: case 0x6F:
      case 0x70: case 0x71: case 0x72: case 0x73: case 0x74: case 0x75: case 0x77:
      case 0x78: case 0x79: case 0x7A: case 0x7B: case 0x7C: case 0x7D: case 0x7E: case 0x7F: {
        const dst = (opcode >> 3) & 0x07;
        const src = opcode & 0x07;
        const val = getR(src);
        setR(dst, val);
        return (src === 6 || dst === 6) ? 2 : 1;
      }
      case 0x76: this.halted = true; return 1;              // HALT

      // ============= 0x80-0x87: ADD A,r =============
      case 0x80: case 0x81: case 0x82: case 0x83: case 0x84: case 0x85: case 0x86: case 0x87: {
        const src = opcode & 0x07;
        const val = getR(src);
        this.aluAdd(val);
        return src === 6 ? 2 : 1;
      }
      // 0x88-0x8F: ADC A,r
      case 0x88: case 0x89: case 0x8A: case 0x8B: case 0x8C: case 0x8D: case 0x8E: case 0x8F: {
        const src = opcode & 0x07;
        const val = getR(src);
        this.aluAdc(val);
        return src === 6 ? 2 : 1;
      }
      // 0x90-0x97: SUB A,r
      case 0x90: case 0x91: case 0x92: case 0x93: case 0x94: case 0x95: case 0x96: case 0x97: {
        const src = opcode & 0x07;
        const val = getR(src);
        this.aluSub(val);
        return src === 6 ? 2 : 1;
      }
      // 0x98-0x9F: SBC A,r
      case 0x98: case 0x99: case 0x9A: case 0x9B: case 0x9C: case 0x9D: case 0x9E: case 0x9F: {
        const src = opcode & 0x07;
        const val = getR(src);
        this.aluSbc(val);
        return src === 6 ? 2 : 1;
      }
      // 0xA0-0xA7: AND A,r
      case 0xA0: case 0xA1: case 0xA2: case 0xA3: case 0xA4: case 0xA5: case 0xA6: case 0xA7: {
        const src = opcode & 0x07;
        const val = getR(src);
        this.aluAnd(val);
        return src === 6 ? 2 : 1;
      }
      // 0xA8-0xAF: XOR A,r
      case 0xA8: case 0xA9: case 0xAA: case 0xAB: case 0xAC: case 0xAD: case 0xAE: case 0xAF: {
        const src = opcode & 0x07;
        const val = getR(src);
        this.aluXor(val);
        return src === 6 ? 2 : 1;
      }
      // 0xB0-0xB7: OR A,r
      case 0xB0: case 0xB1: case 0xB2: case 0xB3: case 0xB4: case 0xB5: case 0xB6: case 0xB7: {
        const src = opcode & 0x07;
        const val = getR(src);
        this.aluOr(val);
        return src === 6 ? 2 : 1;
      }
      // 0xB8-0xBF: CP A,r
      case 0xB8: case 0xB9: case 0xBA: case 0xBB: case 0xBC: case 0xBD: case 0xBE: case 0xBF: {
        const src = opcode & 0x07;
        const val = getR(src);
        this.aluCp(val);
        return src === 6 ? 2 : 1;
      }

      // ============= 0xC0-0xFF: misc =============

      case 0xC0: return this.ret(!this.flagZ);              // RET NZ
      case 0xC1: this.bc = this.pop16(); return 3;          // POP BC
      case 0xC2: return this.jp(!this.flagZ);               // JP NZ,a16
      case 0xC3: return this.jp(true);                      // JP a16
      case 0xC4: return this.call(!this.flagZ);             // CALL NZ,a16
      case 0xC5: this.push16(this.bc); return 4;            // PUSH BC
      case 0xC6: this.aluAdd(this.fetch8()); return 2;      // ADD A,d8
      case 0xC7: return this.rst(0x00);                     // RST 00H
      case 0xC8: return this.ret(this.flagZ);               // RET Z
      case 0xC9: this.pc = this.pop16(); return 4;          // RET
      case 0xCA: return this.jp(this.flagZ);                // JP Z,a16
      case 0xCB: return this.executeCB();                   // CB-prefixed
      case 0xCC: return this.call(this.flagZ);              // CALL Z,a16
      case 0xCD: return this.call(true);                    // CALL a16
      case 0xCE: this.aluAdc(this.fetch8()); return 2;      // ADC A,d8
      case 0xCF: return this.rst(0x08);                     // RST 08H

      case 0xD0: return this.ret(!this.flagC);              // RET NC
      case 0xD1: this.de = this.pop16(); return 3;          // POP DE
      case 0xD2: return this.jp(!this.flagC);               // JP NC,a16
      case 0xD4: return this.call(!this.flagC);             // CALL NC,a16
      case 0xD5: this.push16(this.de); return 4;            // PUSH DE
      case 0xD6: this.aluSub(this.fetch8()); return 2;      // SUB A,d8
      case 0xD7: return this.rst(0x10);                     // RST 10H
      case 0xD8: return this.ret(this.flagC);               // RET C
      case 0xD9: { // RETI
        this.pc = this.pop16();
        this.ime = true;
        return 4;
      }
      case 0xDA: return this.jp(this.flagC);                // JP C,a16
      case 0xDC: return this.call(this.flagC);              // CALL C,a16
      case 0xDE: this.aluSbc(this.fetch8()); return 2;      // SBC A,d8
      case 0xDF: return this.rst(0x18);                     // RST 18H

      case 0xE0: this.write8(0xFF00 | this.fetch8(), this.a); return 3; // LDH (a8),A
      case 0xE1: this.hl = this.pop16(); return 3;          // POP HL
      case 0xE2: this.write8(0xFF00 | this.c, this.a); return 2; // LD (C),A
      case 0xE5: this.push16(this.hl); return 4;            // PUSH HL
      case 0xE6: this.aluAnd(this.fetch8()); return 2;      // AND A,d8
      case 0xE7: return this.rst(0x20);                     // RST 20H
      case 0xE8: { // ADD SP,r8 (signed)
        const e = this.fetch8();
        const signed = e < 0x80 ? e : e - 0x100;
        const result = (this.sp + signed) & 0xFFFF;
        this.flagZ = false;
        this.flagN = false;
        this.flagH = ((this.sp & 0x0F) + (e & 0x0F)) > 0x0F;
        this.flagC = ((this.sp & 0xFF) + e) > 0xFF;
        this.sp = result;
        return 4;
      }
      case 0xE9: this.pc = this.hl; return 1;               // JP HL
      case 0xEA: this.write8(this.fetch16(), this.a); return 4; // LD (a16),A
      case 0xEE: this.aluXor(this.fetch8()); return 2;      // XOR A,d8
      case 0xEF: return this.rst(0x28);                     // RST 28H

      case 0xF0: this.a = this.read8(0xFF00 | this.fetch8()); return 3; // LDH A,(a8)
      case 0xF1: this.af = (this.pop16() & 0xFFF0); return 3; // POP AF (preserve low nibble of F)
      case 0xF2: this.a = this.read8(0xFF00 | this.c); return 2; // LD A,(C)
      case 0xF3: this.ime = false; this.imeScheduled = false; return 1; // DI
      case 0xF5: this.push16(this.af); return 4;            // PUSH AF
      case 0xF6: this.aluOr(this.fetch8()); return 2;       // OR A,d8
      case 0xF7: return this.rst(0x30);                     // RST 30H
      case 0xF8: { // LD HL,SP+r8 (signed)
        const e = this.fetch8();
        const signed = e < 0x80 ? e : e - 0x100;
        const result = (this.sp + signed) & 0xFFFF;
        this.flagZ = false;
        this.flagN = false;
        this.flagH = ((this.sp & 0x0F) + (e & 0x0F)) > 0x0F;
        this.flagC = ((this.sp & 0xFF) + e) > 0xFF;
        this.hl = result;
        return 3;
      }
      case 0xF9: this.sp = this.hl; return 2;               // LD SP,HL
      case 0xFA: this.a = this.read8(this.fetch16()); return 4; // LD A,(a16)
      case 0xFB: this.imeScheduled = true; return 1;        // EI (IME set after next instruction)
      case 0xFE: this.aluCp(this.fetch8()); return 2;       // CP A,d8
      case 0xFF: return this.rst(0x38);                     // RST 38H

      // D3, DB, DD, E3, E4, EB, EC, ED, F4, FC, FD are undocumented/unused on SM83.
      // Treat as NOP (real hardware would lock up, but games don't emit these).
      case 0xD3: case 0xDB: case 0xDD: case 0xE3: case 0xE4:
      case 0xEB: case 0xEC: case 0xED: case 0xF4: case 0xFC: case 0xFD:
        return 1;

      default:
        // Should never happen if ROM is valid
        console.warn(`Unknown opcode 0x${opcode.toString(16).padStart(2, "0")} at PC=0x${((this.pc - 1) & 0xFFFF).toString(16)}`);
        return 1;
    }
  }

  // ----- ALU operations -----

  private aluInc(v: number): number {
    v = (v + 1) & 0xFF;
    this.flagZ = v === 0;
    this.flagN = false;
    this.flagH = (v & 0x0F) === 0;
    return v;
  }

  private aluDec(v: number): number {
    v = (v - 1) & 0xFF;
    this.flagZ = v === 0;
    this.flagN = true;
    this.flagH = (v & 0x0F) === 0x0F;
    return v;
  }

  private aluAdd(v: number) {
    const result = this.a + v;
    this.flagZ = (result & 0xFF) === 0;
    this.flagN = false;
    this.flagH = (this.a & 0x0F) + (v & 0x0F) > 0x0F;
    this.flagC = result > 0xFF;
    this.a = result & 0xFF;
  }

  private aluAdc(v: number) {
    const carry = this.flagC ? 1 : 0;
    const result = this.a + v + carry;
    this.flagZ = (result & 0xFF) === 0;
    this.flagN = false;
    this.flagH = (this.a & 0x0F) + (v & 0x0F) + carry > 0x0F;
    this.flagC = result > 0xFF;
    this.a = result & 0xFF;
  }

  private aluSub(v: number) {
    const result = this.a - v;
    this.flagZ = (result & 0xFF) === 0;
    this.flagN = true;
    this.flagH = (this.a & 0x0F) < (v & 0x0F);
    this.flagC = result < 0;
    this.a = result & 0xFF;
  }

  private aluSbc(v: number) {
    const carry = this.flagC ? 1 : 0;
    const result = this.a - v - carry;
    this.flagZ = (result & 0xFF) === 0;
    this.flagN = true;
    this.flagH = (this.a & 0x0F) < (v & 0x0F) + carry;
    this.flagC = result < 0;
    this.a = result & 0xFF;
  }

  private aluAnd(v: number) {
    this.a &= v;
    this.flagZ = this.a === 0;
    this.flagN = false;
    this.flagH = true;
    this.flagC = false;
  }

  private aluOr(v: number) {
    this.a |= v;
    this.flagZ = this.a === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = false;
  }

  private aluXor(v: number) {
    this.a ^= v;
    this.flagZ = this.a === 0;
    this.flagN = false;
    this.flagH = false;
    this.flagC = false;
  }

  private aluCp(v: number) {
    const result = this.a - v;
    this.flagZ = (result & 0xFF) === 0;
    this.flagN = true;
    this.flagH = (this.a & 0x0F) < (v & 0x0F);
    this.flagC = result < 0;
  }

  private aluAddHl(v: number) {
    const result = this.hl + v;
    this.flagN = false;
    this.flagH = (this.hl & 0x0FFF) + (v & 0x0FFF) > 0x0FFF;
    this.flagC = result > 0xFFFF;
    this.hl = result & 0xFFFF;
  }

  private aluDaa() {
    // Decimal Adjust Accumulator - adjust A to be valid BCD
    let a = this.a;
    if (!this.flagN) {
      if (this.flagH || (a & 0x0F) > 9) a += 0x06;
      if (this.flagC || a > 0x9F) { a += 0x60; this.flagC = true; }
    } else {
      if (this.flagH) { a = (a - 6) & 0xFF; }
      if (this.flagC) a -= 0x60;
    }
    a &= 0xFF;
    this.flagH = false;
    this.flagZ = a === 0;
    this.a = a;
  }

  private aluRlca() {
    const carry = (this.a & 0x80) !== 0;
    this.a = ((this.a << 1) & 0xFF) | (carry ? 1 : 0);
    this.flagZ = false;
    this.flagN = false;
    this.flagH = false;
    this.flagC = carry;
  }

  private aluRrca() {
    const carry = (this.a & 0x01) !== 0;
    this.a = (this.a >> 1) | (carry ? 0x80 : 0);
    this.flagZ = false;
    this.flagN = false;
    this.flagH = false;
    this.flagC = carry;
  }

  private aluRla() {
    const carry = (this.a & 0x80) !== 0;
    this.a = ((this.a << 1) & 0xFF) | (this.flagC ? 1 : 0);
    this.flagZ = false;
    this.flagN = false;
    this.flagH = false;
    this.flagC = carry;
  }

  private aluRra() {
    const carry = (this.a & 0x01) !== 0;
    this.a = (this.a >> 1) | (this.flagC ? 0x80 : 0);
    this.flagZ = false;
    this.flagN = false;
    this.flagH = false;
    this.flagC = carry;
  }

  // ----- Control flow -----
  private jrRelative(cond: boolean, offset: number): number {
    if (cond) {
      const signed = offset < 0x80 ? offset : offset - 0x100;
      this.pc = (this.pc + signed) & 0xFFFF;
      return 3;   // 3 M-cycles when taken, 2 when not (fetch8 already adds 1 M)
    }
    return 2;
  }

  private jp(cond: boolean): number {
    const target = this.fetch16();
    if (cond) {
      this.pc = target;
      return 4;
    }
    return 3;
  }

  private call(cond: boolean): number {
    const target = this.fetch16();
    if (cond) {
      this.push16(this.pc);
      this.pc = target;
      return 6;
    }
    return 3;
  }

  private ret(cond: boolean): number {
    if (cond) {
      this.pc = this.pop16();
      return 5;
    }
    return 2;
  }

  private rst(addr: number): number {
    this.push16(this.pc);
    this.pc = addr;
    return 4;
  }

  // ----- CB-prefixed opcodes -----
  // These are split into:
  //   0x00-0x3F: rotate/shift/bit operations on r
  //   0x40-0x7F: BIT b,r (test bit b of r)
  //   0x80-0xBF: RES b,r (reset bit b of r)
  //   0xC0-0xFF: SET b,r (set bit b of r)
  private executeCB(): number {
    const op = this.fetch8();
    const reg = op & 0x07;
    const bit = (op >> 3) & 0x07;
    const group = (op >> 6) & 0x03;

    // Get register value (with (HL) extra cycle)
    const isHl = reg === 6;
    let val = 0;
    switch (reg) {
      case 0: val = this.b; break;
      case 1: val = this.c; break;
      case 2: val = this.d; break;
      case 3: val = this.e; break;
      case 4: val = this.h; break;
      case 5: val = this.l; break;
      case 6: val = this.read8(this.hl); break;
      case 7: val = this.a; break;
    }

    const setResult = (v: number) => {
      switch (reg) {
        case 0: this.b = v; break;
        case 1: this.c = v; break;
        case 2: this.d = v; break;
        case 3: this.e = v; break;
        case 4: this.h = v; break;
        case 5: this.l = v; break;
        case 6: this.write8(this.hl, v); break;
        case 7: this.a = v; break;
      }
    };

    if (group === 0) {
      // 0x00-0x3F: rotations/shifts
      switch (bit) {
        case 0: val = this.cbRlc(val); break;   // RLC r
        case 1: val = this.cbRrc(val); break;   // RRC r
        case 2: val = this.cbRl(val); break;    // RL r
        case 3: val = this.cbRr(val); break;    // RR r
        case 4: val = this.cbSla(val); break;   // SLA r
        case 5: val = this.cbSra(val); break;   // SRA r
        case 6: val = this.cbSwap(val); break;  // SWAP r
        case 7: val = this.cbSrl(val); break;   // SRL r
      }
      setResult(val);
      return isHl ? 4 : 2;
    } else if (group === 1) {
      // 0x40-0x7F: BIT b,r
      this.flagZ = (val & (1 << bit)) === 0;
      this.flagN = false;
      this.flagH = true;
      return isHl ? 3 : 2;
    } else if (group === 2) {
      // 0x80-0xBF: RES b,r (clear bit)
      val &= ~(1 << bit);
      setResult(val);
      return isHl ? 4 : 2;
    } else {
      // 0xC0-0xFF: SET b,r (set bit)
      val |= (1 << bit);
      setResult(val);
      return isHl ? 4 : 2;
    }
  }

  private cbRlc(v: number): number {
    const carry = (v & 0x80) !== 0;
    v = ((v << 1) & 0xFF) | (carry ? 1 : 0);
    this.flagZ = v === 0;
    this.flagN = false; this.flagH = false; this.flagC = carry;
    return v;
  }
  private cbRrc(v: number): number {
    const carry = (v & 0x01) !== 0;
    v = (v >> 1) | (carry ? 0x80 : 0);
    this.flagZ = v === 0;
    this.flagN = false; this.flagH = false; this.flagC = carry;
    return v;
  }
  private cbRl(v: number): number {
    const carry = (v & 0x80) !== 0;
    v = ((v << 1) & 0xFF) | (this.flagC ? 1 : 0);
    this.flagZ = v === 0;
    this.flagN = false; this.flagH = false; this.flagC = carry;
    return v;
  }
  private cbRr(v: number): number {
    const carry = (v & 0x01) !== 0;
    v = (v >> 1) | (this.flagC ? 0x80 : 0);
    this.flagZ = v === 0;
    this.flagN = false; this.flagH = false; this.flagC = carry;
    return v;
  }
  private cbSla(v: number): number {
    const carry = (v & 0x80) !== 0;
    v = (v << 1) & 0xFF;
    this.flagZ = v === 0;
    this.flagN = false; this.flagH = false; this.flagC = carry;
    return v;
  }
  private cbSra(v: number): number {
    const carry = (v & 0x01) !== 0;
    v = (v >> 1) | (v & 0x80);
    this.flagZ = v === 0;
    this.flagN = false; this.flagH = false; this.flagC = carry;
    return v;
  }
  private cbSwap(v: number): number {
    v = ((v & 0x0F) << 4) | ((v & 0xF0) >> 4);
    this.flagZ = v === 0;
    this.flagN = false; this.flagH = false; this.flagC = false;
    return v;
  }
  private cbSrl(v: number): number {
    const carry = (v & 0x01) !== 0;
    v = v >> 1;
    this.flagZ = v === 0;
    this.flagN = false; this.flagH = false; this.flagC = carry;
    return v;
  }
}
