import * as fs from 'fs';

const readCleanLines = (filepath: string): string[] => {
  const content = fs.readFileSync(filepath, 'utf8');
  const isUtf16 = content.includes('\u0000');
  const actualContent = isUtf16 ? fs.readFileSync(filepath, 'utf16le') : content;
  
  return actualContent.split('\n').map(line => {
    line = line.trim();
    const idx = line.indexOf(' (raw=');
    if (idx !== -1) {
      line = line.substring(0, idx).trim();
    }
    return line;
  }).filter(line => line.startsWith('SIO Read:') || line.startsWith('SIO Write:'));
};

const baseline = readCleanLines('my_sio_test_baseline.log');
const current = readCleanLines('my_sio_test_current.log');

console.log(`Baseline SIO events: ${baseline.length}`);
console.log(`Current SIO events: ${current.length}`);

const len = Math.max(baseline.length, current.length);
let diffs = 0;
for (let i = 0; i < len; i++) {
  const b = baseline[i] || '';
  const c = current[i] || '';
  if (b !== c) {
    console.log(`Event ${i + 1}:`);
    console.log(`  B: ${b}`);
    console.log(`  C: ${c}`);
    diffs++;
    if (diffs >= 50) {
      console.log('Stopping after 50 diffs.');
      break;
    }
  }
}
if (diffs === 0) {
  console.log('NO DIFFERENCES FOUND!');
}
