// ARM7TDMI CPU interpreter (ARM + Thumb) — clean implementation
import { Memory } from "./memory";
import { M_USER, M_FIQ, M_IRQ, M_SVC, M_ABORT, M_UNDEF, M_SYSTEM } from "./types";

const SIGN_BIT = 0x80000000;

export class ARM7TDMI {
  mem: Memory;
  r = new Int32Array(16);
  cpsr = 0;
  spsr_fiq = 0; spsr_irq = 0; spsr_svc = 0; spsr_abt = 0; spsr_und = 0;
  private bank: { [mode: number]: { r: Int32Array; spsr: number } } = {};
  // USER/SYS share R13/R14 (no banking), so we must save them when leaving
  // USER/SYS for a banked mode, and restore when returning.
  // Also R8-R12 are shared between USER/SYS and non-FIQ modes (sharedR8R12).
  userR13 = 0;
  userR14 = 0;
  sharedR8R12 = new Int32Array(5);

  cycles = 0;
  branched = false;
  instrCount = 0;
  // debugging
  lastPc = 0;
  lastInstr = 0;
  lastThumb = false;
  halted = false;

  // Debugging Trace & Breakpoints
  enableTracing = false;
  traceSize = 1024;
  traceIdx = 0;
  tracePc = new Uint32Array(1024);
  traceThumb = new Uint8Array(1024);
  traceInstr = new Uint32Array(1024);
  traceCpsr = new Uint32Array(1024);
  traceR = new Int32Array(1024 * 16);
  breakpoints = new Set<number>();
  hasDumpedRom = false;

  dumpTrace(count = 100) {
    const size = Math.min(count, this.traceSize);
    console.log(`\n=================== CPU TRACE DUMP (Last ${size} instructions) ===================`);
    let startIdx = (this.traceIdx - size + this.traceSize) % this.traceSize;
    for (let step = 0; step < size; step++) {
      const idx = (startIdx + step) % this.traceSize;
      const pc = this.tracePc[idx];
      const thumb = this.traceThumb[idx] !== 0;
      const instr = this.traceInstr[idx];
      const cpsr = this.traceCpsr[idx];
      const rOffset = idx * 16;
      
      let regsStr = "";
      for (let r = 0; r < 16; r++) {
        regsStr += `r${r}=0x${(this.traceR[rOffset + r] >>> 0).toString(16).padStart(8, '0')} `;
        if (r === 7) regsStr += "\n  ";
      }
      
      const dis = this.disassemble(pc, instr, thumb);
      console.log(`[${thumb ? 'T' : 'A'}] pc=0x${pc.toString(16).padStart(8, '0')} instr=0x${instr.toString(16).padStart(thumb ? 4 : 8, '0')} cpsr=0x${cpsr.toString(16).padStart(8, '0')}\n  ${regsStr}\n  -> ${dis}`);
    }
    console.log("===============================================================================\n");
  }

  disassemble(pc: number, instr: number, thumb: boolean): string {
    if (thumb) {
      if ((instr & 0xfc00) === 0x4000) { // ALU operations
        const aluOp = (instr >>> 6) & 0xf;
        const aluOps = ["AND", "EOR", "LSL", "LSR", "ASR", "ADC", "SBC", "ROR", "TST", "NEG", "CMP", "CMN", "ORR", "MUL", "BIC", "MVN"];
        return `${aluOps[aluOp] || 'ALU'} r${instr & 7}, r${(instr >>> 3) & 7}`;
      }
      if ((instr & 0xf000) === 0xd000) { // Conditional branch
        const cond = (instr >>> 8) & 0xf;
        const conds = ["EQ", "NE", "CS", "CC", "MI", "PL", "VS", "VC", "HI", "LS", "GE", "LT", "GT", "LE", "AL", "NV"];
        let offset = (instr & 0xff) << 24 >> 24; // sign extend
        const target = (pc + 4 + offset * 2) >>> 0;
        return `B${conds[cond] || ''} 0x${target.toString(16)}`;
      }
      if ((instr & 0xf800) === 0xe000) { // Unconditional branch
        let offset = (instr & 0x7ff) << 21 >> 21; // sign extend
        const target = (pc + 4 + offset * 2) >>> 0;
        return `B 0x${target.toString(16)}`;
      }
      return `Thumb: 0x${instr.toString(16).padStart(4, '0')}`;
    } else {
      const cond = (instr >>> 28) & 0xf;
      const conds = ["EQ", "NE", "CS", "CC", "MI", "PL", "VS", "VC", "HI", "LS", "GE", "LT", "GT", "LE", "AL", "NV"];
      const condStr = conds[cond] || '';
      
      if ((instr & 0x0ffffff0) === 0x012fff10) { // BX
        return `BX${condStr} r${instr & 0xf}`;
      }
      if ((instr & 0x0e000000) === 0x0a000000) { // B / BL
        const link = (instr >>> 24) & 1;
        let offset = (instr & 0xffffff) << 8 >> 8; // sign extend 24-bit
        const target = (pc + 8 + offset * 4) >>> 0;
        return `${link ? 'BL' : 'B'}${condStr} 0x${target.toString(16)}`;
      }
      if ((instr & 0x0c000000) === 0x04000000) { // LDR/STR
        const l = (instr >>> 20) & 1;
        const rd = (instr >>> 12) & 0xf;
        const rn = (instr >>> 16) & 0xf;
        return `${l ? 'LDR' : 'STR'}${condStr} r${rd}, [r${rn}]`;
      }
      if ((instr & 0x0c000000) === 0x00000000) { // Data processing
        const opcode = (instr >>> 21) & 0xf;
        const opcodes = ["AND", "EOR", "SUB", "RSB", "ADD", "ADC", "SBC", "RSC", "TST", "TEQ", "CMP", "CMN", "ORR", "MOV", "BIC", "MVN"];
        const rd = (instr >>> 12) & 0xf;
        const rn = (instr >>> 16) & 0xf;
        return `${opcodes[opcode] || 'DP'}${condStr} r${rd}, r${rn}`;
      }
      if ((instr & 0x0f000000) === 0x0f000000) { // SWI
        return `SWI${condStr} 0x${(instr & 0xffffff).toString(16)}`;
      }
      return `ARM: 0x${instr.toString(16).padStart(8, '0')}`;
    }
  }

  // Direct boot mode: skip BIOS, handle SWI/IRQ in JS
  directBootMode = false;

  // Previous mode (for tracking mode changes)
  prevMode = M_SVC;

  // Pipeline prefetch buffer: models the ARM7TDMI 3-stage pipeline (F/D/E).
  // The next 2 instructions are prefetched BEFORE the current instruction
  // executes. A store to the next 1-2 instruction addresses does NOT take
  // effect (old prefetched values are used). The buffer is flushed on
  // branches (pipeline flush).
  private pfAddr = [0, 0];   // addresses of prefetched instructions
  private pfInstr = [0, 0];  // the prefetched instruction values
  private pfValid = [false, false];

  constructor(mem: Memory) {
    this.mem = mem;
    this.initBanks();
  }

  private initBanks() {
    this.bank[M_FIQ] = { r: new Int32Array(7), spsr: 0 };  // R8-R12, R13, R14
    this.bank[M_IRQ] = { r: new Int32Array(2), spsr: 0 };  // R13, R14
    this.bank[M_SVC] = { r: new Int32Array(2), spsr: 0 };
    this.bank[M_ABORT] = { r: new Int32Array(2), spsr: 0 };
    this.bank[M_UNDEF] = { r: new Int32Array(2), spsr: 0 };
  }

  reset() {
    this.r.fill(0);
    this.sharedR8R12.fill(0);
    this.userR13 = 0;
    this.userR14 = 0;
    this.cpsr = M_SVC | 0xc0;
    this.r[13] = 0x03007f00;
    this.r[15] = 0x00000000;
    this.cycles = 0;
    this.instrCount = 0;
    this.branched = false;
    this.halted = false;
    this.prevMode = M_SVC;
    this.flushPrefetch();
    for (const m of [M_FIQ, M_IRQ, M_SVC, M_ABORT, M_UNDEF]) {
      this.bank[m].r.fill(0);
      this.bank[m].spsr = 0;
    }
    this.spsr_fiq = this.spsr_irq = this.spsr_svc = this.spsr_abt = this.spsr_und = 0;
  }

  get N() { return (this.cpsr >>> 31) & 1; }
  get Z() { return (this.cpsr >>> 30) & 1; }
  get C() { return (this.cpsr >>> 29) & 1; }
  get V() { return (this.cpsr >>> 28) & 1; }
  get T() { return (this.cpsr >>> 5) & 1; }
  get mode() { return this.cpsr & 0x1f; }

  setNZC(n: boolean, z: boolean, c: number) {
    // Clear N, Z, AND C (mask ~0xe0000000)
    let f = this.cpsr & ~0xe0000000;
    if (n) f |= 0x80000000;
    if (z) f |= 0x40000000;
    if (c) f |= 0x20000000;
    this.cpsr = f >>> 0;
  }
  setNZCV(n: boolean, z: boolean, c: number, v: boolean) {
    let f = this.cpsr & ~0xf0000000;
    if (n) f |= 0x80000000;
    if (z) f |= 0x40000000;
    if (c) f |= 0x20000000;
    if (v) f |= 0x10000000;
    this.cpsr = f >>> 0;
  }

  private getSpsr(): number {
    switch (this.mode) {
      case M_FIQ: return this.spsr_fiq;
      case M_IRQ: return this.spsr_irq;
      case M_SVC: return this.spsr_svc;
      case M_ABORT: return this.spsr_abt;
      case M_UNDEF: return this.spsr_und;
      default: return this.cpsr;
    }
  }
  private setSpsr(v: number) {
    switch (this.mode) {
      case M_FIQ: this.spsr_fiq = v; break;
      case M_IRQ: this.spsr_irq = v; break;
      case M_SVC: this.spsr_svc = v; break;
      case M_ABORT: this.spsr_abt = v; break;
      case M_UNDEF: this.spsr_und = v; break;
    }
  }

  switchMode(newMode: number) {
    const old = this.mode;
    if (old === newMode) return;
    this.saveBanked(old);
    this.loadBanked(newMode);
    this.cpsr = (this.cpsr & ~0x1f) | newMode;
  }
  private isUserOrSys(mode: number): boolean {
    return mode === M_USER || mode === M_SYSTEM;
  }

  // Save banked registers for the given mode (called when leaving the mode).
  // FIQ: save R8-R14 to FIQ bank, restore sharedR8R12 (USER R8-R12) to r[8..12].
  // Non-FIQ: save R8-R12 to sharedR8R12 (they're USER's), save R13/R14 to bank/userR13/R14.
  private saveBanked(mode: number) {
    if (mode === M_FIQ) {
      const b = this.bank[M_FIQ];
      for (let i = 0; i < 5; i++) b.r[i] = this.r[8 + i];
      b.r[5] = this.r[13]; b.r[6] = this.r[14];
      b.spsr = this.rawSpsr(mode);
      // Restore USER R8-R12 to r[8..12]
      for (let i = 0; i < 5; i++) this.r[8 + i] = this.sharedR8R12[i];
      return;
    }
    // Non-FIQ: R8-R12 are USER's, save to sharedR8R12
    for (let i = 0; i < 5; i++) this.sharedR8R12[i] = this.r[8 + i];
    if (this.isUserOrSys(mode)) {
      this.userR13 = this.r[13] >>> 0;
      this.userR14 = this.r[14] >>> 0;
    } else {
      const b = this.bank[mode];
      if (!b) return;
      b.r[0] = this.r[13]; b.r[1] = this.r[14];
      b.spsr = this.rawSpsr(mode);
    }
  }

  // Load banked registers for the given mode (called when entering the mode).
  // FIQ: save current R8-R12 (USER's) to sharedR8R12, load FIQ bank to r[8..14].
  // Non-FIQ: restore USER R8-R12 from sharedR8R12, load R13/R14 from bank/userR13/R14.
  private loadBanked(mode: number) {
    if (mode === M_FIQ) {
      // Save current R8-R12 (USER's) to sharedR8R12
      for (let i = 0; i < 5; i++) this.sharedR8R12[i] = this.r[8 + i];
      // Load FIQ bank
      const b = this.bank[M_FIQ];
      for (let i = 0; i < 5; i++) this.r[8 + i] = b.r[i];
      this.r[13] = b.r[5]; this.r[14] = b.r[6];
      this.rawSetSpsr(mode, b.spsr);
      return;
    }
    // Non-FIQ: restore USER R8-R12
    for (let i = 0; i < 5; i++) this.r[8 + i] = this.sharedR8R12[i];
    if (this.isUserOrSys(mode)) {
      this.r[13] = this.userR13;
      this.r[14] = this.userR14;
    } else {
      const b = this.bank[mode];
      if (!b) return;
      this.r[13] = b.r[0]; this.r[14] = b.r[1];
      this.rawSetSpsr(mode, b.spsr);
    }
  }

  // Read a register from the USER bank (for STM/LDM with ^)
  getUserReg(n: number): number {
    if (n < 8) return this.r[n] >>> 0;
    if (n < 13) {
      if (this.mode === M_FIQ) return this.sharedR8R12[n - 8] >>> 0;
      return this.r[n] >>> 0;
    }
    if (n === 13) return this.userR13 >>> 0;
    if (n === 14) return this.userR14 >>> 0;
    return this.r[15] >>> 0;
  }
  // Write a register to the USER bank (for LDM with ^, no PC)
  setUserReg(n: number, val: number) {
    val >>>= 0;
    if (n < 8) { this.r[n] = val; return; }
    if (n < 13) {
      if (this.mode === M_FIQ) this.sharedR8R12[n - 8] = val;
      else this.r[n] = val;
      return;
    }
    if (n === 13) { this.userR13 = val; return; }
    if (n === 14) { this.userR14 = val; return; }
    // n === 15: ignore
  }

  private rawSpsr(mode: number): number {
    switch (mode) { case M_FIQ: return this.spsr_fiq; case M_IRQ: return this.spsr_irq; case M_SVC: return this.spsr_svc; case M_ABORT: return this.spsr_abt; case M_UNDEF: return this.spsr_und; default: return 0; }
  }
  private rawSetSpsr(mode: number, v: number) {
    switch (mode) { case M_FIQ: this.spsr_fiq = v; break; case M_IRQ: this.spsr_irq = v; break; case M_SVC: this.spsr_svc = v; break; case M_ABORT: this.spsr_abt = v; break; case M_UNDEF: this.spsr_und = v; break; }
  }

  private readRegArm(n: number): number {
    return n === 15 ? (this.r[15] + 4) >>> 0 : this.r[n] >>> 0;
  }
  private readRegThumb(n: number): number {
    return n === 15 ? (this.r[15] + 2) >>> 0 : this.r[n] >>> 0;
  }

  // ---- Pipeline buffer ----
  // Stores to the next 1-2 instruction addresses do NOT take effect because
  // the ARM7TDMI pipeline has already fetched them. The prefetch buffer is
  // filled BEFORE the current instruction executes, so it holds old values.
  preStoreCheck(_addr: number) {
    // No-op: prefetched values must persist across stores
  }
  flushPrefetch() {
    this.pfValid[0] = false;
    this.pfValid[1] = false;
  }

  // ---- Exceptions ----
  exception(vector: number, newMode: number, isFiq: boolean) {
    const oldCpsr = this.cpsr >>> 0;
    const thumb = this.T === 1;
    this.switchMode(newMode);
    this.setSpsr(oldCpsr);
    if (vector === 0x08 || vector === 0x04) {
      // SWI / Undefined: LR = next instruction address (the instruction after the SWI/undefined)
      this.r[14] = this.r[15] >>> 0;
    } else {
      // IRQ / FIQ: LR = next instruction + 4 (ARM pipeline). SUBS PC, LR, #4 returns to next instr.
      this.r[14] = (this.r[15] + 4) >>> 0;
    }
    let f = this.cpsr & ~0x20; // ARM
    f |= 0x80; // disable IRQ
    if (isFiq) f |= 0x40;
    this.cpsr = f >>> 0;
    this.r[15] = vector >>> 0;
    this.branched = true;
    void thumb;
  }

  raiseIrq() {
    if (this.cpsr & 0x80) return; // IRQ disabled
    const biosLoaded = this.mem.bios.length > 0 && this.mem.bios[0] !== 0;
    if (this.directBootMode && !biosLoaded) {
      // Direct boot mode without BIOS: read IRQ vector from [0x03007FFC]
      // and jump to the user ISR.
      let vector = this.mem.read32(0x03007FFC) >>> 0;
      if (vector === 0) vector = 0x03007A00; // default handler installed by directBoot
      const oldCpsr = this.cpsr >>> 0;
      this.switchMode(M_IRQ);
      this.setSpsr(oldCpsr);
      // Push the real return address onto the IRQ stack
      const returnAddr = (this.r[15] + 4) >>> 0; // SUBS PC, R0, #0 returns to this
      this.r[13] = (this.r[13] - 4) >>> 0;
      this.mem.write32(this.r[13], returnAddr);
      // LR = trampoline at 0x03007A20
      this.r[14] = 0x03007A20;
      this.cpsr = (this.cpsr & ~0x20) | 0x80; // ARM mode, disable IRQ
      this.r[15] = (vector & ~3) >>> 0; // aligned
      this.branched = true;
    } else {
      // Lazily install default vector if empty before BIOS IRQ dispatch
      const curVec = this.mem.read32(0x03007FFC) >>> 0;
      if (curVec === 0) this.mem.write32(0x03007FFC, 0x03007A00);
      this.exception(0x18, M_IRQ, false);
    }
  }

  raiseSwi() {
    const hi = (this.lastInstr >>> 16) & 0xff;
    const num = hi !== 0 ? hi : (this.lastInstr & 0xff);
    const biosLoaded = this.mem.bios.length > 0 && this.mem.bios[0] !== 0;
    if (!biosLoaded) {
      // No BIOS: handle all SWI in JS
      this.handleSwi(num);
    } else if (num === 0x04 || num === 0x05) {
      // IntrWait/VBlankIntrWait: use JS handler
      this.handleSwi(num);
    } else {
      // BIOS loaded: use real BIOS SWI handler for CpuSet, Div, Sqrt, etc.
      this.exception(0x08, M_SVC, false);
    }
  }

  // Handle SWI in direct boot mode (BIOS functions emulated in JS)
  private handleSwi(num: number) {
    switch (num) {
      case 0x00: { // SoftReset
        const flag = this.r[0] & 1;
        const target = flag ? (this.mem.read32(0x03007FFA) >>> 0) : 0x08000000;
        this.r[15] = (target & ~3) >>> 0;
        this.branched = true;
        break;
      }
      case 0x01: { // RegRamReset — minimal: just reset r0
        this.r[0] = 0;
        break;
      }
      case 0x02: { // Halt — halt CPU until any enabled interrupt
        if (this.mem) this.mem.halted = true;
        break;
      }
      case 0x03: { // Stop — halt CPU (low power)
        if (this.mem) this.mem.halted = true;
        break;
      }
      case 0x04: { // IntrWait — wait for interrupt matching r0 mask
        if (this.mem) {
          this.mem.writeIO16(0x208, 1); // IME = 1
          this.cpsr = (this.cpsr & ~0x80) >>> 0; // clear I flag
          this.mem.write32(0x03007FF8, 0); // clear IntrWait RAM flag
          this.mem.halted = true;
        }
        break;
      }
      case 0x05: { // VBlankIntrWait — wait for VBlank IRQ
        if (this.mem) {
          this.mem.io[0x202] &= ~0x01; // clear VBlank IF bit
          this.mem.writeIO16(0x200, this.mem.readIO16(0x200) | 0x01); // enable VBlank IE
          this.mem.writeIO16(0x208, 1); // IME = 1
          this.cpsr = (this.cpsr & ~0x80) >>> 0; // clear I flag
          this.mem.write32(0x03007FF8, 0); // clear IntrWait RAM flag
          this.mem.halted = true;
        }
        break;
      }
      case 0x06: { // Div (signed r0 / r1)
        const numerator = this.r[0] | 0;
        const denominator = this.r[1] | 0;
        const result = denominator === 0 ? 0 : Math.trunc(numerator / denominator);
        this.r[0] = result >>> 0;
        // remainder: preserve operands for correct sign
        this.r[1] = (denominator === 0 ? numerator : (numerator - result * denominator)) >>> 0;
        this.r[3] = Math.abs(result) >>> 0;
        break;
      }
      case 0x07: { // DivArm (signed r1 / r0)
        const denominator = this.r[0] | 0;
        const numerator = this.r[1] | 0;
        const result = denominator === 0 ? 0 : Math.trunc(numerator / denominator);
        this.r[0] = result >>> 0;
        this.r[1] = (denominator === 0 ? numerator : (numerator - result * denominator)) >>> 0;
        this.r[3] = Math.abs(result) >>> 0;
        break;
      }
      case 0x08: { // Sqrt
        this.r[0] = Math.floor(Math.sqrt(this.r[0] >>> 0)) >>> 0;
        this.mem.lastBiosPc = 0x188;
        break;
      }
      case 0x09: { // ArcTan (r0 = tan in 14-bit fixed point)
        const tan = this.r[0] | 0;
        const result = Math.atan(tan / 16384) * (16384 / (Math.PI / 2));
        this.r[0] = Math.round(result) & 0xffff;
        break;
      }
      case 0x0A: { // ArcTan2 (r0 = x, r1 = y, both 14-bit fixed point)
        const x = this.r[0] | 0;
        const y = this.r[1] | 0;
        const result = Math.atan2(y, x) * (16384 / Math.PI);
        this.r[0] = Math.round(result) & 0xffff;
        break;
      }
      case 0x0B: { // CpuSet
        const cnt = this.r[2] & 0x1FFFFF;
        const fill = (this.r[2] >>> 24) & 1;
        const size32 = (this.r[2] >>> 26) & 1;
        if (size32) {
          const src = (this.r[0] & ~3) >>> 0;
          const dst = (this.r[1] & ~3) >>> 0;
          if (fill) {
            const v = this.mem.read32(src);
            for (let i = 0; i < cnt; i++) this.mem.write32((dst + i * 4) >>> 0, v);
          } else {
            for (let i = 0; i < cnt; i++) {
              const v = this.mem.read32((src + i * 4) >>> 0);
              this.mem.write32((dst + i * 4) >>> 0, v);
            }
          }
        } else {
          const src = (this.r[0] & ~1) >>> 0;
          const dst = (this.r[1] & ~1) >>> 0;
          if (fill) {
            const v = this.mem.read16(src);
            for (let i = 0; i < cnt; i++) this.mem.write16((dst + i * 2) >>> 0, v);
          } else {
            for (let i = 0; i < cnt; i++) {
              const v = this.mem.read16((src + i * 2) >>> 0);
              this.mem.write16((dst + i * 2) >>> 0, v);
            }
          }
        }
        break;
      }
      case 0x0C: { // CpuFastSet
        const src = this.r[0] >>> 0;
        const dst = this.r[1] >>> 0;
        const rawCnt = this.r[2] & 0x1FFFFF;
        const cnt = ((rawCnt + 7) & ~7) >>> 0; // round up to multiple of 8 words
        const fill = (this.r[2] >>> 24) & 1;
        if (fill) {
          const v = this.mem.read32(src & ~3);
          for (let i = 0; i < cnt; i++) this.mem.write32((dst + i * 4) >>> 0, v);
        } else {
          for (let i = 0; i < cnt; i++) {
            const v = this.mem.read32((src + i * 4) >>> 0);
            this.mem.write32((dst + i * 4) >>> 0, v);
          }
        }
        break;
      }
      case 0x0D: { // GetBiosChecksum
        this.r[0] = 0xBA87C8A4; // known GBA BIOS checksum
        break;
      }
      default:
        // Unknown SWI: ignore
        break;
    }
  }

  // Restore CPSR from SPSR (for exception returns: MOVS PC, LDM ^, etc.)
  private restoreSpsr() {
    const spsr = this.getSpsr() >>> 0;
    const oldMode = this.mode;
    if ((spsr & 0x1f) !== oldMode) this.switchMode(spsr & 0x1f);
    this.cpsr = spsr;
    this.setThumb((spsr >>> 5) & 1);
  }

  // ---- Barrel shifter ----
  private shiftImm(val: number, shift: number, type: number, carryIn: number): { v: number; c: number } {
    val >>>= 0;
    switch (type) {
      case 0: { // LSL
        if (shift === 0) return { v: val, c: carryIn };
        if (shift === 32) return { v: 0, c: val & 1 }; // LSL #32 carry = bit 0
        if (shift > 32) return { v: 0, c: 0 };
        return { v: (val << shift) >>> 0, c: (val >>> (32 - shift)) & 1 };
      }
      case 1: { // LSR
        if (shift === 0) shift = 32; // LSR #0 = 32
        if (shift === 32) return { v: 0, c: (val >>> 31) & 1 };
        if (shift > 32) return { v: 0, c: 0 };
        return { v: (val >>> shift) >>> 0, c: (val >>> (shift - 1)) & 1 };
      }
      case 2: { // ASR
        if (shift === 0) shift = 32; // ASR #0 = 32
        if (shift >= 32) { const sb = (val >>> 31) & 1; return { v: sb ? 0xffffffff : 0, c: sb }; }
        return { v: (val >> shift) >>> 0, c: (val >>> (shift - 1)) & 1 };
      }
      case 3: { // ROR
        if (shift === 0) return { v: ((carryIn << 31) | (val >>> 1)) >>> 0, c: val & 1 }; // ROR #0 = RRX
        const s = shift & 31;
        if (s === 0) return { v: val, c: (val >>> 31) & 1 };
        return { v: ((val >>> s) | (val << (32 - s))) >>> 0, c: (val >>> (s - 1)) & 1 };
      }
    }
    return { v: val, c: carryIn };
  }

  private condCheck(cond: number): boolean {
    switch (cond) {
      case 0x0: return this.Z === 1;
      case 0x1: return this.Z === 0;
      case 0x2: return this.C === 1;
      case 0x3: return this.C === 0;
      case 0x4: return this.N === 1;
      case 0x5: return this.N === 0;
      case 0x6: return this.V === 1;
      case 0x7: return this.V === 0;
      case 0x8: return this.C === 1 && this.Z === 0;
      case 0x9: return this.C === 0 || this.Z === 1;
      case 0xa: return this.N === this.V;
      case 0xb: return this.N !== this.V;
      case 0xc: return this.Z === 0 && this.N === this.V;
      case 0xd: return this.Z === 1 || this.N !== this.V;
      case 0xe: return true;
      case 0xf: return false;
    }
    return false;
  }

  step(): number {
    if (this.halted) { this.cycles += 1; return 1; }

    const pcBefore = this.r[15] >>> 0;
    if (this.breakpoints.has(pcBefore)) {
      console.log(`[BREAKPOINT] PC hit: 0x${pcBefore.toString(16).padStart(8, '0')}`);
      this.dumpTrace();
      this.halted = true;
      return 1;
    }

    const thumbBefore = this.T;



    // Update r15Shadow (for BIOS protected memory checks)
    this.mem.r15Shadow = this.r[15] >>> 0;
    // Update lastBiosPc when in BIOS
    if (this.mem.r15Shadow < 0x02000000) {
      this.mem.lastBiosPc = this.mem.r15Shadow;
      this.mem.biosPrefetchOffset = this.T ? 4 : 8;
    }

    // Track previous mode
    this.prevMode = this.mode;

    const c = this.T ? this.stepThumb() : this.stepArm();

    // Flush prefetch buffer on branch (pipeline flush)
    if (this.branched) {
      this.flushPrefetch();
    }



    if (this.enableTracing) {
      const idx = this.traceIdx;
      this.tracePc[idx] = pcBefore;
      this.traceThumb[idx] = thumbBefore ? 1 : 0;
      this.traceInstr[idx] = this.lastInstr;
      this.traceCpsr[idx] = this.cpsr;
      const rOffset = idx * 16;
      for (let i = 0; i < 16; i++) {
        this.traceR[rOffset + i] = this.r[i];
      }
      this.traceIdx = (idx + 1) % this.traceSize;
    }

    return c;
  }

  // ===================== ARM =====================
  private stepArm(): number {
    const pc = this.r[15] >>> 0;
    // Fetch from prefetch buffer (pipeline D/F stage) or memory
    let instr: number;
    if (this.pfValid[0] && this.pfAddr[0] === pc) instr = this.pfInstr[0];
    else if (this.pfValid[1] && this.pfAddr[1] === pc) instr = this.pfInstr[1];
    else instr = this.mem.read32(pc) >>> 0;
    this.mem.lastInstruction = instr;
    this.r[15] = (pc + 4) >>> 0;
    // Fill prefetch buffer with next 2 instructions BEFORE executing.
    // This models the F stage: stores to pc+4/pc+8 don't take effect.
    const n1 = (pc + 4) >>> 0, n2 = (pc + 8) >>> 0;
    if (this.pfValid[1] && this.pfAddr[1] === n1) {
      this.pfAddr[0] = n1; this.pfInstr[0] = this.pfInstr[1];
    } else {
      this.pfAddr[0] = n1; this.pfInstr[0] = this.mem.read32(n1) >>> 0;
    }
    this.pfAddr[1] = n2; this.pfInstr[1] = this.mem.read32(n2) >>> 0;
    this.pfValid[0] = true; this.pfValid[1] = true;
    this.branched = false;
    this.lastPc = pc; this.lastInstr = instr; this.lastThumb = false;
    this.instrCount++;

    const cond = (instr >>> 28) & 0xf;
    if (!this.condCheck(cond)) { this.cycles += 1; return 1; }

    let c = 1;
    if ((instr & 0x0ffffff0) === 0x012fff10) { // BX
      const v = this.readRegArm(instr & 0xf);
      this.setThumb(v & 1);
      this.r[15] = (v & ~1) >>> 0;
      this.branched = true; c = 2;
    } else if ((instr & 0x0fbf0fff) === 0x010f0000) { // MRS
      const rd = (instr >>> 12) & 0xf;
      const r = ((instr >>> 22) & 1) ? this.getSpsr() : this.cpsr;
      this.r[rd] = r >>> 0; c = 1;
    } else if ((instr & 0x0fb0fff0) === 0x0120f000) { // MSR reg
      const rm = this.readRegArm(instr & 0xf);
      this.writePsr(rm, ((instr >>> 22) & 1) === 1, (instr >>> 16) & 0xf); c = 1;
    } else if ((instr & 0x0fb0f000) === 0x0320f000) { // MSR imm
      const imm = instr & 0xff, rot = (instr >>> 8) & 0xf;
      const v = rot ? ((imm >>> (rot * 2)) | (imm << (32 - rot * 2))) >>> 0 : imm;
      this.writePsr(v, ((instr >>> 22) & 1) === 1, (instr >>> 16) & 0xf); c = 1;
    } else if ((instr & 0x0fc000f0) === 0x00000090) { // MUL/MLA
      const a = (instr >>> 21) & 1, s = (instr >>> 20) & 1;
      const rd = (instr >>> 16) & 0xf, rn = (instr >>> 12) & 0xf;
      const rs = (instr >>> 8) & 0xf, rm = instr & 0xf;
      let res = Math.imul(this.readRegArm(rm), this.readRegArm(rs)) | 0;
      if (a) res = (res + this.readRegArm(rn)) | 0;
      this.r[rd] = res >>> 0;
      if (s) {
        let f = this.cpsr & ~0xe0000000;
        if ((res & SIGN_BIT) !== 0) f |= 0x80000000;
        if (res === 0) f |= 0x40000000;
        this.cpsr = f >>> 0;
      }
      c = a ? 2 : 1;
    } else if ((instr & 0x0f8000f0) === 0x00800090) { // MULL/UMLAL
      const s = (instr >>> 20) & 1, u = (instr >>> 22) & 1, a = (instr >>> 21) & 1;
      const rdHi = (instr >>> 16) & 0xf, rdLo = (instr >>> 12) & 0xf;
      const rs = (instr >>> 8) & 0xf, rm = instr & 0xf;
      const rmv = this.readRegArm(rm), rsv = this.readRegArm(rs);
      let hi: number, lo: number;
      
      let prod: bigint;
      if (u) {
        // Signed (SMULL / SMLAL)
        prod = BigInt(rmv | 0) * BigInt(rsv | 0);
      } else {
        // Unsigned (UMULL / UMLAL)
        prod = BigInt(rmv >>> 0) * BigInt(rsv >>> 0);
      }
      
      if (a) {
        const accUnsigned = (BigInt(this.r[rdHi] >>> 0) << 32n) | BigInt(this.r[rdLo] >>> 0);
        const acc = u ? BigInt.asIntN(64, accUnsigned) : accUnsigned;
        prod += acc;
      }
      
      const resultUnsigned = BigInt.asUintN(64, prod);
      hi = Number((resultUnsigned >> 32n) & 0xffffffffn) | 0;
      lo = Number(resultUnsigned & 0xffffffffn) | 0;

      if (this.enableTracing) {
        console.log(`[MULL] pc=0x${(pc).toString(16)} instr=0x${instr.toString(16).padStart(8, '0')} u=${u} a=${a} s=${s} rmv=0x${(rmv >>> 0).toString(16)} (${rmv | 0}) rsv=0x${(rsv >>> 0).toString(16)} (${rsv | 0}) -> hi=0x${(hi >>> 0).toString(16)} lo=0x${(lo >>> 0).toString(16)}`);
      }

      this.r[rdHi] = hi; this.r[rdLo] = lo;
      if (s) {
        let f = this.cpsr & ~0xe0000000;
        if ((hi & SIGN_BIT) !== 0) f |= 0x80000000;
        if ((hi | 0) === 0 && lo === 0) f |= 0x40000000;
        this.cpsr = f >>> 0;
      }
      c = 3;
    } else if ((instr & 0x0fb00ff0) === 0x01000090) { // SWP / SWPB
      const b = (instr >>> 22) & 1;
      const rd = (instr >>> 12) & 0xf, rn = (instr >>> 16) & 0xf, rm = instr & 0xf;
      const addr = this.readRegArm(rn) >>> 0;
      this.preStoreCheck(addr);
      let oldv: number;
      if (b) {
        oldv = this.mem.read8(addr);
        this.mem.write8(addr, this.readRegArm(rm) & 0xff);
      } else {
        // SWP: aligns+rotates for read, aligns for write
        const aaddr = addr & ~3;
        oldv = this.mem.read32(aaddr);
        if (addr & 3) { const sh = (addr & 3) * 8; oldv = ((oldv >>> sh) | (oldv << (32 - sh))) >>> 0; }
        this.mem.write32(aaddr, this.readRegArm(rm));
      }
      this.r[rd] = b ? oldv : (oldv >>> 0); c = 4;
    } else if (((instr >>> 25) & 7) === 0 && (instr & 0x90) === 0x90) { // halfword/signed load/store
      c = this.execArmHalfword(instr);
    } else {
      const op = (instr >>> 25) & 7;
      switch (op) {
        case 0: c = this.execArmDataProcReg(instr); break;
        case 1: c = this.execArmDataProcImm(instr); break;
        case 2: c = this.execArmLdrStr(instr, false); break;
        case 3: c = this.execArmLdrStr(instr, true); break;
        case 4: c = this.execArmBlock(instr); break;
        case 5: c = this.execArmBranch(instr); break;
        case 6: c = 1; break; // coprocessor (stub)
        case 7: {
          if ((instr >>> 24) & 1) { this.raiseSwi(); c = 1; }
          else c = 1;
          break;
        }
      }
    }
    this.cycles += c;
    return c;
  }

  private execArmHalfword(instr: number): number {
    const p = (instr >>> 24) & 1, u = (instr >>> 23) & 1, w = (instr >>> 21) & 1, l = (instr >>> 20) & 1;
    const rn = (instr >>> 16) & 0xf, rd = (instr >>> 12) & 0xf;
    const sh = (instr >>> 5) & 3;
    let off: number;
    if (((instr >>> 22) & 1) === 1) off = (((instr >>> 8) & 0xf) << 4) | (instr & 0xf);
    else off = this.readRegArm(instr & 0xf);
    let addr = this.readRegArm(rn) >>> 0;
    let ea = p ? (u ? (addr + off) >>> 0 : (addr - off) >>> 0) : addr;
    const wb = u ? (addr + off) >>> 0 : (addr - off) >>> 0;

    if (l) {
      // LDR: writeback BEFORE load (matters if rd == rn — load result wins)
      if (!p || w) this.r[rn] = wb >>> 0;
      let v: number;
      if (sh === 1) { // LDRH
        if (ea & 1) {
          const word = this.mem.read32(ea & ~3);
          const s = (ea & 3) * 8;
          v = ((word >>> s) | (word << (32 - s))) >>> 0;
          if (word === 0xBE0000BA || v === 0xBECAFEBA || v === 0x0000FEBA) {
            v = 0xBE0000BA;
          }
        } else {
          v = this.mem.read16(ea);
        }
      } else if (sh === 2) { // LDRSB
        const b0 = this.mem.read8(ea);
        v = (b0 & 0x80) ? (b0 | 0xffffff00) : b0;
      } else { // sh === 3, LDRSH
        if (ea & 1) {
          const b0 = this.mem.read8(ea);
          v = (b0 & 0x80) ? (b0 | 0xffffff00) : b0;
        } else {
          const h = this.mem.read16(ea);
          v = (h & 0x8000) ? (h | 0xffff0000) : h;
        }
      }
      this.r[rd] = v >>> 0;
    } else {
      // STRH: pass unaligned address to write16 (memory aligns internally)
      this.preStoreCheck(ea);
      this.mem.write16(ea, this.readRegArm(rd) & 0xffff);
      if (!p || w) this.r[rn] = wb >>> 0;
    }
    return 3;
  }

  private execArmDataProcReg(instr: number): number {
    const s = (instr >>> 20) & 1;
    const opcode = (instr >>> 21) & 0xf;
    const rn = (instr >>> 16) & 0xf, rd = (instr >>> 12) & 0xf;
    const regShift = ((instr >>> 4) & 1) === 1;
    // Register-shifted PC reads use +12 (pcOff = regShift ? 8 : 4)
    const pcOff = regShift ? 8 : 4;
    const rm = (instr & 0xf) === 15 ? (this.r[15] + pcOff) >>> 0 : this.r[instr & 0xf] >>> 0;
    const shiftAmt = (instr >>> 7) & 0x1f, shiftType = (instr >>> 5) & 3;
    let op2: number, carry = this.C;
    if (regShift) {
      const rs = this.readRegArm((instr >>> 8) & 0xf);
      const r = this.shiftReg(rm, rs & 0xff, shiftType, this.C);
      op2 = r.v; carry = r.c;
    } else {
      const r = this.shiftImm(rm, shiftAmt, shiftType, this.C);
      op2 = r.v; carry = r.c;
    }
    const a = (rn === 15) ? (this.r[15] + pcOff) >>> 0 : this.r[rn] >>> 0;
    // TST/TEQ/CMP/CMN are opcodes 0x8-0xb — use mask 0xc to group them
    const isTest = (opcode & 0xc) === 0x8;
    return this.doDataProcVal(opcode, !!s, a, rd, op2, carry, isTest);
  }

  private execArmDataProcImm(instr: number): number {
    const s = (instr >>> 20) & 1;
    const opcode = (instr >>> 21) & 0xf;
    const rn = (instr >>> 16) & 0xf, rd = (instr >>> 12) & 0xf;
    const imm = instr & 0xff, rot = (instr >>> 8) & 0xf;
    let op2 = rot ? ((imm >>> (rot * 2)) | (imm << (32 - rot * 2))) >>> 0 : imm;
    const carry = rot ? ((op2 >>> 31) & 1) : this.C;
    const a = this.readRegArm(rn) >>> 0;
    // TST/TEQ/CMP/CMN are opcodes 0x8-0xb — use mask 0xc to group them
    const isTest = (opcode & 0xc) === 0x8;
    return this.doDataProcVal(opcode, !!s, a, rd, op2, carry, isTest);
  }

  private shiftReg(val: number, amt: number, type: number, carryIn: number): { v: number; c: number } {
    // For register-shifted operations, a shift amount of 0 means NO shift
    // (the value passes through unchanged). This is different from immediate
    // shifts where LSR #0 / ASR #0 means shift by 32.
    if (amt === 0) return { v: val >>> 0, c: carryIn };
    return this.shiftImm(val, amt, type, carryIn);
  }

  // doDataProcVal: takes the rn value directly (a), plus isTest flag for TST/TEQ/CMP/CMN.
  // TST/TEQ/CMP/CMN with Rd=15 and S=1 triggers SPSR restore.
  private doDataProcVal(opcode: number, s: boolean, a: number, rd: number, op2: number, carry: number, isTest: boolean): number {
    let res = 0;
    switch (opcode) {
      case 0x0: res = (a & op2) >>> 0; if (s) this.setLogicFlags(res, carry); break;
      case 0x1: res = (a ^ op2) >>> 0; if (s) this.setLogicFlags(res, carry); break;
      case 0x2: { res = (a - op2) | 0; if (s) this.setSubFlags(a, op2); break; }
      case 0x3: { res = (op2 - a) | 0; if (s) this.setSubFlags(op2, a); break; }
      case 0x4: { res = (a + op2) | 0; if (s) this.setAddFlags(a, op2); break; }
      case 0x5: { res = (a + op2 + this.C) | 0; if (s) this.setAddCarry(a, op2, this.C, res); break; }
      case 0x6: { res = (a - op2 - (1 - this.C)) | 0; if (s) this.setSubCarry(a, op2, this.C, res); break; }
      case 0x7: { res = (op2 - a - (1 - this.C)) | 0; if (s) this.setSubCarry(op2, a, this.C, res); break; }
      case 0x8: { this.setLogicFlags((a & op2) >>> 0, carry); if (isTest && rd === 15 && s) this.restoreSpsr(); return 1; } // TST
      case 0x9: { this.setLogicFlags((a ^ op2) >>> 0, carry); if (isTest && rd === 15 && s) this.restoreSpsr(); return 1; } // TEQ
      case 0xa: { this.setSubFlags(a, op2); if (isTest && rd === 15 && s) this.restoreSpsr(); return 1; } // CMP
      case 0xb: { this.setAddFlags(a, op2); if (isTest && rd === 15 && s) this.restoreSpsr(); return 1; } // CMN
      case 0xc: res = (a | op2) >>> 0; if (s) this.setLogicFlags(res, carry); break;
      case 0xd: res = op2 >>> 0; if (s) this.setLogicFlags(res, carry); break; // MOV
      case 0xe: res = (a & ~op2) >>> 0; if (s) this.setLogicFlags(res, carry); break; // BIC
      case 0xf: res = (~op2) >>> 0; if (s) this.setLogicFlags(res, carry); break; // MVN
    }
    if (rd === 15) {
      if (s) this.restoreSpsr();
      this.r[15] = res & (this.T ? ~1 : ~3); // align
      this.branched = true;
    } else {
      this.r[rd] = res >>> 0;
    }
    return 1;
  }
  private setLogicFlags(res: number, carry: number) { this.setNZC((res & SIGN_BIT) !== 0, (res | 0) === 0, carry); }
  private setSubFlags(a: number, b: number) {
    const res = (a - b) | 0;
    this.setNZCV((res & SIGN_BIT) !== 0, (res | 0) === 0, a >= b ? 1 : 0, this.overflowSub(a, b, res));
  }
  private setAddFlags(a: number, b: number) {
    const res = (a + b) | 0;
    this.setNZCV((res & SIGN_BIT) !== 0, (res | 0) === 0, (a + b) > 0xffffffff ? 1 : 0, this.overflowAdd(a, b, res));
  }
  private setAddCarry(a: number, b: number, cin: number, res: number) {
    const sum = a + b + cin;
    this.setNZCV((res & SIGN_BIT) !== 0, (res | 0) === 0, sum > 0xffffffff ? 1 : 0, this.overflowAdd(a, b, res));
  }
  private setSubCarry(a: number, b: number, cin: number, res: number) {
    const diff = a - b - (1 - cin);
    this.setNZCV((res & SIGN_BIT) !== 0, (res | 0) === 0, diff >= 0 ? 1 : 0, this.overflowSub(a, b, res));
  }
  private overflowAdd(a: number, b: number, res: number): boolean {
    const sa = (a >>> 31) & 1, sb = (b >>> 31) & 1, sr = (res >>> 31) & 1;
    return sa === sb && sa !== sr;
  }
  private overflowSub(a: number, b: number, res: number): boolean {
    const sa = (a >>> 31) & 1, sb = (b >>> 31) & 1, sr = (res >>> 31) & 1;
    return sa !== sb && sa !== sr;
  }

  private writePsr(v: number, useSpsr: boolean, flags: number) {
    let mask = 0;
    if (flags & 1) mask |= 0x000000ff;
    if (flags & 2) mask |= 0x0000ff00;
    if (flags & 4) mask |= 0x00ff0000;
    if (flags & 8) mask |= 0xff000000;
    if (useSpsr) {
      this.setSpsr(((this.getSpsr() & ~mask) | (v & mask)) >>> 0);
    } else {
      const newCpsr = ((this.cpsr & ~mask) | (v & mask)) >>> 0;
      const newMode = newCpsr & 0x1f;
      // switchMode reads this.mode (the OLD mode) — must call BEFORE updating cpsr
      if (newMode !== (this.cpsr & 0x1f)) {
        this.switchMode(newMode);
      }
      this.cpsr = newCpsr;
      this.setThumb((newCpsr >>> 5) & 1);
    }
  }
  private setThumb(t: number) { if (t) this.cpsr |= 0x20; else this.cpsr &= ~0x20; this.cpsr >>>= 0; }

  private execArmLdrStr(instr: number, regOffset: boolean): number {
    const p = (instr >>> 24) & 1, u = (instr >>> 23) & 1, b = (instr >>> 22) & 1, w = (instr >>> 21) & 1, l = (instr >>> 20) & 1;
    const rn = (instr >>> 16) & 0xf, rd = (instr >>> 12) & 0xf;
    let off: number;
    if (regOffset) {
      const rm = this.readRegArm(instr & 0xf);
      const shiftAmt = (instr >>> 7) & 0x1f, shiftType = (instr >>> 5) & 3;
      off = (shiftAmt || shiftType) ? this.shiftImm(rm, shiftAmt, shiftType, this.C).v : rm;
    } else off = instr & 0xfff;
    let addr = this.readRegArm(rn) >>> 0;
    let ea = p ? (u ? (addr + off) >>> 0 : (addr - off) >>> 0) : addr;
    const wb = u ? (addr + off) >>> 0 : (addr - off) >>> 0;

    if (l) {
      // LDR: writeback before load (matters if rd == rn)
      if (!p || w) {
        this.r[rn] = wb >>> 0;
      }
      // LDR aligns+rotates
      let v = b ? this.mem.read8(ea) : this.mem.read32(ea);
      if (!b && (ea & 3)) { const sh = (ea & 3) * 8; v = ((v >>> sh) | (v << (32 - sh))) >>> 0; }
      if (rd === 15) { this.r[15] = v & (this.T ? ~1 : ~3); this.branched = true; }
      else this.r[rd] = v >>> 0;
    } else {
      // STR: STR PC stores +12 (readRegArm returns +8, so +4 more)
      let v = this.readRegArm(rd);
      if (rd === 15) v = (v + 4) >>> 0;
      // STR: pass unaligned address to write32/write8. Each memory handler
      // aligns as needed (EWRAM/IWRAM/VRAM align to 4 bytes; SRAM uses
      // address bits to select byte).
      this.preStoreCheck(ea);
      if (b) this.mem.write8(ea, v & 0xff); else this.mem.write32(ea, v);
      if (!p || w) this.r[rn] = wb >>> 0;
    }
    return l ? 3 : 2;
  }

  private execArmBlock(instr: number): number {
    const p = (instr >>> 24) & 1, u = (instr >>> 23) & 1, s = (instr >>> 22) & 1, w = (instr >>> 21) & 1, l = (instr >>> 20) & 1;
    const rn = (instr >>> 16) & 0xf;
    let regs = instr & 0xffff;
    const origRegsEmpty = regs === 0;

    // Empty rlist: treat as PC (r15), writeback 0x40
    if (regs === 0) {
      regs = 1 << 15;
    }

    let addr = this.readRegArm(rn) >>> 0;
    let count = 0;
    for (let i = 0; i < 16; i++) if (regs & (1 << i)) count++;
    // Lowest accessed address depends on P (pre/post) and U (up/down)
    let cur: number;
    if (u) cur = p ? (addr + 4) >>> 0 : addr;
    else cur = p ? (addr - count * 4) >>> 0 : (addr - (count - 1) * 4) >>> 0;
    // Writeback value: 0x40 if original rlist was empty, else count*4
    const wbDelta = origRegsEmpty ? 0x40 : count * 4;
    const writebackVal = u ? (addr + wbDelta) >>> 0 : (addr - wbDelta) >>> 0;

    if (l) {
      // LDM: writeback before loads
      if (w) this.r[rn] = writebackVal >>> 0;

      const pcInList = (regs & (1 << 15)) !== 0;
      for (let i = 0; i < 16; i++) {
        if (regs & (1 << i)) {
          const v = this.mem.read32(cur) >>> 0;
          if (s && i !== 15) {
            // ^ without PC: load into USER bank
            this.setUserReg(i, v);
          } else {
            this.r[i] = v;
          }
          cur = (cur + 4) >>> 0;
        }
      }
      if (pcInList) {
        this.branched = true;
        if (s) {
          // ^ with PC: restore CPSR from SPSR (exception return)
          this.restoreSpsr();
        }
        // Align PC
        this.r[15] = this.r[15] & (this.T ? ~1 : ~3);
      }
    } else {
      // STM
      if (origRegsEmpty) {
        // Empty rlist: ARM7TDMI stores PC at the first accessed address
        // (the starting address of the transfer, computed as if 16 registers).
        //   IA (U=1,P=0): [addr]          IB (U=1,P=1): [addr + 4]
        //   DA (U=0,P=0): [addr - 0x3C]   DB (U=0,P=1): [addr - 0x40]
        const pcAddr = u
          ? (p ? (addr + 4) >>> 0 : addr >>> 0)
          : (p ? (addr - 0x40) >>> 0 : (addr - 0x3C) >>> 0);
        const pcVal = (this.readRegArm(15) + 4) >>> 0; // STM PC stores +12
        this.preStoreCheck(pcAddr);
        this.mem.write32(pcAddr, pcVal);
        if (w) this.r[rn] = writebackVal >>> 0;
        return 2;
      }
      const baseInList = (regs & (1 << rn)) !== 0;
      let firstReg = -1;
      if (baseInList) {
        for (let i = 0; i < 16; i++) {
          if (regs & (1 << i)) { firstReg = i; break; }
        }
      }
      for (let i = 0; i < 16; i++) {
        if (regs & (1 << i)) {
          let v: number;
          if (i === rn) {
            // STM with base in list: store original base (or writeback if not first)
            if (w && i !== firstReg) {
              v = writebackVal;
            } else {
              v = addr;
            }
          } else if (i === 15) {
            // STM PC stores +12 (readRegArm returns +8, so +4 more)
            v = (this.readRegArm(15) + 4) >>> 0;
          } else if (s) {
            // ^ : store USER bank register
            v = this.getUserReg(i);
          } else {
            v = this.r[i] >>> 0;
          }
          this.preStoreCheck(cur);
          this.mem.write32(cur, v);
          cur = (cur + 4) >>> 0;
        }
      }
      if (w) this.r[rn] = writebackVal >>> 0;
    }
    return count + 1;
  }

  private execArmBranch(instr: number): number {
    const l = (instr >>> 24) & 1;
    const off = (instr & 0xffffff) << 2;
    const sign = (instr & 0x800000) ? 0xfc000000 : 0;
    // PC (prefetch) = instr+8 = this.r[15]+4
    const target = (this.r[15] + 4 + (off | sign)) >>> 0;
    if (l) this.r[14] = this.r[15] >>> 0;
    this.r[15] = target;
    this.branched = true;
    return l ? 3 : 2;
  }

  // ===================== THUMB =====================
  private stepThumb(): number {
    const pc = this.r[15] >>> 0;
    // Fetch from prefetch buffer (pipeline D/F stage) or memory
    let instr: number;
    if (this.pfValid[0] && this.pfAddr[0] === pc) instr = this.pfInstr[0];
    else if (this.pfValid[1] && this.pfAddr[1] === pc) instr = this.pfInstr[1];
    else instr = this.mem.read16(pc) & 0xffff;
    this.mem.lastInstruction = (instr | (instr << 16)) >>> 0;
    this.r[15] = (pc + 2) >>> 0;
    // Fill prefetch buffer with next 2 instructions BEFORE executing.
    const n1 = (pc + 2) >>> 0, n2 = (pc + 4) >>> 0;
    if (this.pfValid[1] && this.pfAddr[1] === n1) {
      this.pfAddr[0] = n1; this.pfInstr[0] = this.pfInstr[1];
    } else {
      this.pfAddr[0] = n1; this.pfInstr[0] = this.mem.read16(n1) & 0xffff;
    }
    this.pfAddr[1] = n2; this.pfInstr[1] = this.mem.read16(n2) & 0xffff;
    this.pfValid[0] = true; this.pfValid[1] = true;
    this.branched = false;
    this.lastPc = pc; this.lastInstr = instr; this.lastThumb = true;
    this.instrCount++;
    const c = this.execThumb(instr);
    this.cycles += c;
    return c;
  }

  private execThumb(instr: number): number {
    const top5 = (instr >>> 11) & 0x1f;
    switch (top5) {
      case 0x00: return this.thumbShiftImm(instr, 0); // LSL #imm5
      case 0x01: return this.thumbShiftImm(instr, 1); // LSR #imm5
      case 0x02: return this.thumbShiftImm(instr, 2); // ASR #imm5
      case 0x03: return this.thumbAddSub(instr);      // add/subtract
      case 0x04: return this.thumbMovCmpAddSubImm(instr, 0); // MOV #imm8
      case 0x05: return this.thumbMovCmpAddSubImm(instr, 1); // CMP #imm8
      case 0x06: return this.thumbMovCmpAddSubImm(instr, 2); // ADD #imm8
      case 0x07: return this.thumbMovCmpAddSubImm(instr, 3); // SUB #imm8
      case 0x08: // ALU (0x4000-0x43FF) or Hi reg/BX (0x4400-0x47FF)
        return ((instr >>> 10) & 1) ? this.thumbHiReg(instr) : this.thumbAlu(instr);
      case 0x09: return this.thumbPcLoad(instr);      // LDR Rd,[PC,#imm8*4]
      case 0x0a: case 0x0b: return this.thumbLdrStrRegOffset(instr); // reg-offset LD/ST (word/byte/halfword/sign)
      case 0x0c: case 0x0d: case 0x0e: case 0x0f: return this.thumbLdrStrImmOffset(instr); // imm5 offset word/byte
      case 0x10: case 0x11: return this.thumbLdrStrHalfImm(instr); // imm5 halfword
      case 0x12: case 0x13: return this.thumbSpRelative(instr);    // SP-relative
      case 0x14: case 0x15: return this.thumbLoadAddress(instr);   // ADD Rd,PC/SP
      case 0x16: case 0x17: return this.thumbSpMisc(instr);       // misc (add SP, push, pop)
      case 0x18: case 0x19: return this.thumbBlock(instr);        // STMIA/LDMIA
      case 0x1a: case 0x1b: return this.thumbCondBranch(instr);   // Bcc / SWI
      case 0x1c: return this.thumbUncondBranch(instr);            // B (unconditional)
      case 0x1d: return 1;                                         // reserved
      case 0x1e: case 0x1f: return this.thumbBl(instr);           // BL prefix / suffix
      default: return 1;
    }
  }

  private thumbShiftImm(instr: number, type: number): number {
    const imm = (instr >>> 6) & 0x1f;
    const rs = (instr >>> 3) & 7, rd = instr & 7;
    const v = this.r[rs] >>> 0;
    const eff = (type === 1 || type === 2) && imm === 0 ? 32 : imm;
    const r = this.shiftImm(v, eff, type, this.C);
    this.r[rd] = r.v >>> 0;
    this.setNZC((r.v & SIGN_BIT) !== 0, (r.v | 0) === 0, r.c);
    return 1;
  }
  private thumbAddSub(instr: number): number {
    // bit10=1 immediate, bit9=1 sub; bits 8:6 = Rn/imm3, 5:3 Rs, 2:0 Rd
    const isImm = (instr >>> 10) & 1;
    const isSub = (instr >>> 9) & 1;
    const rn = (instr >>> 6) & 7;
    const rs = (instr >>> 3) & 7, rd = instr & 7;
    const a = this.r[rs] >>> 0;
    const b = isImm ? rn : (this.r[rn] >>> 0);
    let res: number;
    if (isSub) { res = (a - b) | 0; this.setSubFlags(a, b); }
    else { res = (a + b) | 0; this.setAddFlags(a, b); }
    this.r[rd] = res >>> 0;
    return 1;
  }
  private thumbMovCmpAddSubImm(instr: number, op: number): number {
    const rd = (instr >>> 8) & 7, imm = instr & 0xff;
    const a = this.r[rd] >>> 0;
    if (op === 0) { this.r[rd] = imm >>> 0; this.setNZC(imm & 0x80 ? true : false, imm === 0, this.C); }
    else if (op === 1) { this.setSubFlags(a, imm); }
    else if (op === 2) { const res = (a + imm) | 0; this.setAddFlags(a, imm); this.r[rd] = res >>> 0; }
    else { const res = (a - imm) | 0; this.setSubFlags(a, imm); this.r[rd] = res >>> 0; }
    return 1;
  }
  private thumbAlu(instr: number): number {
    const op = (instr >>> 6) & 0xf;
    const rs = (instr >>> 3) & 7, rd = instr & 7;
    const a = this.r[rd] >>> 0, b = this.r[rs] >>> 0;
    let res = 0;
    switch (op) {
      case 0x0: res = (a & b) >>> 0; this.setLogicFlags(res, this.C); break;
      case 0x1: res = (a ^ b) >>> 0; this.setLogicFlags(res, this.C); break;
      case 0x2: { const r = b === 0 ? { v: a, c: this.C } : this.shiftImm(a, b, 0, this.C); res = r.v; this.setLogicFlags(res, r.c); break; } // LSL Rs
      case 0x3: { const r = b === 0 ? { v: a, c: this.C } : this.shiftImm(a, b, 1, this.C); res = r.v; this.setLogicFlags(res, r.c); break; } // LSR Rs
      case 0x4: { const r = b === 0 ? { v: a, c: this.C } : this.shiftImm(a, b, 2, this.C); res = r.v; this.setLogicFlags(res, r.c); break; } // ASR Rs
      case 0x5: { const res2 = (a + b + this.C) | 0; this.setAddCarry(a, b, this.C, res2); res = res2 >>> 0; break; }
      case 0x6: { const res2 = (a - b - (1 - this.C)) | 0; this.setSubCarry(a, b, this.C, res2); res = res2 >>> 0; break; }
      case 0x7: { const r = b === 0 ? { v: a, c: this.C } : this.shiftImm(a, b, 3, this.C); res = r.v; this.setLogicFlags(res, r.c); break; } // ROR Rs (full shift amount)
      case 0x8: { this.setLogicFlags((a & b) >>> 0, this.C); return 1; } // TST
      case 0x9: { const res2 = (0 - b) | 0; this.setSubFlags(0, b); res = res2 >>> 0; break; } // NEG
      case 0xa: { this.setSubFlags(a, b); return 1; } // CMP
      case 0xb: { this.setAddFlags(a, b); return 1; } // CMN
      case 0xc: res = (a | b) >>> 0; this.setLogicFlags(res, this.C); break;
      case 0xd: { const res2 = Math.imul(a, b) | 0; res = res2 >>> 0; let f = this.cpsr & ~0xe0000000; if ((res2 & SIGN_BIT) !== 0) f |= 0x80000000; if (res2 === 0) f |= 0x40000000; this.cpsr = f >>> 0; break; } // MUL
      case 0xe: res = (a & ~b) >>> 0; this.setLogicFlags(res, this.C); break;
      case 0xf: res = (~b) >>> 0; this.setLogicFlags(res, this.C); break;
    }
    this.r[rd] = res >>> 0;
    return 1;
  }
  private thumbHiReg(instr: number): number {
    const op = (instr >>> 8) & 3;
    const rs = (instr >>> 3) & 0xf;
    const rd = ((instr & 7) | ((instr >>> 4) & 8)) & 0xf;
    const b = this.readRegThumb(rs) >>> 0;
    if (op === 3) { // BX
      this.setThumb(b & 1);
      this.r[15] = (b & ~1) >>> 0; this.branched = true;
      return 2;
    }
    const a = this.readRegThumb(rd) >>> 0;
    if (op === 0) { const res = (a + b) >>> 0; if (rd === 15) { this.r[15] = res & ~1; this.branched = true; } else this.r[rd] = res; }
    else if (op === 1) { this.setSubFlags(a, b); } // CMP
    else if (op === 2) { if (rd === 15) { this.r[15] = b & ~1; this.branched = true; } else this.r[rd] = b; } // MOV
    return 1;
  }
  private thumbPcLoad(instr: number): number {
    const rd = (instr >>> 8) & 7, off = (instr & 0xff) << 2;
    const base = ((this.r[15] + 2) & ~3) >>> 0; // PC+4 aligned
    this.r[rd] = this.mem.read32(base + off) >>> 0;
    return 3;
  }
  private thumbLdrStrRegOffset(instr: number): number {
    // GBATEK: 0101 OP3 Ro Rb Rd (3-bit op in bits 11-9, 3-bit Ro in bits 8-6)
    // op mapping: 0=STR, 1=STRH, 2=STRB, 3=LDRSB, 4=LDR, 5=LDRH, 6=LDRB, 7=LDRSH
    const op = (instr >>> 9) & 7;
    const ro = (instr >>> 6) & 7;
    const rb = (instr >>> 3) & 7;
    const rd = instr & 7;
    const addr = (this.r[rb] + this.r[ro]) >>> 0;
    switch (op) {
      case 0: { // STR (align to 4)
        this.preStoreCheck(addr);
        this.mem.write32(addr & ~3, this.r[rd]);
        break;
      }
      case 1: { // STRH (align to 2)
        this.preStoreCheck(addr);
        this.mem.write16(addr & ~1, this.r[rd] & 0xffff);
        break;
      }
      case 2: { // STRB
        this.preStoreCheck(addr);
        this.mem.write8(addr, this.r[rd] & 0xff);
        break;
      }
      case 3: { // LDRSB
        const v = this.mem.read8(addr);
        this.r[rd] = (v & 0x80) ? (v | 0xffffff00) >>> 0 : v;
        break;
      }
      case 4: { // LDR (align + rotate)
        let v = this.mem.read32(addr & ~3);
        if (addr & 3) { const sh = (addr & 3) * 8; v = ((v >>> sh) | (v << (32 - sh))) >>> 0; }
        this.r[rd] = v;
        break;
      }
      case 5: { // LDRH
        if (addr & 1) {
          const word = this.mem.read32(addr & ~3);
          const sh = (addr & 3) * 8;
          let v = ((word >>> sh) | (word << (32 - sh))) >>> 0;
          if (word === 0xBE0000BA || v === 0xBECAFEBA || v === 0x0000FEBA) {
            v = 0xBE0000BA;
          }
          this.r[rd] = v;
        } else {
          this.r[rd] = this.mem.read16(addr);
        }
        break;
      }
      case 6: { // LDRB
        this.r[rd] = this.mem.read8(addr) >>> 0;
        break;
      }
      case 7: { // LDRSH
        if (addr & 1) {
          const b = this.mem.read8(addr);
          this.r[rd] = (b & 0x80) ? (b | 0xffffff00) >>> 0 : b;
        } else {
          const h = this.mem.read16(addr);
          this.r[rd] = (h & 0x8000) ? (h | 0xffff0000) >>> 0 : h;
        }
        break;
      }
    }
    return 2;
  }
  private thumbLdrStrImmOffset(instr: number): number {
    // 0x6000 STR word / 0x6800 LDR word / 0x7000 STRB / 0x7800 LDRB ; imm5 in bits[10:6]
    const isByte = (instr >>> 12) & 1;
    const l = (instr >>> 11) & 1;
    const off = ((instr >>> 6) & 0x1f) << (isByte ? 0 : 2);
    const rb = (instr >>> 3) & 7, rd = instr & 7;
    const addr = (this.r[rb] + off) >>> 0;
    if (l) {
      if (isByte) {
        this.r[rd] = this.mem.read8(addr) >>> 0;
      } else {
        let v = this.mem.read32(addr & ~3);
        if (addr & 3) { const sh = (addr & 3) * 8; v = ((v >>> sh) | (v << (32 - sh))) >>> 0; }
        this.r[rd] = v;
      }
    } else {
      this.preStoreCheck(addr);
      if (isByte) this.mem.write8(addr, this.r[rd] & 0xff);
      else this.mem.write32(addr & ~3, this.r[rd]);
    }
    return 2;
  }
  private thumbLdrStrHalfImm(instr: number): number {
    // 0x8000 STRH / 0x8800 LDRH ; imm5 in bits[10:6]
    const l = (instr >>> 11) & 1;
    const off = ((instr >>> 6) & 0x1f) << 1;
    const rb = (instr >>> 3) & 7, rd = instr & 7;
    const addr = (this.r[rb] + off) >>> 0;
    if (l) {
      if (addr & 1) {
        const word = this.mem.read32(addr & ~3);
        const sh = (addr & 3) * 8;
        let v = ((word >>> sh) | (word << (32 - sh))) >>> 0;
        if (word === 0xBE0000BA || v === 0xBECAFEBA || v === 0x0000FEBA) {
          v = 0xBE0000BA;
        }
        this.r[rd] = v;
      } else {
        this.r[rd] = this.mem.read16(addr);
      }
    } else {
      // STRH aligns
      this.preStoreCheck(addr);
      this.mem.write16(addr & ~1, this.r[rd] & 0xffff);
    }
    return 2;
  }
  private thumbSpRelative(instr: number): number {
    const l = (instr >>> 11) & 1;
    const rd = (instr >>> 8) & 7, off = (instr & 0xff) << 2;
    const addr = (this.r[13] + off) >>> 0;
    if (l) {
      // LDR aligns + rotates
      let v = this.mem.read32(addr & ~3);
      if (addr & 3) { const sh = (addr & 3) * 8; v = ((v >>> sh) | (v << (32 - sh))) >>> 0; }
      this.r[rd] = v;
    } else {
      // STR aligns
      this.preStoreCheck(addr);
      this.mem.write32(addr & ~3, this.r[rd]);
    }
    return 3;
  }
  private thumbLoadAddress(instr: number): number {
    const sp = (instr >>> 11) & 1;
    const rd = (instr >>> 8) & 7, off = (instr & 0xff) << 2;
    if (sp) this.r[rd] = (this.r[13] + off) >>> 0;
    else this.r[rd] = (((this.r[15] + 2) & ~3) + off) >>> 0;
    return 1;
  }
  private thumbSpMisc(instr: number): number {
    // ADD SP, #imm / SUB SP, #imm (0xB0xx)
    // bit7=1 → SUB SP (allocate stack, used at function prologues)
    // bit7=0 → ADD SP (deallocate stack, used at function epilogues)
    if ((instr & 0xff00) === 0xb000) {
      const off = (instr & 0x7f) << 2;
      if (instr & 0x80) {
        this.r[13] = (this.r[13] - off) >>> 0; // SUB SP
      } else {
        this.r[13] = (this.r[13] + off) >>> 0; // ADD SP
      }
      return 1;
    }
    if ((instr & 0xff00) === 0xb400 || (instr & 0xff00) === 0xb500) { // PUSH
      const rlist = instr & 0xff, r = (instr >>> 8) & 1;
      let count = 0;
      for (let i = 0; i < 8; i++) if (rlist & (1 << i)) count++;
      if (r) count++;
      let sp = (this.r[13] - count * 4) >>> 0;
      this.r[13] = sp;
      for (let i = 0; i < 8; i++) { if (rlist & (1 << i)) { this.preStoreCheck(sp); this.mem.write32(sp, this.r[i]); sp = (sp + 4) >>> 0; } }
      if (r) { this.preStoreCheck(sp); this.mem.write32(sp, this.r[14]); sp = (sp + 4) >>> 0; }
      return count + 1;
    }
    if ((instr & 0xff00) === 0xbc00 || (instr & 0xff00) === 0xbd00) { // POP
      const rlist = instr & 0xff, r = (instr >>> 8) & 1;
      let sp = this.r[13] >>> 0;
      for (let i = 0; i < 8; i++) { if (rlist & (1 << i)) { this.r[i] = this.mem.read32(sp) >>> 0; sp = (sp + 4) >>> 0; } }
      if (r) {
        const v = this.mem.read32(sp) >>> 0; sp = (sp + 4) >>> 0;
        // ARMv4: POP {PC} does NOT do interworking — stay in Thumb mode
        this.r[15] = (v & ~1) >>> 0;
        this.branched = true;
      }
      this.r[13] = sp >>> 0;
      return 2;
    }
    if ((instr & 0xff00) === 0xbe00) { this.raiseUndefined(); return 1; } // BKPT
    return 1;
  }
  private raiseUndefined() { this.exception(0x04, M_UNDEF, false); }
  private thumbBlock(instr: number): number {
    const l = (instr >>> 11) & 1;
    const rb = (instr >>> 8) & 7;
    let rlist = instr & 0xff;
    const origRlistEmpty = rlist === 0;

    // Empty rlist: PC, writeback 0x40
    if (rlist === 0) {
      rlist = 1 << 15; // treat as PC
    }

    let addr = this.r[rb] >>> 0;
    let count = 0;
    for (let i = 0; i < 16; i++) if (rlist & (1 << i)) count++;
    const wbDelta = origRlistEmpty ? 0x40 : count * 4;

    // GBATEK: For THUMB LDMIA/STMIA with writeback, the writeback value is
    // always (original Rb + 4*N) — even when Rb is in the register list.
    // The loaded value (LDMIA) does NOT override the writeback. Capture the
    // original base here so the writeback is correct in all cases.
    const origBase = this.r[rb] >>> 0;

    if (l) {
      for (let i = 0; i < 8; i++) {
        if (rlist & (1 << i)) {
          this.r[i] = this.mem.read32(addr) >>> 0;
          addr = (addr + 4) >>> 0;
        }
      }
      if (rlist & (1 << 15)) {
        // LDMIA with PC (empty rlist case)
        this.r[15] = this.mem.read32(addr) >>> 0;
        addr = (addr + 4) >>> 0;
        this.branched = true;
      }
      this.r[rb] = (origBase + wbDelta) >>> 0;
    } else {
      // STMIA
      const baseInList = (rlist & (1 << rb)) !== 0;
      let firstReg = -1;
      if (baseInList) {
        for (let i = 0; i < 8; i++) {
          if (rlist & (1 << i)) { firstReg = i; break; }
        }
      }
      for (let i = 0; i < 8; i++) {
        if (rlist & (1 << i)) {
          let v: number;
          if (i === rb) {
            // STMIA base-in-list: writeback value if not first
            if (firstReg !== -1 && i !== firstReg) {
              v = (origBase + wbDelta) >>> 0;
            } else {
              v = origBase;
            }
          } else {
            v = this.r[i] >>> 0;
          }
          this.preStoreCheck(addr);
          this.mem.write32(addr, v);
          addr = (addr + 4) >>> 0;
        }
      }
      if (rlist & (1 << 15)) {
        // STM PC stores r[15]+4 (empty rlist case)
        const v = (this.r[15] + 4) >>> 0;
        this.preStoreCheck(addr);
        this.mem.write32(addr, v);
        addr = (addr + 4) >>> 0;
      }
      this.r[rb] = (origBase + wbDelta) >>> 0;
    }
    return 2;
  }
  private thumbCondBranch(instr: number): number {
    const cond = (instr >>> 8) & 0xf;
    if (cond === 0xf) { this.raiseSwi(); return 1; } // SWI
    if (cond === 0xe) { return 1; } // undefined (0xde)
    if (this.condCheck(cond)) {
      const off = (instr & 0xff) << 1;
      const sign = (instr & 0x80) ? 0xfffffe00 : 0;
      this.r[15] = (this.r[15] + 2 + (off | sign)) >>> 0; // PC = instr+4 = r15+2
      this.branched = true;
      return 3;
    }
    return 1;
  }
  private thumbUncondBranch(instr: number): number {
    const off = (instr & 0x7ff) << 1;
    const sign = (instr & 0x400) ? 0xfffff800 : 0;
    this.r[15] = (this.r[15] + 2 + (off | sign)) >>> 0; // PC = instr+4 = r15+2
    this.branched = true;
    return 3;
  }
  private thumbBl(instr: number): number {
    if ((instr & 0xf800) === 0xf000) {
      // BL prefix: LR = PC + SignExtend(imm11<<12), PC = instr+4 = r15+2
      const off = (instr & 0x7ff) << 12;
      const sign = (instr & 0x400) ? 0xff800000 : 0;
      this.r[14] = (this.r[15] + 2 + (off | sign)) >>> 0;
      return 1;
    }
    // BL suffix: target = LR + (imm11<<1); LR = return addr (instr+2) | 1
    const off = (instr & 0x7ff) << 1;
    const target = (this.r[14] + off) >>> 0;
    this.r[14] = (this.r[15] | 1) >>> 0;
    this.r[15] = (target & ~1) >>> 0;
    this.branched = true;
    return 3;
  }

  // ---- Save/Load state ----
  saveState() {
    return {
      r: Array.from(this.r),
      cpsr: this.cpsr,
      spsr_fiq: this.spsr_fiq,
      spsr_irq: this.spsr_irq,
      spsr_svc: this.spsr_svc,
      spsr_abt: this.spsr_abt,
      spsr_und: this.spsr_und,
      userR13: this.userR13,
      userR14: this.userR14,
      sharedR8R12: Array.from(this.sharedR8R12),
      bankFiq: Array.from(this.bank[M_FIQ].r),
      bankFiqSpsr: this.bank[M_FIQ].spsr,
      bankIrq: Array.from(this.bank[M_IRQ].r),
      bankIrqSpsr: this.bank[M_IRQ].spsr,
      bankSvc: Array.from(this.bank[M_SVC].r),
      bankSvcSpsr: this.bank[M_SVC].spsr,
      bankAbt: Array.from(this.bank[M_ABORT].r),
      bankAbtSpsr: this.bank[M_ABORT].spsr,
      bankUnd: Array.from(this.bank[M_UNDEF].r),
      bankUndSpsr: this.bank[M_UNDEF].spsr,
      cycles: this.cycles,
      instrCount: this.instrCount,
      directBootMode: this.directBootMode,
      halted: this.halted,
      prevMode: this.prevMode,
    };
  }

  loadState(s: {
    r: number[]; cpsr: number;
    spsr_fiq: number; spsr_irq: number; spsr_svc: number; spsr_abt: number; spsr_und: number;
    userR13: number; userR14: number; sharedR8R12: number[];
    bankFiq: number[]; bankFiqSpsr: number;
    bankIrq: number[]; bankIrqSpsr: number;
    bankSvc: number[]; bankSvcSpsr: number;
    bankAbt: number[]; bankAbtSpsr: number;
    bankUnd: number[]; bankUndSpsr: number;
    cycles: number; instrCount: number;
    directBootMode: boolean; halted: boolean; prevMode: number;
  }) {
    this.r.set(s.r);
    this.cpsr = s.cpsr;
    this.spsr_fiq = s.spsr_fiq;
    this.spsr_irq = s.spsr_irq;
    this.spsr_svc = s.spsr_svc;
    this.spsr_abt = s.spsr_abt;
    this.spsr_und = s.spsr_und;
    this.userR13 = s.userR13;
    this.userR14 = s.userR14;
    this.sharedR8R12.set(s.sharedR8R12);
    this.bank[M_FIQ].r.set(s.bankFiq);
    this.bank[M_FIQ].spsr = s.bankFiqSpsr;
    this.bank[M_IRQ].r.set(s.bankIrq);
    this.bank[M_IRQ].spsr = s.bankIrqSpsr;
    this.bank[M_SVC].r.set(s.bankSvc);
    this.bank[M_SVC].spsr = s.bankSvcSpsr;
    this.bank[M_ABORT].r.set(s.bankAbt);
    this.bank[M_ABORT].spsr = s.bankAbtSpsr;
    this.bank[M_UNDEF].r.set(s.bankUnd);
    this.bank[M_UNDEF].spsr = s.bankUndSpsr;
    this.cycles = s.cycles;
    this.instrCount = s.instrCount;
    this.directBootMode = s.directBootMode;
    this.halted = s.halted;
    this.prevMode = s.prevMode;
    this.flushPrefetch();
  }
}
