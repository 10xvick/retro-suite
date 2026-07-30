// Disassemble ROM around 0x0800b870 (test result display code) and 0x0800af00
import * as fs from 'fs';

const cart = new Uint8Array(fs.readFileSync('public/roms/test/suite.gba'));
const ROM_BASE = 0x08000000;

function u16(off: number): number {
  return cart[off] | (cart[off + 1] << 8);
}
function u32(off: number): number {
  return (cart[off] | (cart[off+1]<<8) | (cart[off+2]<<16) | (cart[off+3]<<24)) >>> 0;
}

function thumbDisasm(addr: number, instr: number): string {
  if ((instr & 0xFF00) === 0x2000) return `mov r${(instr>>8)&7}, #0x${(instr&0xFF).toString(16)}`;
  if ((instr & 0xFF00) === 0x3000) return `add r${(instr>>8)&7}, #0x${(instr&0xFF).toString(16)}`;
  if ((instr & 0xFF00) === 0x3800) return `sub r${(instr>>8)&7}, #0x${(instr&0xFF).toString(16)}`;
  if ((instr & 0xFF00) === 0x2800) return `cmp r${(instr>>8)&7}, #0x${(instr&0xFF).toString(16)}`;
  if ((instr & 0xFF00) === 0x2400) return `mov r${(instr>>8)&7}, #0x${(instr&0xFF).toString(16)}  ; mov r4,imm`;
  if ((instr & 0xF800) === 0x0000) { // LSL
    const off5 = (instr>>6)&31; const rs=(instr>>3)&7; const rd=instr&7;
    if (off5===0) return `mov r${rd}, r${rs}`;
    return `lsl r${rd}, r${rs}, #${off5}`;
  }
  if ((instr & 0xF800) === 0x0800) return `lsr r${instr&7}, r${(instr>>3)&7}, #${(instr>>6)&31}`;
  if ((instr & 0xF800) === 0x1000) return `asr r${instr&7}, r${(instr>>3)&7}, #${(instr>>6)&31}`;
  if ((instr & 0xFE00) === 0x1800) { // ADD/SUB reg
    const op = (instr>>9)&1; const rn=(instr>>6)&7; const rs=(instr>>3)&7; const rd=instr&7;
    return `${op?'sub':'add'} r${rd}, r${rs}, r${rn}`;
  }
  if ((instr & 0xFE00) === 0x1C00) { // ADD/SUB imm3
    const op = (instr>>9)&1; const imm3=(instr>>6)&7; const rs=(instr>>3)&7; const rd=instr&7;
    return `${op?'sub':'add'} r${rd}, r${rs}, #${imm3}`;
  }
  if ((instr & 0xFC00) === 0x4000) { // ALU
    const ops = ['and','eor','lsl','lsr','asr','adc','sbc','ror','tst','neg','cmp','cmn','orr','mul','bic','mvn'];
    return `${ops[(instr>>6)&15]} r${instr&7}, r${(instr>>3)&7}`;
  }
  if ((instr & 0xFC00) === 0x4400) { // Hi reg
    const op = (instr>>8)&3;
    const h1 = (instr>>7)&1; const h2=(instr>>6)&1;
    const rd = ((instr&7)|(h1<<3)); const rs = (((instr>>3)&7)|(h2<<3));
    const ops = ['add','cmp','mov','bx'];
    return `${ops[op]} r${rd}, r${rs}`;
  }
  if ((instr & 0xF800) === 0x4800) { // LDR PC-rel
    const rd=(instr>>8)&7; const off=(instr&0xFF)*4;
    const litAddr = ((addr+4)&~3)+off;
    let val = '?';
    if (litAddr >= ROM_BASE && litAddr+3 < cart.length+ROM_BASE) {
      val = '0x' + u32(litAddr-ROM_BASE).toString(16);
    }
    return `ldr r${rd}, [pc, #${off}] ; =${val}`;
  }
  if ((instr & 0xF000) === 0x5000) { // load/store with reg offset
    const op = (instr>>11)&1; const type=(instr>>10)&1; const ro=(instr>>6)&7; const rb=(instr>>3)&7; const rd=instr&7;
    const sz = ['str','strh','strb','ldsb','ldr','ldrh','ldrb','ldsh'][(op<<2)|(type<<1)|((instr>>9)&1)];
    return `${sz} r${rd}, [r${rb}, r${ro}]`;
  }
  if ((instr & 0xE000) === 0x6000) { // load/store with imm offset
    const op = (instr>>11)&1; const byte_=(instr>>12)&1;
    const off5 = (instr>>6)&31; const rb=(instr>>3)&7; const rd=instr&7;
    const scale = byte_ ? 1 : 4;
    return `${op?'ldr':'str'}${byte_?'b':''} r${rd}, [r${rb}, #${off5*scale}]`;
  }
  if ((instr & 0xF000) === 0x8000) { // LDRH/STRH
    const op=(instr>>11)&1; const off5=(instr>>6)&31; const rb=(instr>>3)&7; const rd=instr&7;
    return `${op?'ldrh':'strh'} r${rd}, [r${rb}, #${off5*2}]`;
  }
  if ((instr & 0xF000) === 0x9000) { // SP-relative
    const op=(instr>>11)&1; const rd=(instr>>8)&7; const off=(instr&0xFF)*4;
    return `${op?'ldr':'str'} r${rd}, [sp, #${off}]`;
  }
  if ((instr & 0xF000) === 0xa000) return `add r${(instr>>8)&7}, ${(instr>>11)&1?'sp':'pc'}, #${(instr&0xFF)*4}`;
  if ((instr & 0xFF00) === 0xb000) return `add sp, #${(instr&0x7F)*4}`;
  if ((instr & 0xFF00) === 0xb080) return `sub sp, #${(instr&0x7F)*4}`;
  if ((instr & 0xF000) === 0xb000) { // push/pop
    const op=(instr>>11)&1; const r=(instr>>8)&1; const rlist=instr&0xFF;
    return `${op?'pop':'push'} {${r?(op?'pc':'lr')+',':''}r0..r${7}}`;
  }
  if ((instr & 0xF000) === 0xc000) { // ldmia/stmia
    const op=(instr>>11)&1; const rb=(instr>>8)&7;
    return `${op?'ldmia':'stmia'} r${rb}!, {regs}`;
  }
  if ((instr & 0xFF00) === 0xdf00) return `swi #${instr&0xFF}`;
  if ((instr & 0xF000) === 0xd000) { // branch conditional
    const cond = (instr>>8)&0xF;
    const condStr = ['beq','bne','bcs','bcc','bmi','bpl','bvs','bvc','bhi','bls','bge','blt','bgt','ble'][cond];
    const off8 = ((instr&0xFF)<<24)>>24;
    return `${condStr} 0x${(addr+4+off8*2).toString(16)}`;
  }
  if ((instr & 0xF800) === 0xe000) { // B
    const off11 = ((instr&0x7FF)<<21)>>21;
    return `b 0x${(addr+4+off11*2).toString(16)}`;
  }
  if ((instr & 0xF800) === 0xf000) return `bl_hi (offset_high)`;
  if ((instr & 0xF800) === 0xf800) {
    const off = (instr & 0x7FF) << 1;
    return `bl_lo (offset_low=${off})`;
  }
  if ((instr & 0xFF87) === 0x4700) return `bx r${(instr>>3)&0xF}`;
  return `??? (0x${instr.toString(16).padStart(4,'0')})`;
}

function dumpRange(start: number, end: number, label: string) {
  console.log(`\n=== ${label} (0x${start.toString(16)} - 0x${end.toString(16)}) ===`);
  const keyAddrs = new Set([0x0800af16, 0x0800af1c, 0x0800af40, 0x0800af44, 0x0800af46, 
                             0x0800af72, 0x0800af74, 0x0800af78, 0x0800af7a,
                             0x0800b870, 0x0800b876, 0x0800b83c, 0x0800bae8]);
  for (let addr = start; addr < end; addr += 2) {
    const off = addr - ROM_BASE;
    if (off < 0 || off + 1 >= cart.length) break;
    const instr = u16(off);
    const mark = keyAddrs.has(addr) ? ' <<<' : '';
    console.log(`  0x${addr.toString(16).padStart(8,'0')}: ${instr.toString(16).padStart(4,'0')}  ${thumbDisasm(addr, instr)}${mark}`);
  }
}

// Dump the VBlank handler area
dumpRange(0x0800b830, 0x0800b900, 'VBlank handler (test display code)');

// Dump the toggle ISR area
dumpRange(0x0800aef0, 0x0800b000, 'Layer toggle ISR area');
