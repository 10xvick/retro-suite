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
            this.timer += 2048 - this.frequency;
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
            this.timer += (2048 - this.frequency) * 2;
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
    fifoATimer = 0;
    fifoBTimer = 0;
    fifoAEnable = false;
    fifoBEnable = false;
    fifoAVolume = 2; // 0:25% 1:50% 2:100%
    fifoBVolume = 2;

    // Master state
    masterEnable = false;
    psgVolume = 3; // 0-3 (25/50/75/100%)
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
        this.fifoAEnable = false;
        this.fifoBEnable = false;
        this.masterEnable = false;
        this.psgVolume = 3;
        this.regs.fill(0);
        this.readPos = this.writePos = this.count = this.frac = 0;
    }

    tick(cycles: number) {
        if (!this.masterEnable) return;

        this.sq1.tick(cycles);
        this.sq2.tick(cycles);
        this.wave.tick(cycles);
        this.noise.tick(cycles);

        this.frac += cycles;
        while (this.frac >= CYCLES_PER_SAMPLE) {
            this.frac -= CYCLES_PER_SAMPLE;
            this.produceSample();
        }
    }

    private produceSample() {
        // PSG mix
        let left = 0, right = 0;
        if (this.masterEnable) {
            const s1 = this.sq1.sample(), s2 = this.sq2.sample();
            const sw = this.wave.sample(), sn = this.noise.sample();
            const psg = (s1 + s2 + sw + sn) / 4 * (this.psgVolume + 1) / 4;
            left += psg; right += psg;

            // FIFO direct sound: pop a byte when the timer latches (approximate:
            // pop at sample rate when enabled)
            if (this.fifoAEnable) {
                if (this.fifoA.size <= 16 && this.dmaRequest) this.dmaRequest(0);
                const v = this.fifoA.pop();
                if (v !== undefined) {
                    const sv = ((v << 24) >> 24) / 128 * (this.fifoAVolume === 0 ? 0.25 : this.fifoAVolume === 1 ? 0.5 : 1);
                    left += sv; right += sv;
                }
            }
            if (this.fifoBEnable) {
                if (this.fifoB.size <= 16 && this.dmaRequest) this.dmaRequest(1);
                const v = this.fifoB.pop();
                if (v !== undefined) {
                    const sv = ((v << 24) >> 24) / 128 * (this.fifoBVolume === 0 ? 0.25 : this.fifoBVolume === 1 ? 0.5 : 1);
                    left += sv; right += sv;
                }
            }
        }

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
        // Direct-sound sample latch on timer overflow (timer A/B).
        if (timer === this.fifoATimer && this.fifoAEnable) {
            if (this.fifoA.size <= 16 && this.dmaRequest) this.dmaRequest(0);
        }
        if (timer === this.fifoBTimer && this.fifoBEnable) {
            if (this.fifoB.size <= 16 && this.dmaRequest) this.dmaRequest(1);
        }
    }

    writeRegister(off: number, val: number, size: 1 | 2 | 4) {
        const base = off - 0x60;
        for (let i = 0; i < size; i++) {
            this.regs[base + i] = (val >> (i * 8)) & 0xff;
        }

        // SOUNDCNT_X (0x84): bit 7 = PSG master enable (R/W). Bits 0-3 are
        // read-only channel status; bits 8-15 unused. For every write size the
        // master bit lives in bit 7 of `val` (little-endian low byte). The old
        // code tested `val & 0x8000` for 16/32-bit writes, so the standard
        // `strh 0x04000084, #0x80` left the APU master OFF -> total silence.
        if (off === 0x84) {
            this.masterEnable = (val & 0x80) !== 0;
        }
        // SOUNDCNT_L (0x80): PSG volume + channel L/R enables
        if (off === 0x80) {
            this.psgVolume = (val >> 0) & 3;
        }
        // SOUNDCNT_H (0x82): FIFO volume + timer select + enable
        if (off === 0x82 || off === 0x83) {
            const v = this.regs[2] | (this.regs[3] << 8);
            this.fifoAVolume = (v >> 0) & 3;
            this.fifoBVolume = (v >> 2) & 3;
            this.fifoATimer = (v >> 8) & 3;
            this.fifoBTimer = (v >> 12) & 3;
            this.fifoAEnable = (v & 0x0100) !== 0;
            this.fifoBEnable = (v & 0x0200) !== 0;
        }
        // PSG channel registers (GBATEK mapping)
        if (off === 0x60) { // SOUND1CNT_L: length + duty
            this.sq1.duty = (val >> 6) & 3;
        }
        if (off === 0x62) { // SOUND1CNT_H: envelope + freq + restart
            this.sq1.volume = (val >> 12) & 15;
            this.sq1.frequency = val & 0x7ff;
            if (val & 0x8000) { this.sq1.enable = this.masterEnable; this.sq1.timer = 0; }
            this.sq1.active = this.sq1.enable && this.sq1.volume > 0;
        }
        if (off === 0x68) { // SOUND2CNT_L: length + duty
            this.sq2.duty = (val >> 6) & 3;
        }
        if (off === 0x6c) { // SOUND2CNT_H: envelope + freq + restart
            this.sq2.volume = (val >> 12) & 15;
            this.sq2.frequency = val & 0x7ff;
            if (val & 0x8000) { this.sq2.enable = this.masterEnable; this.sq2.timer = 0; }
            this.sq2.active = this.sq2.enable && this.sq2.volume > 0;
        }
        if (off === 0x72) { // SOUND3CNT_H: volume code (bits 13-15)
            this.wave.volume = (val >> 13) & 3;
        }
        if (off === 0x74) { // SOUND3CNT_L: freq low
            this.wave.frequency = val & 0x7ff;
        }
        if (off === 0x76) { // SOUND3CNT_H: freq high + restart (bit 15)
            this.wave.frequency = (this.wave.frequency & 0xff) | ((val & 7) << 8);
            if (val & 0x8000) { this.wave.enable = this.masterEnable; this.wave.timer = 0; }
            this.wave.active = this.wave.enable;
        }
        if (off === 0x78) { // SOUND4CNT_L: length + envelope
            this.noise.volume = (val >> 12) & 15;
        }
        if (off === 0x7c) { // SOUND4CNT_H: freq + restart (bit 15)
            this.noise.shift = (val >> 4) & 0xf;
            if (val & 0x8000) { this.noise.enable = this.masterEnable; this.noise.timer = 0; }
            this.noise.active = this.noise.enable && this.noise.volume > 0;
        }
        if (off >= 0x90 && off < 0xa0) { // WAVE_RAM
            this.wave.waveRam[base - 0x30] = this.regs[base];
        }
        if (off === 0xa8 || off === 0xac) { // FIFO_A/B via 32-bit writes
            // handled via pushFifoByte for byte writes; 32-bit writes come here
            const fifo = off === 0xa8 ? this.fifoA : this.fifoB;
            for (let i = 0; i < 4; i++) fifo.push((val >> (i * 8)) & 0xff);
        }
    }

    saveState(): any {
        return {
            regs: Array.from(this.regs),
            masterEnable: this.masterEnable,
            psgVolume: this.psgVolume,
            fifoA: this.fifoA.toArray(),
            fifoB: this.fifoB.toArray(),
            fifoAEnable: this.fifoAEnable,
            fifoBEnable: this.fifoBEnable,
            fifoATimer: this.fifoATimer,
            fifoBTimer: this.fifoBTimer,
            fifoAVolume: this.fifoAVolume,
            fifoBVolume: this.fifoBVolume,
        };
    }

    loadState(s: any) {
        if (!s) return;
        if (s.regs) this.regs.set(s.regs);
        this.masterEnable = !!s.masterEnable;
        this.psgVolume = s.psgVolume ?? 3;
        if (s.fifoA) this.fifoA.fromArray(s.fifoA);
        if (s.fifoB) this.fifoB.fromArray(s.fifoB);
        this.fifoAEnable = !!s.fifoAEnable;
        this.fifoBEnable = !!s.fifoBEnable;
        this.fifoATimer = s.fifoATimer ?? 0;
        this.fifoBTimer = s.fifoBTimer ?? 0;
        this.fifoAVolume = s.fifoAVolume ?? 2;
        this.fifoBVolume = s.fifoBVolume ?? 2;
    }
}
