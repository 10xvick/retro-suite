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
         this.setFlagZ((this.state.a & v) === 0);
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
         this.setFlagZ((this.state.a & v) === 0);
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
        this.state.psw = this.popByte();
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
         const val = this.readByte(addr) ^ 0xFF;
         const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         this.state.a = sum & 0xFF;
         this.updateNZ(this.state.a);
        return 4;
      }
      case 0xA6: { // SBC A, xi
        const addr = this.getDpAddr(this.state.x);
         const val = this.readByte(addr) ^ 0xFF;
         const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         this.state.a = sum & 0xFF;
         this.updateNZ(this.state.a);
        return 3;
      }
      case 0xA9: { // SBC dp, dp
        const src = this.getDpAddr(this.readByte(this.state.pc++));
         const dst = this.getDpAddr(this.readByte(this.state.pc++));
         const val = this.readByte(src) ^ 0xFF;
         const destVal = this.readByte(dst);
         const sum = destVal + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((destVal ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((destVal ^ val ^ 0x80) & (destVal ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         const res = sum & 0xFF;
         this.writeByte(dst, res);
         this.updateNZ(res);
        return 6;
      }
      case 0xB5: { // SBC A, abx
        const addr = (this.readWord(this.state.pc) + this.state.x) & 0xFFFF;
         this.state.pc += 2;
         const val = this.readByte(addr) ^ 0xFF;
         const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         this.state.a = sum & 0xFF;
         this.updateNZ(this.state.a);
        return 5;
      }
      case 0xB6: { // SBC A, aby
        const addr = (this.readWord(this.state.pc) + this.state.y) & 0xFFFF;
         this.state.pc += 2;
         const val = this.readByte(addr) ^ 0xFF;
         const sum = this.state.a + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((this.state.a ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((this.state.a ^ val ^ 0x80) & (this.state.a ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         this.state.a = sum & 0xFF;
         this.updateNZ(this.state.a);
        return 5;
      }
      case 0xB9: { // SBC xi, yi
        const addrX = this.getDpAddr(this.state.x);
         const addrY = this.getDpAddr(this.state.y);
         const val = this.readByte(addrY) ^ 0xFF;
         const destVal = this.readByte(addrX);
         const sum = destVal + val + (this.getFlagC() ? 1 : 0);
         this.setFlagH(((destVal ^ val ^ sum) & 0x10) !== 0);
         this.setFlagV(((destVal ^ val ^ 0x80) & (destVal ^ sum) & 0x80) !== 0);
         this.setFlagC(sum > 0xFF);
         const res = sum & 0xFF;
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
