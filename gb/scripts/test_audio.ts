// Generate a WAV file from the APU output to verify audio is correct.
// This bypasses the browser entirely and tests the APU directly.

import { GameBoy } from "../src/gb/gameboy";
import * as fs from "fs";
import * as path from "path";

const romPath = process.argv[2] || "/home/z/my-project/upload/Spider-Man 2 - The Sinister Six (USA, Europe).gbc";
const outputPath = process.argv[3] || "/home/z/my-project/download/audio_test.wav";
const frames = parseInt(process.argv[4] || "600");

const rom = new Uint8Array(fs.readFileSync(romPath));
const gb = new GameBoy({});
gb.loadRom(rom);

// Collect all samples
const allSamples: number[] = [];

let maxAmplitude = 0;
let nonzeroSamples = 0;
let totalSamples = 0;

// Run frames, collecting samples
for (let f = 0; f < frames; f++) {
  gb.runFrame();
  const apu: any = gb.apu;
  // Drain the buffer
  const buf = new Float32Array(4096);
  const read = apu.readSamples(buf, 4096);
  for (let i = 0; i < read; i++) {
    allSamples.push(buf[i]);
    if (Math.abs(buf[i]) > maxAmplitude) maxAmplitude = Math.abs(buf[i]);
    if (buf[i] !== 0) nonzeroSamples++;
    totalSamples++;
  }
}

console.log(`Ran ${frames} frames`);
console.log(`Total samples collected: ${totalSamples}`);
console.log(`Non-zero samples: ${nonzeroSamples} (${(nonzeroSamples * 100 / totalSamples).toFixed(1)}%)`);
console.log(`Max amplitude: ${maxAmplitude.toFixed(4)}`);

// Write WAV file (16-bit PCM, stereo, 32768 Hz)
const sampleRate = 32768;
const numChannels = 2;
const bitsPerSample = 16;
const byteRate = sampleRate * numChannels * bitsPerSample / 8;
const blockAlign = numChannels * bitsPerSample / 8;
const dataSize = allSamples.length * 2;  // 2 bytes per sample
const fileSize = 44 + dataSize;

const buffer = Buffer.alloc(44 + dataSize);

// RIFF header
buffer.write("RIFF", 0);
buffer.writeUInt32LE(fileSize - 8, 4);
buffer.write("WAVE", 8);

// fmt chunk
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);  // chunk size
buffer.writeUInt16LE(1, 20);   // PCM format
buffer.writeUInt16LE(numChannels, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(byteRate, 28);
buffer.writeUInt16LE(blockAlign, 32);
buffer.writeUInt16LE(bitsPerSample, 34);

// data chunk
buffer.write("data", 36);
buffer.writeUInt32LE(dataSize, 40);

// Write samples (convert float [-1, 1] to int16)
let offset = 44;
for (const sample of allSamples) {
  const clamped = Math.max(-1, Math.min(1, sample));
  const int16 = Math.round(clamped * 32767);
  buffer.writeInt16LE(int16, offset);
  offset += 2;
}

fs.writeFileSync(outputPath, buffer);
console.log(`\nWAV file written: ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
console.log(`Duration: ${(allSamples.length / 2 / sampleRate).toFixed(2)} seconds`);

// Analyze frequency content (simple zero-crossing rate)
let zeroCrossings = 0;
for (let i = 1; i < allSamples.length; i += 2) {  // left channel only
  if ((allSamples[i - 2] >= 0) !== (allSamples[i] >= 0)) {
    zeroCrossings++;
  }
}
const zcr = zeroCrossings / (allSamples.length / 2) * sampleRate / 2;
console.log(`Estimated frequency (zero-crossing): ${zcr.toFixed(0)} Hz`);

// Show APU state
const apu: any = gb.apu;
console.log(`\nAPU state:`);
console.log(`  Sound on: ${apu.soundOn}`);
console.log(`  NR50 (master vol): 0x${apu.nr50.toString(16)}`);
console.log(`  NR51 (channel map): 0x${apu.nr51.toString(16)}`);
console.log(`  Ch1: active=${apu.ch1.active} vol=${apu.ch1.envVolume} dac=${apu.ch1.dacEnabled}`);
console.log(`  Ch2: active=${apu.ch2.active} vol=${apu.ch2.envVolume} dac=${apu.ch2.dacEnabled}`);
console.log(`  Ch3: active=${apu.ch3.active} dac=${apu.ch3.dacEnabled}`);
console.log(`  Ch4: active=${apu.ch4.active} vol=${apu.ch4.envVolume} dac=${apu.ch4.dacEnabled}`);
