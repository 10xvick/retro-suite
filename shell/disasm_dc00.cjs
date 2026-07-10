const fs = require('fs');
const romData = fs.readFileSync('public/sample.sfc');
// LoROM offset for BF:DC00 = (0x3F * 0x8000) + 0x5C00
const offset = (0x3F * 0x8000) + (0xDC00 & 0x7FFF);
const bytes = romData.slice(offset, offset + 100);
console.log(bytes.toString('hex').match(/.{1,2}/g).join(' '));
