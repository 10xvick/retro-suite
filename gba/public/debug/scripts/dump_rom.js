const fs = require('fs');
const path = require('path');

const romPath = path.resolve('gba/public/suite.gba');
const buf = fs.readFileSync(romPath);

const startOffset = 0x6a00;
const endOffset = 0x6b50;

console.log("Dumping ROM offsets 0x6a00 to 0x6b50:");
for (let offset = startOffset; offset < endOffset; offset += 4) {
  const instr = buf.readUInt32LE(offset);
  const pc = 0x8000000 + offset;
  console.log(`0x${pc.toString(16).padStart(8, '0')}: 0x${instr.toString(16).padStart(8, '0')}`);
}
