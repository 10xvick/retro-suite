// Audio Processing Unit (APU) - emulates the Game Boy's 4 sound channels.
//
// Channels:
//   1. Square wave with frequency sweep
//   2. Square wave (no sweep)
//   3. Custom wave (4-bit, 32 samples)
//   4. White noise (LFSR-based)
//
// The APU runs at the CPU clock rate (~4.19 MHz). A frame sequencer at
// 512 Hz clocks length, envelope, and sweep updates.
//
// Sound output is generated as a stream of stereo float samples [-1, 1],
// accumulated in a ring buffer. The browser's Web Audio API pulls from
// this buffer via a ScriptProcessorNode.
//
// Register reference:
//   NR10-NR14 (0xFF10-0xFF14): Channel 1 (square + sweep)
//   NR21-NR24 (0xFF16-0xFF19): Channel 2 (square)
//   NR30-NR34 (0xFF1A-0xFF1E): Channel 3 (wave)
//   NR41-NR44 (0xFF20-0xFF23): Channel 4 (noise)
//   NR50 (0xFF24): Master volume + VIN
//   NR51 (0xFF25): Channel output mapping (left/right)
//   NR52 (0xFF26): Sound on/off + channel status
//   0xFF30-0xFF3F: Wave RAM (32 x 4-bit samples)

export class APU {
  // Master enable
  soundOn: boolean = false;

  // NR50 - master volume (bits 0-2 = right vol, bits 4-6 = left vol)
  nr50: number = 0x00;
  // NR51 - output select (each channel has left/right enable bits)
  nr51: number = 0x00;

  // ---- Channel 1: Square wave with sweep ----
  ch1: SquareChannel = new SquareChannel();

  // ---- Channel 2: Square wave (no sweep) ----
  ch2: SquareChannel = new SquareChannel();

  // ---- Channel 3: Wave ----
  ch3: WaveChannel = new WaveChannel();

  // ---- Channel 4: Noise ----
  ch4: NoiseChannel = new NoiseChannel();

  // Wave RAM (32 x 4-bit samples, stored in 16 bytes)
  waveRam: Uint8Array = new Uint8Array(0x10);

  // Frame sequencer - clocks at 512 Hz (every 8192 T-cycles = 2048 M-cycles)
  // Steps cycle through: length (256Hz), length+sweep (128Hz), length (64Hz), length+envelope
  private frameSeqCounter: number = 0;
  private frameSeqStep: number = 0;

  // Sample buffer - stereo interleaved (L, R, L, R, ...)
  // Sample rate: we generate 1 sample per ~795 M-cycles (4.19MHz / 5274 ≈ 795)
  // which gives ~5274 samples/sec. The Web Audio API runs at 44100 Hz,
  // so we resample.
  static readonly SAMPLE_RATE = 32768;
  private sampleAccumulator: number = 0;
  private cyclesPerSample: number;

  // Ring buffer of generated samples (stereo interleaved)
  sampleBuffer: Float32Array = new Float32Array(APU.SAMPLE_RATE * 2); // 1 second buffer
  private bufferWritePos: number = 0;
  private bufferReadPos: number = 0;
  bufferSize: number = 0;

  // CGB double-speed mode (when true, APU runs at 2x speed)
  doubleSpeed: boolean = false;
  private apuCycleAccumulator: number = 0;

  constructor() {
    // cyclesPerSample is in M-cycles (the unit used by the accumulator).
    // CPU clock = 4,194,304 T-cycles/sec = 1,048,576 M-cycles/sec.
    // Sample rate = 32768 Hz -> 1048576 / 32768 = 32 M-cycles per sample.
    this.cyclesPerSample = 1048576 / APU.SAMPLE_RATE; // = 32 M-cycles
  }

  reset() {
    this.soundOn = false;
    this.nr50 = 0x00;
    this.nr51 = 0x00;
    this.ch1.reset();
    this.ch2.reset();
    this.ch3.reset();
    this.ch4.reset();
    this.waveRam.fill(0);
    this.frameSeqCounter = 0;
    this.frameSeqStep = 0;
    this.sampleAccumulator = 0;
    this.bufferWritePos = 0;
    this.bufferReadPos = 0;
    this.bufferSize = 0;
  }

  // Read a sound register
  read(addr: number): number {
    switch (addr) {
      case 0xFF10: return this.ch1.nrx0 | 0x80;
      case 0xFF11: return this.ch1.nrx1 | 0x3F;
      case 0xFF12: return this.ch1.nrx2;
      case 0xFF13: return 0xFF;
      case 0xFF14: return this.ch1.nrx4 | 0xBF;

      case 0xFF16: return this.ch2.nrx1 | 0x3F;
      case 0xFF17: return this.ch2.nrx2;
      case 0xFF18: return 0xFF;
      case 0xFF19: return this.ch2.nrx4 | 0xBF;

      case 0xFF1A: return (this.ch3.nrx0 & 0x80) | 0x7F;
      case 0xFF1B: return 0xFF;
      case 0xFF1C: return this.ch3.nrx2 | 0x9F;
      case 0xFF1D: return 0xFF;
      case 0xFF1E: return this.ch3.nrx4 | 0xBF;

      case 0xFF20: return 0xFF;
      case 0xFF21: return this.ch4.nrx2;
      case 0xFF22: return this.ch4.nrx3;
      case 0xFF23: return this.ch4.nrx4 | 0xBF;

      case 0xFF24: return this.nr50;
      case 0xFF25: return this.nr51;
      case 0xFF26: {
        let status = this.soundOn ? 0x80 : 0x00;
        if (this.soundOn) {
          if (this.ch1.active) status |= 0x01;
          if (this.ch2.active) status |= 0x02;
          if (this.ch3.active) status |= 0x04;
          if (this.ch4.active) status |= 0x08;
        }
        return status | 0x70;
      }

      case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33:
      case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
      case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B:
      case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
        return this.waveRam[addr - 0xFF30];

      default:
        return 0xFF;
    }
  }

  write(addr: number, value: number) {
    value &= 0xFF;

    // If sound is off (NR52 bit 7 = 0), only NR52 and wave RAM can be written
    if (!this.soundOn && addr !== 0xFF26 && !(addr >= 0xFF30 && addr <= 0xFF3F)) {
      // On DMG, length registers can still be written when sound is off
      // but other registers are locked. We allow all writes for simplicity.
    }

    switch (addr) {
      case 0xFF10: this.ch1.nrx0 = value; this.ch1.updateSweep(); break;
      case 0xFF11: this.ch1.nrx1 = value; this.ch1.updateLength(); break;
      case 0xFF12: this.ch1.nrx2 = value; this.ch1.updateEnvelope(); break;
      case 0xFF13: this.ch1.nrx3 = value; this.ch1.updateFrequency(); break;
      case 0xFF14:
        this.ch1.nrx4 = value;
        if (value & 0x80) this.ch1.trigger();
        this.ch1.updateFrequency();
        break;

      case 0xFF16: this.ch2.nrx1 = value; this.ch2.updateLength(); break;
      case 0xFF17: this.ch2.nrx2 = value; this.ch2.updateEnvelope(); break;
      case 0xFF18: this.ch2.nrx3 = value; this.ch2.updateFrequency(); break;
      case 0xFF19:
        this.ch2.nrx4 = value;
        if (value & 0x80) this.ch2.trigger();
        this.ch2.updateFrequency();
        break;

      case 0xFF1A:
        this.ch3.nrx0 = value;
        this.ch3.dacEnabled = (value & 0x80) !== 0;
        if (!this.ch3.dacEnabled) this.ch3.active = false;
        break;
      case 0xFF1B: this.ch3.nrx1 = value; this.ch3.updateLength(); break;
      case 0xFF1C: this.ch3.nrx2 = value; break;
      case 0xFF1D: this.ch3.nrx3 = value; this.ch3.updateFrequency(); break;
      case 0xFF1E:
        this.ch3.nrx4 = value;
        if (value & 0x80) this.ch3.trigger();
        this.ch3.updateFrequency();
        break;

      case 0xFF20: this.ch4.nrx1 = value; this.ch4.updateLength(); break;
      case 0xFF21: this.ch4.nrx2 = value; this.ch4.updateEnvelope(); break;
      case 0xFF22: this.ch4.nrx3 = value; break;
      case 0xFF23:
        this.ch4.nrx4 = value;
        if (value & 0x80) this.ch4.trigger();
        break;

      case 0xFF24: this.nr50 = value; break;
      case 0xFF25: this.nr51 = value; break;
      case 0xFF26:
        this.soundOn = (value & 0x80) !== 0;
        if (!this.soundOn) {
          this.ch1.active = false;
          this.ch2.active = false;
          this.ch3.active = false;
          this.ch4.active = false;
        }
        break;

      case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33:
      case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
      case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B:
      case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
        this.waveRam[addr - 0xFF30] = value;
        break;
    }
  }

  // Advance the APU by mCycles M-cycles.
  // 1 M-cycle = 4 T-cycles. The APU runs at T-cycle rate and does NOT
  // speed up in CGB double-speed mode (the APU clock is independent).
  tick(mCycles: number) {
    if (!this.soundOn) {
      // Still need to advance the frame sequencer to maintain timing
      // but don't generate samples
      let advanceCycles = mCycles;
      if (this.doubleSpeed) {
        this.apuCycleAccumulator += mCycles;
        advanceCycles = Math.floor(this.apuCycleAccumulator / 2);
        this.apuCycleAccumulator %= 2;
      }
      this.frameSeqCounter += advanceCycles * 4;
      return;
    }

    let apuCycles = mCycles;
    if (this.doubleSpeed) {
      this.apuCycleAccumulator += mCycles;
      apuCycles = Math.floor(this.apuCycleAccumulator / 2);
      this.apuCycleAccumulator %= 2;
    }

    const tCycles = apuCycles * 4;

    // Frame sequencer: 512 Hz = every 8192 T-cycles
    this.frameSeqCounter += tCycles;
    while (this.frameSeqCounter >= 8192) {
      this.frameSeqCounter -= 8192;
      this.stepFrameSequencer();
    }

    // Tick each channel's waveform generator
    this.ch1.tick(tCycles);
    this.ch2.tick(tCycles);
    this.ch3.tick(tCycles, this.waveRam);
    this.ch3.waveRamRef = this.waveRam;
    this.ch4.tick(tCycles);

    // Generate audio samples (accumulator in M-cycles)
    this.sampleAccumulator += apuCycles;
    while (this.sampleAccumulator >= this.cyclesPerSample) {
      this.sampleAccumulator -= this.cyclesPerSample;
      this.generateSample();
    }
  }

  private stepFrameSequencer() {
    // The frame sequencer has 8 steps, cycling every 8192 T-cycles:
    //   Step 0: Length clocked
    //   Step 1: -
    //   Step 2: Length + Sweep clocked
    //   Step 3: -
    //   Step 4: Length clocked
    //   Step 5: -
    //   Step 6: Length + Sweep clocked
    //   Step 7: Envelope clocked
    const lengthClock = (this.frameSeqStep % 2 === 0);
    const sweepClock = (this.frameSeqStep === 2 || this.frameSeqStep === 6);
    const envClock = (this.frameSeqStep === 7);

    if (lengthClock) {
      this.ch1.clockLength();
      this.ch2.clockLength();
      this.ch3.clockLength();
      this.ch4.clockLength();
    }
    if (sweepClock) {
      this.ch1.clockSweep();
    }
    if (envClock) {
      this.ch1.clockEnvelope();
      this.ch2.clockEnvelope();
      this.ch4.clockEnvelope();
    }

    this.frameSeqStep = (this.frameSeqStep + 1) % 8;
  }

  private generateSample() {
    // Get each channel's current output (0-15)
    let ch1Out = this.ch1.getOutput();
    let ch2Out = this.ch2.getOutput();
    let ch3Out = this.ch3.getOutput();
    let ch4Out = this.ch4.getOutput();

    // NR51: output mapping
    // Bit 0 = Ch1 to right, Bit 1 = Ch2 to right, Bit 2 = Ch3 to right, Bit 3 = Ch4 to right
    // Bit 4 = Ch1 to left,  Bit 5 = Ch2 to left,  Bit 6 = Ch3 to left,  Bit 7 = Ch4 to left
    const ch1Right = (this.nr51 & 0x01) ? ch1Out : 0;
    const ch2Right = (this.nr51 & 0x02) ? ch2Out : 0;
    const ch3Right = (this.nr51 & 0x04) ? ch3Out : 0;
    const ch4Right = (this.nr51 & 0x08) ? ch4Out : 0;
    const ch1Left = (this.nr51 & 0x10) ? ch1Out : 0;
    const ch2Left = (this.nr51 & 0x20) ? ch2Out : 0;
    const ch3Left = (this.nr51 & 0x40) ? ch3Out : 0;
    const ch4Left = (this.nr51 & 0x80) ? ch4Out : 0;

    // NR50: master volume
    const rightVol = (this.nr50 & 0x07) + 1;
    const leftVol = ((this.nr50 >> 4) & 0x07) + 1;

    // Mix: sum channels, apply master volume, normalize to [-1, 1]
    // Max per channel = 15, max sum = 4*15 = 60, max after volume = 60*8 = 480
    const rightMix = (ch1Right + ch2Right + ch3Right + ch4Right) * rightVol;
    const leftMix = (ch1Left + ch2Left + ch3Left + ch4Left) * leftVol;

    // Normalize: max possible = 480, divide by 240 for generous headroom
    // (most games use 2 channels at moderate volume, so this gives good audible output)
    const rightSample = Math.min(1.0, Math.max(-1.0, rightMix / 240.0));
    const leftSample = Math.min(1.0, Math.max(-1.0, leftMix / 240.0));

    // Write to ring buffer
    this.sampleBuffer[this.bufferWritePos] = leftSample;
    this.bufferWritePos = (this.bufferWritePos + 1) % this.sampleBuffer.length;
    this.sampleBuffer[this.bufferWritePos] = rightSample;
    this.bufferWritePos = (this.bufferWritePos + 1) % this.sampleBuffer.length;
    this.bufferSize = Math.min(this.bufferSize + 2, this.sampleBuffer.length);
  }

  // Pull samples from the ring buffer for Web Audio playback
  // Returns the number of samples actually read.
  readSamples(out: Float32Array, count: number): number {
    let read = 0;
    for (let i = 0; i < count && this.bufferSize >= 2; i++) {
      out[i] = this.sampleBuffer[this.bufferReadPos];
      this.bufferReadPos = (this.bufferReadPos + 1) % this.sampleBuffer.length;
      this.bufferSize--;
      read++;
    }
    return read;
  }
}

// ---- Square wave channel (used by Ch1 and Ch2) ----
class SquareChannel {
  nrx0: number = 0;  // NR10 (sweep) - only used by Ch1
  nrx1: number = 0;  // Length timer + duty
  nrx2: number = 0;  // Envelope
  nrx3: number = 0;  // Frequency low
  nrx4: number = 0;  // Frequency high + control

  active: boolean = false;
  dacEnabled: boolean = false;

  // Frequency timer (counts T-cycles)
  private freqTimer: number = 0;
  private wavePosition: number = 0;

  // Length timer
  private lengthCounter: number = 0;

  // Envelope
  private envTimer: number = 0;
  private envVolume: number = 0;

  // Sweep (Ch1 only)
  private sweepTimer: number = 0;
  private sweepEnabled: boolean = false;
  private sweepShadowFreq: number = 0;

  reset() {
    this.nrx0 = 0; this.nrx1 = 0; this.nrx2 = 0; this.nrx3 = 0; this.nrx4 = 0;
    this.active = false;
    this.dacEnabled = false;
    this.freqTimer = 0;
    this.wavePosition = 0;
    this.lengthCounter = 0;
    this.envTimer = 0;
    this.envVolume = 0;
    this.sweepTimer = 0;
    this.sweepEnabled = false;
    this.sweepShadowFreq = 0;
  }

  get frequency(): number {
    return ((this.nrx4 & 0x07) << 8) | this.nrx3;
  }

  updateFrequency() {
    // Recalculate sweep shadow frequency
    this.sweepShadowFreq = this.frequency;
  }

  updateLength() {
    this.lengthCounter = 64 - (this.nrx1 & 0x3F);
  }

  updateEnvelope() {
    this.dacEnabled = (this.nrx2 & 0xF8) !== 0;
  }

  updateSweep() {
    // NR10: bit 0-2 = sweep time, bit 3 = direction, bit 4-7 = shift
    // Only Ch1 uses this
  }

  trigger() {
    if (!this.dacEnabled) return;
    this.active = true;

    // Reset frequency timer
    this.freqTimer = (2048 - this.frequency) * 4;
    this.wavePosition = 0;

    // Reload length if zero
    if (this.lengthCounter === 0) {
      this.lengthCounter = 64;
    }

    // Reset envelope
    this.envVolume = (this.nrx2 >> 4) & 0x0F;
    this.envTimer = this.nrx2 & 0x07;

    // Reset sweep (Ch1 only)
    this.sweepShadowFreq = this.frequency;
    const sweepTime = (this.nrx0 >> 4) & 0x07;
    const sweepShift = this.nrx0 & 0x07;
    this.sweepTimer = sweepTime;
    this.sweepEnabled = (sweepTime > 0 || sweepShift > 0);
    if (sweepShift > 0) {
      this.clockSweep();
    }
  }

  tick(tCycles: number) {
    if (!this.active) return;

    this.freqTimer -= tCycles;
    while (this.freqTimer <= 0) {
      this.freqTimer += (2048 - this.frequency) * 4;
      this.wavePosition = (this.wavePosition + 1) % 8;
    }
  }

  clockLength() {
    if (this.nrx4 & 0x40) {  // Length enable
      if (this.lengthCounter > 0) {
        this.lengthCounter--;
        if (this.lengthCounter === 0) {
          this.active = false;
        }
      }
    }
  }

  clockEnvelope() {
    if (this.envTimer > 0) {
      this.envTimer--;
      if (this.envTimer === 0) {
        this.envTimer = this.nrx2 & 0x07;
        const direction = (this.nrx2 & 0x08) ? 1 : -1;
        const newVol = this.envVolume + direction;
        if (newVol >= 0 && newVol <= 15) {
          this.envVolume = newVol;
        } else {
          this.envTimer = 0;  // Stop envelope
        }
      }
    }
  }

  clockSweep() {
    if (!this.sweepEnabled) return;

    const sweepTime = (this.nrx0 >> 4) & 0x07;
    const sweepDir = (this.nrx0 & 0x08) ? -1 : 1;
    const sweepShift = this.nrx0 & 0x07;

    this.sweepTimer--;
    if (this.sweepTimer <= 0) {
      this.sweepTimer = sweepTime > 0 ? sweepTime : 8;

      if (sweepShift > 0) {
        const newFreq = this.sweepShadowFreq + (this.sweepShadowFreq >> sweepShift) * sweepDir;

        if (newFreq < 0) {
          this.active = false;
          return;
        }
        if (newFreq > 2047) {
          this.active = false;
          return;
        }

        this.sweepShadowFreq = newFreq;
        this.nrx3 = newFreq & 0xFF;
        this.nrx4 = (this.nrx4 & 0xF8) | ((newFreq >> 8) & 0x07);
        this.freqTimer = (2048 - newFreq) * 4;
      }
    }
  }

  // Duty cycle patterns (8 steps each)
  private static readonly DUTY_PATTERNS: number[][] = [
    [0, 0, 0, 0, 0, 0, 0, 1],  // 12.5%
    [1, 0, 0, 0, 0, 0, 0, 1],  // 25%
    [1, 0, 0, 0, 0, 1, 1, 1],  // 50%
    [0, 1, 1, 1, 1, 1, 1, 0],  // 75% (inverted 25%)
  ];

  getOutput(): number {
    if (!this.active || !this.dacEnabled) return 0;

    const duty = (this.nrx1 >> 6) & 0x03;
    const bit = SquareChannel.DUTY_PATTERNS[duty][this.wavePosition];
    if (bit === 0) return 0;
    return this.envVolume;
  }
}

// ---- Wave channel (Ch3) ----
class WaveChannel {
  nrx0: number = 0;  // Sound on/off (DAC enable)
  nrx1: number = 0;  // Length
  nrx2: number = 0;  // Output level
  nrx3: number = 0;  // Frequency low
  nrx4: number = 0;  // Frequency high + control

  active: boolean = false;
  dacEnabled: boolean = false;

  private freqTimer: number = 0;
  private wavePosition: number = 0;
  private lengthCounter: number = 0;

  reset() {
    this.nrx0 = 0; this.nrx1 = 0; this.nrx2 = 0; this.nrx3 = 0; this.nrx4 = 0;
    this.active = false;
    this.dacEnabled = false;
    this.freqTimer = 0;
    this.wavePosition = 0;
    this.lengthCounter = 0;
  }

  get frequency(): number {
    return ((this.nrx4 & 0x07) << 8) | this.nrx3;
  }

  updateFrequency() {}

  updateLength() {
    this.lengthCounter = 256 - this.nrx1;
  }

  trigger() {
    if (!this.dacEnabled) return;
    this.active = true;
    this.freqTimer = (2048 - this.frequency) * 2;
    this.wavePosition = 0;
    if (this.lengthCounter === 0) {
      this.lengthCounter = 256;
    }
  }

  tick(tCycles: number, _waveRam: Uint8Array) {
    if (!this.active) return;

    this.freqTimer -= tCycles;
    while (this.freqTimer <= 0) {
      this.freqTimer += (2048 - this.frequency) * 2;
      this.wavePosition = (this.wavePosition + 1) % 32;
    }
  }

  clockLength() {
    if (this.nrx4 & 0x40) {
      if (this.lengthCounter > 0) {
        this.lengthCounter--;
        if (this.lengthCounter === 0) {
          this.active = false;
        }
      }
    }
  }

  getOutput(): number {
    if (!this.active || !this.dacEnabled) return 0;

    // Wave RAM: 32 x 4-bit samples in 16 bytes
    const byte = this.wavePosition >> 1;
    const nibble = this.wavePosition & 1;
    const wr = this.waveRamRef;
    const sample = nibble
      ? ((wr ? wr[byte] : 0) & 0x0F)
      : (((wr ? wr[byte] : 0) >> 4) & 0x0F);

    // Output level (NR32): 0=mute, 1=100%, 2=50%, 3=25%
    const shift = (this.nrx2 >> 5) & 0x03;
    if (shift === 0) return 0;
    return sample >> (shift - 1);
  }

  // Wave RAM reference - set by APU
  waveRamRef: Uint8Array | null = null;
}

// ---- Noise channel (Ch4) ----
class NoiseChannel {
  nrx1: number = 0;  // Length
  nrx2: number = 0;  // Envelope
  nrx3: number = 0;  // Frequency + counter
  nrx4: number = 0;  // Control

  active: boolean = false;
  dacEnabled: boolean = false;

  private freqTimer: number = 0;
  private lfsr: number = 0x7FFF;  // 15-bit LFSR
  private lengthCounter: number = 0;
  private envTimer: number = 0;
  private envVolume: number = 0;

  reset() {
    this.nrx1 = 0; this.nrx2 = 0; this.nrx3 = 0; this.nrx4 = 0;
    this.active = false;
    this.dacEnabled = false;
    this.freqTimer = 0;
    this.lfsr = 0x7FFF;
    this.lengthCounter = 0;
    this.envTimer = 0;
    this.envVolume = 0;
  }

  updateLength() {
    this.lengthCounter = 64 - (this.nrx1 & 0x3F);
  }

  updateEnvelope() {
    this.dacEnabled = (this.nrx2 & 0xF8) !== 0;
  }

  trigger() {
    if (!this.dacEnabled) return;
    this.active = true;
    this.lfsr = 0x7FFF;
    this.envVolume = (this.nrx2 >> 4) & 0x0F;
    this.envTimer = this.nrx2 & 0x07;
    if (this.lengthCounter === 0) {
      this.lengthCounter = 64;
    }
    this.updateFreqTimer();
  }

  private updateFreqTimer() {
    const divisor = this.nrx3 & 0x07;
    const prescalar = divisor === 0 ? 8 : (divisor << 4);
    const clockShift = (this.nrx3 >> 4) & 0x0F;
    this.freqTimer = prescalar << clockShift;
  }

  tick(tCycles: number) {
    if (!this.active) return;

    this.freqTimer -= tCycles;
    while (this.freqTimer <= 0) {
      this.updateFreqTimer();

      // LFSR: XOR bits 0 and 1, shift right, put result in bit 14 (and bit 6 if 7-bit mode)
      const xor = (this.lfsr & 0x01) ^ ((this.lfsr >> 1) & 0x01);
      this.lfsr >>= 1;
      this.lfsr |= (xor << 14);
      if (this.nrx3 & 0x08) {  // 7-bit mode
        this.lfsr = (this.lfsr & ~(1 << 6)) | (xor << 6);
      }
    }
  }

  clockLength() {
    if (this.nrx4 & 0x40) {
      if (this.lengthCounter > 0) {
        this.lengthCounter--;
        if (this.lengthCounter === 0) {
          this.active = false;
        }
      }
    }
  }

  clockEnvelope() {
    if (this.envTimer > 0) {
      this.envTimer--;
      if (this.envTimer === 0) {
        this.envTimer = this.nrx2 & 0x07;
        const direction = (this.nrx2 & 0x08) ? 1 : -1;
        const newVol = this.envVolume + direction;
        if (newVol >= 0 && newVol <= 15) {
          this.envVolume = newVol;
        } else {
          this.envTimer = 0;
        }
      }
    }
  }

  getOutput(): number {
    if (!this.active || !this.dacEnabled) return 0;
    // LFSR bit 0 inverted = output
    const bit = (~this.lfsr) & 0x01;
    if (bit === 0) return 0;
    return this.envVolume;
  }
}
