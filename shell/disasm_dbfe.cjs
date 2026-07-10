const fs = require('fs');
const romData = fs.readFileSync('public/sample.sfc');
// LoROM offset for BF:DBFE = (0x3F * 0x8000) + 0x5BFE
const offset = (0x3F * 0x8000) + (0xDBFE & 0x7FFF);
const bytes = romData.slice(offset, offset + 100);
console.log(bytes.toString('hex').match(/.{1,2}/g).join(' '));
