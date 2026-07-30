// Disassemble ROM bytes around the DISPCNT-writing code
import * as fs from 'fs';

const cart = new Uint8Array(fs.readFileSync('public/roms/test/suite.gba'));
const ROM_BASE = 0x08000000;

// Helper: read little-endian 16-bit at ROM offset
function u16(off: number): number {
  return cart[off] | (cart[off + 1] << 8);
}

// Disassemble a single THUMB instruction (heuristic, not a full disassembler)
function thumbDisasm(addr: number, instr: number): string {
  const hex = instr.toString(16).padStart(4, '0');
  
  // Format: try to identify key instructions
  if ((instr & 0xFE00) === 0x5400) { // STRB/STRH
    const op = (instr >> 9) & 1;
    const ro = (instr >> 6) & 7;
    const rb = (instr >> 3) & 7;
    const rd = instr & 7;
    return op ? `strb r${rd}, [r${rb}, r${ro}]` : `strh r${rd}, [r${rb}, r${ro}]`;
  }
  if ((instr & 0xF800) === 0x6000) { // STR (imm)
    const imm = ((instr >> 6) & 0x1F) * 4;
    return `str r${instr&7}, [r${(instr>>3)&7}, #${imm}]`;
  }
  if ((instr & 0xF800) === 0x8000) { // STRH (imm)
    const imm = ((instr >> 6) & 0x1F) * 2;
    return `strh r${instr&7}, [r${(instr>>3)&7}, #${imm}]`;
  }
  if ((instr & 0xF800) === 0x8800) { // LDRH (imm)
    const imm = ((instr >> 6) & 0x1F) * 2;
    return `ldrh r${instr&7}, [r${(instr>>3)&7}, #${imm}]`;
  }
  if ((instr & 0xF800) === 0x6800) { // LDR (imm)
    const imm = ((instr >> 6) & 0x1F) * 4;
    return `ldr r${instr&7}, [r${(instr>>3)&7}, #${imm}]`;
  }
  if ((instr & 0xF800) === 0x4800) { // LDR (PC-relative)
    const off = (instr & 0xFF) * 4;
    const pc = (addr + 4) & ~3;
    const litAddr = pc + off;
    let lit = '';
    if (litAddr >= ROM_BASE && litAddr + 3 < cart.length + ROM_BASE) {
      const v = cart[litAddr - ROM_BASE] | (cart[litAddr - ROM_BASE + 1] << 8) |
                (cart[litAddr - ROM_BASE + 2] << 16) | (cart[litAddr - ROM_BASE + 3] << 24);
      lit = ` ; =0x${(v>>>0).toString(16)}`;
    }
    return `ldr r${(instr>>8)&7}, [pc, #${off}]${lit}`;
  }
  if ((instr & 0xFF00) === 0x4700) return `bx r${(instr>>3)&0xF}`;
  if ((instr & 0xF800) === 0xF000) return `bl (high half)`;
  if ((instr & 0xF800) === 0xF800) return `bl (low half) -> PC+${((instr&0x7FF)<<1)-0x1000}`;
  if ((instr & 0xF800) === 0xD000) {  // Bcond
    const off8 = ((instr & 0xFF) << 24) >> 24;
    const target = addr + 4 + off8 * 2;
    const cond = ['beq','bne','bcs','bcc','bmi','bpl','bvs','bvc','bhi','bls','bge','blt','bgt','ble','???','???'][(instr>>8)&0xF];
    return `${cond} 0x${target.toString(16).padStart(8,'0')}`;
  }
  if ((instr & 0xF800) === 0xE000) {  // B (unconditional)
    const off11 = ((instr & 0x7FF) << 21) >> 21;
    const target = addr + 4 + off11 * 2;
    return `b 0x${target.toString(16).padStart(8,'0')}`;
  }
  if ((instr & 0xFFC0) === 0x0000 && (instr & 0x00C0) !== 0) return `lsl r${instr&7}, r${(instr>>3)&7}, #${(instr>>6)&0x1F}`;
  if ((instr & 0xFFC0) === 0x0000) return `mov r${instr&7}, r${(instr>>3)&7}`;
  if ((instr & 0xFF00) === 0x2000) return `mov r${(instr>>8)&7}, #0x${(instr&0xFF).toString(16)}`;
  if ((instr & 0xFF00) === 0x3000) return `add r${(instr>>8)&7}, #${instr&0xFF}`;
  if ((instr & 0xFF00) === 0x3800) return `sub r${(instr>>8)&7}, #${instr&0xFF}`;
  if ((instr & 0xFF00) === 0x2800) return `cmp r${(instr>>8)&7}, #0x${(instr&0xFF).toString(16)}`;
  if ((instr & 0xFFC0) === 0x4000) {
    const ops = ['and','eor','lsl','lsr','asr','adc','sbc','ror','tst','neg','cmp','cmn','orr','mul','bic','mvn'];
    return `${ops[(instr>>6)&0xF]} r${instr&7}, r${(instr>>3)&7}`;
  }
  if ((instr & 0xFC00) === 0x4400) { // Hi reg ops
    const ops2 = ['add','cmp','mov','bx'];
    return `${ops2[(instr>>8)&3]} (hi-reg)`;
  }
  if ((instr & 0xFF00) === 0x4900) return `ldr r${(instr>>8)&7}, =pool`;
  if ((instr & 0xF800) === 0xA000) return `add r${(instr>>8)&7}, pc, #${(instr&0xFF)*4}`;
  if ((instr & 0xF800) === 0xA800) return `add r${(instr>>8)&7}, sp, #${(instr&0xFF)*4}`;
  if ((instr & 0xFF80) === 0xB000) return `add sp, #${(instr&0x7F)*4}`;
  if ((instr & 0xFF80) === 0xB080) return `sub sp, #${(instr&0x7F)*4}`;
  if ((instr & 0xFF00) === 0xB400) return `push {...}`;
  if ((instr & 0xFF00) === 0xBC00) return `pop {...}`;
  if ((instr & 0xFF00) === 0xBD00) return `pop {..., pc}`;
  if ((instr & 0xDF00) === 0xDF00) return `swi #${instr&0xFF}`;
  
  return `??? (0x${hex})`;
}

// Dump around the key addresses
const startAddr = 0x0800af00;
const endAddr   = 0x0800b000;
const startOff  = startAddr - ROM_BASE;
const endOff    = endAddr - ROM_BASE;

console.log(`=== THUMB disassembly 0x0800af00 - 0x0800afff ===`);
const keyAddresses = new Set([0x0800af16, 0x0800af1c, 0x0800af40, 0x0800af46, 0x0800af74, 0x0800af7a]);

for (let off = startOff; off < Math.min(endOff, startOff + 0x100); off += 2) {
  const addr = ROM_BASE + off;
  const instr = u16(off);
  const mark = keyAddresses.has(addr) ? ' <<<' : '';
  const disasm = thumbDisasm(addr, instr);
  console.log(`  0x${addr.toString(16).padStart(8,'0')}: ${instr.toString(16).padStart(4,'0')}  ${disasm}${mark}`);
}
