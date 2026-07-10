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
    this.audioEnabled = true;  // Keep audio enabled after reset
  }

  public setSampleRate(sampleRate: number): void {
    const safe = Math.max(8000, Math.min(192000, Math.floor(sampleRate)));
    this.sampleRate = safe;
  }

  public stepSpc(cycles: number): void {
    this.spc700.stepCycles(cycles);
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

    for (let i = 0; i < count; i++) {
      const sample = this.dsp.render(this.sampleRate);
      left[i] = sample.left;
      right[i] = sample.right;
    }

    return { left, right };
  }

  private diagnosticCounter = 0;

  public enableAudio(): void {
    this.audioEnabled = true;
  }

  public disableAudio(): void {
    this.audioEnabled = false;
  }
}
