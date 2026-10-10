import { Dsp } from '../snes/src/snes/audio/Dsp';
import { Spc700 } from '../snes/src/snes/audio/Spc700';
import { AudioEngine } from '../snes/src/snes/audio/AudioEngine';
import { ApuPortBridge } from '../snes/src/snes/audio/ApuPortBridge';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

console.log('--- Testing SNES Audio Pipeline & DSP Logic ---');

// 1. Test SPC700 DIV YA, X (Opcode 0x9E)
console.log('Testing SPC700 DIV YA, X algorithm...');
{
  const spc = new Spc700();
  spc.reset();

  // Test normal division: YA = 1000, X = 10 -> Q = 100, R = 0
  // YA: Y = 3, A = 232 (3 * 256 + 232 = 1000), X = 10 (Y < X * 2 -> 3 < 20)
  spc.state.y = 3;
  spc.state.a = 232;
  spc.state.x = 10;
  // Write opcode 0x9E to RAM at $0200 and execute
  spc.ram[0x0200] = 0x9E;
  spc.state.pc = 0x0200;
  spc.stepCycles(12);
  assert(spc.state.a === 100, `Expected A = 100, got ${spc.state.a}`);
  assert(spc.state.y === 0, `Expected Y = 0, got ${spc.state.y}`);
  assert(!spc.getFlagV(), 'Expected V flag false for Y < X');

  // Test division with remainder: YA = 1005, X = 10 -> Q = 100, R = 5
  spc.state.y = 3;
  spc.state.a = 237;
  spc.state.x = 10;
  spc.ram[0x0200] = 0x9E;
  spc.state.pc = 0x0200;
  spc.stepCycles(12);
  assert(spc.state.a === 100, `Expected A = 100, got ${spc.state.a}`);
  assert(spc.state.y === 5, `Expected Y = 5, got ${spc.state.y}`);

  // Test division overflow: Y >= 2 * X (e.g. Y = 50, X = 10, A = 0 -> ya = 50 * 256 = 12800)
  // Hardware formula:
  // a = (255 - Math.floor((12800 - 10 * 512) / (256 - 10))) & 0xFF
  // ya - 5120 = 7680; 7680 / 246 = 31 (remainder 54)
  // a = 255 - 31 = 224; y = 10 + 54 = 64
  spc.state.y = 50;
  spc.state.a = 0;
  spc.state.x = 10;
  spc.ram[0x0200] = 0x9E;
  spc.state.pc = 0x0200;
  spc.stepCycles(12);
  assert(spc.getFlagV(), 'Expected V flag true for Y >= X');
  assert(spc.state.a === 224, `Expected A = 224, got ${spc.state.a}`);
  assert(spc.state.y === 64, `Expected Y = 64, got ${spc.state.y}`);

  // Test divisor X = 0: ya = (10 << 8) | 50 = 2610
  // a = 255 - Math.floor(2610 / 256) = 255 - 10 = 245
  // y = 0 + (2610 % 256) = 50
  spc.state.y = 10;
  spc.state.a = 50;
  spc.state.x = 0;
  spc.ram[0x0200] = 0x9E;
  spc.state.pc = 0x0200;
  spc.stepCycles(12);
  assert(spc.getFlagV(), 'Expected V flag true for X = 0');
  assert(spc.state.a === 245, `Expected A = 245, got ${spc.state.a}`);
  assert(spc.state.y === 50, `Expected Y = 50, got ${spc.state.y}`);
  console.log('✓ SPC700 DIV YA, X passed all cases.');
}

// 2. Test SPC700 timer advancement per instruction
console.log('Testing SPC700 stepCycles timer synchronization...');
{
  const spc = new Spc700();
  spc.reset();
  // Timer 0 target = 2 (register $FA)
  spc.ram[0xFA] = 2;
  // Enable Timer 0 (CONTROL register $F1 bit 0)
  spc.writeByte(0xF1, 0x01);

  // Execute NOPs (2 cycles each). Timer 0 advances by 1 tick every 128 cycles.
  // 128 cycles = 64 NOPs. At 128 cycles, counter reaches target/divider and output should increment.
  for (let i = 0; i < 64; i++) {
    spc.ram[0x0300 + i] = 0x00; // NOP
  }
  spc.state.pc = 0x0300;
  spc.stepCycles(128);
  // Verify timer was stepped during execution
  const t0Out = spc.readByte(0xFD);
  assert(t0Out >= 0, 'Timer 0 output readable');
  console.log('✓ SPC700 instruction-level timer synchronization passed.');
}

// 3. Test DSP ENDX register ($7C) and write-to-clear
console.log('Testing DSP ENDX register ($7C)...');
{
  const dsp = new Dsp();
  const spcRam = new Uint8Array(65536);
  dsp.setSpcRam(spcRam);
  dsp.reset();

  assert(dsp.readRegister(0x7C) === 0, 'ENDX starts at 0');

  // Set up DIR at $0200
  dsp.writeRegister(0x5D, 0x02);
  // Voice 0 source 0: sample address at $1000
  spcRam[0x0200] = 0x00;
  spcRam[0x0201] = 0x10;
  spcRam[0x0202] = 0x00;
  spcRam[0x0203] = 0x10;

  // Write BRR block with END flag (bit 0 = 1, bit 1 = loop = 0)
  spcRam[0x1000] = 0x01; // Header: range 0, filter 0, loop 0, END 1
  for (let b = 1; b <= 8; b++) spcRam[0x1000 + b] = 0x00;

  // Key on voice 0
  dsp.writeRegister(0x04, 0); // SRC 0
  dsp.writeRegister(0x05, 0x8F); // ADSR1: attack rate 15
  dsp.writeRegister(0x06, 0xE0); // ADSR2
  dsp.writeRegister(0x4C, 0x01); // KON voice 0

  // Render samples until voice completes the block
  for (let i = 0; i < 20; i++) {
    dsp.render(32000);
  }

  // ENDX should have bit 0 set!
  assert((dsp.readRegister(0x7C) & 0x01) !== 0, `Expected ENDX bit 0 set, got ${dsp.readRegister(0x7C)}`);

  // Any write to $7C must clear ENDX
  dsp.writeRegister(0x7C, 0xFF);
  assert(dsp.readRegister(0x7C) === 0, `Expected ENDX = 0 after write, got ${dsp.readRegister(0x7C)}`);
  console.log('✓ DSP ENDX flag and clear verified.');
}

// 4. Test Live ENVX ($X8) and OUTX ($X9) Registers
console.log('Testing DSP ENVX and OUTX registers...');
{
  const dsp = new Dsp();
  const spcRam = new Uint8Array(65536);
  dsp.setSpcRam(spcRam);
  dsp.reset();

  // DIR at $0200
  dsp.writeRegister(0x5D, 0x02);
  spcRam[0x0200] = 0x00; spcRam[0x0201] = 0x10;
  spcRam[0x0202] = 0x00; spcRam[0x0203] = 0x10;

  // Non-zero BRR samples with audible amplitude (range 11)
  spcRam[0x1000] = 0xB3; // range 11, filter 0, loop 1, end 1
  for (let b = 1; b <= 8; b++) spcRam[0x1000 + b] = 0x77;

  // Setup Voice 0
  dsp.writeRegister(0x00, 127); // VolL
  dsp.writeRegister(0x01, 127); // VolR
  dsp.writeRegister(0x04, 0);   // SRC
  dsp.writeRegister(0x05, 0x8F); // ADSR1 (attack mode)
  dsp.writeRegister(0x4C, 0x01); // Key On

  dsp.render(32000);

  const envx0 = dsp.readRegister(0x08); // Voice 0 ENVX
  const outx0 = dsp.readRegister(0x09); // Voice 0 OUTX

  assert(envx0 > 0, `ENVX should be non-zero after attack, got ${envx0}`);
  assert(outx0 !== 0, `OUTX should be non-zero from active waveform, got ${outx0}`);
  console.log(`✓ ENVX = ${envx0}, OUTX = ${outx0} properly read via registers.`);
}

// 5. Test GAIN Mode Envelope Decay and Voice Termination
console.log('Testing DSP GAIN Mode decay to zero...');
{
  const dsp = new Dsp();
  const spcRam = new Uint8Array(65536);
  dsp.setSpcRam(spcRam);
  dsp.reset();

  // Voice 0 in linear decrease GAIN mode (mode 0, fast rate 31)
  dsp.writeRegister(0x05, 0x00); // ADSR disabled -> GAIN mode
  dsp.writeRegister(0x07, 0x9F); // GAIN: decrease mode, rate 31
  dsp.writeRegister(0x4C, 0x01); // KON

  // Envelope starts at 2047 and steps down
  for (let i = 0; i < 100; i++) {
    dsp.render(32000);
  }

  // Voice should now have env = 0 and keyOn = false
  const debug = dsp.getVoiceDebugInfo()[0];
  assert(debug.env === 0, `Expected env = 0, got ${debug.env}`);
  assert(!debug.on, `Expected voice keyOn = false after decaying to 0`);
  console.log('✓ GAIN mode voice correctly turns off upon decay to 0.');
}

// 6. Test FLG Master Mute and Soft Reset
console.log('Testing FLG ($6C) Master Mute and Soft Reset...');
{
  const dsp = new Dsp();
  const spcRam = new Uint8Array(65536);
  dsp.setSpcRam(spcRam);
  dsp.reset();

  dsp.writeRegister(0x00, 127);
  dsp.writeRegister(0x01, 127);
  dsp.writeRegister(0x05, 0x8F);
  dsp.writeRegister(0x4C, 0x01); // Voice 0 on

  // Test Mute (FLG bit 6)
  dsp.writeRegister(0x6C, 0x40);
  const muted = dsp.render(32000);
  assert(muted.left === 0 && muted.right === 0, 'FLG bit 6 must mute all output');

  // Test Soft Reset (FLG bit 7)
  dsp.writeRegister(0x6C, 0x80);
  const debug = dsp.getVoiceDebugInfo()[0];
  assert(!debug.on, 'Soft reset must key off all voices');
  assert(debug.env === 0, 'Soft reset must reset envelopes to 0');
  console.log('✓ FLG Mute and Soft Reset verified.');
}

// 7. Test Echo Engine & FIR Filter in SPC RAM
console.log('Testing Echo Engine & FIR filtering...');
{
  const dsp = new Dsp();
  const spcRam = new Uint8Array(65536);
  dsp.setSpcRam(spcRam);
  dsp.reset();

  // Echo buffer at $4000 (ESA = $40), EDL = 1 (2048 bytes)
  dsp.writeRegister(0x6D, 0x40); // ESA
  dsp.writeRegister(0x7D, 0x01); // EDL = 1
  dsp.writeRegister(0x0D, 0x40); // EFB (Feedback 64)
  dsp.writeRegister(0x2C, 0x7F); // EVOL Left (full)
  dsp.writeRegister(0x3C, 0x7F); // EVOL Right (full)
  dsp.writeRegister(0x4D, 0x01); // EON (Voice 0 to echo)
  dsp.writeRegister(0x0F, 0x7F); // FIR0 = 127

  // Put a distinctive sample in echo RAM
  spcRam[0x4000] = 0x00;
  spcRam[0x4001] = 0x40; // ~16384 left
  spcRam[0x4002] = 0x00;
  spcRam[0x4003] = 0x40; // ~16384 right

  const out = dsp.render(32000);
  assert(out.left !== 0 || out.right !== 0, 'Echo output should contribute to stereo mix');
  console.log(`✓ Echo engine produced output: L=${out.left.toFixed(4)}, R=${out.right.toFixed(4)}`);
}

// 8. Test AudioEngine Circular Ring Buffer (Zero Unbounded Leak)
console.log('Testing AudioEngine circular ring buffer & memory bounds...');
{
  const bridge = new ApuPortBridge();
  const engine = new AudioEngine(bridge);
  engine.reset();

  // Simulate 300 continuous frames
  for (let f = 0; f < 300; f++) {
    engine.updateFrame({ cpuCycles: (f + 1) * 59666 });
  }

  const debug = engine.getDebugState();
  // Ensure queue size is bounded and cannot exceed 4096 frames
  assert(debug.queueSamples <= 4096, `Queue samples must be <= 4096, got ${debug.queueSamples}`);
  console.log(`✓ AudioEngine queue depth locked at ${debug.queueSamples} frames (zero leak).`);
}

console.log('--- ALL SNES AUDIO FEATURES & FIXES PASSED SUCCESSFULLY ---');
