import * as fs from 'fs';
import * as path from 'path';

const romPath = path.resolve('gba/public/roms/test/suite.gba');
const cart = new Uint8Array(fs.readFileSync(romPath));

// Category 13 video test table address in suite.gba
// Let's search for pointers to setup/render functions or search the ROM for Category 13 descriptor table
console.log("=== INSPECTING ROM DESCRIPTOR TABLE FOR CATEGORY 13 ===");

// Search for setup address 0x0800bc05 (bytes: 05 bc 00 08) or similar
for (let i = 0; i < cart.length - 16; i += 4) {
  const val = cart[i] | (cart[i+1] << 8) | (cart[i+2] << 16) | (cart[i+3] << 24);
  if (val === 0x0800bc05 || val === 0x0800ae55) {
    console.log(`Found pointer 0x${val.toString(16)} at ROM offset 0x${i.toString(16)} (0x${(0x08000000 + i).toString(16)})`);
    // Print surrounding 32 bytes
    for (let j = -16; j <= 16; j += 4) {
      const p = cart[i+j] | (cart[i+j+1] << 8) | (cart[i+j+2] << 16) | (cart[i+j+3] << 24);
      console.log(`  [0x${(0x08000000 + i + j).toString(16)}]: 0x${p.toString(16)}`);
    }
  }
}
