const fs = require('fs');
const romData = fs.readFileSync('public/sample.sfc');
// LoROM offset for BF:DBCD = (0x3F * 0x8000) + 0x5BCD
const offset = (0x3F * 0x8000) + (0xDBCD & 0x7FFF);
const bytes = romData.slice(offset, offset + 10);
console.log(bytes.toString('hex').match(/.{1,2}/g).join(' '));
