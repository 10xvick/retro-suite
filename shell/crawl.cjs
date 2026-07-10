/**
 * SNES Static Reachability Crawler
 * ----------------------------------
 * Usage:  node crawl.cjs > full_disasm.txt
 *
 * Starts from the reset vector and follows every JSR/JMP/BRA/Bxx/JSL/JML
 * statically, tracking acc/index size flags through SEP/REP.
 * Marks indirect jumps (JMP ($addr,X), JSR ($addr,X)) as STUBS to resolve later.
 * Everything NOT reachable as code is left unmarked (likely data).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── ROM Loading ─────────────────────────────────────────────────────────────

const romPath = path.join(__dirname, 'public', 'sample.sfc');
const fileData = new Uint8Array(fs.readFileSync(romPath));

// Strip 512-byte SMC copier header if present
let rom;
const hasSmcHeader = fileData.length > 512 && (() => {
  const cs = fileData[0x7FDE + 512] | (fileData[0x7FDF + 512] << 8);
  const cc = fileData[0x7FDC + 512] | (fileData[0x7FDD + 512] << 8);
  return (cs + cc) === 0xFFFF;
})();
rom = hasSmcHeader ? fileData.slice(512) : fileData;

// ─── LoROM mapping ───────────────────────────────────────────────────────────

function romRead(bank, addr) {
  bank &= 0xFF;
  addr &= 0xFFFF;
  // LoROM: banks 0x00-0x7D and 0x80-0xFF, address 0x8000-0xFFFF
  if (addr >= 0x8000) {
    const offset = ((bank & 0x7F) * 0x8000) + (addr - 0x8000);
    if (offset < rom.length) return rom[offset];
  }
  return 0;
}

function romReadWord(bank, addr) {
  return romRead(bank, addr) | (romRead(bank, addr + 1) << 8);
}

// ─── Header / Reset Vector ───────────────────────────────────────────────────

// LoROM: native vectors at $FFXX in bank 0 (rom offset 0x7FXX)
const nativeReset  = rom[0x7FFD] << 8 | rom[0x7FFC]; // Native mode reset
const nativeNMI    = rom[0x7FFB] << 8 | rom[0x7FFA];
const nativeIRQ    = rom[0x7FF9] << 8 | rom[0x7FF8];
const title        = Array.from(rom.slice(0x7FC0, 0x7FD5))
                       .map(c => c >= 32 && c < 127 ? String.fromCharCode(c) : '.')
                       .join('').trim();

// ─── Opcode table (mnemonic, addrMode, size, terminal, jumpTarget) ──────────

// addrModes that produce a known absolute/long branch target:
//   'abs'     = 3-byte absolute (JSR $xxxx, JMP $xxxx, Bxx $rr)
//   'long'    = 4-byte long     (JSL $xxxxxx, JML $xxxxxx)
//   'rel'     = 2-byte relative branch
//   'rel16'   = 3-byte BRL
//   'iabs'    = indirect (JMP ($xxxx)) — can't statically resolve
//   'iabsx'   = indexed indirect (JMP ($xxxx,X)) — jump table, STUB
//   'implied' / 'imm8' / 'imm_acc' / 'imm_idx' / 'dp' / etc = no target

const OPCODES = {
  // ── Flags ──────────────────────────────────────────────────────────────────
  0x18: ['CLC','imp',1,0], 0x38: ['SEC','imp',1,0], 0x58: ['CLI','imp',1,0],
  0x78: ['SEI','imp',1,0], 0xD8: ['CLD','imp',1,0], 0xF8: ['SED','imp',1,0],
  0xFB: ['XCE','imp',1,0], 0xEA: ['NOP','imp',1,0], 0xCB: ['WAI','imp',1,0],
  0xDB: ['STP','imp',1,1], // terminal
  0xE2: ['SEP','imm8',2,0], 0xC2: ['REP','imm8',2,0],

  // ── Load / Store ───────────────────────────────────────────────────────────
  0xA9: ['LDA','imm_a',0,0],   0xAD: ['LDA','abs',3,0],   0xA5: ['LDA','dp',2,0],
  0xBD: ['LDA','absx',3,0],    0xB9: ['LDA','absy',3,0],  0xAF: ['LDA','long',4,0],
  0xBF: ['LDA','longx',4,0],   0xB2: ['LDA','dpi',2,0],   0xB1: ['LDA','dpiy',2,0],
  0xA1: ['LDA','dpix',2,0],    0xA3: ['LDA','sr',2,0],    0xA7: ['LDA','dpil',2,0],
  0xB7: ['LDA','dpiyl',2,0],

  0xA2: ['LDX','imm_x',0,0],   0xAE: ['LDX','abs',3,0],   0xA6: ['LDX','dp',2,0],
  0xBE: ['LDX','absy',3,0],

  0xA0: ['LDY','imm_x',0,0],   0xAC: ['LDY','abs',3,0],   0xA4: ['LDY','dp',2,0],
  0xBC: ['LDY','absx',3,0],

  0x8D: ['STA','abs',3,0],     0x85: ['STA','dp',2,0],    0x9D: ['STA','absx',3,0],
  0x99: ['STA','absy',3,0],    0x8F: ['STA','long',4,0],  0x9F: ['STA','longx',4,0],
  0x92: ['STA','dpi',2,0],     0x91: ['STA','dpiy',2,0],  0x81: ['STA','dpix',2,0],
  0x97: ['STA','dpiyl',2,0],   0x95: ['STA','dpx',2,0],

  0x8E: ['STX','abs',3,0],     0x86: ['STX','dp',2,0],
  0x8C: ['STY','abs',3,0],     0x84: ['STY','dp',2,0],
  0x9C: ['STZ','abs',3,0],     0x9E: ['STZ','absx',3,0],  0x64: ['STZ','dp',2,0],
  0x74: ['STZ','dpx',2,0],

  // ── Arithmetic ─────────────────────────────────────────────────────────────
  0x69: ['ADC','imm_a',0,0],   0x6D: ['ADC','abs',3,0],   0x65: ['ADC','dp',2,0],
  0x7D: ['ADC','absx',3,0],    0x79: ['ADC','absy',3,0],  0x7F: ['ADC','longx',4,0],
  0x67: ['ADC','dpil',2,0],    0x61: ['ADC','dpix',2,0],  0x71: ['ADC','dpiy',2,0],
  0x72: ['ADC','dpi',2,0],

  0xE9: ['SBC','imm_a',0,0],   0xED: ['SBC','abs',3,0],   0xE5: ['SBC','dp',2,0],
  0xFD: ['SBC','absx',3,0],    0xF9: ['SBC','absy',3,0],  0xFF: ['SBC','longx',4,0],
  0xE1: ['SBC','dpix',2,0],    0xF1: ['SBC','dpiy',2,0],  0xF2: ['SBC','dpi',2,0],

  0xC9: ['CMP','imm_a',0,0],   0xCD: ['CMP','abs',3,0],   0xC5: ['CMP','dp',2,0],
  0xDD: ['CMP','absx',3,0],    0xD9: ['CMP','absy',3,0],
  0xE0: ['CPX','imm_x',0,0],   0xEC: ['CPX','abs',3,0],   0xE4: ['CPX','dp',2,0],
  0xC0: ['CPY','imm_x',0,0],   0xCC: ['CPY','abs',3,0],   0xC4: ['CPY','dp',2,0],

  0x89: ['BIT','imm_a',0,0],   0x2C: ['BIT','abs',3,0],   0x24: ['BIT','dp',2,0],
  0x3C: ['BIT','absx',3,0],

  0x29: ['AND','imm_a',0,0],   0x2D: ['AND','abs',3,0],   0x25: ['AND','dp',2,0],
  0x3D: ['AND','absx',3,0],    0x39: ['AND','absy',3,0],  0x3F: ['AND','longx',4,0],
  0x21: ['AND','dpix',2,0],    0x31: ['AND','dpiy',2,0],  0x32: ['AND','dpi',2,0],

  0x09: ['ORA','imm_a',0,0],   0x0D: ['ORA','abs',3,0],   0x05: ['ORA','dp',2,0],
  0x1D: ['ORA','absx',3,0],    0x19: ['ORA','absy',3,0],  0x1F: ['ORA','longx',4,0],
  0x01: ['ORA','dpix',2,0],    0x11: ['ORA','dpiy',2,0],  0x12: ['ORA','dpi',2,0],

  0x49: ['EOR','imm_a',0,0],   0x4D: ['EOR','abs',3,0],   0x45: ['EOR','dp',2,0],
  0x5D: ['EOR','absx',3,0],    0x59: ['EOR','absy',3,0],  0x41: ['EOR','dpix',2,0],
  0x51: ['EOR','dpiy',2,0],    0x52: ['EOR','dpi',2,0],

  // ── Inc / Dec ──────────────────────────────────────────────────────────────
  0x1A: ['INC','acc',1,0],     0xE8: ['INX','imp',1,0],   0xC8: ['INY','imp',1,0],
  0xEE: ['INC','abs',3,0],     0xE6: ['INC','dp',2,0],    0xFE: ['INC','absx',3,0],
  0xF6: ['INC','dpx',2,0],
  0x3A: ['DEC','acc',1,0],     0xCA: ['DEX','imp',1,0],   0x88: ['DEY','imp',1,0],
  0xCE: ['DEC','abs',3,0],     0xC6: ['DEC','dp',2,0],    0xDE: ['DEC','absx',3,0],
  0xD6: ['DEC','dpx',2,0],

  // ── Shifts ────────────────────────────────────────────────────────────────
  0x0A: ['ASL','acc',1,0],     0x0E: ['ASL','abs',3,0],   0x06: ['ASL','dp',2,0],  0x1E: ['ASL','absx',3,0],
  0x4A: ['LSR','acc',1,0],     0x4E: ['LSR','abs',3,0],   0x46: ['LSR','dp',2,0],  0x5E: ['LSR','absx',3,0],
  0x2A: ['ROL','acc',1,0],     0x2E: ['ROL','abs',3,0],   0x26: ['ROL','dp',2,0],  0x3E: ['ROL','absx',3,0],
  0x6A: ['ROR','acc',1,0],     0x6E: ['ROR','abs',3,0],   0x66: ['ROR','dp',2,0],  0x7E: ['ROR','absx',3,0],

  // ── Transfers ──────────────────────────────────────────────────────────────
  0xAA: ['TAX','imp',1,0], 0x8A: ['TXA','imp',1,0], 0xA8: ['TAY','imp',1,0],
  0x98: ['TYA','imp',1,0], 0x9A: ['TXS','imp',1,0], 0xBA: ['TSX','imp',1,0],
  0xEB: ['XBA','imp',1,0], 0x5B: ['TCD','imp',1,0], 0x7B: ['TDC','imp',1,0],
  0x1B: ['TCS','imp',1,0], 0x3B: ['TSC','imp',1,0],

  // ── Stack ──────────────────────────────────────────────────────────────────
  0x48: ['PHA','imp',1,0], 0x68: ['PLA','imp',1,0],
  0xDA: ['PHX','imp',1,0], 0xFA: ['PLX','imp',1,0],
  0x5A: ['PHY','imp',1,0], 0x7A: ['PLY','imp',1,0],
  0x08: ['PHP','imp',1,0], 0x28: ['PLP','imp',1,0],
  0x8B: ['PHB','imp',1,0], 0xAB: ['PLB','imp',1,0],
  0x0B: ['PHD','imp',1,0], 0x2B: ['PLD','imp',1,0],
  0x4B: ['PHK','imp',1,0],
  0xF4: ['PEA','abs',3,0], 0xD4: ['PEI','dp',2,0],

  // ── Jumps / Calls ─────────────────────────────────────────────────────────
  0x4C: ['JMP','abs_jmp',3,1],   // terminal + follow target
  0x6C: ['JMP','iabs',3,1],      // indirect — STUB, terminal
  0x7C: ['JMP','iabsx',3,1],     // indexed indirect — STUB, terminal
  0x5C: ['JML','long_jmp',4,1],  // terminal + follow long target
  0xDC: ['JML','ilong',3,1],     // indirect long — STUB, terminal

  0x20: ['JSR','abs_jsr',3,0],   // call, follow target + continue
  0xFC: ['JSR','iabsx',3,0],     // indexed indirect call — STUB
  0x22: ['JSL','long_jsr',4,0],  // long call, follow + continue

  0x60: ['RTS','imp',1,1],   // terminal
  0x6B: ['RTL','imp',1,1],   // terminal
  0x40: ['RTI','imp',1,1],   // terminal

  // ── Branches ──────────────────────────────────────────────────────────────
  0x90: ['BCC','rel',2,0], 0xB0: ['BCS','rel',2,0],
  0xD0: ['BNE','rel',2,0], 0xF0: ['BEQ','rel',2,0],
  0x10: ['BPL','rel',2,0], 0x30: ['BMI','rel',2,0],
  0x50: ['BVC','rel',2,0], 0x70: ['BVS','rel',2,0],
  0x80: ['BRA','rel',2,1], // unconditional — terminal (follow target only, but also next)
  0x82: ['BRL','rel16',3,0],

  // ── Misc ──────────────────────────────────────────────────────────────────
  0x00: ['BRK','imp',1,1], // terminal
  0x54: ['MVN','blk',3,0], 0x44: ['MVP','blk',3,0],
  0x42: ['WDM','imm8',2,0],
};

// ─── Disassembly engine ──────────────────────────────────────────────────────

// State per address: { acc8, idx8, visited }
// We store as a Map<key, state> where key = `${bank}:${pc}`
const visited   = new Map(); // key → { acc8, idx8, lines: [{addr, bytes, asm}] }
const subLabels = new Map(); // key → label string
const stubs     = [];        // indirect jump locations we can't resolve

function key(bank, pc) {
  return `${bank.toString(16).padStart(2,'0')}:${pc.toString(16).padStart(4,'0')}`;
}

function setLabel(bank, pc, label) {
  const k = key(bank, pc);
  if (!subLabels.has(k)) subLabels.set(k, label);
}

// Instruction size accounting for variable-length immediates
function instrSize(opcode, acc8, idx8) {
  const info = OPCODES[opcode];
  if (!info) return 1;
  const [, mode, staticSize] = info;
  if (staticSize > 0) return staticSize;
  // Variable: imm_a = 2 if acc8, 3 if 16-bit; imm_x same for index
  if (mode === 'imm_a') return acc8 ? 2 : 3;
  if (mode === 'imm_x') return idx8 ? 2 : 3;
  return 1;
}

// Work queue entries: { bank, pc, acc8, idx8, depth, caller }
const queue = [];

function enqueue(bank, pc, acc8, idx8, caller = '') {
  const k = key(bank, pc);
  if (visited.has(k)) return;
  // Mark as queued immediately to avoid duplicate enqueues
  visited.set(k, null); // placeholder
  queue.push({ bank, pc, acc8, idx8, caller });
}

// ─── Crawl one subroutine starting at (bank, pc) ─────────────────────────────

function crawl(bank, startPc, acc8Init, idx8Init, caller) {
  let pc = startPc;
  let acc8 = acc8Init;
  let idx8 = idx8Init;

  const lines = [];

  for (let safety = 0; safety < 4096; safety++) {
    const k = key(bank, pc);

    // If we've already fully decoded this address in another pass, stop
    if (visited.has(k) && visited.get(k) !== null) break;

    const opcode = romRead(bank, pc);
    const info   = OPCODES[opcode];

    if (!info) {
      // Unknown opcode — treat as 1-byte data, stop
      lines.push({ bank, pc, bytes: [opcode], asm: `; db $${opcode.toString(16).padStart(2,'0')} [UNKNOWN OPCODE — treat as data]`, flags: {acc8,idx8} });
      break;
    }

    const [mnem, mode, , terminal] = info;
    const size = instrSize(opcode, acc8, idx8);

    // Read raw bytes
    const rawBytes = [];
    for (let i = 0; i < size; i++) rawBytes.push(romRead(bank, pc + i));

    // Build operand string and extract targets
    let operand = '';
    let jumpTargetBank = bank;
    let jumpTargetPc   = -1;
    let nextPc = (pc + size) & 0xFFFF;

    switch (mode) {
      case 'imp':
      case 'acc':
        operand = '';
        break;
      case 'imm8': {
        const v = rawBytes[1];
        operand = `#$${v.toString(16).padStart(2,'0')}`;
        // Track SEP/REP flag changes
        if (opcode === 0xE2) { if (v & 0x20) acc8 = true;  if (v & 0x10) idx8 = true; }
        if (opcode === 0xC2) { if (v & 0x20) acc8 = false; if (v & 0x10) idx8 = false; }
        break;
      }
      case 'imm_a': {
        if (acc8) {
          operand = `#$${rawBytes[1].toString(16).padStart(2,'0')}`;
        } else {
          const w = rawBytes[1] | (rawBytes[2] << 8);
          operand = `#$${w.toString(16).padStart(4,'0')}`;
        }
        break;
      }
      case 'imm_x': {
        if (idx8) {
          operand = `#$${rawBytes[1].toString(16).padStart(2,'0')}`;
        } else {
          const w = rawBytes[1] | (rawBytes[2] << 8);
          operand = `#$${w.toString(16).padStart(4,'0')}`;
        }
        break;
      }
      case 'dp':    operand = `$${rawBytes[1].toString(16).padStart(2,'0')}`; break;
      case 'dpx':   operand = `$${rawBytes[1].toString(16).padStart(2,'0')},X`; break;
      case 'dpix':  operand = `($${rawBytes[1].toString(16).padStart(2,'0')},X)`; break;
      case 'dpi':   operand = `($${rawBytes[1].toString(16).padStart(2,'0')})`; break;
      case 'dpiy':  operand = `($${rawBytes[1].toString(16).padStart(2,'0')}),Y`; break;
      case 'dpil':  operand = `[$${rawBytes[1].toString(16).padStart(2,'0')}]`; break;
      case 'dpiyl': operand = `[$${rawBytes[1].toString(16).padStart(2,'0')}],Y`; break;
      case 'sr':    operand = `$${rawBytes[1].toString(16).padStart(2,'0')},S`; break;
      case 'abs':
      case 'absx':
      case 'absy': {
        const w = rawBytes[1] | (rawBytes[2] << 8);
        operand = `$${w.toString(16).padStart(4,'0')}`;
        if (mode === 'absx') operand += ',X';
        if (mode === 'absy') operand += ',Y';
        break;
      }
      case 'abs_jmp': {
        const w = rawBytes[1] | (rawBytes[2] << 8);
        jumpTargetPc = w;
        operand = `$${w.toString(16).padStart(4,'0')}`;
        break;
      }
      case 'abs_jsr': {
        const w = rawBytes[1] | (rawBytes[2] << 8);
        jumpTargetPc = w;
        operand = `$${w.toString(16).padStart(4,'0')}`;
        break;
      }
      case 'iabs': {
        const w = rawBytes[1] | (rawBytes[2] << 8);
        operand = `($${w.toString(16).padStart(4,'0')})`;
        stubs.push(`JMP (${key(bank,w)}) @ ${key(bank,pc)} — INDIRECT, unresolvable statically`);
        break;
      }
      case 'iabsx': {
        const w = rawBytes[1] | (rawBytes[2] << 8);
        operand = `($${w.toString(16).padStart(4,'0')},X)`;
        stubs.push(`JMP/JSR (${key(bank,w)},X) @ ${key(bank,pc)} — JUMP TABLE, resolve manually`);
        break;
      }
      case 'ilong': {
        const w = rawBytes[1] | (rawBytes[2] << 8);
        operand = `[$${w.toString(16).padStart(4,'0')}]`;
        stubs.push(`JML [$${w.toString(16).padStart(4,'0')}] @ ${key(bank,pc)} — INDIRECT LONG`);
        break;
      }
      case 'long':
      case 'longx': {
        const addr = rawBytes[1] | (rawBytes[2] << 8);
        const bnk  = rawBytes[3];
        operand = `$${bnk.toString(16).padStart(2,'0')}:$${addr.toString(16).padStart(4,'0')}`;
        if (mode === 'longx') operand += ',X';
        break;
      }
      case 'long_jmp':
      case 'long_jsr': {
        const addr = rawBytes[1] | (rawBytes[2] << 8);
        const bnk  = rawBytes[3];
        jumpTargetBank = bnk;
        jumpTargetPc   = addr;
        operand = `$${bnk.toString(16).padStart(2,'0')}:$${addr.toString(16).padStart(4,'0')}`;
        break;
      }
      case 'rel': {
        const off = rawBytes[1] > 127 ? rawBytes[1] - 256 : rawBytes[1];
        const target = (pc + 2 + off) & 0xFFFF;
        jumpTargetPc = target;
        operand = `$${target.toString(16).padStart(4,'0')}`;
        break;
      }
      case 'rel16': {
        const off16 = rawBytes[1] | (rawBytes[2] << 8);
        const soff  = off16 > 32767 ? off16 - 65536 : off16;
        const target = (pc + 3 + soff) & 0xFFFF;
        jumpTargetPc = target;
        operand = `$${target.toString(16).padStart(4,'0')}`;
        break;
      }
      case 'blk': {
        operand = `$${rawBytes[2].toString(16).padStart(2,'0')},$${rawBytes[1].toString(16).padStart(2,'0')}`;
        break;
      }
    }

    // Compose ASM line
    const byteStr  = rawBytes.map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
    const addrStr  = `$${bank.toString(16).padStart(2,'0').toUpperCase()}:${pc.toString(16).padStart(4,'0').toUpperCase()}`;
    const flagStr  = `[${acc8?'m':'M'}${idx8?'x':'X'}]`;
    const asmStr   = operand ? `${mnem.padEnd(4)} ${operand}` : mnem;

    lines.push({ bank, pc, bytes: rawBytes, asm: `${addrStr}  ${byteStr.padEnd(12)}  ${flagStr} ${asmStr}`, flags: {acc8, idx8} });

    // Enqueue jump/call targets
    if (jumpTargetPc >= 0) {
      // Only follow if in ROM space (>= 0x8000 for LoROM)
      if (jumpTargetPc >= 0x8000 || jumpTargetBank !== bank) {
        const tBank = jumpTargetBank;
        const tPc   = jumpTargetPc;
        const tk    = key(tBank, tPc);
        setLabel(tBank, tPc,
          (mode === 'abs_jsr' || mode === 'long_jsr') ? `sub_${tk}` : `loc_${tk}`
        );
        enqueue(tBank, tPc, acc8, idx8, key(bank, pc));
      }
    }

    // For conditional branches and JSR: also continue to next instruction
    // For unconditional JMP/BRA/RTS/RTL: stop (terminal)
    if (terminal) {
      // BRA is terminal for "fall-through" but we still follow both sides
      // Actually BRA is truly unconditional so nextPc is dead
      // But conditional branches: fall-through IS valid
      if (mode === 'rel' && mnem !== 'BRA') {
        // conditional branch — also follow fall-through
        enqueue(bank, nextPc, acc8, idx8, key(bank, pc));
      }
      break;
    } else {
      pc = nextPc;
    }
  }

  // Store results
  const k = key(bank, startPc);
  visited.set(k, { acc8: acc8Init, idx8: idx8Init, caller, lines });
}

// ─── Seed the queue ───────────────────────────────────────────────────────────

// Native reset vector (bank 0x80, reset address)
const resetBank = 0x80;
enqueue(resetBank, nativeReset, true, true, 'RESET');
setLabel(resetBank, nativeReset, 'RESET');

// NMI handler
enqueue(resetBank, nativeNMI, true, true, 'NMI');
setLabel(resetBank, nativeNMI, 'NMI');

// IRQ handler  
enqueue(resetBank, nativeIRQ, true, true, 'IRQ');
setLabel(resetBank, nativeIRQ, 'IRQ');

// ─── Process queue ────────────────────────────────────────────────────────────

let processed = 0;
while (queue.length > 0) {
  const { bank, pc, acc8, idx8, caller } = queue.shift();
  crawl(bank, pc, acc8, idx8, caller);
  processed++;
  if (processed % 500 === 0) {
    process.stderr.write(`  [crawl] ${processed} subroutines, ${queue.length} queued...\n`);
  }
}

process.stderr.write(`[done] ${processed} entry points decoded, ${stubs.length} unresolvable stubs\n`);

// ─── Output ───────────────────────────────────────────────────────────────────

// Collect all visited addresses with their output lines
// Sort by bank then pc
const allLines = []; // { bank, pc, text }
const seenLine = new Set();

for (const [k, data] of visited.entries()) {
  if (!data || !data.lines) continue;
  for (const line of data.lines) {
    const lineKey = `${line.bank}:${line.pc}`;
    if (!seenLine.has(lineKey)) {
      seenLine.add(lineKey);
      allLines.push(line);
    }
  }
}

allLines.sort((a, b) => {
  if (a.bank !== b.bank) return a.bank - b.bank;
  return a.pc - b.pc;
});

// Emit header
console.log(`; ============================================================`);
console.log(`; SNES Static Disassembly — ${title}`);
console.log(`; ROM size: ${(rom.length / 1024).toFixed(0)} KB`);
console.log(`; Reset:    $${resetBank.toString(16).padStart(2,'0').toUpperCase()}:${nativeReset.toString(16).padStart(4,'0').toUpperCase()}`);
console.log(`; NMI:      $${resetBank.toString(16).padStart(2,'0').toUpperCase()}:${nativeNMI.toString(16).padStart(4,'0').toUpperCase()}`);
console.log(`; IRQ:      $${resetBank.toString(16).padStart(2,'0').toUpperCase()}:${nativeIRQ.toString(16).padStart(4,'0').toUpperCase()}`);
console.log(`; [m/M] = acc 8/16-bit   [x/X] = index 8/16-bit`);
console.log(`; ============================================================`);
console.log();

let lastBank = -1;
let lastPc   = -1;

for (const line of allLines) {
  // Bank separator
  if (line.bank !== lastBank) {
    console.log();
    console.log(`; ${'═'.repeat(56)}`);
    console.log(`; BANK $${line.bank.toString(16).padStart(2,'0').toUpperCase()}`);
    console.log(`; ${'═'.repeat(56)}`);
    lastBank = line.bank;
    lastPc   = -1;
  }

  // Gap in addresses = possible data between subroutines
  if (lastPc !== -1 && line.pc > lastPc + 8) {
    console.log();
  }

  // Subroutine label
  const k = key(line.bank, line.pc);
  if (subLabels.has(k)) {
    console.log();
    console.log(`; ${'─'.repeat(56)}`);
    console.log(`${subLabels.get(k)}:`);
  }

  console.log(line.asm);
  lastPc = line.pc;
}

// Stubs summary
if (stubs.length > 0) {
  console.log();
  console.log(`; ${'═'.repeat(56)}`);
  console.log(`; UNRESOLVABLE STUBS (indirect jumps / jump tables)`);
  console.log(`; These require runtime trace or manual analysis`);
  console.log(`; ${'═'.repeat(56)}`);
  for (const s of stubs) {
    console.log(`; STUB: ${s}`);
  }
}
