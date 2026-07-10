// Test audio by directly programming DSP with a simple square wave

// This test generates a 440Hz square wave (A note) to verify the audio pipeline works
function testAudioOutput() {
  const emulator = window._emulator;
  if (!emulator) {
    console.error('No emulator found');
    return;
  }

  const apu = emulator.audio.apu;
  if (!apu) {
    console.error('No APU found');
    return;
  }

  const dsp = apu.dsp;
  const spc700 = apu.spc700;
  const ram = spc700.getRam();

  console.log('=== Audio System Test ===');
  console.log('Uploading test BRR sample to SPC700 RAM...');

  // Create a simple BRR sample (square wave)
  // BRR format: 1 header byte + 8 data bytes = 9 bytes per block
  // Each block decodes to 16 samples
  
  // Simple square wave: alternating +127 and -128 (max amplitude)
  const sampleAddr = 0x0400; // Put sample at 0x0400
  
  // BRR header: range=12 (max), filter=0, loop=1, end=1
  // 0xCE = 11001110 = range 12, filter 0, loop, end
  ram[sampleAddr] = 0xCE;
  
  // Data bytes: alternating high/low nibbles for square wave
  // Nibble value 7 = max positive, 8 = max negative in 4-bit signed
  ram[sampleAddr + 1] = 0x77; // +7, +7
  ram[sampleAddr + 2] = 0x77; // +7, +7  
  ram[sampleAddr + 3] = 0x88; // -8, -8
  ram[sampleAddr + 4] = 0x88; // -8, -8
  ram[sampleAddr + 5] = 0x77; // +7, +7
  ram[sampleAddr + 6] = 0x77; // +7, +7
  ram[sampleAddr + 7] = 0x88; // -8, -8
  ram[sampleAddr + 8] = 0x88; // -8, -8

  // Set up sample directory (DIR) at page 0x02 (0x0200)
  dsp.writeRegister(0x5D, 0x02);
  
  // Directory entry 0: start and loop both point to our sample
  ram[0x0200] = sampleAddr & 0xFF;
  ram[0x0201] = (sampleAddr >> 8) & 0xFF;
  ram[0x0202] = sampleAddr & 0xFF; // Loop address (same as start)
  ram[0x0203] = (sampleAddr >> 8) & 0xFF;

  console.log(`Sample uploaded to 0x${sampleAddr.toString(16)}`);
  console.log('Configuring DSP voice 0...');

  // Configure Voice 0
  dsp.writeRegister(0x00, 127);  // V0VOLL - Left volume (max)
  dsp.writeRegister(0x01, 127);  // V0VOLR - Right volume (max)
  
  // Pitch for 440Hz: pitch = (440 * 4096) / 32000 ≈ 0x0384
  dsp.writeRegister(0x02, 0x84);  // V0PITCHL - Pitch low byte
  dsp.writeRegister(0x03, 0x03);  // V0PITCHH - Pitch high byte
  
  dsp.writeRegister(0x04, 0);    // V0SRCN - Source number 0
  dsp.writeRegister(0x05, 0xFF); // V0ADSR1 - Fast attack, max decay
  dsp.writeRegister(0x06, 0xE0); // V0ADSR2 - Full sustain
  dsp.writeRegister(0x07, 0x00); // V0GAIN - Use ADSR

  // Set master volume
  dsp.writeRegister(0x0C, 100);  // MVOLL - Master volume left
  dsp.writeRegister(0x1C, 100);  // MVOLR - Master volume right

  // Key on voice 0
  console.log('Keying on voice 0...');
  dsp.writeRegister(0x4C, 0x01);  // KON - Key on voice 0

  console.log('✓ Test tone should now be playing at 440Hz');
  console.log('Audio pipeline: BRR sample → DSP voice → AudioWorklet → speakers');
  
  // Check status after a moment
  setTimeout(() => {
    const audioDebug = emulator.getAudioDebugState();
    console.log('\nAudio Status:');
    console.log(`  Queue: ${audioDebug.queueChunks} chunks, ${audioDebug.queueSamples} samples`);
    console.log(`  RMS L: ${audioDebug.rmsL.toFixed(6)}, R: ${audioDebug.rmsR.toFixed(6)}`);
    
    const kon = dsp.readRegister(0x4C);
    console.log(`  DSP KON: 0x${kon.toString(16).padStart(2, '0')}`);
    
    if (audioDebug.rmsL > 0.001 || audioDebug.rmsR > 0.001) {
      console.log('✓✓✓ SUCCESS! Audio is working! You should hear a 440Hz tone.');
    } else {
      console.log('⚠ RMS still zero - checking voice state...');
    }
  }, 1000);
  
  return 'Test initiated - check console for results';
}

// Run the test
console.log('Running audio test...');
testAudioOutput();
