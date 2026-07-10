const disasm = "78 5c 61 8c 80 08 c2 30 48 da 5a 8b a9 00 00 9b 54 80 80 e2 20 ad 3f 21 ad 10 42 ad 0f 01 29 ff f0 03 4c 8b e1 a9 80 8d 00 21 20 4f bb ad 6e 07 c9 02 f0 15 ad 80 1c d0 10 22 e0 d0 81 20 75 b8 20 f6 b8 20 68 b6 20 c8 b6 a2 08 00 8e 09 42 a2 dc 00 8e 07 42 ad 1b 1e 8d 2c 21 ad 39 0a 8d 0d 21 ad 3a 0a 8d 0d 21 ad 3b 0a 8d 0e 21 ad 3c 0a 8d 0e 21 ad 43 0a 8d 10 21 9c 10 21 ad 4f 01 c9 05 d0 1b ad 39 0a 8d 41 0a ad 3a 0a 8d 42 0a ad dc 07 38 e9 12 8d dc 07 8d 10 21 9c 10 21 ad 41".split(' ');
let bytes = disasm.map(h => parseInt(h, 16));
let i = 0;
let pc = 0x8C5C;
const ops = {
  0x78: 'SEI', 0x5C: 'JMP long', 0x08: 'PHP', 0xC2: 'REP', 0x48: 'PHA', 0xDA: 'PHX', 0x5A: 'PHY', 0x8B: 'PHB',
  0xA9: 'LDA imm', 0x9B: 'TXY', 0x54: 'MVN', 0xE2: 'SEP', 0xAD: 'LDA abs', 0x29: 'AND imm', 0xF0: 'BEQ', 0x4C: 'JMP abs',
  0x8D: 'STA abs', 0x20: 'JSR abs', 0xC9: 'CMP imm', 0xD0: 'BNE', 0x22: 'JSL', 0xE0: 'CPX imm', 0xA2: 'LDX imm', 0x8E: 'STX abs',
  0x9C: 'STZ abs', 0x38: 'SEC', 0xE9: 'SBC imm'
};
// I won't decode everything perfectly but just to see if there's a PLA
for (let j=0; j<bytes.length; j++) {
  if (bytes[j] === 0x68) console.log('Found PLA (68) at offset', j, 'PC=', (pc+j).toString(16));
  if (bytes[j] === 0xFA) console.log('Found PLX (FA) at offset', j, 'PC=', (pc+j).toString(16));
  if (bytes[j] === 0x7A) console.log('Found PLY (7A) at offset', j, 'PC=', (pc+j).toString(16));
  if (bytes[j] === 0xAB) console.log('Found PLB (AB) at offset', j, 'PC=', (pc+j).toString(16));
  if (bytes[j] === 0x28) console.log('Found PLP (28) at offset', j, 'PC=', (pc+j).toString(16));
  if (bytes[j] === 0x40) console.log('Found RTI (40) at offset', j, 'PC=', (pc+j).toString(16));
}
