import type { ApuPortBridge, ApuPortWriteEvent } from './ApuPortBridge';
import { Apu } from './Apu';
import type { ApuDebugState } from './Apu';

export interface AudioFrameRequest {
  cpuCycles: number;
}

export interface AudioDebugState {
  enabled: boolean;
  volume: number;
  queueChunks: number;
  queueSamples: number;
  rmsL: number;
  rmsR: number;
  zeroCrossRate: number;
  clipRatio: number;
}

export class AudioEngine {
  private enabled = false;
  public readonly apuBridge: ApuPortBridge;

  private context: AudioContext | null = null;
  private audioNode: ScriptProcessorNode | null = null;
  private gainNode: GainNode | null = null;

  // Pre-allocated circular ring buffer (16,384 frames capacity ~ 370ms at 44.1kHz)
  private readonly ringCapacity = 16384;
  private readonly ringL = new Float32Array(16384);
  private readonly ringR = new Float32Array(16384);
  private ringWrite = 0;
  private ringRead = 0;
  private ringCount = 0;

  private volume = 0.35;
  public tempo = 1.0;
  public readonly apu = new Apu();
  private rmsL = 0;
  private rmsR = 0;
  private zeroCrossRate = 0;
  private clipRatio = 0;
  private queueChunks = 0;

  private lastSyncCpuCycles = 0;
  private pendingSpcCycles = 0;
  private lastFrameCpuCycles = 0;

  constructor(apuBridge: ApuPortBridge) {
    this.apuBridge = apuBridge;
    this.apuBridge.onReadPort = (port: number) => {
      // Always expose real APU ports so SNES<->SPC handshake remains accurate
      // even before the user enables WebAudio output.
      return this.apu.readCpuPort(port);
    };

    this.apuBridge.onSync = (cpuCycles: number) => {
      // Always sync SPC700 so the SNES CPU can communicate with it
      if (cpuCycles < this.lastSyncCpuCycles) {
        this.lastSyncCpuCycles = cpuCycles;
        this.lastFrameCpuCycles = cpuCycles;
      }

      const elapsedCpuCycles = cpuCycles - this.lastSyncCpuCycles;
      if (elapsedCpuCycles > 0) {
        this.pendingSpcCycles += elapsedCpuCycles * (1024000 / 3579545);
        const toRun = Math.floor(this.pendingSpcCycles);
        if (toRun > 0) {
          const events = this.apuBridge.consumeWriteEvents();
          this.applyApuEvents(events);
          this.apu.stepSpc(toRun);
          this.pendingSpcCycles -= toRun;
        }
      }
      this.lastSyncCpuCycles = cpuCycles;
    };
  }

  public async enable(): Promise<void> {
    this.enabled = true;
    await this.ensureAudioGraph();
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  public disable(): void {
    this.enabled = false;
    this.ringRead = 0;
    this.ringWrite = 0;
    this.ringCount = 0;
    if (this.context && this.context.state === 'running') {
      void this.context.suspend();
    }
  }

  public reset(): void {
    this.ringRead = 0;
    this.ringWrite = 0;
    this.ringCount = 0;
    this.apu.reset();
  }

  public updateFrame(req: AudioFrameRequest): void {
    // Always catch up any remaining cycles in the frame
    if (this.apuBridge.onSync) {
      this.apuBridge.onSync(req.cpuCycles);
    }

    if (!this.enabled) {
      // Render DSP to update internal registers (ENDX, timers)
      const sampleRate = 2000;
      const sampleCount = (req.cpuCycles - this.lastFrameCpuCycles) / 3579545 * sampleRate;
      if (sampleCount > 0) {
        this.apu.renderStereo(sampleCount);
      }
      this.lastFrameCpuCycles = req.cpuCycles;
      return;
    }

    const events = this.apuBridge.consumeWriteEvents();
    this.applyApuEvents(events);

    const sampleRate = this.context?.sampleRate ?? 44100;
    const elapsedFrameCycles = Math.max(0, req.cpuCycles - this.lastFrameCpuCycles);
    this.lastFrameCpuCycles = req.cpuCycles;

    const samplesForFrame = Math.max(1, Math.floor((sampleRate * elapsedFrameCycles * this.tempo) / 3579545));
    this.apu.setSampleRate(sampleRate);
    const stereo = this.apu.renderStereo(samplesForFrame);

    this.pushStereoToRing(stereo.left, stereo.right);
  }

  private pushStereoToRing(left: Float32Array, right: Float32Array): void {
    const len = left.length;
    for (let i = 0; i < len; i++) {
      this.ringL[this.ringWrite] = left[i];
      this.ringR[this.ringWrite] = right[i];
      this.ringWrite = (this.ringWrite + 1) % this.ringCapacity;
    }
    this.ringCount = Math.min(this.ringCapacity, this.ringCount + len);

    // Hard bound: keep buffer depth below 4096 frames (~92ms) to eliminate latency buildup
    if (this.ringCount > 4096) {
      const drop = this.ringCount - 2048;
      this.ringRead = (this.ringRead + drop) % this.ringCapacity;
      this.ringCount = 2048;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
  }

  public setTempo(tempo: number): void {
    this.tempo = Math.max(0.25, Math.min(4, tempo));
  }

  public getVolume(): number {
    return this.volume;
  }

  public getContext(): AudioContext | null {
    return this.context;
  }

  public getGainNode(): GainNode | null {
    return this.gainNode;
  }

  public getDebugState(): AudioDebugState {
    return {
      enabled: this.enabled,
      volume: this.volume,
      queueChunks: this.queueChunks,
      queueSamples: this.ringCount,
      rmsL: this.rmsL,
      rmsR: this.rmsR,
      zeroCrossRate: this.zeroCrossRate,
      clipRatio: this.clipRatio,
    };
  }

  public getApuDebugState(): ApuDebugState {
    return this.apu.getDebugState();
  }

  private async ensureAudioGraph(): Promise<void> {
    if (this.context) return;

    const AudioContextCtor =
      (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    this.context = new AudioContextCtor({ sampleRate: 44100, latencyHint: 'interactive' });
    this.apu.setSampleRate(this.context.sampleRate);

    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = this.volume;
    this.gainNode.connect(this.context.destination);

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.audioNode = this.context.createScriptProcessor(2048, 0, 2);
    this.audioNode.onaudioprocess = (e: AudioProcessingEvent) => {
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      const needed = outL.length;

      if (!this.enabled || this.ringCount === 0) {
        outL.fill(0);
        outR.fill(0);
        return;
      }

      let sumSqL = 0;
      let sumSqR = 0;
      let clips = 0;
      let zc = 0;
      let prevL = 0;

      const toCopy = Math.min(needed, this.ringCount);
      for (let i = 0; i < toCopy; i++) {
        const sL = this.ringL[this.ringRead];
        const sR = this.ringR[this.ringRead];
        this.ringRead = (this.ringRead + 1) % this.ringCapacity;
        outL[i] = sL;
        outR[i] = sR;

        sumSqL += sL * sL;
        sumSqR += sR * sR;
        if (Math.abs(sL) > 0.995 || Math.abs(sR) > 0.995) clips++;
        if ((sL >= 0 && prevL < 0) || (sL < 0 && prevL >= 0)) zc++;
        prevL = sL;
      }
      this.ringCount -= toCopy;

      if (toCopy < needed) {
        for (let i = toCopy; i < needed; i++) {
          outL[i] = 0;
          outR[i] = 0;
        }
      }

      this.rmsL = Math.sqrt(sumSqL / needed);
      this.rmsR = Math.sqrt(sumSqR / needed);
      this.zeroCrossRate = zc / needed;
      this.clipRatio = clips / needed;
      this.queueChunks = Math.floor(this.ringCount / 512);
    };

    this.audioNode.connect(this.gainNode);
  }

  private applyApuEvents(events: ApuPortWriteEvent[]): void {
    for (const ev of events) {
      this.apu.applyPortEvent(ev);
    }
  }
}
