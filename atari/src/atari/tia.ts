// Atari 2600 TIA (Television Interface Adaptor)
// Pixel-accurate rendering of Playfield, Players, Missiles, Ball, Collisions, and Audio synthesis

export const CLOCKS_PER_SCANLINE = 228;
export const SCANLINES_PER_FRAME = 262;
export const VISIBLE_CLOCK_START = 68;
export const VISIBLE_PIXELS = 160;
export const VISIBLE_HEIGHT = 192;

// LFSR Polynomial generator for Atari TIA audio
function buildPoly(len: number, taps: number[], init: number): Uint8Array {
    const seq = new Uint8Array(len);
    let reg = init & ((1 << Math.max(...taps)) - 1) || 1;
    for (let i = 0; i < len; i++) {
        seq[i] = reg & 1;
        let fb = 0;
        for (const t of taps) fb ^= (reg >> (t - 1)) & 1;
        reg = ((reg >> 1) | (fb << (Math.max(...taps) - 1))) & 0xFFFF;
    }
    return seq;
}

const POLY4 = buildPoly(15, [4, 3], 0x1);
const POLY5 = buildPoly(31, [5, 3], 0x1);
const POLY9 = buildPoly(511, [9, 5], 0x1);

// Standard Atari 2600 NTSC palette (128 entries: 16 hues x 8 lums)
export const NTSC_PALETTE: [number, number, number][] = [
    [0x00, 0x00, 0x00], [0x40, 0x40, 0x40], [0x6c, 0x6c, 0x6c], [0x90, 0x90, 0x90],
    [0xb0, 0xb0, 0xb0], [0xc8, 0xc8, 0xc8], [0xdc, 0xdc, 0xdc], [0xec, 0xec, 0xec],
    [0x44, 0x44, 0x00], [0x64, 0x64, 0x10], [0x84, 0x84, 0x1c], [0xa0, 0xa0, 0x2c],
    [0xbc, 0xbc, 0x3c], [0xd4, 0xd4, 0x48], [0xec, 0xec, 0x54], [0xfc, 0xfc, 0x5c],
    [0x40, 0x28, 0x00], [0x60, 0x44, 0x00], [0x80, 0x60, 0x00], [0xa0, 0x7c, 0x00],
    [0xc0, 0x98, 0x00], [0xdc, 0xb4, 0x00], [0xf8, 0xd0, 0x00], [0xfc, 0xdc, 0x00],
    [0x40, 0x14, 0x00], [0x60, 0x2c, 0x00], [0x80, 0x44, 0x00], [0xa0, 0x5c, 0x00],
    [0xc0, 0x74, 0x00], [0xdc, 0x8c, 0x00], [0xf8, 0xa4, 0x00], [0xfc, 0xb4, 0x00],
    [0x3c, 0x00, 0x00], [0x5c, 0x10, 0x00], [0x7c, 0x20, 0x00], [0x9c, 0x30, 0x00],
    [0xbc, 0x40, 0x00], [0xd8, 0x50, 0x00], [0xf4, 0x60, 0x00], [0xfc, 0x70, 0x00],
    [0x40, 0x00, 0x00], [0x60, 0x10, 0x00], [0x80, 0x20, 0x00], [0xa0, 0x30, 0x00],
    [0xc0, 0x40, 0x00], [0xdc, 0x50, 0x00], [0xf8, 0x60, 0x00], [0xfc, 0x70, 0x00],
    [0x40, 0x00, 0x08], [0x60, 0x10, 0x24], [0x80, 0x20, 0x40], [0xa0, 0x30, 0x5c],
    [0xc0, 0x40, 0x78], [0xdc, 0x50, 0x94], [0xf8, 0x60, 0xb0], [0xfc, 0x70, 0xc4],
    [0x40, 0x00, 0x20], [0x60, 0x10, 0x40], [0x80, 0x20, 0x60], [0xa0, 0x30, 0x80],
    [0xc0, 0x40, 0xa0], [0xdc, 0x50, 0xbc], [0xf8, 0x60, 0xd8], [0xfc, 0x70, 0xec],
    [0x30, 0x00, 0x34], [0x50, 0x10, 0x54], [0x70, 0x20, 0x74], [0x90, 0x30, 0x94],
    [0xb0, 0x40, 0xb4], [0xd0, 0x50, 0xd4], [0xec, 0x60, 0xf0], [0xfc, 0x70, 0xfc],
    [0x24, 0x00, 0x40], [0x40, 0x10, 0x60], [0x5c, 0x20, 0x80], [0x78, 0x30, 0xa0],
    [0x90, 0x40, 0xc0], [0xac, 0x50, 0xdc], [0xc8, 0x60, 0xf8], [0xd8, 0x70, 0xfc],
    [0x14, 0x00, 0x44], [0x2c, 0x10, 0x64], [0x44, 0x20, 0x84], [0x5c, 0x30, 0xa4],
    [0x74, 0x40, 0xc4], [0x8c, 0x50, 0xe0], [0xa4, 0x60, 0xfc], [0xb4, 0x70, 0xfc],
    [0x00, 0x00, 0x40], [0x18, 0x10, 0x60], [0x30, 0x20, 0x80], [0x48, 0x30, 0xa0],
    [0x60, 0x40, 0xc0], [0x78, 0x50, 0xdc], [0x90, 0x60, 0xf8], [0xa0, 0x70, 0xfc],
    [0x00, 0x00, 0x3c], [0x14, 0x24, 0x5c], [0x28, 0x48, 0x7c], [0x3c, 0x6c, 0x9c],
    [0x50, 0x90, 0xbc], [0x64, 0xb4, 0xdc], [0x78, 0xd8, 0xf8], [0x88, 0xec, 0xfc],
    [0x00, 0x00, 0x30], [0x10, 0x20, 0x50], [0x20, 0x40, 0x70], [0x30, 0x60, 0x90],
    [0x40, 0x80, 0xb0], [0x50, 0xa0, 0xd0], [0x60, 0xc0, 0xf0], [0x70, 0xd0, 0xfc],
    [0x00, 0x08, 0x24], [0x10, 0x28, 0x44], [0x20, 0x48, 0x64], [0x30, 0x68, 0x84],
    [0x40, 0x88, 0xa4], [0x50, 0xa8, 0xc4], [0x60, 0xc8, 0xe0], [0x70, 0xd8, 0xf0],
    [0x00, 0x18, 0x14], [0x10, 0x38, 0x34], [0x20, 0x58, 0x54], [0x30, 0x78, 0x74],
    [0x40, 0x98, 0x94], [0x50, 0xb8, 0xb4], [0x60, 0xd8, 0xd0], [0x70, 0xe8, 0xe0],
    [0x00, 0x24, 0x00], [0x14, 0x44, 0x14], [0x28, 0x64, 0x28], [0x3c, 0x84, 0x3c],
    [0x50, 0xa4, 0x50], [0x64, 0xc4, 0x64], [0x78, 0xe4, 0x78], [0x88, 0xf4, 0x88],
    [0x00, 0x28, 0x00], [0x18, 0x48, 0x10], [0x30, 0x68, 0x20], [0x48, 0x88, 0x30],
    [0x60, 0xa8, 0x40], [0x78, 0xc8, 0x50], [0x90, 0xe8, 0x60], [0xa0, 0xf8, 0x70],
];

export class TIA {
    // Framebuffer: 160 x 192 (or 160 x 262) packed ABGR little-endian pixels
    public framebuffer = new Uint32Array(VISIBLE_PIXELS * VISIBLE_HEIGHT);
    public visibleHeight = VISIBLE_HEIGHT;

    // Beam timing & frame synchronization
    public scanline = 0;
    public pixelClock = 0;
    public frameComplete = false;
    public wsyncRequested = false;
    public frameLines = 262;
    private displayTop = 34; // default start scanline of visible active video
    private _frameStarted = false;
    private _linesSinceFrameStart = 0;
    private _vsyncActive = false;

    // Registers
    public vsync = 0;
    public vblank = 0;
    public nusiz0 = 0;
    public nusiz1 = 0;
    public p0col = 0;
    public p1col = 0;
    public pfcol = 0;
    public bcol = 0;
    public ctrlpf = 0;
    public refp0 = 0;
    public refp1 = 0;
    public pf0 = 0;
    public pf1 = 0;
    public pf2 = 0;
    public grp0 = 0;
    public grp1 = 0;
    public enam0 = 0;
    public enam1 = 0;
    public enabl = 0;
    public vdelp0 = 0;
    public vdelp1 = 0;
    public vdelbl = 0;
    public resmp0 = 0;
    public resmp1 = 0;

    // Object Positions (color clocks: 0..227)
    public posP0 = 0;
    public posP1 = 0;
    public posM0 = 0;
    public posM1 = 0;
    public posBL = 0;

    // Horizontal Motion (-8..+7)
    public hmp0 = 0;
    public hmp1 = 0;
    public hmm0 = 0;
    public hmm1 = 0;
    public hmbl = 0;

    // Active graphics latches (affected by VDEL)
    private grp0Active = 0;
    private grp1Active = 0;
    private enablActive = 0;

    // Collision Latches (bit 6/7 set)
    public collM0P0 = 0;
    public collM0P1 = 0;
    public collM1P0 = 0;
    public collM1P1 = 0;
    public collP0PF = 0;
    public collP0BL = 0;
    public collP1PF = 0;
    public collP1BL = 0;
    public collM0PF = 0;
    public collM0BL = 0;
    public collM1PF = 0;
    public collM1BL = 0;
    public collBLPF = 0;
    public collP0P1 = 0;
    public collM0M1 = 0;

    // Controller Inputs (active low bit 7)
    public inpt0 = 0x80;
    public inpt1 = 0x80;
    public inpt2 = 0x80;
    public inpt3 = 0x80;
    public inpt4 = 0x80;
    public inpt5 = 0x80;

    // Audio State
    public audc = [0, 0];
    public audf = [0, 0];
    public audv = [0, 0];
    private chDiv = [114, 114];
    private chCounter = [0, 0];
    private p4Idx = [0, 0];
    private p5Idx = [0, 0];
    private p9Idx = [0, 0];
    private sqLevel = [1, 1];

    // Audio Ring Buffer (mono samples at ~31399 Hz)
    private audioRing = new Float32Array(16384);
    private audioWritePos = 0;
    private audioReadPos = 0;
    private audioCount = 0;
    private audioClockAcc = 0;

    constructor() {
        this.reset();
    }

    public reset(): void {
        this.scanline = 0;
        this.pixelClock = 0;
        this.frameComplete = false;
        this.wsyncRequested = false;
        this.frameLines = 262;
        this.displayTop = 34;
        this._frameStarted = false;
        this._linesSinceFrameStart = 0;
        this._vsyncActive = false;

        this.framebuffer.fill(0);

        this.vsync = 0;
        this.vblank = 0;
        this.nusiz0 = 0;
        this.nusiz1 = 0;
        this.p0col = 0;
        this.p1col = 0;
        this.pfcol = 0;
        this.bcol = 0;
        this.ctrlpf = 0;
        this.refp0 = 0;
        this.refp1 = 0;
        this.pf0 = 0;
        this.pf1 = 0;
        this.pf2 = 0;
        this.grp0 = 0;
        this.grp1 = 0;
        this.enam0 = 0;
        this.enam1 = 0;
        this.enabl = 0;
        this.vdelp0 = 0;
        this.vdelp1 = 0;
        this.vdelbl = 0;
        this.resmp0 = 0;
        this.resmp1 = 0;

        this.posP0 = 0;
        this.posP1 = 0;
        this.posM0 = 0;
        this.posM1 = 0;
        this.posBL = 0;

        this.hmp0 = 0;
        this.hmp1 = 0;
        this.hmm0 = 0;
        this.hmm1 = 0;
        this.hmbl = 0;

        this.grp0Active = 0;
        this.grp1Active = 0;
        this.enablActive = 0;

        this.audc = [0, 0];
        this.audf = [0, 0];
        this.audv = [0, 0];
        this.chDiv = [114, 114];
        this.chCounter = [0, 0];
        this.p4Idx = [0, 0];
        this.p5Idx = [0, 0];
        this.p9Idx = [0, 0];
        this.sqLevel = [1, 1];

        this.audioWritePos = 0;
        this.audioReadPos = 0;
        this.audioCount = 0;
        this.audioClockAcc = 0;

        this.clearCollisions();
    }

    public clearCollisions(): void {
        this.collM0P0 = 0;
        this.collM0P1 = 0;
        this.collM1P0 = 0;
        this.collM1P1 = 0;
        this.collP0PF = 0;
        this.collP0BL = 0;
        this.collP1PF = 0;
        this.collP1BL = 0;
        this.collM0PF = 0;
        this.collM0BL = 0;
        this.collM1PF = 0;
        this.collM1BL = 0;
        this.collBLPF = 0;
        this.collP0P1 = 0;
        this.collM0M1 = 0;
    }

    // Advance 1 CPU cycle = 3 TIA color clocks
    public clock(): void {
        for (let i = 0; i < 3; i++) {
            this.clockColor();
        }

        // Release WSYNC at the end of the scanline
        if (this.wsyncRequested && this.pixelClock === 0) {
            this.wsyncRequested = false;
        }
    }

    private clockColor(): void {
        this.renderPixel();
        this.clockAudio();

        this.pixelClock++;
        if (this.pixelClock >= CLOCKS_PER_SCANLINE) {
            this.pixelClock = 0;
            this.onScanlineEnd();
        }
    }

    private onScanlineEnd(): void {
        this.scanline++;
        this._linesSinceFrameStart++;

        // Reset missile to player if RESMP is active
        if (this.resmp0) this.posM0 = (this.posP0 + 4) % CLOCKS_PER_SCANLINE;
        if (this.resmp1) this.posM1 = (this.posP1 + 4) % CLOCKS_PER_SCANLINE;

        if (this.frameComplete) return;

        // Safety fallback if game kernel fails to assert VSYNC
        if (this._linesSinceFrameStart >= 320) {
            this.frameComplete = true;
            this._frameStarted = false;
        }
    }

    private startFrame(): void {
        this.framebuffer.fill(0);
        this.scanline = 0;
        this._linesSinceFrameStart = 0;
        this._frameStarted = true;
    }

    private endFrame(): void {
        this.frameComplete = true;
        this._frameStarted = false;
    }

    // Position resulting from a strobe write (RESP0, RESP1, etc.)
    private respPosition(): number {
        // Strobe takes effect immediately; near HBLANK, object appears around start of visible line
        const pos = (this.pixelClock + 4) % CLOCKS_PER_SCANLINE;
        return pos;
    }

    // Apply HMOVE horizontal motion
    private applyHMOVE(): void {
        const move = (pos: number, val: number) => {
            // Signed 4-bit nibble (-8..+7)
            const motion = (val ^ 0x08) - 0x08;
            return (pos - motion + CLOCKS_PER_SCANLINE) % CLOCKS_PER_SCANLINE;
        };

        this.posP0 = move(this.posP0, this.hmp0);
        this.posP1 = move(this.posP1, this.hmp1);
        this.posM0 = move(this.posM0, this.hmm0);
        this.posM1 = move(this.posM1, this.hmm1);
        this.posBL = move(this.posBL, this.hmbl);
    }

    // TIA Memory Writes ($00-$3F)
    public write(addr: number, data: number): void {
        data &= 0xFF;
        const reg = addr & 0x3F;

        switch (reg) {
            case 0x00: // VSYNC
                this.vsync = data;
                if ((data & 0x02) !== 0 && !this._vsyncActive) {
                    this.frameLines = this._frameStarted ? this._linesSinceFrameStart : 262;
                    this.endFrame();
                    this._vsyncActive = true;
                } else if ((data & 0x02) === 0 && this._vsyncActive) {
                    this._vsyncActive = false;
                    this.startFrame();
                }
                break;
            case 0x01: // VBLANK
                this.vblank = data;
                break;
            case 0x02: // WSYNC
                this.wsyncRequested = true;
                break;
            case 0x03: // RSYNC
                this.pixelClock = 0;
                break;
            case 0x04: // NUSIZ0
                this.nusiz0 = data;
                break;
            case 0x05: // NUSIZ1
                this.nusiz1 = data;
                break;
            case 0x06: // COLUP0
                this.p0col = data;
                break;
            case 0x07: // COLUP1
                this.p1col = data;
                break;
            case 0x08: // COLUPF
                this.pfcol = data;
                break;
            case 0x09: // COLUBK
                this.bcol = data;
                break;
            case 0x0A: // CTRLPF
                this.ctrlpf = data;
                break;
            case 0x0B: // REFP0
                this.refp0 = data;
                break;
            case 0x0C: // REFP1
                this.refp1 = data;
                break;
            case 0x0D: // PF0
                this.pf0 = data;
                break;
            case 0x0E: // PF1
                this.pf1 = data;
                break;
            case 0x0F: // PF2
                this.pf2 = data;
                break;
            case 0x10: // RESP0
                this.posP0 = this.respPosition();
                break;
            case 0x11: // RESP1
                this.posP1 = this.respPosition();
                break;
            case 0x12: // RESM0
                this.posM0 = this.respPosition();
                break;
            case 0x13: // RESM1
                this.posM1 = this.respPosition();
                break;
            case 0x14: // RESBL
                this.posBL = this.respPosition();
                break;
            case 0x15: // AUDC0
                this.audc[0] = data & 0x0F;
                break;
            case 0x16: // AUDC1
                this.audc[1] = data & 0x0F;
                break;
            case 0x17: // AUDF0
                this.audf[0] = data & 0x1F;
                break;
            case 0x18: // AUDF1
                this.audf[1] = data & 0x1F;
                break;
            case 0x19: // AUDV0
                this.audv[0] = data & 0x0F;
                break;
            case 0x1A: // AUDV1
                this.audv[1] = data & 0x0F;
                break;
            case 0x1B: // GRP0
                this.grp0 = data;
                if (!this.vdelp0) this.grp0Active = data;
                if (this.vdelp1) this.grp1Active = this.grp1;
                break;
            case 0x1C: // GRP1
                this.grp1 = data;
                if (!this.vdelp1) this.grp1Active = data;
                if (this.vdelp0) this.grp0Active = this.grp0;
                if (this.vdelbl) this.enablActive = this.enabl;
                break;
            case 0x1D: // ENAM0
                this.enam0 = data & 0x02;
                break;
            case 0x1E: // ENAM1
                this.enam1 = data & 0x02;
                break;
            case 0x1F: // ENABL
                this.enabl = data & 0x02;
                if (!this.vdelbl) this.enablActive = this.enabl;
                break;
            case 0x20: // HMP0
                this.hmp0 = (data >> 4) & 0x0F;
                break;
            case 0x21: // HMP1
                this.hmp1 = (data >> 4) & 0x0F;
                break;
            case 0x22: // HMM0
                this.hmm0 = (data >> 4) & 0x0F;
                break;
            case 0x23: // HMM1
                this.hmm1 = (data >> 4) & 0x0F;
                break;
            case 0x24: // HMBL
                this.hmbl = (data >> 4) & 0x0F;
                break;
            case 0x25: // VDELP0
                this.vdelp0 = data & 0x01;
                break;
            case 0x26: // VDELP1
                this.vdelp1 = data & 0x01;
                break;
            case 0x27: // VDELBL
                this.vdelbl = data & 0x01;
                break;
            case 0x28: // RESMP0
                this.resmp0 = data & 0x02;
                if (this.resmp0) this.posM0 = (this.posP0 + 4) % CLOCKS_PER_SCANLINE;
                break;
            case 0x29: // RESMP1
                this.resmp1 = data & 0x02;
                if (this.resmp1) this.posM1 = (this.posP1 + 4) % CLOCKS_PER_SCANLINE;
                break;
            case 0x2A: // HMOVE
                this.applyHMOVE();
                break;
            case 0x2B: // HMCLR
                this.hmp0 = 0; this.hmp1 = 0; this.hmm0 = 0; this.hmm1 = 0; this.hmbl = 0;
                break;
            case 0x2C: // CXCLR
                this.clearCollisions();
                break;
        }
    }

    // TIA Memory Reads ($00-$0D)
    public read(addr: number): number {
        const reg = addr & 0x0F;
        switch (reg) {
            case 0x00: return this.collM0P1 | (this.collM0P0 >> 1); // CXM0P: bit 7 = M0-P1, bit 6 = M0-P0
            case 0x01: return this.collM1P0 | (this.collM1P1 >> 1); // CXM1P: bit 7 = M1-P0, bit 6 = M1-P1
            case 0x02: return this.collP0PF | (this.collP0BL >> 1); // CXP0FB: bit 7 = P0-PF, bit 6 = P0-BL
            case 0x03: return this.collP1PF | (this.collP1BL >> 1); // CXP1FB: bit 7 = P1-PF, bit 6 = P1-BL
            case 0x04: return this.collM0PF | (this.collM0BL >> 1); // CXM0FB: bit 7 = M0-PF, bit 6 = M0-BL
            case 0x05: return this.collM1PF | (this.collM1BL >> 1); // CXM1FB: bit 7 = M1-PF, bit 6 = M1-BL
            case 0x06: return this.collBLPF;                        // CXBLPF: bit 7 = BL-PF
            case 0x07: return this.collP0P1 | (this.collM0M1 >> 1); // CXPPMM: bit 7 = P0-P1, bit 6 = M0-M1
            case 0x08: return this.inpt0;
            case 0x09: return this.inpt1;
            case 0x0A: return this.inpt2;
            case 0x0B: return this.inpt3;
            case 0x0C: return this.inpt4;
            case 0x0D: return this.inpt5;
            default: return 0xFF;
        }
    }

    // Helper: evaluate player sprite bit at current clock
    private getPlayerPixel(playerPos: number, grp: number, refp: number, nusiz: number): boolean {
        if (grp === 0) return false;
        const code = nusiz & 0x07;

        // Player copy offsets and sizing
        let copies: number[];
        let pixelWidth = 1;

        switch (code) {
            case 0: copies = [0]; pixelWidth = 1; break;
            case 1: copies = [0, 16]; pixelWidth = 1; break;
            case 2: copies = [0, 32]; pixelWidth = 1; break;
            case 3: copies = [0, 16, 32]; pixelWidth = 1; break;
            case 4: copies = [0, 64]; pixelWidth = 1; break;
            case 5: copies = [0]; pixelWidth = 2; break; // Double size
            case 6: copies = [0, 32, 64]; pixelWidth = 1; break;
            case 7: copies = [0]; pixelWidth = 4; break; // Quad size
            default: copies = [0]; pixelWidth = 1; break;
        }

        const totalWidth = 8 * pixelWidth;
        const clk = this.pixelClock;

        for (let i = 0; i < copies.length; i++) {
            const origin = (playerPos + copies[i]) % CLOCKS_PER_SCANLINE;
            const diff = (clk - origin + CLOCKS_PER_SCANLINE) % CLOCKS_PER_SCANLINE;
            if (diff < totalWidth) {
                const bitIndex = Math.floor(diff / pixelWidth);
                const bit = (refp & 0x08) !== 0 ? (bitIndex) : (7 - bitIndex);
                if ((grp & (1 << bit)) !== 0) return true;
            }
        }
        return false;
    }

    // Helper: evaluate missile pixel
    private getMissilePixel(missilePos: number, enabled: number, nusiz: number): boolean {
        if (!enabled) return false;
        const sizeCode = (nusiz >> 4) & 0x03;
        const width = 1 << sizeCode; // 1, 2, 4, or 8 clocks
        const clk = this.pixelClock;
        const diff = (clk - missilePos + CLOCKS_PER_SCANLINE) % CLOCKS_PER_SCANLINE;
        return diff < width;
    }

    // Helper: evaluate ball pixel
    private getBallPixel(ballPos: number, enabled: number, ctrlpf: number): boolean {
        if (!enabled) return false;
        const sizeCode = (ctrlpf >> 4) & 0x03;
        const width = 1 << sizeCode; // 1, 2, 4, or 8 clocks
        const clk = this.pixelClock;
        const diff = (clk - ballPos + CLOCKS_PER_SCANLINE) % CLOCKS_PER_SCANLINE;
        return diff < width;
    }

    private renderPixel(): void {
        const clk = this.pixelClock;
        if (clk < VISIBLE_CLOCK_START) return;

        const x = clk - VISIBLE_CLOCK_START;
        if (x >= VISIBLE_PIXELS) return;

        const line = this.scanline;
        if (line >= SCANLINES_PER_FRAME) return;

        // ---- 1. Playfield Bit ----
        let pfOn = false;
        const reflect = (this.ctrlpf & 0x01) !== 0;
        const pfPixel = x >> 2; // 0..39 playfield pixels

        if (pfPixel < 20) {
            // Left half
            if (pfPixel < 4) pfOn = ((this.pf0 >> (4 + pfPixel)) & 1) !== 0;
            else if (pfPixel < 12) pfOn = ((this.pf1 >> (11 - pfPixel)) & 1) !== 0;
            else pfOn = ((this.pf2 >> (pfPixel - 12)) & 1) !== 0;
        } else {
            // Right half (reflected or repeated)
            const rPixel = pfPixel - 20;
            if (reflect) {
                const mirr = 19 - rPixel;
                if (mirr < 4) pfOn = ((this.pf0 >> (4 + mirr)) & 1) !== 0;
                else if (mirr < 12) pfOn = ((this.pf1 >> (11 - mirr)) & 1) !== 0;
                else pfOn = ((this.pf2 >> (mirr - 12)) & 1) !== 0;
            } else {
                if (rPixel < 4) pfOn = ((this.pf0 >> (4 + rPixel)) & 1) !== 0;
                else if (rPixel < 12) pfOn = ((this.pf1 >> (11 - rPixel)) & 1) !== 0;
                else pfOn = ((this.pf2 >> (rPixel - 12)) & 1) !== 0;
            }
        }

        // ---- 2. Objects ----
        const p0On = this.getPlayerPixel(this.posP0, this.grp0Active, this.refp0, this.nusiz0);
        const p1On = this.getPlayerPixel(this.posP1, this.grp1Active, this.refp1, this.nusiz1);
        const m0On = !this.resmp0 && this.getMissilePixel(this.posM0, this.enam0, this.nusiz0);
        const m1On = !this.resmp1 && this.getMissilePixel(this.posM1, this.enam1, this.nusiz1);
        const blOn = this.getBallPixel(this.posBL, this.enablActive, this.ctrlpf);

        // ---- 3. Collisions (latched only outside VBLANK) ----
        if ((this.vblank & 0x02) === 0) {
            if (m0On && p1On) this.collM0P1 = 0x80;
            if (m0On && p0On) this.collM0P0 = 0x80;
            if (m1On && p0On) this.collM1P0 = 0x80;
            if (m1On && p1On) this.collM1P1 = 0x80;
            if (p0On && pfOn) this.collP0PF = 0x80;
            if (p0On && blOn) this.collP0BL = 0x80;
            if (p1On && pfOn) this.collP1PF = 0x80;
            if (p1On && blOn) this.collP1BL = 0x80;
            if (m0On && pfOn) this.collM0PF = 0x80;
            if (m0On && blOn) this.collM0BL = 0x80;
            if (m1On && pfOn) this.collM1PF = 0x80;
            if (m1On && blOn) this.collM1BL = 0x80;
            if (blOn && pfOn) this.collBLPF = 0x80;
            if (p0On && p1On) this.collP0P1 = 0x80;
            if (m0On && m1On) this.collM0M1 = 0x80;
        }

        // If VBLANK is enabled, screen is black
        if ((this.vblank & 0x02) !== 0) return;

        // ---- 4. Priority Resolution & Pixel Color ----
        const priorityPF = (this.ctrlpf & 0x04) !== 0;
        const scoreMode = (this.ctrlpf & 0x02) !== 0;

        // Determine Playfield color (Score mode uses COLUP0 left, COLUP1 right)
        let curPfCol = this.pfcol;
        if (scoreMode) {
            curPfCol = x < 80 ? this.p0col : this.p1col;
        }

        let pixelColor = this.bcol;

        if (priorityPF) {
            // Playfield / Ball priority
            if (pfOn) pixelColor = curPfCol;
            else if (blOn) pixelColor = this.pfcol;
            else if (p0On || m0On) pixelColor = this.p0col;
            else if (p1On || m1On) pixelColor = this.p1col;
        } else {
            // Player / Missile priority
            if (p0On || m0On) pixelColor = this.p0col;
            else if (p1On || m1On) pixelColor = this.p1col;
            else if (pfOn) pixelColor = curPfCol;
            else if (blOn) pixelColor = this.pfcol;
        }

        // Palette lookup: hue = high nibble (0..15), lum = low nibble & 0x0E >> 1 (0..7)
        const hue = (pixelColor >> 4) & 0x0F;
        const lum = (pixelColor >> 1) & 0x07;
        const rgb = NTSC_PALETTE[(hue << 3) | lum] || NTSC_PALETTE[0];

        // Framebuffer mapping into 192 visible lines
        const dispY = line - this.displayTop;
        if (dispY >= 0 && dispY < VISIBLE_HEIGHT) {
            // ABGR 32-bit packed
            this.framebuffer[dispY * VISIBLE_PIXELS + x] =
                (0xFF << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
        }
    }

    // Audio clocking: called every color clock (~3.58 MHz)
    private clockAudio(): void {
        this.audioClockAcc++;
        // Downsample from 3.579545 MHz color clock to ~31399 Hz (every 114 color clocks)
        if (this.audioClockAcc >= 114) {
            this.audioClockAcc = 0;
            this.generateAudioSample();
        }
    }

    private generateAudioSample(): void {
        let sample = 0;

        for (let ch = 0; ch < 2; ch++) {
            const c = this.audc[ch];
            const f = this.audf[ch] + 1;
            const v = this.audv[ch];

            this.chCounter[ch]++;
            if (this.chCounter[ch] >= f) {
                this.chCounter[ch] = 0;
                this.p4Idx[ch] = (this.p4Idx[ch] + 1) % 15;
                this.p5Idx[ch] = (this.p5Idx[ch] + 1) % 31;
                this.p9Idx[ch] = (this.p9Idx[ch] + 1) % 511;
                this.sqLevel[ch] ^= 1;
            }

            let bit = 1;
            switch (c) {
                case 0: case 11: bit = 1; break;
                case 1: bit = POLY4[this.p4Idx[ch]]; break;
                case 2: bit = (this.p4Idx[ch] & 1) ? POLY4[this.p4Idx[ch]] : 1; break;
                case 3: bit = POLY5[this.p5Idx[ch]]; break;
                case 4: case 5: bit = this.sqLevel[ch]; break;
                case 6: case 10: bit = (this.p5Idx[ch] % 2 === 0) ? 1 : 0; break;
                case 7: case 9: bit = POLY5[this.p5Idx[ch]]; break;
                case 8: bit = POLY9[this.p9Idx[ch]]; break;
                case 12: case 13: bit = this.sqLevel[ch]; break;
                case 14: bit = POLY5[this.p5Idx[ch]]; break;
                case 15: bit = POLY4[this.p4Idx[ch]]; break;
            }

            const channelSample = bit ? (v / 15.0) : -(v / 15.0);
            sample += channelSample * 0.5;
        }

        // Enqueue into ring buffer
        if (this.audioCount < this.audioRing.length) {
            this.audioRing[this.audioWritePos] = sample;
            this.audioWritePos = (this.audioWritePos + 1) % this.audioRing.length;
            this.audioCount++;
        }
    }

    // Audio interface for WebAudio
    public get audioSamplesAvailable(): number {
        return this.audioCount;
    }

    public drainAudio(outBuf: Float32Array): number {
        const toCopy = Math.min(outBuf.length, this.audioCount);
        for (let i = 0; i < toCopy; i++) {
            outBuf[i] = this.audioRing[this.audioReadPos];
            this.audioReadPos = (this.audioReadPos + 1) % this.audioRing.length;
        }
        this.audioCount -= toCopy;
        return toCopy;
    }

    public saveState(): any {
        return {
            scanline: this.scanline,
            pixelClock: this.pixelClock,
            frameLines: this.frameLines,
            vsync: this.vsync,
            vblank: this.vblank,
            nusiz0: this.nusiz0,
            nusiz1: this.nusiz1,
            p0col: this.p0col,
            p1col: this.p1col,
            pfcol: this.pfcol,
            bcol: this.bcol,
            ctrlpf: this.ctrlpf,
            refp0: this.refp0,
            refp1: this.refp1,
            pf0: this.pf0,
            pf1: this.pf1,
            pf2: this.pf2,
            grp0: this.grp0,
            grp1: this.grp1,
            enam0: this.enam0,
            enam1: this.enam1,
            enabl: this.enabl,
            vdelp0: this.vdelp0,
            vdelp1: this.vdelp1,
            vdelbl: this.vdelbl,
            resmp0: this.resmp0,
            resmp1: this.resmp1,
            posP0: this.posP0,
            posP1: this.posP1,
            posM0: this.posM0,
            posM1: this.posM1,
            posBL: this.posBL,
            hmp0: this.hmp0,
            hmp1: this.hmp1,
            hmm0: this.hmm0,
            hmm1: this.hmm1,
            hmbl: this.hmbl,
            grp0Active: this.grp0Active,
            grp1Active: this.grp1Active,
            enablActive: this.enablActive,
            audc: [...this.audc],
            audf: [...this.audf],
            audv: [...this.audv],
        };
    }

    public loadState(state: any): void {
        if (!state) return;
        Object.assign(this, state);
    }
}