export interface SpcState {
  pc: number;
  a: number;
  x: number;
  y: number;
  sp: number;
  psw: number;
}

interface SpcTimer {
  enabled: boolean;
  target: number;      // 8-bit compare value ($FA/$FB/$FC)
  counter: number;     // internal 8-bit counter
  output: number;      // 4-bit output for $FD-$FF
  divider: number;     // fractional cycle counter
}

// Global log collection for debugging
declare global {
  interface Window {
    spc700Logs?: string[];
  }
}

if (typeof window !== 'undefined') {
  window.spc700Logs = window.spc700Logs || [];
}

export class Spc700 {
  public static readonly CLOCK_HZ = 1024000;

  private ram = new Uint8Array(0x10000);
  private portsFromCpu = new Uint8Array(4); // CPU → SPC (written by CPU)
  private portsToCpu = new Uint8Array(4);   // SPC → CPU (read by CPU)

  private timers: SpcTimer[] = [
    { enabled: false, target: 0, counter: 0, output: 0, divider: 0 },
    { enabled: false, target: 0, counter: 0, output: 0, divider: 0 },
    { enabled: false, target: 0, counter: 0, output: 0, divider: 0 },
  ];

  private state: SpcState = {
    pc: 0,
    a: 0,
    x: 0,
    y: 0,
    sp: 0xEF,
    psw: 0,
  };

  private iplRomEnabled = true;
  public cycleDeficit = 0;
  private dsp: any = null;       // DSP instance
  private dspAddr = 0;           // last written DSP register address ($F2)

  // Official IPL ROM (64 bytes)
  private readonly iplRom = new Uint8Array([
    0xCD, 0xEF, 0xBD, 0xE8, 0x00, 0xC6, 0x1D, 0xD0, 0xFC, 0x8F, 0xAA, 0xF4, 0x8F, 0xBB, 0xF5, 0x78,
    0xCC, 0xF4, 0xD0, 0xFB, 0x2F, 0x19, 0xEB, 0xF4, 0xD0, 0xFC, 0x7E, 0xF4, 0xD0, 0x0B, 0xE4, 0xF5,
    0xCB, 0xF4, 0xD7, 0x00, 0xFC, 0xD0, 0xF3, 0xAB, 0x01, 0x10, 0xEF, 0x7E, 0xF4, 0x10, 0xEB, 0xBA,
    0xF6, 0xDA, 0x00, 0xBA, 0xF4, 0xC4, 0xF4, 0xDD, 0x5D, 0xD0, 0xDB, 0x1F, 0x00, 0x00, 0xC0, 0xFF
  ]);

  public reset(): void {
    this.ram.fill(0);
    this.portsFromCpu.fill(0);
    this.portsToCpu.fill(0);
    for (let i = 0; i < 3; i++) {
      this.timers[i] = { enabled: false, target: 0, counter: 0, output: 0, divider: 0 };
    }
    this.cycleDeficit = 0;
    this.iplRomEnabled = true;
    this.dspAddr = 0;

    this.iplRomEnabled = true;
    this.dspAddr = 0;

    // Hardwired reset vector for SPC700 is $FFC0
    this.state = {
      pc: 0xFFC0,
      a: 0,
      x: 0,
      y: 0,
      sp: 0xEF,
      psw: 0,
    };
  }

  public pcHistory = new Uint16Array(100);
  public pcHistoryIdx = 0;

  public getState(): SpcState {
    return { ...this.state };
  }

  public getRam(): Uint8Array {
    return this.ram;
  }

  public setDsp(dsp: any): void {
    this.dsp = dsp;
  }

  // CPU writes to APU ports (0-3)
  public writeCpuPort(port: number, value: number): void {
    const p = port & 3;
    this.portsFromCpu[p] = value & 0xFF;
    this.ram[0xF4 + p] = this.portsFromCpu[p];
  }

  // CPU reads from APU ports (0-3)
  public readCpuPort(port: number): number {
    return this.portsToCpu[port & 3] & 0xFF;
  }

  // SPC side writes to I/O registers
  private writeSpcIo(addr: number, value: number): void {
    const a = addr & 0xFFFF;
    const v = value & 0xFF;
    this.ram[a] = v;

    switch (a) {
      case 0xF2: // DSP address
        this.dspAddr = v & 0x7F;
        break;
      case 0xF3: // DSP data
        if (this.dsp) this.dsp.writeRegister(this.dspAddr, v);
        break;
      case 0xF4:
      case 0xF5:
      case 0xF6:
      case 0xF7:
        this.portsToCpu[a - 0xF4] = v;
        break;
      case 0xF1: // Timer control
        this.handleTimerControl(v);
        break;
    }
  }

  // SPC side reads from I/O registers
  private readSpcIo(addr: number): number {
    const a = addr & 0xFFFF;
    if (a === 0xF3) {
      return this.dsp ? this.dsp.readRegister(this.dspAddr) : 0;
    }
    if (a >= 0xFD && a <= 0xFF) {
      const idx = a - 0xFD;
      const out = this.timers[idx].output & 0x0F;
      this.timers[idx].output = 0; // read clears
      return out;
    }
    return this.ram[a];
  }

  private handleTimerControl(value: number): void {
    // Bit 7: IPL ROM visibility (1 = ROM mapped at 0xFFC0, 0 = RAM visible)
    this.iplRomEnabled = (value & 0x80) !== 0;
    for (let i = 0; i < 3; i++) {
      const enable = ((value >> i) & 1) !== 0;
      if (enable && !this.timers[i].enabled) {
        this.timers[i].counter = 0;
        this.timers[i].divider = 0;
      }
      this.timers[i].enabled = enable;
    }
    // Update timer target registers from $FA/$FB/$FC
    for (let i = 0; i < 3; i++) {
      this.timers[i].target = this.ram[0xFA + i];
    }
  }

  private advanceTimers(cycles: number): void {
    const dividers = [128, 128, 16];
    for (let i = 0; i < 3; i++) {
      const t = this.timers[i];
      if (!t.enabled) continue;
      t.divider += cycles;
      while (t.divider >= dividers[i]) {
        t.divider -= dividers[i];
        let cnt = (t.counter + 1) & 0xFF;
        t.counter = cnt;
        const ramTarget = this.ram[0xFA + i];
        const target = ramTarget === 0 ? 0x100 : ramTarget;
        if (cnt === target) {
          t.counter = 0;
          t.output = (t.output + 1) & 0x0F;
        }
      }
    }
  }

  public stepCycles(cycles: number): void {
    const bounded = Math.max(0, Math.floor(cycles));
    this.advanceTimers(bounded);
    let remaining = bounded - this.cycleDeficit;
    while (remaining > 0) {
      this.pcHistory[this.pcHistoryIdx] = this.state.pc;
      this.pcHistoryIdx = (this.pcHistoryIdx + 1) % 100;
      const opcode = this.readByte(this.state.pc);
      this.state.pc = (this.state.pc + 1) & 0xFFFF;
      const taken = this.executeOpcode(opcode); if (Number.isNaN(taken) || taken === undefined) console.error("Opcode returned NaN:", opcode.toString(16));
      remaining -= taken;
    }
    this.cycleDeficit = -remaining;
  }

  // ----- Memory access (with IPL ROM mirroring) -----
  public getDpAddr(offset: number): number {
    return (this.state.psw & 0x20 ? 0x100 : 0) + (offset & 0xFF);
  }

  public readByte(a: number): number {
    a &= 0xFFFF;
    if (a >= 0xFFC0 && this.iplRomEnabled) {
      return this.iplRom[a - 0xFFC0];
    }
    if (a >= 0xF4 && a <= 0xF7) {
      return this.portsFromCpu[a - 0xF4];
    }
    if (a === 0xF2 || a === 0xF3 || (a >= 0xFD && a <= 0xFF)) {
      return this.readSpcIo(a);
    }
    return this.ram[a];
  }

  private writeByte(addr: number, value: number): void {
    const a = addr & 0xFFFF;
    const v = value & 0xFF;
    if (a >= 0xF4 && a <= 0xF7) {
      this.portsToCpu[a - 0xF4] = v;
      this.ram[a] = v;
      return;
    }
    this.ram[a] = v;
    if (a >= 0xF0 && a <= 0xFF) {
      this.writeSpcIo(a, v);
    }
  }

  private readWord(addr: number): number {
    const lo = this.readByte(addr);
    const hi = this.readByte((addr + 1) & 0xFFFF);
    return (hi << 8) | lo;
  }

  private writeWord(addr: number, value: number): void {
    this.writeByte(addr, value & 0xFF);
    this.writeByte((addr + 1) & 0xFFFF, (value >> 8) & 0xFF);
  }

  // Stack
  private push(value: number): void {
    const addr = 0x0100 | this.state.sp;
    this.writeByte(addr, value);
    this.state.sp = (this.state.sp - 1) & 0xFF;
  }

  private pop(): number {
    this.state.sp = (this.state.sp + 1) & 0xFF;
    const addr = 0x0100 | this.state.sp;
    return this.readByte(addr);
  }

  private pushWord(value: number): void {
    this.push((value >> 8) & 0xFF);
    this.push(value & 0xFF);
  }

  private popWord(): number {
    const lo = this.pop();
    const hi = this.pop();
    return (hi << 8) | lo;
  }

  // Flag helpers
  private getFlagN(): boolean { return (this.state.psw & 0x80) !== 0; }
  private getFlagV(): boolean { return (this.state.psw & 0x40) !== 0; }
  private getFlagP(): boolean { return (this.state.psw & 0x20) !== 0; }
  private getFlagB(): boolean { return (this.state.psw & 0x10) !== 0; }
  private getFlagH(): boolean { return (this.state.psw & 0x08) !== 0; }
  private getFlagI(): boolean { return (this.state.psw & 0x04) !== 0; }
  private getFlagZ(): boolean { return (this.state.psw & 0x02) !== 0; }
  private getFlagC(): boolean { return (this.state.psw & 0x01) !== 0; }

  private setFlagN(v: boolean) { if (v) this.state.psw |= 0x80; else this.state.psw &= ~0x80; }
  private setFlagV(v: boolean) { if (v) this.state.psw |= 0x40; else this.state.psw &= ~0x40; }
  private setFlagP(v: boolean) { if (v) this.state.psw |= 0x20; else this.state.psw &= ~0x20; }
  private setFlagB(v: boolean) { if (v) this.state.psw |= 0x10; else this.state.psw &= ~0x10; }
  private setFlagH(v: boolean) { if (v) this.state.psw |= 0x08; else this.state.psw &= ~0x08; }
  private setFlagI(v: boolean) { if (v) this.state.psw |= 0x04; else this.state.psw &= ~0x04; }
  private setFlagZ(v: boolean) { if (v) this.state.psw |= 0x02; else this.state.psw &= ~0x02; }
  private setFlagC(v: boolean) { if (v) this.state.psw |= 0x01; else this.state.psw &= ~0x01; }

  private updateNZ(value: number): void {
    const v = value & 0xFF;
    this.setFlagN((v & 0x80) !== 0);
    this.setFlagZ(v === 0);
  }

  // ----- Complete opcode table (232 instructions) -----
  private executeOpcode(opcode: number): number {
    switch (opcode) {
      // ---------- NOP / Special ----------
      case 0x00: return 2;                 // NOP
      case 0xEF: return 3;                // SLEEP (NOP-like)
      case 0xFF: return 3;                // STOP (NOP-like)

      // ---------- TCALL (vector calls) ----------
      case 0x01: case 0x11: case 0x21: case 0x31:
      case 0x41: case 0x51: case 0x61: case 0x71:
      case 0x81: case 0x91: case 0xA1: case 0xB1:
      case 0xC1: case 0xD1: case 0xE1: case 0xF1: {
        const n = (opcode >> 4) & 0x0F;
        const vec = 0xFFDE - n * 2;
        const target = this.readWord(vec);
        this.pushWord(this.state.pc);
        this.state.pc = target;
        return 8;
      }

      // ---------- Flag operations ----------
      case 0x20: this.setFlagP(false); return 2;   // CLRP
      case 0x80: this.setFlagC(true); return 2;    // SETC
      case 0x60: this.setFlagC(false); return 2;   // CLRC
      case 0x40: this.setFlagP(true); return 2;    // SETP
      case 0xA0: this.setFlagI(true); return 3;    // EI
      case 0xE0: this.setFlagV(false); return 2;   // CLRV
      case 0xC0: this.setFlagI(false); return 3;   // DI

      // ---------- Move (Load/Store) ----------
      case 0xE8: this.state.a = this.readByte(this.state.pc++); this.updateNZ(this.state.a); return 2; // MOV A, #imm
      case 0xCD: this.state.x = this.readByte(this.state.pc++); this.updateNZ(this.state.x); return 2; // MOV X, #imm
      case 0x8D: this.state.y = this.readByte(this.state.pc++); this.updateNZ(this.state.y); return 2; // MOV Y, #imm
      case 0xBD: this.state.sp = this.state.x; return 2;                                               // MOV SP, X
      case 0x7D: this.state.a = this.state.x; this.updateNZ(this.state.a); return 2;                  // MOV A, X
      case 0xDD: this.state.a = this.state.y; this.updateNZ(this.state.a); return 2;                  // MOV A, Y
      case 0x5D: this.state.x = this.state.a; this.updateNZ(this.state.x); return 2;                  // MOV X, A
      case 0xFD: this.state.y = this.state.a; this.updateNZ(this.state.y); return 2;                  // MOV Y, A

      case 0xE4: { const dp = this.readByte(this.state.pc++); this.state.a = this.readByte(this.getDpAddr(dp)); this.updateNZ(this.state.a); return 3; }
      case 0xF4: { const dp = this.readByte(this.state.pc++); this.state.a = this.readByte(this.getDpAddr(dp + this.state.x)); this.updateNZ(this.state.a); return 4; }
      case 0xE5: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.state.a = this.readByte(addr); this.updateNZ(this.state.a); return 4; }
      case 0xE6: { this.state.a = this.readByte(this.getDpAddr(this.state.x)); this.updateNZ(this.state.a); return 3; }
      case 0xE7: { const dp = this.readByte(this.state.pc++); const ptr = (dp + this.state.x) & 0xFF; const addr = this.readWord(this.getDpAddr(ptr)); this.state.a = this.readByte(addr); this.updateNZ(this.state.a); return 6; }
      case 0xE9: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.state.x = this.readByte(addr); this.updateNZ(this.state.x); return 4; }
      case 0xEB: { const dp = this.readByte(this.state.pc++); this.state.y = this.readByte(this.getDpAddr(dp)); this.updateNZ(this.state.y); return 3; }
      case 0xEC: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.state.y = this.readByte(addr); this.updateNZ(this.state.y); return 4; }
      case 0xF6: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.state.a = this.readByte((addr + this.state.y) & 0xFFFF); this.updateNZ(this.state.a); return 5; } // MOV A, !abs+Y
      case 0xF7: { const dp = this.readByte(this.state.pc++); const base = this.readWord(this.getDpAddr(dp)); this.state.a = this.readByte((base + this.state.y) & 0xFFFF); this.updateNZ(this.state.a); return 6; } // MOV A, [dp]+Y
      case 0xB7: { const dp = this.readByte(this.state.pc++); const ptr = (dp + this.state.x) & 0xFF; const base = this.readWord(this.getDpAddr(ptr)); this.state.a = this.readByte((base + this.state.y) & 0xFFFF); this.updateNZ(this.state.a); return 6; } // MOV A, [dp+X]+Y (actually this should be indexed indirect indexed)
      case 0xF9: { const dp = this.readByte(this.state.pc++); this.state.x = this.readByte(this.getDpAddr(dp + this.state.y)); this.updateNZ(this.state.x); return 4; }
      case 0xFA: { const src = this.readByte(this.state.pc++); const dst = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dst), this.readByte(this.getDpAddr(src))); return 5; }
      case 0xC4: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.state.a); return 4; }
      case 0xC5: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.writeByte(addr, this.state.a); return 5; }
      case 0xD4: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp + this.state.x), this.state.a); return 5; } // MOV dp+X, A
      case 0xD5: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.writeByte((addr + this.state.x) & 0xFFFF, this.state.a); return 6; } // MOV abs+X, A
      case 0xD6: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.writeByte((addr + this.state.y) & 0xFFFF, this.state.a); return 6; } // MOV abs+Y, A
      case 0xD7: { const dp = this.readByte(this.state.pc++); const base = this.readWord(this.getDpAddr(dp)); this.writeByte((base + this.state.y) & 0xFFFF, this.state.a); return 7; } // MOV [dp]+Y, A
      case 0xD8: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.state.x); return 4; } // MOV dp, X
      case 0xD9: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp + this.state.y), this.state.x); return 5; } // MOV dp+Y, X
      case 0xDB: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.writeByte(addr, this.state.y); return 5; }
      case 0xAF: { this.writeByte(this.getDpAddr(this.state.x), this.state.a); this.state.x = (this.state.x + 1) & 0xFF; return 4; }
      case 0xBF: { this.writeByte(this.getDpAddr(this.state.x), this.state.y); this.state.x = (this.state.x + 1) & 0xFF; return 4; }
      case 0x8F: { const imm = this.readByte(this.state.pc++); const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), imm); return 5; }
      case 0xC7: { const dp = this.readByte(this.state.pc++); const addr = this.readWord(this.getDpAddr(dp)); this.writeByte(addr, this.state.a); return 5; }
      case 0x1F: { // JMP [!abs+X]
        const addr = this.readWord(this.state.pc);
        this.state.pc = this.readWord((addr + this.state.x) & 0xFFFF);
        return 6;
      }

      // ---------- Arithmetic ----------
      case 0x88: { // ADC A, #imm
        const val = this.readByte(this.state.pc++);
        const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
        this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
        this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
        this.setFlagC(sum > 0xFF);
        this.state.a = sum & 0xFF;
        this.updateNZ(this.state.a);
        return 2;
      }
      case 0x89: { // ADC A, !abs
        const addr = this.readWord(this.state.pc); this.state.pc += 2;
        const val = this.readByte(addr);
        const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
        this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
        this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
        this.setFlagC(sum > 0xFF);
        this.state.a = sum & 0xFF;
        this.updateNZ(this.state.a);
        return 4;
      }
      case 0xA8: { // SBC A, #imm
        const val = this.readByte(this.state.pc++);
        const borrow = this.getFlagC() ? 0 : 1;
        const diff = this.state.a - val - borrow;
        this.setFlagH(((this.state.a ^ val ^ diff) & 0x10) === 0);
        this.setFlagV(((this.state.a ^ val) & (this.state.a ^ diff) & 0x80) !== 0);
        this.setFlagC(diff >= 0);
        this.state.a = diff & 0xFF;
        this.updateNZ(this.state.a);
        return 2;
      }
      case 0x68: { // CMP A, #imm
        const imm = this.readByte(this.state.pc++);
        const diff = this.state.a - imm;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(this.state.a >= imm);
        return 2;
      }
      case 0x69: { // CMP dp(dest), dp(src)
        const src = this.readByte(this.state.pc++);
        const dst = this.readByte(this.state.pc++);
        const valDst = this.readByte(this.getDpAddr(dst));
        const valSrc = this.readByte(this.getDpAddr(src));
        const diff = valDst - valSrc;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(valDst >= valSrc);
        return 6;
      }
      case 0xC6: { // MOV (X), A
        this.writeByte(this.getDpAddr(this.state.x), this.state.a);
        return 4;
      }
      case 0x35: { // AND A, !abs
        const addr = this.readWord(this.state.pc);
        this.state.pc += 2;
        this.state.a &= this.readByte(addr);
        this.updateNZ(this.state.a);
        return 5;
      }
      case 0x75: { // CMP A, !abs
        const addr = this.readWord(this.state.pc);
        this.state.pc += 2;
        const val = this.readByte(addr);
        const diff = this.state.a - val;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(this.state.a >= val);
        return 5;
      }
      case 0x64: { // CMP A, dp
        const dp = this.readByte(this.state.pc++);
        const val = this.readByte(this.getDpAddr(dp));
        const diff = this.state.a - val;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(this.state.a >= val);
        return 3;
      }
      case 0xC8: { // CMP X, #imm
        const imm = this.readByte(this.state.pc++);
        const diff = this.state.x - imm;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(this.state.x >= imm);
        return 2;
      }
      case 0x7E: { // CMP Y, dp
        const dp = this.readByte(this.state.pc++);
        const val = this.readByte(this.getDpAddr(dp));
        const diff = this.state.y - val;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(this.state.y >= val);
        return 4;
      }
      case 0x6E: { // DBNZ dp, rel
        const dp = this.readByte(this.state.pc++);
        const val = (this.readByte(this.getDpAddr(dp)) - 1) & 0xFF;
        this.writeByte(this.getDpAddr(dp), val);
        const rel = this.readByte(this.state.pc++);
        if (val !== 0) {
          const offset = rel < 0x80 ? rel : rel - 256;
          this.state.pc = (this.state.pc + offset) & 0xFFFF;
          return 7;
        }
        return 5;
      }

      case 0xFE: { // DBNZ Y, rel
        this.state.y = (this.state.y - 1) & 0xFF;
        const rel = this.readByte(this.state.pc++);
        let taken = 0;
        if (this.state.y !== 0) {
          const offset = rel < 0x80 ? rel : rel - 256;
          this.state.pc = (this.state.pc + offset) & 0xFFFF;
          taken = 2;
        }
        return 4 + taken;
      }      // ---------- Added missing opcodes ----------
      case 0xB8: { // SBC dp, imm
        const imm = this.readByte(this.state.pc++);
        const dp = this.readByte(this.state.pc++);
        const addr = (this.state.psw & 0x20 ? 0x100 : 0) + dp;
        const val = this.readByte(addr);
        const borrow = this.getFlagC() ? 0 : 1;
        const diff = val - imm - borrow;
        this.setFlagH(((val ^ imm ^ diff) & 0x10) === 0);
        this.setFlagV(((val ^ imm) & (val ^ diff) & 0x80) !== 0);
        this.setFlagC(diff >= 0);
        const result = diff & 0xFF;
        this.writeByte(addr, result);
        this.updateNZ(result);
        return 5;
      }
      case 0x29: { // AND dp, dp
        const src = this.readByte(this.state.pc++);
        const dest = this.readByte(this.state.pc++);
        const val = this.readByte(this.getDpAddr(dest)) & this.readByte(this.getDpAddr(src));
        this.writeByte(this.getDpAddr(dest), val);
        this.updateNZ(val);
        return 6;
      }
      case 0x95: { // ADC A, abs+X
        const addr = this.readWord(this.state.pc); this.state.pc += 2;
        const val = this.readByte((addr + this.state.x) & 0xFFFF);
        const carry = this.getFlagC() ? 1 : 0;
        const sum = this.state.a + val + carry;
        this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
        this.setFlagV(((~(this.state.a ^ val)) & (this.state.a ^ sum) & 0x80) !== 0);
        this.setFlagC(sum > 0xFF);
        this.state.a = sum & 0xFF;
        this.updateNZ(this.state.a);
        return 5;
      }
      case 0xA4: { // SBC A, dp
        const dp = this.readByte(this.state.pc++);
        const addr = (this.state.psw & 0x20 ? 0x100 : 0) + dp;
        const val = this.readByte(addr);
        const borrow = this.getFlagC() ? 0 : 1;
        const diff = this.state.a - val - borrow;
        this.setFlagH(((this.state.a ^ val ^ diff) & 0x10) === 0);
        this.setFlagV(((this.state.a ^ val) & (this.state.a ^ diff) & 0x80) !== 0);
        this.setFlagC(diff >= 0);
        this.state.a = diff & 0xFF;
        this.updateNZ(this.state.a);
        return 3;
      }
      case 0xFB: { // MOV Y, dp+X
        const dp = this.readByte(this.state.pc++);
        const addr = (this.state.psw & 0x20 ? 0x100 : 0) + ((dp + this.state.x) & 0xFF);
        this.state.y = this.readByte(addr);
        this.updateNZ(this.state.y);
        return 4;
      }
      case 0xDE: { // CBNE dp+X, rel
        const dp = this.readByte(this.state.pc++);
        const rel = this.readByte(this.state.pc++);
        const addr = (this.state.psw & 0x20 ? 0x100 : 0) + ((dp + this.state.x) & 0xFF);
        const val = this.readByte(addr);
        if (this.state.a !== val) {
          this.state.pc += (rel < 0x80 ? rel : rel - 256);
          return 6;
        }
        return 4;
      }
      case 0x77: { // CMP A, [dp]+Y
        const dp = this.readByte(this.state.pc++);
        const ptrAddr = (this.state.psw & 0x20 ? 0x100 : 0) + dp;
        const ptr = this.readWord(ptrAddr);
        const val = this.readByte((ptr + this.state.y) & 0xFFFF);
        const diff = this.state.a - val;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(this.state.a >= val);
        return 6;
      }
      case 0x27: { // AND A, [dp+X]
        const dp = this.readByte(this.state.pc++);
        const ptr = (dp + this.state.x) & 0xFF;
        const addr = this.readWord(this.getDpAddr(ptr));
        this.state.a &= this.readByte(addr);
        this.updateNZ(this.state.a);
        return 6;
      }
      case 0x6B: { // ROR dp
        const dp = this.readByte(this.state.pc++);
        const addr = (this.state.psw & 0x20 ? 0x100 : 0) + dp;
        let v = this.readByte(addr);
        const carry = (v & 1) !== 0;
        v = ((this.getFlagC() ? 0x80 : 0) | (v >> 1)) & 0xFF;
        this.writeByte(addr, v);
        this.setFlagC(carry);
        this.updateNZ(v);
        return 5;
      }
      case 0x5C: { // LSR A
        const carry = (this.state.a & 1) !== 0;
        this.state.a >>= 1;
        this.setFlagC(carry);
        this.updateNZ(this.state.a);
        return 2;
      }
      case 0x2B: { // ROL dp
        const dp = this.readByte(this.state.pc++);
        const addr = (this.state.psw & 0x20 ? 0x100 : 0) + dp;
        let v = this.readByte(addr);
        const carry = (v & 0x80) !== 0;
        v = ((v << 1) | (this.getFlagC() ? 1 : 0)) & 0xFF;
        this.writeByte(addr, v);
        this.setFlagC(carry);
        this.updateNZ(v);
        return 5;
      }
      case 0x38: { // AND dp, imm
        const imm = this.readByte(this.state.pc++);
        const dp = this.readByte(this.state.pc++);
        const addr = (this.state.psw & 0x20 ? 0x100 : 0) + dp;
        const val = this.readByte(addr);
        const result = (val & imm) & 0xFF;
        this.writeByte(addr, result);
        this.updateNZ(result);
        return 5;
      }
      case 0x84: { // ADC A, dp
        const dp = this.readByte(this.state.pc++);
        const addr = (this.state.psw & 0x20 ? 0x100 : 0) + dp;
        const val = this.readByte(addr);
        const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
        this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
        this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
        this.setFlagC(sum > 0xFF);
        this.state.a = sum & 0xFF;
        this.updateNZ(this.state.a);
        return 3;
      }
      case 0x65: { // CMP A, !abs+X
        const addr = this.readWord(this.state.pc);
        this.state.pc += 2;
        const val = this.readByte((addr + this.state.x) & 0xFFFF);
        const diff = this.state.a - val;
        this.setFlagC(this.state.a >= val);
        this.updateNZ(diff & 0xFF);
        return 5;
      }
      case 0x39: { // AND (X), (Y)
        const xAddr = (this.state.psw & 0x20 ? 0x100 : 0) + this.state.x;
        const yAddr = (this.state.psw & 0x20 ? 0x100 : 0) + this.state.y;
        const val = this.readByte(xAddr) & this.readByte(yAddr);
        this.writeByte(xAddr, val);
        this.updateNZ(val);
        return 5;
      }
      case 0x0A: { // OR1 C, mem.bit
        const word = this.readWord(this.state.pc);
        this.state.pc += 2;
        const bit = word >> 13;
        const addr = word & 0x1FFF;
        const val = (this.readByte(addr) >> bit) & 1;
        this.setFlagC(this.getFlagC() || (val === 1));
        return 5;
      }
      case 0x16: { // OR A, abs+Y
        const addr = this.readWord(this.state.pc); this.state.pc += 2;
        this.state.a |= this.readByte((addr + this.state.y) & 0xFFFF);
        this.updateNZ(this.state.a);
        return 5;
      }
      case 0xB4: { // SBC A, dp+X
        const dp = this.readByte(this.state.pc++);
        const addr = (this.state.psw & 0x20 ? 0x100 : 0) + ((dp + this.state.x) & 0xFF);
        const val = this.readByte(addr);
        const borrow = this.getFlagC() ? 0 : 1;
        const diff = this.state.a - val - borrow;
        this.setFlagH(((this.state.a ^ val ^ diff) & 0x10) === 0);
        this.setFlagV(((this.state.a ^ val) & (this.state.a ^ diff) & 0x80) !== 0);
        this.setFlagC(diff >= 0);
        this.state.a = diff & 0xFF;
        this.updateNZ(this.state.a);
        return 4;
      }
      case 0x96: { // ADC A, abs+Y
        const addr = this.readWord(this.state.pc); this.state.pc += 2;
        const val = this.readByte((addr + this.state.y) & 0xFFFF);
        const carry = this.getFlagC() ? 1 : 0;
        const sum = this.state.a + val + carry;
        this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
        this.setFlagV(((~(this.state.a ^ val)) & (this.state.a ^ sum) & 0x80) !== 0);
        this.setFlagC(sum > 0xFF);
        this.state.a = sum & 0xFF;
        this.updateNZ(this.state.a);
        return 5;
      }

      case 0x18: {
        const dp = this.readByte(this.state.pc++);
        const imm = this.readByte(this.state.pc++);
        const val = this.readByte(this.getDpAddr(dp));
        const result = val | imm;
        this.writeByte(this.getDpAddr(dp), result);
        this.updateNZ(result);
        return 5;
      }
      case 0x1E: { // CMP X, abs
        const addr = this.readWord(this.state.pc); this.state.pc += 2;
        const val = this.readByte(addr);
        const diff = this.state.x - val;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(this.state.x >= val);
        return 4;
      }
      case 0x78: { // CMP dp, #imm
        const imm = this.readByte(this.state.pc++);
        const dp = this.readByte(this.state.pc++);
        const val = this.readByte(this.getDpAddr(dp));
        const diff = val - imm;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(val >= imm);
        return 5;
      }
      case 0x3E: { // CMP X, dp
        const dp = this.readByte(this.state.pc++);
        const val = this.readByte(this.getDpAddr(dp));
        const diff = this.state.x - val;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(this.state.x >= val);
        return 3;
      }
      case 0xAD: { // CMP Y, #imm
        const imm = this.readByte(this.state.pc++);
        const diff = this.state.y - imm;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(this.state.y >= imm);
        return 2;
      }
      case 0x5E: { // CMP Y, dp
        const dp = this.readByte(this.state.pc++);
        const val = this.readByte(this.getDpAddr(dp));
        const diff = this.state.y - val;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(this.state.y >= val);
        return 3;
      }
      case 0x79: { // CMP (X), (Y)
        const x = this.readByte(this.getDpAddr(this.state.x));
        const y = this.readByte(this.getDpAddr(this.state.y));
        const diff = x - y;
        this.setFlagN((diff & 0x80) !== 0);
        this.setFlagZ((diff & 0xFF) === 0);
        this.setFlagC(x >= y);
        return 5;
      }
      case 0x08: { const imm = this.readByte(this.state.pc++); this.state.a |= imm; this.updateNZ(this.state.a); return 2; } // OR A, #imm
      case 0x04: { const dp = this.readByte(this.state.pc++); this.state.a |= this.readByte(this.getDpAddr(dp)); this.updateNZ(this.state.a); return 3; } // OR A, dp
      case 0x05: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.state.a |= this.readByte(addr); this.updateNZ(this.state.a); return 4; } // OR A, !abs
      case 0x06: { this.state.a |= this.readByte(this.getDpAddr(this.state.x)); this.updateNZ(this.state.a); return 3; } // OR A, (X)
      case 0x07: { const dp = this.readByte(this.state.pc++); const ptr = (dp + this.state.x) & 0xFF; const addr = this.readWord(this.getDpAddr(ptr)); this.state.a |= this.readByte(addr); this.updateNZ(this.state.a); return 6; } // OR A, [dp+X]
      case 0x09: { const src = this.readByte(this.state.pc++); const dst = this.readByte(this.state.pc++); const result = this.readByte(this.getDpAddr(dst)) | this.readByte(this.getDpAddr(src)); this.writeByte(this.getDpAddr(dst), result); this.updateNZ(result); return 5; } // OR dd, dd
      case 0x14: { const dp = this.readByte(this.state.pc++); this.state.a |= this.readByte(this.getDpAddr(dp + this.state.x)); this.updateNZ(this.state.a); return 4; } // OR A, dp+X
      case 0x15: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.state.a |= this.readByte((addr + this.state.x) & 0xFFFF); this.updateNZ(this.state.a); return 5; } // OR A, !abs+X
      case 0x19: { const x = this.readByte(this.getDpAddr(this.state.x)); const y = this.readByte(this.getDpAddr(this.state.y)); const result = x | y; this.writeByte(this.getDpAddr(this.state.x), result); this.updateNZ(result); return 5; } // OR (X), (Y)
      case 0x28: { const imm = this.readByte(this.state.pc++); this.state.a &= imm; this.updateNZ(this.state.a); return 2; } // AND
      case 0x24: { const dp = this.readByte(this.state.pc++); this.state.a &= this.readByte(this.getDpAddr(dp)); this.updateNZ(this.state.a); return 3; }
      case 0x25: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.state.a &= this.readByte(addr); this.updateNZ(this.state.a); return 4; }
      case 0x26: { this.state.a &= this.readByte(this.getDpAddr(this.state.x)); this.updateNZ(this.state.a); return 3; }
      case 0x34: { const dp = this.readByte(this.state.pc++); this.state.a &= this.readByte(this.getDpAddr(dp + this.state.x)); this.updateNZ(this.state.a); return 4; }
      case 0x48: { const imm = this.readByte(this.state.pc++); this.state.a ^= imm; this.updateNZ(this.state.a); return 2; } // EOR A, #imm
      case 0x49: { const src = this.readByte(this.state.pc++); const dst = this.readByte(this.state.pc++); const result = this.readByte(this.getDpAddr(dst)) ^ this.readByte(this.getDpAddr(src)); this.writeByte(this.getDpAddr(dst), result); this.updateNZ(result); return 6; } // EOR dd, dd
      case 0x44: { const dp = this.readByte(this.state.pc++); this.state.a ^= this.readByte(this.getDpAddr(dp)); this.updateNZ(this.state.a); return 3; } // EOR A, dp
      case 0x45: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.state.a ^= this.readByte(addr); this.updateNZ(this.state.a); return 4; } // EOR A, !abs
      case 0x46: { this.state.a ^= this.readByte(this.getDpAddr(this.state.x)); this.updateNZ(this.state.a); return 3; } // EOR A, (X)
      case 0x54: { const dp = this.readByte(this.state.pc++); this.state.a ^= this.readByte(this.getDpAddr(dp + this.state.x)); this.updateNZ(this.state.a); return 4; } // EOR A, dp+X
      case 0x55: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.state.a ^= this.readByte((addr + this.state.x) & 0xFFFF); this.updateNZ(this.state.a); return 5; } // EOR A, !abs+X
      case 0x56: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.state.a ^= this.readByte((addr + this.state.y) & 0xFFFF); this.updateNZ(this.state.a); return 5; } // EOR A, !abs+Y
      case 0x57: { const dp = this.readByte(this.state.pc++); const base = this.readWord(this.getDpAddr(dp)); this.state.a ^= this.readByte((base + this.state.y) & 0xFFFF); this.updateNZ(this.state.a); return 6; } // EOR A, [dp]+Y

      // ---------- Increment / Decrement ----------
      case 0xBC: this.state.a = (this.state.a + 1) & 0xFF; this.updateNZ(this.state.a); return 2; // INC A
      case 0x3D: this.state.x = (this.state.x + 1) & 0xFF; this.updateNZ(this.state.x); return 2; // INC X
      case 0xFC: this.state.y = (this.state.y + 1) & 0xFF; this.updateNZ(this.state.y); return 2; // INC Y
      case 0xAB: { const dp = this.readByte(this.state.pc++); let v = this.readByte(this.getDpAddr(dp)); v = (v + 1) & 0xFF; this.writeByte(this.getDpAddr(dp), v); this.updateNZ(v); return 4; } // INC dp
      case 0xAC: { const addr = this.readWord(this.state.pc); this.state.pc += 2; let v = this.readByte(addr); v = (v + 1) & 0xFF; this.writeByte(addr, v); this.updateNZ(v); return 5; } // INC !abs
      case 0x9C: this.state.a = (this.state.a - 1) & 0xFF; this.updateNZ(this.state.a); return 2; // DEC A
      case 0x1D: this.state.x = (this.state.x - 1) & 0xFF; this.updateNZ(this.state.x); return 2; // DEC X
      case 0xDC: this.state.y = (this.state.y - 1) & 0xFF; this.updateNZ(this.state.y); return 2; // DEC Y
      case 0x8B: { const dp = this.readByte(this.state.pc++); let v = this.readByte(this.getDpAddr(dp)); v = (v - 1) & 0xFF; this.writeByte(this.getDpAddr(dp), v); this.updateNZ(v); return 4; } // DEC dp
      case 0x8C: { const addr = this.readWord(this.state.pc); this.state.pc += 2; let v = this.readByte(addr); v = (v - 1) & 0xFF; this.writeByte(addr, v); this.updateNZ(v); return 5; } // DEC !abs
      case 0x1A: { const dp = this.readByte(this.state.pc++); let word = this.readWord(this.getDpAddr(dp)); word = (word - 1) & 0xFFFF; this.writeWord(this.getDpAddr(dp), word); this.setFlagN((word & 0x8000) !== 0); this.setFlagZ(word === 0); return 6; } // DECW dp

      // ---------- Shifts / Rotates ----------
      case 0x1C: { const carry = (this.state.a & 0x80) !== 0; this.state.a = (this.state.a << 1) & 0xFF; this.setFlagC(carry); this.updateNZ(this.state.a); return 2; } // ASL A
      case 0x4C: { const carry = (this.state.a & 1) !== 0; this.state.a >>= 1; this.setFlagC(carry); this.updateNZ(this.state.a); return 2; } // LSR A
      case 0x2C: { const carry = (this.state.a & 0x80) !== 0; this.state.a = ((this.state.a << 1) | (this.getFlagC() ? 1 : 0)) & 0xFF; this.setFlagC(carry); this.updateNZ(this.state.a); return 2; } // ROL A
      case 0x6C: { const carry = (this.state.a & 1) !== 0; this.state.a = ((this.getFlagC() ? 0x80 : 0) | (this.state.a >> 1)) & 0xFF; this.setFlagC(carry); this.updateNZ(this.state.a); return 2; } // ROR A
      case 0x7C: { const addr = this.readWord(this.state.pc); this.state.pc += 2; let v = this.readByte(addr); const carry = (v & 1) !== 0; v = ((this.getFlagC() ? 0x80 : 0) | (v >> 1)) & 0xFF; this.writeByte(addr, v); this.setFlagC(carry); this.updateNZ(v); return 5; } // ROR !abs
      case 0x7B: { const dp = this.readByte(this.state.pc++); let v = this.readByte(this.getDpAddr(dp + this.state.x)); const carry = (v & 1) !== 0; v = ((this.getFlagC() ? 0x80 : 0) | (v >> 1)) & 0xFF; this.writeByte(this.getDpAddr(dp + this.state.x), v); this.setFlagC(carry); this.updateNZ(v); return 6; } // ROR dp+X
      case 0x1B: { const dp = this.readByte(this.state.pc++); let v = this.readByte(this.getDpAddr(dp)); const carry = (v & 0x80) !== 0; v = (v << 1) & 0xFF; this.writeByte(this.getDpAddr(dp), v); this.setFlagC(carry); this.updateNZ(v); return 5; } // ASL dp
      case 0x4B: { const dp = this.readByte(this.state.pc++); let v = this.readByte(this.getDpAddr(dp)); const carry = (v & 1) !== 0; v >>= 1; this.writeByte(this.getDpAddr(dp), v); this.setFlagC(carry); this.updateNZ(v); return 5; } // LSR dp

      // ---------- Bit operations (memory bits) ----------
      case 0xAA: { // MOV1 C, mem.bit
        const word = this.readWord(this.state.pc);
        this.state.pc += 2;
        const bit = word >> 13;
        const addr = word & 0x1FFF;
        const val = (this.readByte(addr) >> bit) & 1;
        this.setFlagC(val === 1);
        return 4;
      }
      case 0xCA: { // MOV1 mem.bit, C
        const word = this.readWord(this.state.pc);
        this.state.pc += 2;
        const bit = word >> 13;
        const addr = word & 0x1FFF;
        let b = this.readByte(addr);
        if (this.getFlagC()) b |= (1 << bit);
        else b &= ~(1 << bit);
        this.writeByte(addr, b);
        return 6;
      }
      case 0xEA: { // NOT1 mem.bit
        const word = this.readWord(this.state.pc);
        this.state.pc += 2;
        const bit = word >> 13;
        const addr = word & 0x1FFF;
        let b = this.readByte(addr);
        b ^= (1 << bit);
        this.writeByte(addr, b);
        return 5;
      }
      case 0x4A: { // AND1 C, /mem.bit
        const word = this.readWord(this.state.pc);
        this.state.pc += 2;
        const bit = word >> 13;
        const addr = word & 0x1FFF;
        const val = (this.readByte(addr) >> bit) & 1;
        this.setFlagC(this.getFlagC() && (val === 0));
        return 4;
      }
      case 0x2A: { // OR1 C, /mem.bit
        const word = this.readWord(this.state.pc);
        this.state.pc += 2;
        const bit = word >> 13;
        const addr = word & 0x1FFF;
        const val = (this.readByte(addr) >> bit) & 1;
        this.setFlagC(this.getFlagC() || (val === 0));
        return 5;
      }

      // ---------- SET1 dp.n — set bit n of direct-page byte ----------
      case 0x02: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) | 0x01); return 4; } // SET1 dp.0
      case 0x22: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) | 0x02); return 4; } // SET1 dp.1
      case 0x42: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) | 0x04); return 4; } // SET1 dp.2
      case 0x62: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) | 0x08); return 4; } // SET1 dp.3
      case 0x82: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) | 0x10); return 4; } // SET1 dp.4
      case 0xA2: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) | 0x20); return 4; } // SET1 dp.5
      case 0xC2: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) | 0x40); return 4; } // SET1 dp.6
      case 0xE2: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) | 0x80); return 4; } // SET1 dp.7

      // ---------- CLR1 dp.n — clear bit n of direct-page byte ----------
      case 0x12: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) & ~0x01); return 4; } // CLR1 dp.0
      case 0x32: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) & ~0x02); return 4; } // CLR1 dp.1
      case 0x52: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) & ~0x04); return 4; } // CLR1 dp.2
      case 0x72: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) & ~0x08); return 4; } // CLR1 dp.3
      case 0x92: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) & ~0x10); return 4; } // CLR1 dp.4
      case 0xB2: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) & ~0x20); return 4; } // CLR1 dp.5
      case 0xD2: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) & ~0x40); return 4; } // CLR1 dp.6
      case 0xF2: { const dp = this.readByte(this.state.pc++); this.writeByte(this.getDpAddr(dp), this.readByte(this.getDpAddr(dp)) & ~0x80); return 4; } // CLR1 dp.7

      // ---------- MOVW — 16-bit word moves ----------
      case 0xBA: { // MOVW YA, dp  (load 16-bit direct-page word into YA)
        const dp = this.readByte(this.state.pc++);
        const lo = this.readByte(this.getDpAddr(dp));
        const hi = this.readByte(this.getDpAddr((dp + 1) & 0xFF));
        this.state.a = lo;
        this.state.y = hi;
        const word = (hi << 8) | lo;
        this.setFlagN((word & 0x8000) !== 0);
        this.setFlagZ(word === 0);
        return 5;
      }
      case 0xDA: { // MOVW dp, YA  (store YA as 16-bit word to direct page)
        const dp = this.readByte(this.state.pc++);
        this.writeByte(this.getDpAddr(dp), this.state.a);
        this.writeByte(this.getDpAddr((dp + 1) & 0xFF), this.state.y);
        return 5;
      }
      // 0x5B is actually LSR dp+X per SPC700 matrix
      case 0x5B: { // LSR dp+X
        const dp = this.readByte(this.state.pc++);
        const ea = this.getDpAddr((dp + this.state.x) & 0xFF);
        let v = this.readByte(ea);
        this.setFlagC((v & 1) !== 0);
        v >>= 1;
        this.writeByte(ea, v);
        this.updateNZ(v);
        return 5;
      }

      // ---------- Additional indexed loads ----------
      case 0xA7: { // MOV A, [dp+X]  (indexed indirect)
        const dp = this.readByte(this.state.pc++);
        const ptr = (dp + this.state.x) & 0xFF;
        const addr = this.readWord(this.getDpAddr(ptr));
        this.state.a = this.readByte(addr);
        this.updateNZ(this.state.a);
        return 6;
      }
      case 0xF8: { // MOV X, dp
        const dp = this.readByte(this.state.pc++);
        this.state.x = this.readByte(this.getDpAddr(dp));
        this.updateNZ(this.state.x);
        return 3;
      }
      case 0xC9: { // MOV !abs, X
        const addr = this.readWord(this.state.pc); this.state.pc += 2;
        this.writeByte(addr, this.state.x);
        return 5;
      }
      case 0xCB: { // MOV !abs, Y (actually MOV dp, Y per some tables — using dp)
        const dp = this.readByte(this.state.pc++);
        this.writeByte(this.getDpAddr(dp), this.state.y);
        return 4;
      }
      case 0xCC: { // MOV !abs, Y
        const addr = this.readWord(this.state.pc); this.state.pc += 2;
        this.writeByte(addr, this.state.y);
        return 5;
      }
      case 0xF5: { // MOV A, !abs+X
        const addr = this.readWord(this.state.pc); this.state.pc += 2;
        this.state.a = this.readByte((addr + this.state.x) & 0xFFFF);
        this.updateNZ(this.state.a);
        return 5;
      }
      case 0x3A: { // INCW dp
        const dp = this.readByte(this.state.pc++);
        let word = this.readWord(this.getDpAddr(dp));
        word = (word + 1) & 0xFFFF;
        this.writeWord(this.getDpAddr(dp), word);
        this.setFlagN((word & 0x8000) !== 0);
        this.setFlagZ(word === 0);
        return 6;
      }
      case 0x7A: { // ADDW YA, dp
        const dp = this.readByte(this.state.pc++);
        const mem = this.readWord(this.getDpAddr(dp));
        const ya = (this.state.y << 8) | this.state.a;
        const result = ya + mem;
        this.setFlagC(result > 0xFFFF);
        const r16 = result & 0xFFFF;
        this.state.a = r16 & 0xFF;
        this.state.y = (r16 >> 8) & 0xFF;
        this.setFlagN((r16 & 0x8000) !== 0);
        this.setFlagZ(r16 === 0);
        return 5;
      }
      case 0x9A: { // SUBW YA, dp
        const dp = this.readByte(this.state.pc++);
        const mem = this.readWord(this.getDpAddr(dp));
        const ya = (this.state.y << 8) | this.state.a;
        const result = ya - mem;
        this.setFlagC(result >= 0);
        const r16 = result & 0xFFFF;
        this.state.a = r16 & 0xFF;
        this.state.y = (r16 >> 8) & 0xFF;
        this.setFlagN((r16 & 0x8000) !== 0);
        this.setFlagZ(r16 === 0);
        return 5;
      }
      case 0x9E: { // DIV YA, X
        const x = this.state.x;
        this.setFlagV(this.state.y >= x);
        this.setFlagH((this.state.y & 0x0F) >= (x & 0x0F));
        if (x === 0) {
          this.state.y = (this.state.y + this.state.a) & 0xFF;
          this.state.a = 0xFF;
        } else {
          const ya = (this.state.y << 8) | this.state.a;
          const quotient = Math.floor(ya / x);
          const remainder = ya % x;
          this.state.a = quotient & 0xFF;
          this.state.y = remainder & 0xFF;
        }
        this.updateNZ(this.state.a);
        return 12;
      }
      case 0xCF: { // MUL YA
        const result = this.state.y * this.state.a;
        this.state.a = result & 0xFF;
        this.state.y = (result >> 8) & 0xFF;
        this.setFlagN((this.state.y & 0x80) !== 0);
        this.setFlagZ(this.state.y === 0);
        return 9;
      }
      case 0xDF: { // DAA (Decimal Adjust after Add) — approximate
        if (this.getFlagC() || this.state.a > 0x99) {
          this.state.a = (this.state.a + 0x60) & 0xFF;
          this.setFlagC(true);
        }
        if (this.getFlagH() || (this.state.a & 0x0F) > 0x09) {
          this.state.a = (this.state.a + 0x06) & 0xFF;
        }
        this.updateNZ(this.state.a);
        return 3;
      }
      case 0xBE: { // DAS (Decimal Adjust after Subtract) — approximate
        if (!this.getFlagC() || this.state.a > 0x99) {
          this.state.a = (this.state.a - 0x60) & 0xFF;
          this.setFlagC(false);
        }
        if (!this.getFlagH() || (this.state.a & 0x0F) > 0x09) {
          this.state.a = (this.state.a - 0x06) & 0xFF;
        }
        this.updateNZ(this.state.a);
        return 3;
      }
      case 0x9B: { // XCN A (exchange nibbles of A)
        this.state.a = ((this.state.a >> 4) | (this.state.a << 4)) & 0xFF;
        this.updateNZ(this.state.a);
        return 5;
      }
      case 0x9D: { // MOV X, SP
        this.state.x = this.state.sp;
        this.updateNZ(this.state.x);
        return 2;
      }

      // ---------- Branches ----------
      case 0x10: { // BPL
        const off = this.readByte(this.state.pc++);
        if (!this.getFlagN()) { this.state.pc += (off < 128 ? off : off - 256); return 4; }
        return 2;
      }
      case 0x30: { // BMI
        const off = this.readByte(this.state.pc++);
        if (this.getFlagN()) { this.state.pc += (off < 128 ? off : off - 256); return 4; }
        return 2;
      }
      case 0x50: { // BVC
        const off = this.readByte(this.state.pc++);
        if (!this.getFlagV()) { this.state.pc += (off < 128 ? off : off - 256); return 4; }
        return 2;
      }
      case 0x70: { // BVS
        const off = this.readByte(this.state.pc++);
        if (this.getFlagV()) { this.state.pc += (off < 128 ? off : off - 256); return 4; }
        return 2;
      }
      case 0x90: { // BCC
        const off = this.readByte(this.state.pc++);
        if (!this.getFlagC()) { this.state.pc += (off < 128 ? off : off - 256); return 4; }
        return 2;
      }
      case 0xB0: { // BCS
        const off = this.readByte(this.state.pc++);
        if (this.getFlagC()) { this.state.pc += (off < 128 ? off : off - 256); return 4; }
        return 2;
      }
      case 0xD0: { // BNE
        const off = this.readByte(this.state.pc++);
        if (!this.getFlagZ()) { this.state.pc += (off < 128 ? off : off - 256); return 4; }
        return 2;
      }
      case 0xF0: { // BEQ
        const off = this.readByte(this.state.pc++);
        if (this.getFlagZ()) { this.state.pc += (off < 128 ? off : off - 256); return 4; }
        return 2;
      }
      case 0x2F: { // BRA
        const off = this.readByte(this.state.pc++);
        this.state.pc += (off < 128 ? off : off - 256);
        return 4;
      }

      // ---------- Bit Branch Set/Clear ----------
      case 0x03: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x01) !== 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBS dp.0, rel
      case 0x23: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x02) !== 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBS dp.1, rel
      case 0x43: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x04) !== 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBS dp.2, rel
      case 0x63: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x08) !== 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBS dp.3, rel
      case 0x83: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x10) !== 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBS dp.4, rel
      case 0xA3: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x20) !== 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBS dp.5, rel
      case 0xC3: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x40) !== 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBS dp.6, rel
      case 0xE3: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x80) !== 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBS dp.7, rel
      case 0x13: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x01) === 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBC dp.0, rel
      case 0x33: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x02) === 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBC dp.1, rel
      case 0x53: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x04) === 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBC dp.2, rel
      case 0x73: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x08) === 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBC dp.3, rel
      case 0x93: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x10) === 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBC dp.4, rel
      case 0xB3: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x20) === 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBC dp.5, rel
      case 0xD3: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x40) === 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBC dp.6, rel
      case 0xF3: { const dp = this.readByte(this.state.pc++); const off = this.readByte(this.state.pc++); if ((this.readByte(this.getDpAddr(dp)) & 0x80) === 0) { this.state.pc += (off < 128 ? off : off - 256); return 7; } return 5; } // BBC dp.7, rel


      // ---------- Subroutines / Jumps ----------
      case 0x5F: { this.state.pc = this.readWord(this.state.pc); return 3; }      // JMP !abs
      case 0x0F: { const dp = this.readByte(this.state.pc++); this.state.pc = this.readWord(this.getDpAddr(dp)); return 4; } // JMP [dp]
      case 0x3F: { const addr = this.readWord(this.state.pc); this.state.pc += 2; this.pushWord(this.state.pc); this.state.pc = addr; return 8; } // CALL !abs
      case 0x4F: { const page = this.readByte(this.state.pc++); const addr = 0xFF00 | page; this.pushWord(this.state.pc); this.state.pc = addr; return 6; } // PCALL
      case 0x6F: { this.state.pc = this.popWord(); return 5; }                   // RET
      case 0x2E: { // CBNE dp, rel
        const dp = this.readByte(this.state.pc++);
        const rel = this.readByte(this.state.pc++);
        const val = this.readByte(this.getDpAddr(dp));
        if (this.state.a !== val) {
          const offset = rel < 0x80 ? rel : rel - 256;
          this.state.pc = (this.state.pc + offset) & 0xFFFF;
          return 7;
        }
        return 5;
      }
      // ---------- Stack ----------
      case 0x2D: this.push(this.state.a); return 4;
      case 0x4D: this.push(this.state.x); return 4;
      case 0x6D: this.push(this.state.y); return 4;
      case 0x0D: this.push(this.state.psw); return 4;
      case 0xAE: this.state.a = this.pop(); return 4;
      case 0xCE: this.state.x = this.pop(); return 4;
      case 0xEE: this.state.y = this.pop(); return 4;
      case 0x8E: this.state.psw = this.pop(); return 4;

      // ---------- Multiply (DIV, DAA, DAS omitted – very rare) ----------
      // No multiply instruction in SPC700.

      // ---------- Unknown ----------
      case 0x0B: { // ASL dp
        const addr = this.getDpAddr(this.readByte(this.state.pc++));
         let v = this.readByte(addr);
         const c = (v & 0x80) !== 0;
         v = (v << 1) & 0xFF;
         this.writeByte(addr, v);
         this.setFlagC(c);
         this.updateNZ(v);
        return 4;
      }
      case 0x0C: { // ASL abs
        const addr = this.readWord(this.state.pc);
         this.state.pc += 2;
         let v = this.readByte(addr);
         const c = (v & 0x80) !== 0;
         v = (v << 1) & 0xFF;
         this.writeByte(addr, v);
         this.setFlagC(c);
         this.updateNZ(v);
        return 5;
      }
      case 0x0E: { // TSET1 abs
        const addr = this.readWord(this.state.pc);
         this.state.pc += 2;
         const v = this.readByte(addr);
         const diff = this.state.a - v;
         this.setFlagZ((diff & 0xFF) === 0);
         this.setFlagN((diff & 0x80) !== 0);
         this.writeByte(addr, v | this.state.a);
        return 6;
      }
      case 0x17: { // OR A, diy
        const dp = this.readByte(this.state.pc++);
         const ptr = this.readWord(this.getDpAddr(dp));
         const addr = (ptr + this.state.y) & 0xFFFF;
         this.state.a |= this.readByte(addr);
         this.updateNZ(this.state.a);
        return 6;
      }
      case 0x36: { // AND A, aby
        const addr = (this.readWord(this.state.pc) + this.state.y) & 0xFFFF;
         this.state.pc += 2;
         this.state.a &= this.readByte(addr);
         this.updateNZ(this.state.a);
        return 5;
      }
      case 0x37: { // AND A, diy
        const dp = this.readByte(this.state.pc++);
         const ptr = this.readWord(this.getDpAddr(dp));
         const addr = (ptr + this.state.y) & 0xFFFF;
         this.state.a &= this.readByte(addr);
         this.updateNZ(this.state.a);
        return 6;
      }
      case 0x3B: { // ROL dpx
        const addr = this.getDpAddr((this.readByte(this.state.pc++) + this.state.x) & 0xFF);
         let v = this.readByte(addr);
         const carry = (v & 0x80) !== 0;
         v = ((v << 1) | (this.getFlagC() ? 1 : 0)) & 0xFF;
         this.writeByte(addr, v);
         this.setFlagC(carry);
         this.updateNZ(v);
        return 5;
      }
      case 0x3C: { // ROL A
        const carry = (this.state.a & 0x80) !== 0;
         this.state.a = ((this.state.a << 1) | (this.getFlagC() ? 1 : 0)) & 0xFF;
         this.setFlagC(carry);
         this.updateNZ(this.state.a);
        return 2;
      }
      case 0x47: { // EOR A, dxi
        const dp = this.readByte(this.state.pc++);
         const addr = this.readWord(this.getDpAddr((dp + this.state.x) & 0xFF));
         this.state.a ^= this.readByte(addr);
         this.updateNZ(this.state.a);
        return 6;
      }
      case 0x4E: { // TCLR1 abs
        const addr = this.readWord(this.state.pc);
         this.state.pc += 2;
         const v = this.readByte(addr);
         const diff = this.state.a - v;
         this.setFlagZ((diff & 0xFF) === 0);
         this.setFlagN((diff & 0x80) !== 0);
         this.writeByte(addr, v & ~this.state.a);
        return 6;
      }
      case 0x58: { // EOR dp, imm
        const imm = this.readByte(this.state.pc++);
         const addr = this.getDpAddr(this.readByte(this.state.pc++));
         const val = this.readByte(addr);
         const res = val ^ imm;
         this.writeByte(addr, res);
         this.updateNZ(res);
        return 5;
      }
      case 0x59: { // EOR xi, yi
        const addrX = this.getDpAddr(this.state.x);
         const addrY = this.getDpAddr(this.state.y);
         const res = this.readByte(addrX) ^ this.readByte(addrY);
         this.writeByte(addrX, res);
         this.updateNZ(res);
        return 5;
      }
      case 0x5A: { // CMPW dp
        const addr = this.getDpAddr(this.readByte(this.state.pc++));
         const v = this.readWord(addr);
         const ya = (this.state.y << 8) | this.state.a;
         const diff = ya - v;
         this.setFlagC(ya >= v);
         this.setFlagZ(diff === 0);
         this.setFlagN((diff & 0x8000) !== 0);
        return 4;
      }
      case 0x66: { // CMP A, xi
        const addr = this.getDpAddr(this.state.x);
         const v = this.readByte(addr);
         const diff = this.state.a - v;
         this.setFlagC(this.state.a >= v);
         this.updateNZ(diff & 0xFF);
        return 3;
      }
      case 0x67: { // CMP A, dxi
        const dp = this.readByte(this.state.pc++);
         const addr = this.readWord(this.getDpAddr((dp + this.state.x) & 0xFF));
         const v = this.readByte(addr);
         const diff = this.state.a - v;
         this.setFlagC(this.state.a >= v);
         this.updateNZ(diff & 0xFF);
        return 6;
      }
      case 0x6A: { // AND1 C, !mem.bit
        const word = this.readWord(this.state.pc);
         this.state.pc += 2;
         const bit = word >> 13;
         const addr = word & 0x1FFF;
         const val = (this.readByte(addr) >> bit) & 1;
         this.setFlagC(this.getFlagC() && (val === 0));
        return 4;
      }
      case 0x74: { // CMP A, dpx
        const addr = this.getDpAddr((this.readByte(this.state.pc++) + this.state.x) & 0xFF);
         const v = this.readByte(addr);
         const diff = this.state.a - v;
         this.setFlagC(this.state.a >= v);
         this.updateNZ(diff & 0xFF);
        return 4;
      }
      case 0x76: { // CMP A, aby
        const addr = (this.readWord(this.state.pc) + this.state.y) & 0xFFFF;
         this.state.pc += 2;
         const v = this.readByte(addr);
         const diff = this.state.a - v;
         this.setFlagC(this.state.a >= v);
         this.updateNZ(diff & 0xFF);
        return 5;
      }
      case 0x7F: { // RETI
        this.state.psw = this.pop();
         this.state.pc = this.popWord();
        return 6;
      }
      case 0x85: { // ADC A, abs
        const addr = this.readWord(this.state.pc);
         this.state.pc += 2;
         const val = this.readByte(addr);
         const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         this.state.a = sum & 0xFF;
         this.updateNZ(this.state.a);
        return 4;
      }
      case 0x86: { // ADC A, xi
        const addr = this.getDpAddr(this.state.x);
         const val = this.readByte(addr);
         const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         this.state.a = sum & 0xFF;
         this.updateNZ(this.state.a);
        return 3;
      }
      case 0x87: { // ADC A, dxi
        const dp = this.readByte(this.state.pc++);
         const addr = this.readWord(this.getDpAddr((dp + this.state.x) & 0xFF));
         const val = this.readByte(addr);
         const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         this.state.a = sum & 0xFF;
         this.updateNZ(this.state.a);
        return 6;
      }
      case 0x8A: { // EOR1 C, mem.bit
        const word = this.readWord(this.state.pc);
         this.state.pc += 2;
         const bit = word >> 13;
         const addr = word & 0x1FFF;
         const val = (this.readByte(addr) >> bit) & 1;
         this.setFlagC(this.getFlagC() !== (val === 1));
        return 5;
      }
      case 0x94: { // ADC A, dpx
        const addr = this.getDpAddr((this.readByte(this.state.pc++) + this.state.x) & 0xFF);
         const val = this.readByte(addr);
         const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         this.state.a = sum & 0xFF;
         this.updateNZ(this.state.a);
        return 4;
      }
      case 0x97: { // ADC A, diy
        const dp = this.readByte(this.state.pc++);
         const ptr = this.readWord(this.getDpAddr(dp));
         const addr = (ptr + this.state.y) & 0xFFFF;
         const val = this.readByte(addr);
         const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         this.state.a = sum & 0xFF;
         this.updateNZ(this.state.a);
        return 6;
      }
      case 0x98: { // ADC dp, imm
        const imm = this.readByte(this.state.pc++);
         const addr = this.getDpAddr(this.readByte(this.state.pc++));
         const val = this.readByte(addr);
         const sum = val + imm + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((val ^ imm ^ sum) & 0x10) !== 0);
         this.setFlagV(((val ^ imm ^ 0x80) & (val ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         const res = sum & 0xFF;
         this.writeByte(addr, res);
         this.updateNZ(res);
        return 5;
      }
      case 0x99: { // ADC xi, yi
        const addrX = this.getDpAddr(this.state.x);
         const addrY = this.getDpAddr(this.state.y);
         const valX = this.readByte(addrX);
         const valY = this.readByte(addrY);
         const sum = valX + valY + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((valX ^ valY ^ sum) & 0x10) !== 0);
         this.setFlagV(((valX ^ valY ^ 0x80) & (valX ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         const res = sum & 0xFF;
         this.writeByte(addrX, res);
         this.updateNZ(res);
        return 5;
      }
      case 0x9F: { // XCN A
        this.state.a = ((this.state.a << 4) | (this.state.a >> 4)) & 0xFF;
         this.updateNZ(this.state.a);
        return 5;
      }
      case 0xA5: { // SBC A, abs
        const addr = this.readWord(this.state.pc);
         this.state.pc += 2;
         const val = this.readByte(addr);
         const borrow = this.getFlagC() ? 0 : 1;
         const diff = this.state.a - val - borrow;
         this.setFlagH(((this.state.a ^ val ^ diff) & 0x10) === 0);
         this.setFlagV(((this.state.a ^ val) & (this.state.a ^ diff) & 0x80) !== 0);
         this.setFlagC(diff >= 0);
         this.state.a = diff & 0xFF;
         this.updateNZ(this.state.a);
        return 4;
      }
      case 0xA6: { // SBC A, xi
        const addr = this.getDpAddr(this.state.x);
         const val = this.readByte(addr);
         const borrow = this.getFlagC() ? 0 : 1;
         const diff = this.state.a - val - borrow;
         this.setFlagH(((this.state.a ^ val ^ diff) & 0x10) === 0);
         this.setFlagV(((this.state.a ^ val) & (this.state.a ^ diff) & 0x80) !== 0);
         this.setFlagC(diff >= 0);
         this.state.a = diff & 0xFF;
         this.updateNZ(this.state.a);
        return 3;
      }
      case 0xA9: { // SBC dp, dp
        const src = this.getDpAddr(this.readByte(this.state.pc++));
         const dst = this.getDpAddr(this.readByte(this.state.pc++));
         const val = this.readByte(src);
         const destVal = this.readByte(dst);
         const borrow = this.getFlagC() ? 0 : 1;
         const diff = destVal - val - borrow;
         this.setFlagH(((destVal ^ val ^ diff) & 0x10) === 0);
         this.setFlagV(((destVal ^ val) & (destVal ^ diff) & 0x80) !== 0);
         this.setFlagC(diff >= 0);
         const res = diff & 0xFF;
         this.writeByte(dst, res);
         this.updateNZ(res);
        return 6;
      }
      case 0xB5: { // SBC A, abx
        const addr = (this.readWord(this.state.pc) + this.state.x) & 0xFFFF;
         this.state.pc += 2;
         const val = this.readByte(addr);
         const borrow = this.getFlagC() ? 0 : 1;
         const diff = this.state.a - val - borrow;
         this.setFlagH(((this.state.a ^ val ^ diff) & 0x10) === 0);
         this.setFlagV(((this.state.a ^ val) & (this.state.a ^ diff) & 0x80) !== 0);
         this.setFlagC(diff >= 0);
         this.state.a = diff & 0xFF;
         this.updateNZ(this.state.a);
        return 5;
      }
      case 0xB6: { // SBC A, aby
        const addr = (this.readWord(this.state.pc) + this.state.y) & 0xFFFF;
         this.state.pc += 2;
         const val = this.readByte(addr);
         const borrow = this.getFlagC() ? 0 : 1;
         const diff = this.state.a - val - borrow;
         this.setFlagH(((this.state.a ^ val ^ diff) & 0x10) === 0);
         this.setFlagV(((this.state.a ^ val) & (this.state.a ^ diff) & 0x80) !== 0);
         this.setFlagC(diff >= 0);
         this.state.a = diff & 0xFF;
         this.updateNZ(this.state.a);
        return 5;
      }
      case 0xB9: { // SBC xi, yi
        const addrX = this.getDpAddr(this.state.x);
         const addrY = this.getDpAddr(this.state.y);
         const val = this.readByte(addrY);
         const destVal = this.readByte(addrX);
         const borrow = this.getFlagC() ? 0 : 1;
         const diff = destVal - val - borrow;
         this.setFlagH(((destVal ^ val ^ diff) & 0x10) === 0);
         this.setFlagV(((destVal ^ val) & (destVal ^ diff) & 0x80) !== 0);
         this.setFlagC(diff >= 0);
         const res = diff & 0xFF;
         this.writeByte(addrX, res);
         this.updateNZ(res);
        return 5;
      }
      case 0xBB: { // INC dpx
        const addr = this.getDpAddr((this.readByte(this.state.pc++) + this.state.x) & 0xFF);
         const res = (this.readByte(addr) + 1) & 0xFF;
         this.writeByte(addr, res);
         this.updateNZ(res);
        return 5;
      }
      case 0xED: { // NOTC
        this.setFlagC(!this.getFlagC());
        return 3;
      }

      default: {
        if (!this._unknownLog.has(opcode)) {
          this._unknownLog.add(opcode);
          console.warn(`SPC700: unknown opcode 0x${opcode.toString(16).padStart(2, '0')} at PC=0x${this.state.pc.toString(16)}`);
        }
        return 2;
      }
    }
  }
  private _unknownLog = new Set<number>();
}