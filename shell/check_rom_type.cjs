const fs = require('fs');

const romData = fs.readFileSync('public/sample.sfc');
const hasHeader = romData.length % 1024 === 512;
const offset = hasHeader ? 512 : 0;

// LoROM header is at 0x7FC0
// HiROM header is at 0xFFC0
const loromCheck = romData.slice(offset + 0x7FDC, offset + 0x7FE0);
const hiromCheck = romData.slice(offset + 0xFFDC, offset + 0xFFE0);
console.log('LoROM Inverse Checksum:', loromCheck.toString('hex'));
console.log('HiROM Inverse Checksum:', hiromCheck.toString('hex'));
