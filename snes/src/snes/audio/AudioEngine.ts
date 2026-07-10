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

// Inline AudioWorklet processor as a data URL so no external file is needed.
// It consumes stereo Float32 chunks posted via messages and writes them to the
// output buffer, padding with silence on underrun.
const WORKLET_PROCESSOR_CODE = `
class SnesQueueProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queueL = [];
    this._queueR = [];
    this._offset = 0;
    this._rmsL = 0;
    this._rmsR = 0;
    this._clips = 0;
    this._zc = 0;
    this._prev = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === 'push') {
        this._queueL.push(e.data.left);
        this._queueR.push(e.data.right);
      } else if (e.data.type === 'flush') {
        this._queueL.length = 0;
        this._queueR.length = 0;
        this._offset = 0;
      }
    };
  }

  process(inputs, outputs) {
    const outL = outputs[0][0];
    const outR = outputs[0][1];
    if (!outL) return true;

    let sumSqL = 0, sumSqR = 0, clips = 0, zc = 0;
    const prev = this._prev;

    for (let i = 0; i < outL.length; i++) {
      let sL = 0, sR = 0;
      while (this._queueL.length > 0) {
        const hL = this._queueL[0];
        const hR = this._queueR[0] ?? hL;
        if (this._offset < hL.length) {
          sL = hL[this._offset];
          sR = hR[this._offset];
          this._offset++;
          break;
        }
        this._queueL.shift();
        this._queueR.shift();
        this._offset = 0;
      }
      outL[i] = sL;
      outR[i] = sR;
      sumSqL += sL * sL;
      sumSqR += sR * sR;
      if (Math.abs(sL) > 0.995 || Math.abs(sR) > 0.995) clips++;
      if ((sL >= 0 && this._prev < 0) || (sL < 0 && this._prev >= 0)) zc++;
      this._prev = sL;
    }
    const n = Math.max(1, outL.length);
    this.port.postMessage({
      type: 'stats',
      rmsL: Math.sqrt(sumSqL / n),
      rmsR: Math.sqrt(sumSqR / n),
      zeroCrossRate: zc / n,
      clipRatio: clips / n,
      queueChunks: this._queueL.length,
    });
    return true;
  }
}
registerProcessor('snes-queue-processor', SnesQueueProcessor);
`;

export class AudioEngine {
  private enabled = false;
  public readonly apuBridge: ApuPortBridge;

  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;
  private workletReady = false;
  private workletLoading = false;

  // Queue for when worklet isn't ready yet — chunks to push once connected
  private readonly pendingQueue: Array<{ left: Float32Array; right: Float32Array }> = [];

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
  private _debugFrameCount = 0;

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
    this.pendingQueue.length = 0;
    if (this.context && this.context.state === 'running') {
      void this.context.suspend();
    }
  }

  public reset(): void {
    this.pendingQueue.length = 0;
    // Flush worklet queue
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'flush' });
    }
    this.apu.reset();
  }

  public updateFrame(req: AudioFrameRequest): void {
    // Always catch up any remaining cycles in the frame
    if (this.apuBridge.onSync) {
      this.apuBridge.onSync(req.cpuCycles);
    }

    if (!this.enabled) {
      // We must still render the DSP so it updates its internal state (e.g. ENDX register)
      // Otherwise games that poll ENDX will freeze if audio is disabled
      const sampleRate = 2000; // Low frequency rendering to prevent overhead
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

    // Debug: log audio state periodically
    if (!this._debugFrameCount) this._debugFrameCount = 0;
    this._debugFrameCount++;
    if (this._debugFrameCount % 120 === 0) {
      let sumL = 0, sumR = 0, nonZero = 0;
      for (let i = 0; i < stereo.left.length; i++) {
        sumL += Math.abs(stereo.left[i]);
        sumR += Math.abs(stereo.right[i]);
        if (stereo.left[i] !== 0 || stereo.right[i] !== 0) nonZero++;
      }
      const dbg = this.apu.getDebugState();
      const voices = this.apu.getDspVoices();
      const regs = this.apu.getDspRegs();
      const mvolL = regs[0x0C]; const mvolR = regs[0x1C];
      const activeVoices = voices.filter(v => v.on);
      const voiceSummary = activeVoices.map(v => `v${v.idx}:env=${v.env}vol=${v.volL}/${v.volR}pitch=${v.pitch}`).join(' ');
      console.log(`[Audio] frame=${this._debugFrameCount} samples=${samplesForFrame} nonzero=${nonZero}/${stereo.left.length} avgL=${(sumL/stereo.left.length).toFixed(4)} avgR=${(sumR/stereo.right.length).toFixed(4)} spcPC=$${dbg.spc700Pc.toString(16)} worklet=${this.workletReady} mvol=${mvolL}/${mvolR} active=${activeVoices.length} ${voiceSummary}`);
    }

    this.pushStereoChunk(stereo.left, stereo.right);

    // Ensure a minimum reservoir (~2 frames) to prevent underrun crackle
    const minQueuedSamples = 2048;
    const approxQueued = this.queueChunks * samplesForFrame;
    if (approxQueued < minQueuedSamples) {
      const refill = this.apu.renderStereo(minQueuedSamples - approxQueued);
      this.pushStereoChunk(refill.left, refill.right);
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

  public getDebugState(): AudioDebugState {
    return {
      enabled: this.enabled,
      volume: this.volume,
      queueChunks: this.queueChunks,
      queueSamples: this.queueChunks * 512, // approx
      rmsL: this.rmsL,
      rmsR: this.rmsR,
      zeroCrossRate: this.zeroCrossRate,
      clipRatio: this.clipRatio,
    };
  }

  public getApuDebugState(): ApuDebugState {
    return this.apu.getDebugState();
  }

  private pushStereoChunk(left: Float32Array, right: Float32Array): void {
    if (this.workletReady && this.workletNode) {
      // Drain pending queue first
      while (this.pendingQueue.length > 0) {
        const chunk = this.pendingQueue.shift()!;
        this.workletNode.port.postMessage(
          { type: 'push', left: chunk.left, right: chunk.right },
          [chunk.left.buffer, chunk.right.buffer]
        );
      }
      this.workletNode.port.postMessage(
        { type: 'push', left, right },
        [left.buffer, right.buffer]
      );
    } else {
      // Buffer until worklet is ready (cap at ~400ms to avoid unbounded growth)
      if (this.pendingQueue.length < 50) {
        this.pendingQueue.push({ left, right });
      }
    }
  }

  private async ensureAudioGraph(): Promise<void> {
    if (this.context) return;
    if (this.workletLoading) return;

    const AudioContextCtor =
      (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    this.context = new AudioContextCtor({ sampleRate: 44100, latencyHint: 'interactive' });
    this.apu.setSampleRate(this.context.sampleRate);

    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = this.volume;
    this.gainNode.connect(this.context.destination);

    // Load the AudioWorklet processor from an inline blob URL
    this.workletLoading = true;
    try {
      const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      await this.context.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      this.workletNode = new AudioWorkletNode(this.context, 'snes-queue-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      // Receive stats and queue size back from the worklet
      this.workletNode.port.onmessage = (e) => {
        if (e.data.type === 'stats') {
          this.rmsL = e.data.rmsL;
          this.rmsR = e.data.rmsR;
          this.zeroCrossRate = e.data.zeroCrossRate;
          this.clipRatio = e.data.clipRatio;
          this.queueChunks = e.data.queueChunks;
        }
      };

      this.workletNode.connect(this.gainNode);
      this.workletReady = true;
    } catch (err) {
      console.warn('[AudioEngine] AudioWorklet failed, falling back to ScriptProcessor:', err);
      this.workletLoading = false;
      this.fallbackToScriptProcessor();
      return;
    }
    this.workletLoading = false;
  }

  private fallbackToScriptProcessor(): void {
    if (!this.context || !this.gainNode) return;

    // Fallback queue for ScriptProcessor
    const queueL: Float32Array[] = [];
    const queueR: Float32Array[] = [];
    let queueOffset = 0;

    // Override pushStereoChunk to fill local queues
    const origPush = this.pushStereoChunk.bind(this);
    this.pushStereoChunk = (left: Float32Array, right: Float32Array) => {
      queueL.push(left);
      queueR.push(right);
      // Cap at ~400ms
      const maxChunks = Math.floor((this.context?.sampleRate ?? 44100) * 0.4 / 512);
      if (queueL.length > maxChunks) { queueL.shift(); queueR.shift(); queueOffset = 0; }
    };

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const scriptNode = this.context.createScriptProcessor(1024, 0, 2);
    scriptNode.onaudioprocess = (evt: AudioProcessingEvent) => {
      const outL = evt.outputBuffer.getChannelData(0);
      const outR = evt.outputBuffer.getChannelData(1);
      for (let i = 0; i < outL.length; i++) {
        let sL = 0, sR = 0;
        while (queueL.length > 0) {
          const hL = queueL[0]; const hR = queueR[0] ?? hL;
          if (queueOffset < hL.length) { sL = hL[queueOffset]; sR = hR[queueOffset]; queueOffset++; break; }
          queueL.shift(); queueR.shift(); queueOffset = 0;
        }
        outL[i] = sL; outR[i] = sR;
      }
    };
    scriptNode.connect(this.gainNode);
  }

  private applyApuEvents(events: ApuPortWriteEvent[]): void {
    for (const ev of events) {
      this.apu.applyPortEvent(ev);
    }
  }
}
