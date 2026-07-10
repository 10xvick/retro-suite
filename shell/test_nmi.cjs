const fs = require('fs');
const rom = fs.readFileSync('public/sample.sfc');
// LoROM offset
const start = 0x8C5C - 0x8000;
const bytes = rom.slice(start, start + 0xA0);
console.log(bytes.toString('hex').match(/.{1,2}/g).join(' '));
