import { readFileSync } from 'fs';

try {
  const romPath = '/Users/vishalsingh/Downloads/Jungle Book, The (USA).sfc';
  const file = readFileSync(romPath);
  console.log('ROM File Size:', file.length);
  
  // Dump first 32 bytes
  const first32 = Array.from(file.slice(0, 32)).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  console.log('First 32 bytes:', first32);

  // Read Reset vector from $7FFC-$7FFD (LoROM)
  const resetLo = file[0x7FFC] | (file[0x7FFD] << 8);
  console.log('LoROM Reset vector (at 0x7FFC):', resetLo.toString(16).toUpperCase());

  // Read Reset vector from $FFFC-$FFFD (HiROM)
  const resetHi = file[0xFFFC] | (file[0xFFFD] << 8);
  console.log('HiROM Reset vector (at 0xFFFC):', resetHi.toString(16).toUpperCase());

} catch (err) {
  console.error('Error reading ROM:', err);
}
