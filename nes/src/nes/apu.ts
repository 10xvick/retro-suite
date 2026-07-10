const LENGTH_TABLE = [
  10, 254, 20,  2, 40,  4, 80,  6, 160,  8, 60, 10, 14, 12, 26, 14,
  12,  16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30
];

export class APU {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  
  // Pulse 1
  private osc1: OscillatorNode | null = null;
  private gain1: GainNode | null = null;
  private pulse1Enabled = false;
  private pulse1Timer = 0;
  private pulse1Volume = 0;
  private pulse1Length = 0;
  private pulse1Halt = false;
  
  // Pulse 2
  private osc2: OscillatorNode | null = null;
  private gain2: GainNode | null = null;
  private pulse2Enabled = false;
  private pulse2Timer = 0;
  private pulse2Volume = 0;
  private pulse2Length = 0;
  private pulse2Halt = false;

  // Triangle
  private osc3: OscillatorNode | null = null;
  private gain3: GainNode | null = null;
  private triEnabled = false;
  private triTimer = 0;
  private triLength = 0;
  private triHalt = false;
  
  // Noise
  private noiseEnabled = false;
  private noiseLength = 0;
  private noiseHalt = false;
  
  // APU register state
  private apuStatus = 0;
  
  // Frame counter sequencer
  private frameCycles = 0;
  private frameMode = 0; // 0 = 4-step, 1 = 5-step
  private totalCycles = 0;

  // Frame IRQ
  private bus: any = null;
  private frameIrqActive = false;
  private irqInhibit = false;
  private pendingImmediateClock = false;

  constructor() {}

  public connectBus(bus: any) {
    this.bus = bus;
  }

  public init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.ctx.destination);
      
      // Setup Pulse 1
      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = 'square';
      this.gain1 = this.ctx.createGain();
      this.gain1.gain.value = 0;
      this.osc1.connect(this.gain1);
      this.gain1.connect(this.masterGain);
      this.osc1.start();

      // Setup Pulse 2
      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = 'square';
      this.gain2 = this.ctx.createGain();
      this.gain2.gain.value = 0;
      this.osc2.connect(this.gain2);
      this.gain2.connect(this.masterGain);
      this.osc2.start();

      // Setup Triangle
      this.osc3 = this.ctx.createOscillator();
      this.osc3.type = 'triangle';
      this.gain3 = this.ctx.createGain();
      this.gain3.gain.value = 0;
      this.osc3.connect(this.gain3);
      this.gain3.connect(this.masterGain);
      this.osc3.start();
    } catch (e) {
      console.error("Web Audio API not supported", e);
    }
  }

  public setVolume(volume: number) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(volume, this.ctx.currentTime);
    }
  }

  public reset() {
    this.pulse1Enabled = false;
    this.pulse1Timer = 0;
    this.pulse1Volume = 0;
    this.pulse1Length = 0;
    this.pulse1Halt = false;

    this.pulse2Enabled = false;
    this.pulse2Timer = 0;
    this.pulse2Volume = 0;
    this.pulse2Length = 0;
    this.pulse2Halt = false;

    this.triEnabled = false;
    this.triTimer = 0;
    this.triLength = 0;
    this.triHalt = false;

    this.noiseEnabled = false;
    this.noiseLength = 0;
    this.noiseHalt = false;

    this.apuStatus = 0;
    this.frameIrqActive = false;
    this.irqInhibit = false;
    this.frameCycles = 0;
    this.frameMode = 0;
    this.totalCycles = 0;
    this.pendingImmediateClock = false;
    
    this.updatePulse1Volume();
    this.updatePulse2Volume();
    this.updateTriangleVolume();
  }

  public write(addr: number, data: number) {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    switch (addr) {
      // Pulse 1
      case 0x4000:
        this.pulse1Volume = data & 0x0F;
        this.pulse1Halt = (data & 0x20) !== 0;
        this.updatePulse1Volume();
        break;
      case 0x4002:
        this.pulse1Timer = (this.pulse1Timer & 0x0700) | data;
        this.updatePulse1Frequency();
        break;
      case 0x4003:
        this.pulse1Timer = (this.pulse1Timer & 0x00FF) | ((data & 0x07) << 8);
        this.updatePulse1Frequency();
        if (this.pulse1Enabled) {
          this.pulse1Length = LENGTH_TABLE[data >> 3];
        }
        this.updatePulse1Volume();
        break;

      // Pulse 2
      case 0x4004:
        this.pulse2Volume = data & 0x0F;
        this.pulse2Halt = (data & 0x20) !== 0;
        this.updatePulse2Volume();
        break;
      case 0x4006:
        this.pulse2Timer = (this.pulse2Timer & 0x0700) | data;
        this.updatePulse2Frequency();
        break;
      case 0x4007:
        this.pulse2Timer = (this.pulse2Timer & 0x00FF) | ((data & 0x07) << 8);
        this.updatePulse2Frequency();
        if (this.pulse2Enabled) {
          this.pulse2Length = LENGTH_TABLE[data >> 3];
        }
        this.updatePulse2Volume();
        break;

      // Triangle
      case 0x4008:
        this.triHalt = (data & 0x80) !== 0;
        break;
      case 0x400A:
        this.triTimer = (this.triTimer & 0x0700) | data;
        this.updateTriangleFrequency();
        break;
      case 0x400B:
        this.triTimer = (this.triTimer & 0x00FF) | ((data & 0x07) << 8);
        this.updateTriangleFrequency();
        if (this.triEnabled) {
          this.triLength = LENGTH_TABLE[data >> 3];
        }
        this.updateTriangleVolume();
        break;

      // Noise
      case 0x400C:
        this.noiseHalt = (data & 0x20) !== 0;
        break;
      case 0x400F:
        if (this.noiseEnabled) {
          this.noiseLength = LENGTH_TABLE[data >> 3];
        }
        break;

      // APU Status
      case 0x4015:
        this.apuStatus = data;
        this.pulse1Enabled = (data & 0x01) !== 0;
        this.pulse2Enabled = (data & 0x02) !== 0;
        this.triEnabled = (data & 0x04) !== 0;
        this.noiseEnabled = (data & 0x08) !== 0;

        if (!this.pulse1Enabled) this.pulse1Length = 0;
        if (!this.pulse2Enabled) this.pulse2Length = 0;
        if (!this.triEnabled) this.triLength = 0;
        if (!this.noiseEnabled) this.noiseLength = 0;
        
        this.updatePulse1Volume();
        this.updatePulse2Volume();
        this.updateTriangleVolume();
        break;

      // APU Frame Counter
      case 0x4017:
        this.frameMode = (data & 0x80) !== 0 ? 1 : 0;
        this.irqInhibit = (data & 0x40) !== 0;
        this.frameCycles = (this.totalCycles % 2 === 0) ? -3 : -4;
        if (this.irqInhibit) {
          this.frameIrqActive = false;
        }
        if (this.frameMode === 1) {
          this.pendingImmediateClock = true;
        }
        break;
    }
  }

  public readStatus(): number {
    let status = 0;
    if (this.pulse1Length > 0) status |= 0x01;
    if (this.pulse2Length > 0) status |= 0x02;
    if (this.triLength > 0) status |= 0x04;
    if (this.noiseLength > 0) status |= 0x08;
    if (this.frameIrqActive) status |= 0x40;
    this.frameIrqActive = false;
    return status;
  }

  public clock() {
    this.totalCycles++;
    this.frameCycles++;

    if (this.frameCycles === 0 && this.pendingImmediateClock) {
      this.tickLengthCounters();
      this.pendingImmediateClock = false;
    }

    if (this.frameMode === 0) {
      // 4-step mode
      if (this.frameCycles === 14913 || this.frameCycles === 29829) {
        this.tickLengthCounters();
      }
      if (this.frameCycles === 29828 || this.frameCycles === 29829 || this.frameCycles === 29830) {
        if (!this.irqInhibit) {
          this.frameIrqActive = true;
        }
      }
      if (this.frameCycles >= 29830) {
        this.frameCycles = 0;
      }
    } else {
      // 5-step mode
      if (this.frameCycles === 14913 || this.frameCycles === 37281) {
        this.tickLengthCounters();
      }
      if (this.frameCycles >= 37282) {
        this.frameCycles = 0;
      }
    }

    if (this.frameIrqActive && !this.irqInhibit) {
      if (this.bus && this.bus.cpu) {
        this.bus.cpu.irq();
      }
    }
  }

  private tickLengthCounters() {
    // Pulse 1
    if (this.pulse1Enabled && !this.pulse1Halt && this.pulse1Length > 0) {
      this.pulse1Length--;
      if (this.pulse1Length === 0) {
        this.updatePulse1Volume();
      }
    }
    // Pulse 2
    if (this.pulse2Enabled && !this.pulse2Halt && this.pulse2Length > 0) {
      this.pulse2Length--;
      if (this.pulse2Length === 0) {
        this.updatePulse2Volume();
      }
    }
    // Triangle
    if (this.triEnabled && !this.triHalt && this.triLength > 0) {
      this.triLength--;
      if (this.triLength === 0) {
        this.updateTriangleVolume();
      }
    }
    // Noise
    if (this.noiseEnabled && !this.noiseHalt && this.noiseLength > 0) {
      this.noiseLength--;
    }
  }

  private updatePulse1Frequency() {
    if (this.osc1 && this.ctx) {
      const freq = 111860.8 / (this.pulse1Timer + 1);
      if (freq > 20 && freq < 20000) {
        this.osc1.frequency.setValueAtTime(freq, this.ctx.currentTime);
      }
    }
  }

  private updatePulse1Volume() {
    if (this.gain1 && this.ctx) {
      const active = this.pulse1Enabled && this.pulse1Length > 0;
      const targetGain = active ? (this.pulse1Volume / 15.0) * 0.15 : 0;
      this.gain1.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.01);
    }
  }

  private updatePulse2Frequency() {
    if (this.osc2 && this.ctx) {
      const freq = 111860.8 / (this.pulse2Timer + 1);
      if (freq > 20 && freq < 20000) {
        this.osc2.frequency.setValueAtTime(freq, this.ctx.currentTime);
      }
    }
  }

  private updatePulse2Volume() {
    if (this.gain2 && this.ctx) {
      const active = this.pulse2Enabled && this.pulse2Length > 0;
      const targetGain = active ? (this.pulse2Volume / 15.0) * 0.15 : 0;
      this.gain2.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.01);
    }
  }

  private updateTriangleFrequency() {
    if (this.osc3 && this.ctx) {
      const freq = 55930.4 / (this.triTimer + 1);
      if (freq > 20 && freq < 20000) {
        this.osc3.frequency.setValueAtTime(freq, this.ctx.currentTime);
      }
    }
  }

  private updateTriangleVolume() {
    if (this.gain3 && this.ctx) {
      const active = this.triEnabled && this.triLength > 0;
      const targetGain = active ? 0.20 : 0;
      this.gain3.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.01);
    }
  }
}
