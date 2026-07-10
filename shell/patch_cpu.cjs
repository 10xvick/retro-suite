const fs = require('fs');
let code = fs.readFileSync('src/emulator/core/CPU.ts', 'utf8');

// find public pc = 0; and add public pcHistory: number[] = []; public pcHistoryIdx = 0;
code = code.replace('public pc: number = 0;', 'public pc: number = 0;\n  public pcHistory: number[] = new Array(100).fill(0);\n  public pcHistoryIdx: number = 0;');

// find public step(): number { and add to history
code = code.replace('public step(): number {', 'public step(): number {\n    this.pcHistory[this.pcHistoryIdx] = this.pc;\n    this.pcHistoryIdx = (this.pcHistoryIdx + 1) % 100;');

fs.writeFileSync('src/emulator/core/CPU.ts', code);
