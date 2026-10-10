// Real SNES DSP with BRR sample decoding and Echo/Reverb processing
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
  sampleBuffer: number[]; // Decoded samples (17 entries for seamless boundary interpolation)
  sampleIndex: number;    // Current position in sample buffer
  pitchCounter: number;   // 14-bit with fractional part
  env: number;            // Envelope level (0-2047)
  envMode: 'attack' | 'decay' | 'sustain' | 'release';
  lastSample: number;     // Live output sample (-1.0 to 1.0) for OUTX ($X9) & PMON ($2D)

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

  // Echo engine state
  private echoOffset = 0;
  private readonly firHistoryL = new Int16Array(8);
  private readonly firHistoryR = new Int16Array(8);
  private firHistoryIdx = 0;

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
    sampleBuffer: new Array(17).fill(0),
    sampleIndex: 0,
    pitchCounter: 0,
    env: 0,
    envMode: 'release',
    lastSample: 0,
    brrPrev1: 0,
    brrPrev2: 0,
    envCounter: 0,
  }));

  // Reference to SPC700 RAM for reading BRR samples and echo buffer
  private spcRam: Uint8Array | null = null;

  public setSpcRam(ram: Uint8Array): void {
    this.spcRam = ram;
  }

  public reset(): void {
    this.regs.fill(0);
    // Initialize master volume registers to maximum
    this.regs[0x0C] = 0x7F; // MVOLL (Master Volume Left)
    this.regs[0x1C] = 0x7F; // MVOLR (Master Volume Right)
    this.noiseLfsr = 1;
    this.noiseCounter = 0;
    this.noiseSample = 0;

    this.echoOffset = 0;
    this.firHistoryL.fill(0);
    this.firHistoryR.fill(0);
    this.firHistoryIdx = 0;

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
      v.lastSample = 0;
      v.brrPrev1 = 0;
      v.brrPrev2 = 0;
      v.envCounter = 0;
    }
  }

  public writeRegister(addr: number, value: number): void {
    const a = addr & 0x7F;
    const v = value & 0xFF;

    // ENDX ($7C): Writing any value clears all bits of ENDX to 0
    if (a === 0x7C) {
      this.regs[0x7C] = 0;
      return;
    }

    // FLG ($6C): Flags register
    if (a === 0x6C) {
      this.regs[0x6C] = v;
      if ((v & 0x80) !== 0) {
        // Soft Reset (bit 7): key off all voices, clear envelopes, and reset ENDX
        for (let i = 0; i < 8; i++) {
          const voice = this.voices[i];
          voice.keyOn = false;
          voice.keyOff = true;
          voice.env = 0;
          voice.envMode = 'release';
          voice.lastSample = 0;
        }
        this.regs[0x7C] = 0;
      }
      return;
    }

    this.regs[a] = v;

    // Voice registers ($00-$7F)
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
      if (field === 0x07) voice.gain = v;
      return;
    }

    // KON (Key On, $4C)
    if (a === 0x4C) {
      for (let i = 0; i < 8; i++) {
        if (((v >> i) & 1) !== 0) {
          this.keyOnVoice(i);
        }
      }
      return;
    }

    // KOFF (Key Off, $5C)
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
    const a = addr & 0x7F;
    const field = a & 0x0F;
    const voiceIdx = (a >> 4) & 7;

    // ENVX ($X8): 7-bit live voice envelope level
    if (field === 0x08 && voiceIdx < 8) {
      return Math.min(0x7F, Math.floor(this.voices[voiceIdx].env / 16)) & 0x7F;
    }

    // OUTX ($X9): 8-bit signed live voice sample output
    if (field === 0x09 && voiceIdx < 8) {
      return Math.max(-128, Math.min(127, Math.floor(this.voices[voiceIdx].lastSample * 127))) & 0xFF;
    }

    // ENDX ($7C): 8-bit sample block end flags
    if (a === 0x7C) {
      return this.regs[0x7C] & 0xFF;
    }

    return this.regs[a] & 0xFF;
  }

  public getVoiceDebugInfo(): Array<{idx:number; on:boolean; volL:number; volR:number; pitch:number; env:number; envMode:string; srcn:number; adsr1:number; gain:number}> {
    return this.voices.map((v, i) => ({
      idx: i, on: v.keyOn, volL: v.volL, volR: v.volR, pitch: v.pitch,
      env: v.env, envMode: v.envMode, srcn: v.srcn, adsr1: v.adsr1, gain: v.gain,
    }));
  }

  public getRegs(): Uint8Array { return this.regs; }

  public render(sampleRate: number): StereoSample {
    // FLG ($6C) bit 6: Master Mute
    if ((this.regs[0x6C] & 0x40) !== 0) {
      return { left: 0, right: 0 };
    }

    // Master volume
    const mvolL = this.toSigned(this.regs[0x0C]) / 127;
    const mvolR = this.toSigned(this.regs[0x1C]) / 127;
    const timeScale = 32000 / sampleRate;

    this.stepNoise(timeScale);

    let left = 0;
    let right = 0;
    let echoInL = 0;
    let echoInR = 0;

    const eon = this.regs[0x4D]; // Echo On voice mask

    for (let i = 0; i < 8; i++) {
      const voice = this.voices[i];
      const sample = this.renderVoice(voice, i, sampleRate, timeScale);
      const volL = voice.volL / 127;
      const volR = voice.volR / 127;
      const voiceL = sample * volL;
      const voiceR = sample * volR;

      left += voiceL;
      right += voiceR;

      if (((eon >> i) & 1) !== 0) {
        echoInL += voiceL;
        echoInR += voiceR;
      }
    }

    // Process Echo & Reverb
    if (this.spcRam) {
      const esa = this.regs[0x6D];
      const edl = this.regs[0x7D] & 0x0F;
      const efb = this.toSigned(this.regs[0x0D]);
      const evolL = this.toSigned(this.regs[0x2C]) / 127;
      const evolR = this.toSigned(this.regs[0x3C]) / 127;
      const echoWriteDisabled = (this.regs[0x6C] & 0x20) !== 0;

      const echoBufferSize = Math.max(4, edl * 2048);
      const echoBaseAddr = (esa << 8) & 0xFFFF;
      const echoAddr = (echoBaseAddr + this.echoOffset) & 0xFFFF;

      // Read current 16-bit stereo sample from echo buffer in SPC RAM
      const b0 = this.spcRam[echoAddr] || 0;
      const b1 = this.spcRam[(echoAddr + 1) & 0xFFFF] || 0;
      const b2 = this.spcRam[(echoAddr + 2) & 0xFFFF] || 0;
      const b3 = this.spcRam[(echoAddr + 3) & 0xFFFF] || 0;
      const sL = (b1 & 0x80) ? ((b1 << 8) | b0) - 65536 : ((b1 << 8) | b0);
      const sR = (b3 & 0x80) ? ((b3 << 8) | b2) - 65536 : ((b3 << 8) | b2);

      // Store in FIR history
      this.firHistoryL[this.firHistoryIdx] = sL;
      this.firHistoryR[this.firHistoryIdx] = sR;

      // 8-tap FIR filter
      let firL = 0;
      let firR = 0;
      for (let k = 0; k < 8; k++) {
        const coeff = this.toSigned(this.regs[(k << 4) | 0x0F]);
        const histIdx = (this.firHistoryIdx - k + 8) & 7;
        firL += (this.firHistoryL[histIdx] * coeff) >> 7;
        firR += (this.firHistoryR[histIdx] * coeff) >> 7;
      }
      this.firHistoryIdx = (this.firHistoryIdx + 1) & 7;

      firL = Math.max(-32768, Math.min(32767, firL));
      firR = Math.max(-32768, Math.min(32767, firR));

      // Add echo to output
      left += (firL / 32768) * evolL;
      right += (firR / 32768) * evolR;

      // Write feedback + echo input back to SPC RAM if echo writing is enabled
      if (!echoWriteDisabled) {
        const feedbackL = (firL * efb) >> 7;
        const feedbackR = (firR * efb) >> 7;
        const newEchoL = Math.max(-32768, Math.min(32767, Math.floor(echoInL * 32767 + feedbackL)));
        const newEchoR = Math.max(-32768, Math.min(32767, Math.floor(echoInR * 32767 + feedbackR)));

        this.spcRam[echoAddr] = newEchoL & 0xFF;
        this.spcRam[(echoAddr + 1) & 0xFFFF] = (newEchoL >> 8) & 0xFF;
        this.spcRam[(echoAddr + 2) & 0xFFFF] = newEchoR & 0xFF;
        this.spcRam[(echoAddr + 3) & 0xFFFF] = (newEchoR >> 8) & 0xFF;
      }

      this.echoOffset = (this.echoOffset + 4) % echoBufferSize;
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
    voice.lastSample = 0;

    // Key-on clears the voice's ENDX bit
    this.regs[0x7C] &= ~(1 << voiceIdx);

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
        voice.envMode = 'attack';
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
      this.decodeBrrBlock(voice, voiceIdx);
    }
  }

  private renderVoice(voice: DspVoice, voiceIdx: number, sampleRate: number, timeScale: number): number {
    if (!voice.keyOn) {
      voice.lastSample = 0;
      return 0;
    }
    if (!this.spcRam) {
      voice.lastSample = 0;
      return 0;
    }

    // Advance envelope
    this.advanceEnvelope(voice, timeScale);
    const envScale = voice.env / 2047; // Normalize to 0-1

    const noiseEnabled = ((this.regs[0x3D] >> voiceIdx) & 1) !== 0;
    if (noiseEnabled) {
      const noiseOut = envScale <= 0.001 ? 0 : this.noiseSample * envScale;
      voice.lastSample = noiseOut;
      return noiseOut;
    }

    // PMON (Pitch Modulation, register $2D): Voice N is pitch-modulated by Voice N-1
    let rawPitch = voice.pitch & 0x3FFF;
    if (voiceIdx > 0 && ((this.regs[0x2D] >> voiceIdx) & 1) !== 0) {
      const prevOut = this.voices[voiceIdx - 1].lastSample; // -1.0 to 1.0
      rawPitch = Math.max(0, Math.min(0x3FFF, Math.floor(rawPitch * (1 + prevOut))));
    }

    const pitchIncrement = rawPitch * timeScale;
    voice.pitchCounter += pitchIncrement;

    // When counter overflows 4096, advance to next BRR sample
    while (voice.pitchCounter >= 4096) {
      voice.pitchCounter -= 4096;
      voice.sampleIndex++;

      if (voice.sampleIndex >= 16) {
        voice.sampleIndex -= 16;
        this.decodeBrrBlock(voice, voiceIdx);
      }
    }

    // Seamless linear interpolation across block boundaries
    const idx = Math.floor(voice.sampleIndex);
    const frac = voice.pitchCounter / 4096;
    const s0 = voice.sampleBuffer[idx] || 0;
    const s1 = (idx < 16 ? voice.sampleBuffer[idx + 1] : voice.sampleBuffer[16]) || 0;
    const interpolated = s0 + (s1 - s0) * frac;

    const finalSample = envScale <= 0.001 ? 0 : interpolated * envScale;
    voice.lastSample = finalSample;
    return finalSample;
  }

  private decodeBrrBlock(voice: DspVoice, voiceIdx: number): void {
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

    // Handle loop/end flags & update ENDX register ($7C)
    if (end !== 0) {
      this.regs[0x7C] |= (1 << voiceIdx);

      if (loop !== 0) {
        voice.brrAddr = voice.brrEndAddr;
      } else {
        voice.keyOn = false;
        voice.env = 0;
        voice.envMode = 'release';
      }
    }

    // Peek the 17th sample from subsequent block to eliminate boundary discontinuities
    if (end !== 0 && loop === 0) {
      voice.sampleBuffer[16] = 0;
    } else {
      const nextHdr = this.spcRam[voice.brrAddr] || 0;
      const nextRange = (nextHdr >> 4) & 0x0F;
      const nextFilter = (nextHdr >> 2) & 0x03;
      const nextByte = this.spcRam[(voice.brrAddr + 1) & 0xFFFF] || 0;
      const nextNibble1 = (nextByte >> 4) & 0x0F;
      voice.sampleBuffer[16] = this.peekBrrSample(nextNibble1, nextRange, nextFilter, voice.brrPrev1, voice.brrPrev2);
    }
  }

  private peekBrrSample(nibble: number, range: number, filter: number, p1: number, p2: number): number {
    let sample = nibble < 8 ? nibble : nibble - 16;
    if (range <= 12) {
      sample = (sample << range) >> 1;
    } else {
      sample = (sample < 0) ? -(1 << 11) : 0;
    }
    switch (filter) {
      case 1: sample += (p1 * 15) >> 4; break;
      case 2: sample += ((p1 * 61) >> 5) - ((p2 * 15) >> 4); break;
      case 3: sample += ((p1 * 115) >> 6) - ((p2 * 13) >> 4); break;
    }
    sample = Math.max(-32768, Math.min(32767, sample));
    return sample / 32768;
  }

  private decodeBrrSample(nibble: number, range: number, filter: number, voice: DspVoice): number {
    let sample = nibble < 8 ? nibble : nibble - 16;

    if (range <= 12) {
      sample = (sample << range) >> 1;
    } else {
      sample = (sample < 0) ? -(1 << 11) : 0;
    }

    const p1 = voice.brrPrev1;
    const p2 = voice.brrPrev2;

    switch (filter) {
      case 0:
        break;
      case 1:
        sample += (p1 * 15) >> 4;
        break;
      case 2:
        sample += (p1 * 61) >> 5;
        sample -= (p2 * 15) >> 4;
        break;
      case 3:
        sample += (p1 * 115) >> 6;
        sample -= (p2 * 13) >> 4;
        break;
    }

    sample = Math.max(-32768, Math.min(32767, sample));

    voice.brrPrev2 = voice.brrPrev1;
    voice.brrPrev1 = sample;

    return sample / 32768;
  }

  private static readonly RATE_PERIODS = [
    Infinity, 2048, 1536, 1280, 1024, 768, 640, 512,
    384, 320, 256, 192, 160, 128, 96, 80,
    64, 48, 40, 32, 24, 20, 16, 12,
    10, 8, 6, 5, 4, 3, 2, 1,
  ];

  private advanceEnvelope(voice: DspVoice, timeScale: number): void {
    const useAdsr = (voice.adsr1 & 0x80) !== 0;

    if (voice.keyOff && voice.envMode !== 'release') {
      voice.envMode = 'release';
      voice.envCounter = 0;
    }

    let rate: number;
    let step: number;
    let isDecrease = false;

    if (!useAdsr && voice.envMode !== 'release') {
      if ((voice.gain & 0x80) === 0) {
        // Direct GAIN: fixed level
        voice.env = (voice.gain & 0x7F) * 16;
        return;
      }
      const mode = (voice.gain >> 5) & 0x03;
      rate = voice.gain & 0x1F;
      if (mode === 0) {
        step = -32; // linear decrease
        isDecrease = true;
      } else if (mode === 1) {
        step = -(Math.floor(voice.env / 256) + 1); // exponential decrease
        isDecrease = true;
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
        isDecrease = true;
      } else { // sustain
        const sr = voice.adsr2 & 0x1F;
        if (sr === 0) return;
        rate = sr;
        step = -(Math.floor(voice.env / 256) + 1);
        isDecrease = true;
      }
    } else {
      // release
      rate = 31;
      step = -(Math.floor(voice.env / 256) + 1);
      isDecrease = true;
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

      if (voice.env === 0 && (voice.envMode === 'release' || isDecrease)) {
        voice.keyOn = false;
        voice.lastSample = 0;
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
}
