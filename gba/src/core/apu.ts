// GBA APU — audio processing unit stub with PSG + FIFO sample mixing.
// Reconstructed implementation: provides the API surface used by gba.ts,
// memory.ts and the shell's GbaEmulatorCore audio handler.
//
// Sample rate: 32768 Hz (16.78 MHz / 512). Stereo output via readSamples().

const SAMPLE_RATE = 32768;
const CYCLES_PER_SAMPLE = 16777216 / SAMPLE_RATE; // 512
const FIFO_LEN = 32;

class Fifo {
    private buf = new Uint8Array(FIFO_LEN);
    private head = 0;
    private tail = 0;
    private count = 0;

    push(v: number) {
        if (this.count >= FIFO_LEN) {
            this.head = (this.head + 1) % FIFO_LEN;
            this.count--;
        }
        this.buf[this.tail] = v & 0xff;
        this.tail = (this.tail + 1) % FIFO_LEN;
        this.count++;
    }

    pop(): number | undefined {
        if (this.count === 0) return undefined;
        const v = this.buf[this.head];
        this.head = (this.head + 1) % FIFO_LEN;
        this.count--;
        return v;
    }

    get size(): number { return this.count; }
    clear() { this.head = 0; this.tail = 0; this.count = 0; }

    toArray(): number[] {
        const res: number[] = [];
        for (let i = 0; i < this.count; i++) {
            res.push(this.buf[(this.head + i) % FIFO_LEN]);
        }
        return res;
    }

    fromArray(arr: number[]) {
        this.clear();
        for (const v of arr) this.push(v);
    }
}

// Simple square-wave PSG channel
class SquareChannel {
    active = false;
    frequency = 0;
    duty = 2; // 0:12.5% 1:25% 2:50% 3:75%
    volume = 0;
    timer = 0;
    step = 0;
    enable = false;

    reset() {
        this.active = false;
        this.frequency = 0;
        this.duty = 2;
        this.volume = 0;
        this.timer = 0;
        this.step = 0;
        this.enable = false;
    }

    tick(cycles: number) {
        if (!this.enable || this.volume === 0) return;
        this.timer -= cycles;
        while (this.timer <= 0) {
            this.timer += (2048 - this.frequency) * 16;
            this.step = (this.step + 1) & 7;
        }
    }

    sample(): number {
        if (!this.enable || this.volume === 0) return 0;
        const dutyTable = [0x01, 0x03, 0x0f, 0xfc]; // bit per step
        const on = (dutyTable[this.duty] >> this.step) & 1;
        return on ? this.volume / 15 : -this.volume / 15;
    }
}

// Wave channel (4-bit samples from wave RAM)
class WaveChannel {
    active = false;
    volume = 0;
    frequency = 0;
    enable = false;
    pos = 0;
    timer = 0;
    waveRam: Uint8Array = new Uint8Array(32);

    reset() {
        this.active = false;
        this.volume = 0;
        this.frequency = 0;
        this.enable = false;
        this.pos = 0;
        this.timer = 0;
        this.waveRam.fill(0);
    }

    tick(cycles: number) {
        if (!this.enable || this.volume === 0) return;
        this.timer -= cycles;
        while (this.timer <= 0) {
            this.timer += (2048 - this.frequency) * 8;
            this.pos = (this.pos + 1) & 31;
        }
    }

    sample(): number {
        if (!this.enable || this.volume === 0) return 0;
        const byte = this.waveRam[this.pos >> 1];
        const nib = (this.pos & 1) ? (byte & 0xf) : (byte >> 4);
        const volShift = [5, 4, 3, 2][Math.min(this.volume, 3)] ?? 5;
        return ((nib >> 1) - 7.5) / 7.5 / (volShift / 2);
    }
}

// Noise channel (LFSR)
class NoiseChannel {
    active = false;
    volume = 0;
    enable = false;
    lfsr = 0x7fff;
    timer = 0;
    shift = 3;

    reset() {
        this.active = false;
        this.volume = 0;
        this.enable = false;
        this.lfsr = 0x7fff;
        this.timer = 0;
        this.shift = 3;
    }

    tick(cycles: number) {
        if (!this.enable || this.volume === 0) return;
        this.timer -= cycles;
        while (this.timer <= 0) {
            this.timer += 64 << this.shift;
            const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
            this.lfsr = (this.lfsr >> 1) | (bit << 14);
        }
    }

    sample(): number {
        if (!this.enable || this.volume === 0) return 0;
        return (this.lfsr & 1) ? this.volume / 15 : -this.volume / 15;
    }
}

export class Apu {
    // Channels
    sq1 = new SquareChannel();
    sq2 = new SquareChannel();
    wave = new WaveChannel();
    noise = new NoiseChannel();
    // Aliases used by memory.ts SOUNDCNT_X status read
    get waveActive(): boolean { return this.wave.active; }
    get noiseActive(): boolean { return this.noise.active; }

    // FIFOs for direct sound A/B
    private fifoA = new Fifo();
    private fifoB = new Fifo();
    fifoATimer = 0; // 0 = Timer 0, 1 = Timer 1
    fifoBTimer = 0; // 0 = Timer 0, 1 = Timer 1
    fifoAEnableRight = false;
    fifoAEnableLeft = false;
    fifoBEnableRight = false;
    fifoBEnableLeft = false;
    fifoAVolume = 1; // 0: 50%, 1: 100%
    fifoBVolume = 1; // 0: 50%, 1: 100%
    psgVolumeRatio = 2; // 0: 25%, 1: 50%, 2: 100%

    // Output latches for Direct Sound
    sampleA = 0;
    sampleB = 0;

    get fifoAEnable(): boolean { return this.fifoAEnableLeft || this.fifoAEnableRight; }
    get fifoBEnable(): boolean { return this.fifoBEnableLeft || this.fifoBEnableRight; }

    // Master state
    masterEnable = false;
    psgVolume = 3; // 0-7 (master volume)
    dmaRequest: ((fifo: 0 | 1) => void) | null = null;

    // Output ring buffer (stereo interleaved L,R)
    private buf = new Float32Array(32768);
    private readPos = 0;
    private writePos = 0;
    private count = 0;
    private frac = 0;

    // Register mirrors for save-state fidelity (0x60-0xAF)
    private regs = new Uint8Array(0x60);

    reset() {
        this.sq1.reset();
        this.sq2.reset();
        this.wave.reset();
        this.noise.reset();
        this.fifoA.clear();
        this.fifoB.clear();
        this.fifoATimer = 0;
        this.fifoBTimer = 0;
        this.fifoAEnableRight = false;
        this.fifoAEnableLeft = false;
        this.fifoBEnableRight = false;
        this.fifoBEnableLeft = false;
        this.fifoAVolume = 1;
        this.fifoBVolume = 1;
        this.psgVolumeRatio = 2;
        this.sampleA = 0;
        this.sampleB = 0;
        this.masterEnable = false;
        this.psgVolume = 3;
        this.regs.fill(0);
        this.readPos = this.writePos = this.count = this.frac = 0;
    }

    tick(cycles: number) {
        if (this.masterEnable) {
            this.sq1.tick(cycles);
            this.sq2.tick(cycles);
            this.wave.tick(cycles);
            this.noise.tick(cycles);
        }

        this.frac += cycles;
        while (this.frac >= CYCLES_PER_SAMPLE) {
            this.frac -= CYCLES_PER_SAMPLE;
            this.produceSample();
        }
    }

    private produceSample() {
        let left = 0, right = 0;
        if (this.masterEnable) {
            const s1 = this.sq1.sample(), s2 = this.sq2.sample();
            const sw = this.wave.sample(), sn = this.noise.sample();
            const psgRatio = this.psgVolumeRatio === 0 ? 0.25 : this.psgVolumeRatio === 1 ? 0.5 : 1.0;
            const psg = (s1 + s2 + sw + sn) / 4 * psgRatio;
            left += psg;
            right += psg;
        }

        const volA = this.fifoAVolume === 0 ? 0.5 : 1.0;
        const outA = this.sampleA * volA;
        if (this.fifoAEnableLeft) left += outA;
        if (this.fifoAEnableRight) right += outA;

        const volB = this.fifoBVolume === 0 ? 0.5 : 1.0;
        const outB = this.sampleB * volB;
        if (this.fifoBEnableLeft) left += outB;
        if (this.fifoBEnableRight) right += outB;

        left = Math.max(-1, Math.min(1, left));
        right = Math.max(-1, Math.min(1, right));

        if (this.count >= this.buf.length) {
            this.readPos = (this.readPos + 2) % this.buf.length;
            this.count -= 2;
        }
        this.buf[this.writePos] = left;
        this.buf[(this.writePos + 1) % this.buf.length] = right;
        this.writePos = (this.writePos + 2) % this.buf.length;
        this.count += 2;
    }

    /** Frames buffered (stereo frame = 2 samples). */
    get bufferedFrames(): number {
        return this.count >> 1;
    }

    /** Read up to `max` interleaved stereo samples. Returns samples written. */
    readSamples(out: Float32Array, max: number): number {
        let n = 0;
        while (n < max && this.count > 0) {
            out[n++] = this.buf[this.readPos];
            this.readPos = (this.readPos + 1) % this.buf.length;
            this.count--;
        }
        return n;
    }

    pushFifoByte(off: number, byte: number) {
        if (off <= 0xa3) this.fifoA.push(byte);
        else this.fifoB.push(byte);
    }

    notifyDmaRan(_fifo: number) {
        // DMA word transfer handled via pushFifoByte; nothing extra needed.
    }

    onTimerOverflow(timer: number) {
        // Direct-sound sample latch on timer overflow (timer A/B: 0 or 1).
        if (timer === this.fifoATimer && (this.fifoAEnableLeft || this.fifoAEnableRight)) {
            const v = this.fifoA.pop();
            if (v !== undefined) {
                this.sampleA = ((v << 24) >> 24) / 128;
            }
            if (this.fifoA.size <= 16 && this.dmaRequest) {
                this.dmaRequest(0);
            }
        }
        if (timer === this.fifoBTimer && (this.fifoBEnableLeft || this.fifoBEnableRight)) {
            const v = this.fifoB.pop();
            if (v !== undefined) {
                this.sampleB = ((v << 24) >> 24) / 128;
            }
            if (this.fifoB.size <= 16 && this.dmaRequest) {
                this.dmaRequest(1);
            }
        }
    }

    private touches(off: number, size: number, reg: number, regLen: number): boolean {
        return off < reg + regLen && (off + size) > reg;
    }

    private reg16(regOff: number): number {
        const b = regOff - 0x60;
        return this.regs[b] | (this.regs[b + 1] << 8);
    }

    writeRegister(off: number, val: number, size: 1 | 2 | 4) {
        const base = off - 0x60;
        for (let i = 0; i < size; i++) {
            this.regs[base + i] = (val >>> (i * 8)) & 0xff;
        }

        // PSG Channel 1
        if (this.touches(off, size, 0x060, 2)) {
            const v = this.reg16(0x060);
            this.sq1.duty = (v >> 6) & 3;
        }
        if (this.touches(off, size, 0x062, 2)) {
            const v = this.reg16(0x062);
            this.sq1.volume = (v >> 12) & 15;
        }
        if (this.touches(off, size, 0x064, 2)) {
            const v = this.reg16(0x064);
            this.sq1.frequency = v & 0x7ff;
            if (v & 0x8000) {
                this.sq1.enable = this.masterEnable;
                this.sq1.timer = (2048 - this.sq1.frequency) * 16;
                this.sq1.step = 0;
            }
            this.sq1.active = this.sq1.enable && this.sq1.volume > 0;
        }

        // PSG Channel 2
        if (this.touches(off, size, 0x068, 2)) {
            const v = this.reg16(0x068);
            this.sq2.duty = (v >> 6) & 3;
            this.sq2.volume = (v >> 12) & 15;
        }
        if (this.touches(off, size, 0x06c, 2)) {
            const v = this.reg16(0x06c);
            this.sq2.frequency = v & 0x7ff;
            if (v & 0x8000) {
                this.sq2.enable = this.masterEnable;
                this.sq2.timer = (2048 - this.sq2.frequency) * 16;
                this.sq2.step = 0;
            }
            this.sq2.active = this.sq2.enable && this.sq2.volume > 0;
        }

        // PSG Channel 3
        if (this.touches(off, size, 0x070, 2)) {
            const v = this.reg16(0x070);
            this.wave.enable = (v & 0x80) !== 0 && this.masterEnable;
        }
        if (this.touches(off, size, 0x072, 2)) {
            const v = this.reg16(0x072);
            this.wave.volume = (v >> 13) & 3;
        }
        if (this.touches(off, size, 0x074, 2)) {
            const v = this.reg16(0x074);
            this.wave.frequency = v & 0x7ff;
            if (v & 0x8000) {
                this.wave.enable = this.masterEnable;
                this.wave.timer = (2048 - this.wave.frequency) * 8;
                this.wave.pos = 0;
            }
            this.wave.active = this.wave.enable;
        }

        // PSG Channel 4
        if (this.touches(off, size, 0x078, 2)) {
            const v = this.reg16(0x078);
            this.noise.volume = (v >> 12) & 15;
        }
        if (this.touches(off, size, 0x07c, 2)) {
            const v = this.reg16(0x07c);
            this.noise.shift = (v >> 4) & 0xf;
            if (v & 0x8000) {
                this.noise.enable = this.masterEnable;
                this.noise.timer = 64 << this.noise.shift;
            }
            this.noise.active = this.noise.enable && this.noise.volume > 0;
        }

        // Control Registers
        if (this.touches(off, size, 0x080, 2)) {
            const v = this.reg16(0x080);
            this.psgVolume = v & 7;
        }
        if (this.touches(off, size, 0x082, 2)) {
            const v = this.reg16(0x082);
            this.psgVolumeRatio = v & 3;
            this.fifoAVolume = (v >> 2) & 1;
            this.fifoBVolume = (v >> 3) & 1;
            this.fifoAEnableRight = (v & 0x0100) !== 0;
            this.fifoAEnableLeft = (v & 0x0200) !== 0;
            this.fifoATimer = (v >> 10) & 1;
            if (v & 0x0800) {
                this.fifoA.clear();
                this.sampleA = 0;
            }
            this.fifoBEnableRight = (v & 0x1000) !== 0;
            this.fifoBEnableLeft = (v & 0x2000) !== 0;
            this.fifoBTimer = (v >> 14) & 1;
            if (v & 0x8000) {
                this.fifoB.clear();
                this.sampleB = 0;
            }
        }
        if (this.touches(off, size, 0x084, 2)) {
            const v = this.reg16(0x084);
            this.masterEnable = (v & 0x80) !== 0;
            if (!this.masterEnable) {
                this.sq1.enable = false;
                this.sq1.active = false;
                this.sq2.enable = false;
                this.sq2.active = false;
                this.wave.enable = false;
                this.wave.active = false;
                this.noise.enable = false;
                this.noise.active = false;
            }
        }

        // Wave RAM (0x090 - 0x09F)
        if (off >= 0x90 && off < 0xa0) {
            for (let i = 0; i < size; i++) {
                const o = off + i;
                if (o >= 0x90 && o < 0xa0) {
                    this.wave.waveRam[o - 0x90] = (val >>> (i * 8)) & 0xff;
                }
            }
        }

        // Direct FIFO writes (0x0A0..0x0A3 and 0x0A4..0x0A7)
        if (this.touches(off, size, 0x0a0, 4)) {
            for (let i = 0; i < size; i++) {
                const o = off + i;
                if (o >= 0x0a0 && o <= 0x0a3) {
                    this.fifoA.push((val >>> (i * 8)) & 0xff);
                }
            }
        }
        if (this.touches(off, size, 0x0a4, 4)) {
            for (let i = 0; i < size; i++) {
                const o = off + i;
                if (o >= 0x0a4 && o <= 0x0a7) {
                    this.fifoB.push((val >>> (i * 8)) & 0xff);
                }
            }
        }
    }

    saveState(): any {
        return {
            regs: Array.from(this.regs),
            masterEnable: this.masterEnable,
            psgVolume: this.psgVolume,
            psgVolumeRatio: this.psgVolumeRatio,
            fifoA: this.fifoA.toArray(),
            fifoB: this.fifoB.toArray(),
            fifoAEnableRight: this.fifoAEnableRight,
            fifoAEnableLeft: this.fifoAEnableLeft,
            fifoBEnableRight: this.fifoBEnableRight,
            fifoBEnableLeft: this.fifoBEnableLeft,
            fifoATimer: this.fifoATimer,
            fifoBTimer: this.fifoBTimer,
            fifoAVolume: this.fifoAVolume,
            fifoBVolume: this.fifoBVolume,
            sampleA: this.sampleA,
            sampleB: this.sampleB,
        };
    }

    loadState(s: any) {
        if (!s) return;
        if (s.regs) this.regs.set(s.regs);
        this.masterEnable = !!s.masterEnable;
        this.psgVolume = s.psgVolume ?? 3;
        this.psgVolumeRatio = s.psgVolumeRatio ?? 2;
        if (s.fifoA) this.fifoA.fromArray(s.fifoA);
        if (s.fifoB) this.fifoB.fromArray(s.fifoB);
        this.fifoAEnableRight = s.fifoAEnableRight ?? !!s.fifoAEnable;
        this.fifoAEnableLeft = s.fifoAEnableLeft ?? !!s.fifoAEnable;
        this.fifoBEnableRight = s.fifoBEnableRight ?? !!s.fifoBEnable;
        this.fifoBEnableLeft = s.fifoBEnableLeft ?? !!s.fifoBEnable;
        this.fifoATimer = s.fifoATimer ?? 0;
        this.fifoBTimer = s.fifoBTimer ?? 0;
        this.fifoAVolume = s.fifoAVolume ?? 1;
        this.fifoBVolume = s.fifoBVolume ?? 1;
        this.sampleA = s.sampleA ?? 0;
        this.sampleB = s.sampleB ?? 0;
    }
}
