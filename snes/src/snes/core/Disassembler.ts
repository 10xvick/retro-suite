import { Bus } from './Bus';

interface InstructionInfo {
  mnemonic: string;
  addrMode: string;
}

export class Disassembler {
  private static opcodes: { [key: number]: InstructionInfo } = {
    0x18: { mnemonic: 'CLC', addrMode: 'implied' },
    0x38: { mnemonic: 'SEC', addrMode: 'implied' },
    0x58: { mnemonic: 'CLI', addrMode: 'implied' },
    0x78: { mnemonic: 'SEI', addrMode: 'implied' },
    0xD8: { mnemonic: 'CLD', addrMode: 'implied' },
    0xF8: { mnemonic: 'SED', addrMode: 'implied' },
    0xE2: { mnemonic: 'SEP', addrMode: 'immediate8' },
    0xC2: { mnemonic: 'REP', addrMode: 'immediate8' },
    0xFB: { mnemonic: 'XCE', addrMode: 'implied' },
    0xEA: { mnemonic: 'NOP', addrMode: 'implied' },
    0xCB: { mnemonic: 'WAI', addrMode: 'implied' },

    // LDA
    0xA9: { mnemonic: 'LDA', addrMode: 'immediateAcc' },
    0xAD: { mnemonic: 'LDA', addrMode: 'absolute' },
    0xA5: { mnemonic: 'LDA', addrMode: 'direct' },

    // LDX
    0xA2: { mnemonic: 'LDX', addrMode: 'immediateIndex' },
    0xAE: { mnemonic: 'LDX', addrMode: 'absolute' },

    // LDY
    0xA0: { mnemonic: 'LDY', addrMode: 'immediateIndex' },
    0xAC: { mnemonic: 'LDY', addrMode: 'absolute' },

    // STA
    0x8D: { mnemonic: 'STA', addrMode: 'absolute' },
    0x85: { mnemonic: 'STA', addrMode: 'direct' },
    0x9D: { mnemonic: 'STA', addrMode: 'absoluteX' },
    0x8F: { mnemonic: 'STA', addrMode: 'long' },
    0x9F: { mnemonic: 'STA', addrMode: 'longX' },

    // LDA (additional long modes)
    0xAF: { mnemonic: 'LDA', addrMode: 'long' },
    0xBF: { mnemonic: 'LDA', addrMode: 'longX' },

    // STX
    0x8E: { mnemonic: 'STX', addrMode: 'absolute' },
    0x86: { mnemonic: 'STX', addrMode: 'direct' },

    // STY
    0x8C: { mnemonic: 'STY', addrMode: 'absolute' },
    0x84: { mnemonic: 'STY', addrMode: 'direct' },

    // STZ
    0x9C: { mnemonic: 'STZ', addrMode: 'absolute' },
    0x9E: { mnemonic: 'STZ', addrMode: 'absoluteX' },
    0x64: { mnemonic: 'STZ', addrMode: 'direct' },
    0x74: { mnemonic: 'STZ', addrMode: 'directX' },

    // Transfers
    0xAA: { mnemonic: 'TAX', addrMode: 'implied' },
    0x8A: { mnemonic: 'TXA', addrMode: 'implied' },
    0xA8: { mnemonic: 'TAY', addrMode: 'implied' },
    0x98: { mnemonic: 'TYA', addrMode: 'implied' },
    0x9A: { mnemonic: 'TXS', addrMode: 'implied' },
    0xBA: { mnemonic: 'TSX', addrMode: 'implied' },
    0xEB: { mnemonic: 'XBA', addrMode: 'implied' },
    0x5B: { mnemonic: 'TCD', addrMode: 'implied' },
    0x7B: { mnemonic: 'TDC', addrMode: 'implied' },
    0x1B: { mnemonic: 'TCS', addrMode: 'implied' },
    0x3B: { mnemonic: 'TSC', addrMode: 'implied' },
    0xAB: { mnemonic: 'PLB', addrMode: 'implied' },
    0x8B: { mnemonic: 'PHB', addrMode: 'implied' },
    0x0B: { mnemonic: 'PHD', addrMode: 'implied' },
    0x2B: { mnemonic: 'PLD', addrMode: 'implied' },
    0x4B: { mnemonic: 'PHK', addrMode: 'implied' },

    // Arithmetic / Inc / Dec
    0x1A: { mnemonic: 'INC', addrMode: 'accumulator' },
    0xE8: { mnemonic: 'INX', addrMode: 'implied' },
    0xC8: { mnemonic: 'INY', addrMode: 'implied' },
    0x3A: { mnemonic: 'DEC', addrMode: 'accumulator' },
    0xCA: { mnemonic: 'DEX', addrMode: 'implied' },
    0x88: { mnemonic: 'DEY', addrMode: 'implied' },
    0x89: { mnemonic: 'BIT', addrMode: 'immediateAcc' },
    0xC9: { mnemonic: 'CMP', addrMode: 'immediateAcc' },
    0x69: { mnemonic: 'ADC', addrMode: 'immediateAcc' },
    0x65: { mnemonic: 'ADC', addrMode: 'direct' },
    0x6D: { mnemonic: 'ADC', addrMode: 'absolute' },
    0x7D: { mnemonic: 'ADC', addrMode: 'absoluteX' },
    0x79: { mnemonic: 'ADC', addrMode: 'absoluteY' },
    0x61: { mnemonic: 'ADC', addrMode: 'indirectX' },
    0x71: { mnemonic: 'ADC', addrMode: 'indirectY' },
    0x72: { mnemonic: 'ADC', addrMode: 'indirect' },
    0x29: { mnemonic: 'AND', addrMode: 'immediateAcc' },
    0x09: { mnemonic: 'ORA', addrMode: 'immediateAcc' },
    0x49: { mnemonic: 'EOR', addrMode: 'immediateAcc' },

    // Additional LDA/STA modes
    0xB2: { mnemonic: 'LDA', addrMode: 'indirect' },
    0xB1: { mnemonic: 'LDA', addrMode: 'indirectY' },
    0xA1: { mnemonic: 'LDA', addrMode: 'indirectX' },
    0xBD: { mnemonic: 'LDA', addrMode: 'absoluteX' },
    0xB9: { mnemonic: 'LDA', addrMode: 'absoluteY' },
    0x92: { mnemonic: 'STA', addrMode: 'indirect' },
    0x91: { mnemonic: 'STA', addrMode: 'indirectY' },
    0x81: { mnemonic: 'STA', addrMode: 'indirectX' },
    0x99: { mnemonic: 'STA', addrMode: 'absoluteY' },

    // Compare Index
    0xE0: { mnemonic: 'CPX', addrMode: 'immediateIndex' },
    0xE4: { mnemonic: 'CPX', addrMode: 'direct' },
    0xEC: { mnemonic: 'CPX', addrMode: 'absolute' },
    0xC0: { mnemonic: 'CPY', addrMode: 'immediateIndex' },
    0xC4: { mnemonic: 'CPY', addrMode: 'direct' },
    0xCC: { mnemonic: 'CPY', addrMode: 'absolute' },

    // SBC
    0xE9: { mnemonic: 'SBC', addrMode: 'immediateAcc' },
    0xE5: { mnemonic: 'SBC', addrMode: 'direct' },
    0xED: { mnemonic: 'SBC', addrMode: 'absolute' },
    0xFD: { mnemonic: 'SBC', addrMode: 'absoluteX' },
    0xF9: { mnemonic: 'SBC', addrMode: 'absoluteY' },
    0xE1: { mnemonic: 'SBC', addrMode: 'indirectX' },
    0xF1: { mnemonic: 'SBC', addrMode: 'indirectY' },
    0xF2: { mnemonic: 'SBC', addrMode: 'indirect' },

    // Shifts
    0x0A: { mnemonic: 'ASL', addrMode: 'accumulator' },
    0x06: { mnemonic: 'ASL', addrMode: 'direct' },
    0x0E: { mnemonic: 'ASL', addrMode: 'absolute' },
    0x1E: { mnemonic: 'ASL', addrMode: 'absoluteX' },
    0x4A: { mnemonic: 'LSR', addrMode: 'accumulator' },
    0x46: { mnemonic: 'LSR', addrMode: 'direct' },
    0x4E: { mnemonic: 'LSR', addrMode: 'absolute' },
    0x5E: { mnemonic: 'LSR', addrMode: 'absoluteX' },
    0x2A: { mnemonic: 'ROL', addrMode: 'accumulator' },
    0x26: { mnemonic: 'ROL', addrMode: 'direct' },
    0x2E: { mnemonic: 'ROL', addrMode: 'absolute' },
    0x3E: { mnemonic: 'ROL', addrMode: 'absoluteX' },
    0x6A: { mnemonic: 'ROR', addrMode: 'accumulator' },
    0x66: { mnemonic: 'ROR', addrMode: 'direct' },
    0x6E: { mnemonic: 'ROR', addrMode: 'absolute' },
    0x7E: { mnemonic: 'ROR', addrMode: 'absoluteX' },

    // Misc
    0xF4: { mnemonic: 'PEA', addrMode: 'absolute' },
    0xFE: { mnemonic: 'INC', addrMode: 'absoluteX' },
    0x7C: { mnemonic: 'JMP', addrMode: 'indirectAbsX' },
    0x54: { mnemonic: 'MVN', addrMode: 'blockMove' },
    0x44: { mnemonic: 'MVP', addrMode: 'blockMove' },

    // Jumps
    0x4C: { mnemonic: 'JMP', addrMode: 'absolute' },
    0x20: { mnemonic: 'JSR', addrMode: 'absolute' },
    0x22: { mnemonic: 'JSL', addrMode: 'long' },
    0x5C: { mnemonic: 'JML', addrMode: 'long' },
    0x60: { mnemonic: 'RTS', addrMode: 'implied' },
    0x6B: { mnemonic: 'RTL', addrMode: 'implied' },

    // Branches
    0xD0: { mnemonic: 'BNE', addrMode: 'relative' },
    0xF0: { mnemonic: 'BEQ', addrMode: 'relative' },
    0x90: { mnemonic: 'BCC', addrMode: 'relative' },
    0xB0: { mnemonic: 'BCS', addrMode: 'relative' },
    0x10: { mnemonic: 'BPL', addrMode: 'relative' },
    0x30: { mnemonic: 'BMI', addrMode: 'relative' },
    0x80: { mnemonic: 'BRA', addrMode: 'relative' },

    // Stack
    0x48: { mnemonic: 'PHA', addrMode: 'implied' },
    0x68: { mnemonic: 'PLA', addrMode: 'implied' },
    0xDA: { mnemonic: 'PHX', addrMode: 'implied' },
    0xFA: { mnemonic: 'PLX', addrMode: 'implied' },
    0x5A: { mnemonic: 'PHY', addrMode: 'implied' },
    0x7A: { mnemonic: 'PLY', addrMode: 'implied' },
    0x08: { mnemonic: 'PHP', addrMode: 'implied' },
    0x28: { mnemonic: 'PLP', addrMode: 'implied' },

    // Missing Instructions added for Jungle Book & general compatibility
    0x00: { mnemonic: 'BRK', addrMode: 'implied' },
    0x50: { mnemonic: 'BVC', addrMode: 'relative' },
    0x70: { mnemonic: 'BVS', addrMode: 'relative' },
    0x97: { mnemonic: 'STA', addrMode: 'indirectLongY' },
    0xB7: { mnemonic: 'LDA', addrMode: 'indirectLongY' },
    0x19: { mnemonic: 'ORA', addrMode: 'absoluteY' },
    0xC6: { mnemonic: 'DEC', addrMode: 'direct' },
    0xE6: { mnemonic: 'INC', addrMode: 'direct' },
    0xBC: { mnemonic: 'LDY', addrMode: 'absoluteX' },
    0xA3: { mnemonic: 'LDA', addrMode: 'stackRelative' },
    0xA6: { mnemonic: 'LDX', addrMode: 'direct' },
    0xA4: { mnemonic: 'LDY', addrMode: 'direct' },
    0xCE: { mnemonic: 'DEC', addrMode: 'absolute' },
    0xCD: { mnemonic: 'CMP', addrMode: 'absolute' },
    0xEE: { mnemonic: 'INC', addrMode: 'absolute' },
    0x3F: { mnemonic: 'AND', addrMode: 'longX' },
    0x7F: { mnemonic: 'ADC', addrMode: 'longX' },
    0xBE: { mnemonic: 'LDX', addrMode: 'absoluteY' },
    0x67: { mnemonic: 'ADC', addrMode: 'indirectLong' },
    0xA7: { mnemonic: 'LDA', addrMode: 'indirectLong' },
    0x05: { mnemonic: 'ORA', addrMode: 'direct' },
    0x0D: { mnemonic: 'ORA', addrMode: 'absolute' },
    0xFF: { mnemonic: 'SBC', addrMode: 'longX' },
    0x95: { mnemonic: 'STA', addrMode: 'directX' },
    0x4D: { mnemonic: 'EOR', addrMode: 'absolute' },
    0xFC: { mnemonic: 'JSR', addrMode: 'indirectAbsX' }
  };

  public static disassemble(
    bus: Bus,
    bank: number,
    pc: number,
    acc8: boolean,
    index8: boolean
  ): { disassembly: string; bytesUsed: number } {
    const opcode = bus.readByte(bank, pc);
    const info = this.opcodes[opcode];

    if (!info) {
      return {
        disassembly: `db $${opcode.toString(16).toUpperCase().padStart(2, '0')}`,
        bytesUsed: 1
      };
    }

    let bytesUsed = 1;
    let operandStr = '';

    const hexByte = (val: number) => '$' + val.toString(16).toUpperCase().padStart(2, '0');
    const hexWord = (val: number) => '$' + val.toString(16).toUpperCase().padStart(4, '0');
    const hexLong = (bankVal: number, addrVal: number) => 
      '$' + bankVal.toString(16).toUpperCase().padStart(2, '0') + ':' + addrVal.toString(16).toUpperCase().padStart(4, '0');

    switch (info.addrMode) {
      case 'implied':
        operandStr = '';
        bytesUsed = 1;
        break;
      
      case 'accumulator':
        operandStr = 'A';
        bytesUsed = 1;
        break;

      case 'immediate8': {
        const val = bus.readByte(bank, pc + 1);
        operandStr = `#${hexByte(val)}`;
        bytesUsed = 2;
        break;
      }

      case 'immediateAcc': {
        if (acc8) {
          const val = bus.readByte(bank, pc + 1);
          operandStr = `#${hexByte(val)}`;
          bytesUsed = 2;
        } else {
          const val = bus.readWord(bank, pc + 1);
          operandStr = `#${hexWord(val)}`;
          bytesUsed = 3;
        }
        break;
      }

      case 'immediateIndex': {
        if (index8) {
          const val = bus.readByte(bank, pc + 1);
          operandStr = `#${hexByte(val)}`;
          bytesUsed = 2;
        } else {
          const val = bus.readWord(bank, pc + 1);
          operandStr = `#${hexWord(val)}`;
          bytesUsed = 3;
        }
        break;
      }

      case 'direct': {
        const val = bus.readByte(bank, pc + 1);
        operandStr = `${hexByte(val)}`;
        bytesUsed = 2;
        break;
      }

      case 'absolute': {
        const val = bus.readWord(bank, pc + 1);
        operandStr = `${hexWord(val)}`;
        bytesUsed = 3;
        break;
      }

      case 'absoluteX': {
        const val = bus.readWord(bank, pc + 1);
        operandStr = `${hexWord(val)},X`;
        bytesUsed = 3;
        break;
      }

      case 'long': {
        const addr = bus.readWord(bank, pc + 1);
        const bnk = bus.readByte(bank, pc + 3);
        operandStr = `${hexLong(bnk, addr)}`;
        bytesUsed = 4;
        break;
      }

      case 'longX': {
        const addr = bus.readWord(bank, pc + 1);
        const bnk = bus.readByte(bank, pc + 3);
        operandStr = `${hexLong(bnk, addr)},X`;
        bytesUsed = 4;
        break;
      }

      case 'stackRelative': {
        const val = bus.readByte(bank, pc + 1);
        operandStr = `${hexByte(val)},S`;
        bytesUsed = 2;
        break;
      }

      case 'directX': {
        const val = bus.readByte(bank, pc + 1);
        operandStr = `${hexByte(val)},X`;
        bytesUsed = 2;
        break;
      }

      case 'absoluteY': {
        const val = bus.readWord(bank, pc + 1);
        operandStr = `${hexWord(val)},Y`;
        bytesUsed = 3;
        break;
      }

      case 'indirect': {
        const val = bus.readByte(bank, pc + 1);
        operandStr = `(${hexByte(val)})`;
        bytesUsed = 2;
        break;
      }

      case 'indirectY': {
        const val = bus.readByte(bank, pc + 1);
        operandStr = `(${hexByte(val)}),Y`;
        bytesUsed = 2;
        break;
      }

      case 'indirectLongY': {
        const val = bus.readByte(bank, pc + 1);
        operandStr = `[${hexByte(val)}],Y`;
        bytesUsed = 2;
        break;
      }

      case 'indirectLong': {
        const val = bus.readByte(bank, pc + 1);
        operandStr = `[${hexByte(val)}]`;
        bytesUsed = 2;
        break;
      }

      case 'indirectX': {
        const val = bus.readByte(bank, pc + 1);
        operandStr = `(${hexByte(val)},X)`;
        bytesUsed = 2;
        break;
      }

      case 'indirectAbsX': {
        const val = bus.readWord(bank, pc + 1);
        operandStr = `(${hexWord(val)},X)`;
        bytesUsed = 3;
        break;
      }

      case 'blockMove': {
        const destB = bus.readByte(bank, pc + 1);
        const srcB = bus.readByte(bank, pc + 2);
        operandStr = `${hexByte(srcB)},${hexByte(destB)}`;
        bytesUsed = 3;
        break;
      }

      case 'relative': {
        const val = bus.readByte(bank, pc + 1);
        // Signed 8-bit offset
        const signedOffset = val > 127 ? val - 256 : val;
        // Target address is PC + 2 + offset
        const targetPc = (pc + 2 + signedOffset) & 0xFFFF;
        operandStr = `${hexWord(targetPc)}`;
        bytesUsed = 2;
        break;
      }

      default:
        operandStr = '';
        bytesUsed = 1;
        break;
    }

    return {
      disassembly: `${info.mnemonic.padEnd(4, ' ')} ${operandStr}`.trim(),
      bytesUsed
    };
  }
}
