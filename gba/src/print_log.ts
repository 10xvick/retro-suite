import * as fs from 'fs';

const content = fs.readFileSync('my_sio_test_baseline.log', 'utf8');
const isUtf16 = content.includes('\u0000');
const actual = isUtf16 ? fs.readFileSync('my_sio_test_baseline.log', 'utf16le') : content;

const lines = actual.split('\n');
for (let i = 240; i < Math.min(lines.length, 265); i++) {
  console.log(`${i + 1}: ${lines[i].trim()}`);
}
