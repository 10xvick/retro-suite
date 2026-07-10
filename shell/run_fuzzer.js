import fs from 'fs';
import { execSync } from 'child_process';

// We need to compile Spc700.ts first
execSync('npx tsc src/emulator/audio/Spc700.ts --esModuleInterop --skipLibCheck --module NodeNext --target ES2022', {stdio: 'inherit'});

console.log('Compiled Spc700.ts!');
