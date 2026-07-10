const opcodes = {
  0xfa: 'MOV dp,dp', 0x69: 'CMP dp,dp', 0xd0: 'BNE rel', 0x2e: 'CBNE dp,rel',
  0xf5: 'MOV A,abs+X', 0xe4: 'MOV A,dp', 0xd8: 'MOV dp,X', 0xf4: 'MOV A,abs+X', 0xd5: 'MOV abs+X,A',
  0x40: 'SET1 dp', 0x85: 'MOV dp,A', 0x7d: 'MOV A,X', 0x3d: 'INC X', 0x02: 'SET0 dp', 0xab: 'INC dp',
  0x3e: 'CMP X,dp', 0x64: 'CMP A,dp', 0xf0: 'BEQ rel', 0xbe: 'DAS', 0x2f: 'BRA rel', 0xe1: 'TCALL 1'
  // just guessing some, but I will read Spc700.ts to get the exact ones!
};
const fs = require('fs');
const spcCode = fs.readFileSync('src/emulator/audio/Spc700.ts', 'utf8');
const lines = spcCode.split('\n');
const table = {};
// let's just find the switch statement cases and length.
