import { Spc700 } from './Spc700';
import { Dsp } from './Dsp';

export interface ApuPortEvent {
  port: number;
  value: number;
}

export interface ApuDebugState {
  sampleRate: number;
  spc700Pc: number;
  spc700A: number;
  spc700X: number;
  spc700Y: number;
  spc700Sp: number;
  spc700Psw: number;
}

// Real APU with SPC700 CPU + DSP emulation.
// Audio output will be enabled once DSP BRR decode is verified.
export class Apu {
  private readonly spc700 = new Spc700();
  private readonly dsp = new Dsp();
  private sampleRate = 44100;

  // Pre-allocated stereo ring buffer for cycle-interleaved DSP samples
  private readonly bufCapacity = 8192;
  private readonly bufL = new Float32Array(8192);
  private readonly bufR = new Float32Array(8192);
  private bufRead = 0;
  private bufWrite = 0;
  private bufCount = 0;
  private sampleCycleAccum = 0;

  // Flag to enable/disable audio output (for verification)
  private audioEnabled = true;  // Enable by default now that BRR decode is implemented

  constructor() {
    this.spc700.reset();
    this.dsp.reset();
    // Give DSP access to SPC700 RAM for BRR samples
    this.dsp.setSpcRam(this.spc700.getRam());
    // Set up SPC700 to route DSP register access
    this.spc700.setDsp(this.dsp);
  }

  public getDebugState(): ApuDebugState {
    const state = this.spc700.getState();
    return {
      sampleRate: this.sampleRate,
      spc700Pc: state.pc,
      spc700A: state.a,
      spc700X: state.x,
      spc700Y: state.y,
      spc700Sp: state.sp,
      spc700Psw: state.psw,
    };
  }

  public getDspVoices() { return this.dsp.getVoiceDebugInfo(); }
  public getDspRegs() { return this.dsp.getRegs(); }

  public reset(): void {
    this.spc700.reset();
    this.dsp.reset();
    this.dsp.setSpcRam(this.spc700.getRam());
    this.bufRead = 0;
    this.bufWrite = 0;
    this.bufCount = 0;
    this.sampleCycleAccum = 0;
    this.audioEnabled = true;  // Keep audio enabled after reset
  }

  public setSampleRate(sampleRate: number): void {
    const safe = Math.max(8000, Math.min(192000, Math.floor(sampleRate)));
    this.sampleRate = safe;
  }

  public stepSpc(cycles: number): void {
    let remaining = Math.max(0, Math.floor(cycles));
    while (remaining > 0) {
      const step = remaining > 32 ? 32 : remaining;
      this.spc700.stepCycles(step);
      remaining -= step;

      this.sampleCycleAccum += step * this.sampleRate;
      while (this.sampleCycleAccum >= 1024000) {
        this.sampleCycleAccum -= 1024000;
        const sample = this.dsp.render(this.sampleRate);
        this.bufL[this.bufWrite] = sample.left;
        this.bufR[this.bufWrite] = sample.right;
        this.bufWrite = (this.bufWrite + 1) & 8191;
        if (this.bufCount < this.bufCapacity) {
          this.bufCount++;
        } else {
          this.bufRead = (this.bufRead + 1) & 8191;
        }
      }
    }
  }

  public discardBufferedSamples(): void {
    this.bufRead = 0;
    this.bufWrite = 0;
    this.bufCount = 0;
  }

  public applyPortEvent(event: ApuPortEvent): void {
    const port = event.port & 3;
    const value = event.value & 0xFF;
    this.spc700.writeCpuPort(port, value);
  }

  public readCpuPort(port: number): number {
    return this.spc700.readCpuPort(port);
  }

  public renderStereo(sampleCount: number): { left: Float32Array; right: Float32Array } {
    const count = Math.max(0, Math.floor(sampleCount));

    const left = new Float32Array(count);
    const right = new Float32Array(count);

    const fromBuf = Math.min(count, this.bufCount);
    for (let i = 0; i < fromBuf; i++) {
      left[i] = this.bufL[this.bufRead];
      right[i] = this.bufR[this.bufRead];
      this.bufRead = (this.bufRead + 1) & 8191;
    }
    this.bufCount -= fromBuf;

    for (let i = fromBuf; i < count; i++) {
      const sample = this.dsp.render(this.sampleRate);
      left[i] = sample.left;
      right[i] = sample.right;
    }

    return { left, right };
  }

  public enableAudio(): void {
    this.audioEnabled = true;
  }

  public disableAudio(): void {
    this.audioEnabled = false;
  }
}
