// Real SNES DSP with BRR sample decoding
interface DspVoice {
  // Register state
  volL: number;
  volR: number;
  pitch: number;  // 14-bit pitch counter increment
  srcn: number;   // Sample source number (index into DIR)
  adsr1: number;
  adsr2: number;
  gain: number;
  
  // Runtime state
  keyOn: boolean;
  keyOff: boolean;
  brrAddr: number;        // Current BRR block address
  brrEndAddr: number;     // BRR loop address
  sampleBuffer: number[]; // Decoded samples (ring buffer)
  sampleIndex: number;    // Current position in ring buffer
  pitchCounter: number;   // 14-bit with fractional part
  env: number;            // Envelope level (0-2047)
  envMode: 'attack' | 'decay' | 'sustain' | 'release';
  
  // BRR decode state
  brrPrev1: number;
  brrPrev2: number;
  // Envelope rate accumulator (DSP ticks)
  envCounter: number;
}

export interface StereoSample {
  left: number;
  right: number;
}

export class Dsp {
  private readonly regs = new Uint8Array(0x80);
  public keyOnCount = 0;
  private noiseLfsr = 1;
  private noiseCounter = 0;
  private noiseSample = 0;
  private readonly voices: DspVoice[] = Array.from({ length: 8 }, () => ({
    volL: 0,
    volR: 0,
    pitch: 0x1000,
    srcn: 0,
    adsr1: 0,
    adsr2: 0,
    gain: 0,
    keyOn: false,
    keyOff: false,
    brrAddr: 0,
    brrEndAddr: 0,
    sampleBuffer: new Array(16).fill(0),
    sampleIndex: 0,
    pitchCounter: 0,
    env: 0,
    envMode: 'release',
    brrPrev1: 0,
    brrPrev2: 0,
    envCounter: 0,
  }));

  // Reference to SPC700 RAM for reading BRR samples
  private spcRam: Uint8Array | null = null;

  public setSpcRam(ram: Uint8Array): void {
    this.spcRam = ram;
  }

  public reset(): void {
    this.regs.fill(0);
    // Initialize master volume registers to maximum so audio is audible
    // before the SPC700 program sets them. Real hardware starts with these
    // at whatever IPL ROM leaves, which is effectively full volume.
    this.regs[0x0C] = 0x7F; // MVOLL (Master Volume Left)
    this.regs[0x1C] = 0x7F; // MVOLR (Master Volume Right)
    this.noiseLfsr = 1;
    this.noiseCounter = 0;
    this.noiseSample = 0;
    for (const v of this.voices) {
      v.volL = 0;
      v.volR = 0;
      v.pitch = 0x1000;
      v.srcn = 0;
      v.adsr1 = 0;
      v.adsr2 = 0;
      v.gain = 0;
      v.keyOn = false;
      v.keyOff = false;
      v.brrAddr = 0;
      v.brrEndAddr = 0;
      v.sampleBuffer.fill(0);
      v.sampleIndex = 0;
      v.pitchCounter = 0;
      v.env = 0;
      v.envMode = 'release';
      v.brrPrev1 = 0;
      v.brrPrev2 = 0;
    }
  }

  public writeRegister(addr: number, value: number): void {
    const a = addr & 0x7F;
    const v = value & 0xFF;
    this.regs[a] = v;

    // Voice registers
    if ((a & 0x0F) <= 0x07 && (a >> 4) < 8) {
      const voiceIdx = (a >> 4) & 7;
      const field = a & 0x0F;
      const voice = this.voices[voiceIdx];
      if (field === 0x00) voice.volL = this.toSigned(v);
      if (field === 0x01) voice.volR = this.toSigned(v);
      if (field === 0x02) voice.pitch = (voice.pitch & 0x3F00) | v;
      if (field === 0x03) voice.pitch = ((v & 0x3F) << 8) | (voice.pitch & 0x00FF);
      if (field === 0x04) voice.srcn = v;
      if (field === 0x05) voice.adsr1 = v;
      if (field === 0x06) voice.adsr2 = v;
      if (field === 0x07) {
        voice.gain = v;
        if (voice.keyOn) {
          this.maybeWarmStartFastDecayVoice(voice);
        }
      }
      return;
    }

    // KON (Key On)
    if (a === 0x4C) {
      for (let i = 0; i < 8; i++) {
        if (((v >> i) & 1) !== 0) {
          this.keyOnVoice(i);
        }
      }
      return;
    }

    // KOFF (Key Off)
    if (a === 0x5C) {
      for (let i = 0; i < 8; i++) {
        if (((v >> i) & 1) !== 0) {
          this.voices[i].keyOff = true;
          this.voices[i].envMode = 'release';
        }
      }
    }
  }

  public readRegister(addr: number): number {
    return this.regs[addr & 0x7F] & 0xFF;
  }

  public getVoiceDebugInfo(): Array<{idx:number; on:boolean; volL:number; volR:number; pitch:number; env:number; envMode:string; srcn:number; adsr1:number; gain:number}> {
    return this.voices.map((v, i) => ({
      idx: i, on: v.keyOn, volL: v.volL, volR: v.volR, pitch: v.pitch,
      env: v.env, envMode: v.envMode, srcn: v.srcn, adsr1: v.adsr1, gain: v.gain,
    }));
  }

  public getRegs(): Uint8Array { return this.regs; }

  public render(sampleRate: number): StereoSample {
    // Master volume
    const mvolL = this.toSigned(this.regs[0x0C]) / 127;
    const mvolR = this.toSigned(this.regs[0x1C]) / 127;
    const timeScale = 32000 / sampleRate;

    this.stepNoise(timeScale);

    let left = 0;
    let right = 0;

    for (let i = 0; i < 8; i++) {
      const voice = this.voices[i];
      const sample = this.renderVoice(voice, i, sampleRate, timeScale);
      const volL = voice.volL / 127;
      const volR = voice.volR / 127;
      left += sample * volL;
      right += sample * volR;
    }

    return {
      left: Math.max(-1, Math.min(1, left * mvolL * 0.5)),
      right: Math.max(-1, Math.min(1, right * mvolR * 0.5)),
    };
  }

  private keyOnVoice(voiceIdx: number): void {
    this.keyOnCount++;
    const voice = this.voices[voiceIdx];
    voice.keyOn = true;
    voice.keyOff = false;
    
    // Initialize envelope based on ADSR vs GAIN mode
    const useAdsr = (voice.adsr1 & 0x80) !== 0;
    if (useAdsr) {
      voice.envMode = 'attack';
      voice.env = 0;
    } else {
      // GAIN mode
      if ((voice.gain & 0x80) === 0) {
        // Direct gain - set envelope to fixed value
        voice.env = (voice.gain & 0x7F) * 16;
        voice.envMode = 'sustain'; // Hold at this level
      } else {
        // Dynamic gain mode (increase/decrease)
        const mode = (voice.gain >> 5) & 0x03;
        if (mode === 0 || mode === 1) {
          // Decrease modes - start at max
          voice.env = 2047;
        } else {
          // Increase modes - start at 0
          voice.env = 0;
        }
        voice.envMode = 'attack'; // Will be handled by GAIN envelope code
      }
    }
    
    voice.pitchCounter = 0;
    voice.sampleIndex = 0;
    voice.sampleBuffer.fill(0);
    voice.brrPrev1 = 0;
    voice.brrPrev2 = 0;
    voice.envCounter = 0;

    // Read sample directory entry (DIR register at $5D)
    const dir = this.regs[0x5D] & 0xFF;
    const dirPage = dir << 8;
    const entryAddr = dirPage + (voice.srcn * 4);
    
    if (this.spcRam) {
      // Read start address (2 bytes) and loop address (2 bytes)
      const startLo = this.spcRam[entryAddr] || 0;
      const startHi = this.spcRam[(entryAddr + 1) & 0xFFFF] || 0;
      const loopLo = this.spcRam[(entryAddr + 2) & 0xFFFF] || 0;
      const loopHi = this.spcRam[(entryAddr + 3) & 0xFFFF] || 0;
      
      voice.brrAddr = (startHi << 8) | startLo;
      voice.brrEndAddr = (loopHi << 8) | loopLo;
      // Pre-decode the first BRR block so sampleBuffer is ready immediately
      this.decodeBrrBlock(voice);

      // Some games key-on voices in fast linear-decrease GAIN mode and expect
      // audible transients even when BRR starts with leading silence.
      // If the first block is silent, decode one extra block and start from
      // its first non-zero sample so envelope decay doesn't erase the note.
      const gainMode = (voice.gain >> 5) & 0x03;
      const gainRate = voice.gain & 0x1F;
      const isFastLinearDecrease = (voice.gain & 0x80) !== 0 && gainMode === 0 && gainRate >= 30;
      if (isFastLinearDecrease) {
        this.warmStartVoiceFromAudibleSample(voice);
      }
    }
  }

  private renderVoice(voice: DspVoice, voiceIdx: number, sampleRate: number, timeScale: number): number {
    if (!voice.keyOn) return 0;
    if (!this.spcRam) return 0;

    // Advance envelope
    this.advanceEnvelope(voice, timeScale);
    const envScale = voice.env / 2047; // Normalize to 0-1

    const noiseEnabled = ((this.regs[0x3D] >> voiceIdx) & 1) !== 0;
    if (noiseEnabled) {
      return envScale <= 0.001 ? 0 : this.noiseSample * envScale;
    }

    // Advance pitch counter (14-bit fixed point, 12-bit fractional)
    // Pitch is 14-bit, represents increment per 32kHz sample
    const pitchIncrement = (voice.pitch & 0x3FFF) * timeScale;
    voice.pitchCounter += pitchIncrement;

    // When counter overflows 4096, advance to next BRR sample
    while (voice.pitchCounter >= 4096) {
      voice.pitchCounter -= 4096;
      voice.sampleIndex++;

      if (voice.sampleIndex >= 16) {
        voice.sampleIndex -= 16;
        this.decodeBrrBlock(voice);
      }
    }

    // Get current sample with linear interpolation
    const idx = Math.floor(voice.sampleIndex);
    const frac = voice.pitchCounter / 4096;
    const s0 = voice.sampleBuffer[idx] || 0;
    const s1 = idx < 15 ? (voice.sampleBuffer[idx + 1] || 0) : s0; // Prevent block boundary wrapping discontinuity
    const interpolated = s0 + (s1 - s0) * frac;

    // Apply envelope
    return envScale <= 0.001 ? 0 : interpolated * envScale;
  }

  private decodeBrrBlock(voice: DspVoice): void {
    if (!this.spcRam) return;

    const header = this.spcRam[voice.brrAddr] || 0;
    const range = (header >> 4) & 0x0F;
    const filter = (header >> 2) & 0x03;
    const loop = (header >> 1) & 0x01;
    const end = header & 0x01;

    // Decode 8 bytes into 16 samples
    for (let i = 0; i < 8; i++) {
      const byte = this.spcRam[(voice.brrAddr + 1 + i) & 0xFFFF] || 0;
      const nibble1 = (byte >> 4) & 0x0F;
      const nibble2 = byte & 0x0F;
      
      const sample1 = this.decodeBrrSample(nibble1, range, filter, voice);
      const sample2 = this.decodeBrrSample(nibble2, range, filter, voice);
      
      voice.sampleBuffer[i * 2] = sample1;
      voice.sampleBuffer[i * 2 + 1] = sample2;
    }

    // Advance to next block (9 bytes per block)
    voice.brrAddr = (voice.brrAddr + 9) & 0xFFFF;

    // Handle loop/end flags
    if (end !== 0) {
      if (loop !== 0) {
        // Loop back
        voice.brrAddr = voice.brrEndAddr;
      } else {
        // Stop voice
        voice.keyOn = false;
        voice.env = 0;
      }
    }
  }

  private decodeBrrSample(nibble: number, range: number, filter: number, voice: DspVoice): number {
    // Sign-extend 4-bit to full integer
    let sample = nibble < 8 ? nibble : nibble - 16;
    
    // Apply range (shift)
    if (range <= 12) {
      sample = (sample << range) >> 1;
    } else {
      sample = (sample < 0) ? -(1 << 11) : 0;
    }

    // Apply filter using previous samples
    const p1 = voice.brrPrev1;
    const p2 = voice.brrPrev2;
    
    switch (filter) {
      case 0:
        // No filter
        break;
      case 1:
        // out[n] = sample + p1*15/16
        sample += (p1 * 15) >> 4;
        break;
      case 2:
        // out[n] = sample + p1*61/32 - p2*15/16
        sample += (p1 * 61) >> 5;
        sample -= (p2 * 15) >> 4;
        break;
      case 3:
        // out[n] = sample + p1*115/64 - p2*13/16
        sample += (p1 * 115) >> 6;
        sample -= (p2 * 13) >> 4;
        break;
    }

    // Clamp to 16-bit signed range
    sample = Math.max(-32768, Math.min(32767, sample));

    // Update previous samples
    voice.brrPrev2 = voice.brrPrev1;
    voice.brrPrev1 = sample;

    // Return normalized to -1.0 to 1.0
    return sample / 32768;
  }

  // SPC DSP rate period table: number of DSP 32kHz ticks between envelope steps.
  // Index = rate value (0-31). Rate 0 = never changes.
  private static readonly RATE_PERIODS = [
    Infinity, 2048, 1536, 1280, 1024, 768, 640, 512,
    384, 320, 256, 192, 160, 128, 96, 80,
    64, 48, 40, 32, 24, 20, 16, 12,
    10, 8, 6, 5, 4, 3, 2, 1,
  ];

  private advanceEnvelope(voice: DspVoice, timeScale: number): void {
    // timeScale = 32000 / sampleRate: DSP ticks elapsed per rendered sample
    const useAdsr = (voice.adsr1 & 0x80) !== 0;

    if (voice.keyOff && voice.envMode !== 'release') {
      voice.envMode = 'release';
      voice.envCounter = 0;
    }

    let rate: number;
    let step: number;

    if (!useAdsr && voice.envMode !== 'release') {
      if ((voice.gain & 0x80) === 0) {
        // Direct GAIN: fixed level, no timer needed
        voice.env = (voice.gain & 0x7F) * 16;
        return;
      }
      const mode = (voice.gain >> 5) & 0x03;
      rate = voice.gain & 0x1F;
      if (mode === 0) {
        step = -32; // linear decrease
      } else if (mode === 1) {
        step = -(Math.floor(voice.env / 256) + 1); // exponential decrease
      } else if (mode === 2) {
        step = 32; // linear increase
      } else {
        step = voice.env < 1536 ? 32 : 8; // bent-line increase
      }
    } else if (useAdsr && voice.envMode !== 'release') {
      if (voice.envMode === 'attack') {
        const ar = voice.adsr1 & 0x0F;
        rate = ar * 2 + 1;
        step = (rate === 31) ? (2047 - voice.env) : 32;
      } else if (voice.envMode === 'decay') {
        const dr = (voice.adsr1 >> 4) & 0x07;
        rate = dr * 2 + 16;
        step = -(Math.floor(voice.env / 256) + 1);
      } else { // sustain
        const sr = voice.adsr2 & 0x1F;
        if (sr === 0) return;
        rate = sr;
        step = -(Math.floor(voice.env / 256) + 1);
      }
    } else {
      // release
      rate = 31;
      step = -(Math.floor(voice.env / 256) + 1);
    }

    const period = Dsp.RATE_PERIODS[rate];
    if (!isFinite(period)) return;

    voice.envCounter += timeScale;
    while (voice.envCounter >= period) {
      voice.envCounter -= period;
      voice.env += step;
      if (voice.env < 0) voice.env = 0;
      if (voice.env > 2047) voice.env = 2047;

      if (useAdsr) {
        if (voice.envMode === 'attack' && voice.env >= 2047) {
          voice.env = 2047;
          voice.envMode = 'decay';
          voice.envCounter = 0;
        } else if (voice.envMode === 'decay') {
          const sl = ((voice.adsr2 >> 5) & 0x07) + 1;
          if (voice.env <= sl * 256) {
            voice.env = sl * 256;
            voice.envMode = 'sustain';
            voice.envCounter = 0;
          }
        }
      }

      if (voice.env === 0 && voice.envMode === 'release') {
        voice.keyOn = false;
        return;
      }
    }
  }

  private toSigned(value: number): number {
    return value < 128 ? value : value - 256;
  }

  private stepNoise(timeScale: number): void {
    const noiseRate = this.regs[0x6C] & 0x1F;
    const period = Dsp.RATE_PERIODS[noiseRate];
    if (!isFinite(period)) return;

    this.noiseCounter += timeScale;
    while (this.noiseCounter >= period) {
      this.noiseCounter -= period;
      const feedback = ((this.noiseLfsr ^ (this.noiseLfsr >> 1)) & 1) >>> 0;
      this.noiseLfsr = ((this.noiseLfsr >> 1) | (feedback << 14)) & 0x7FFF;
      this.noiseSample = (this.noiseLfsr & 1) !== 0 ? -0.6 : 0.6;
    }
  }

  private findFirstAudibleSample(samples: number[]): number {
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) > 1e-6) return i;
    }
    return -1;
  }

  private warmStartVoiceFromAudibleSample(voice: DspVoice): void {
    let firstNonZero = this.findFirstAudibleSample(voice.sampleBuffer);
    if (firstNonZero < 0) {
      this.decodeBrrBlock(voice);
      firstNonZero = this.findFirstAudibleSample(voice.sampleBuffer);
    }
    if (firstNonZero > 0) {
      voice.sampleIndex = firstNonZero;
    }
  }

  private maybeWarmStartFastDecayVoice(voice: DspVoice): void {
    const gainMode = (voice.gain >> 5) & 0x03;
    const gainRate = voice.gain & 0x1F;
    const isFastLinearDecrease = (voice.gain & 0x80) !== 0 && gainMode === 0 && gainRate >= 30;
    if (!isFastLinearDecrease) return;

    this.warmStartVoiceFromAudibleSample(voice);
  }
}
