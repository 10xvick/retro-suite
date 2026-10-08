// Atari 2600 TIA (Television Interface Adaptor)
// Handles scanline timing, playfield/player/missile/ball rendering, collision latches.
// Clocking: called once per CPU cycle (= 3 color clocks). Scanline = 228 color clocks.

const CLOCKS_PER_SCANLINE = 228;
const SCANLINES_PER_FRAME = 262;
const VISIBLE_CLOCK_START = 68;
const VISIBLE_PIXELS = 160;

// LFSR tables for TIA tone generators (index 0 = current output bit)
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
// 4-bit: 15-length; 5-bit: 31-length; 9-bit: 511-length
const POLY4 = buildPoly(15, [4, 3], 0x1);
const POLY5 = buildPoly(31, [5, 3], 0x1);
const POLY9 = buildPoly(511, [9, 5], 0x1);
const POLY4_LEN = 15, POLY5_LEN = 31, POLY9_LEN = 511;

// Standard Atari 2600 NTSC palette (128 color entries)
const NTSC_PALETTE: [number, number, number][] = [
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
    // Framebuffer (160x262, top 192 rows are the visible picture)
    public framebuffer = new Uint32Array(VISIBLE_PIXELS * SCANLINES_PER_FRAME);
    public visibleHeight = 192;

    // Timing state
    public scanline = 0;
    public pixelClock = 0;
    public frameComplete = false;
    public wsyncRequested = false;

    // TV-style frame lock: the frame ends when the GAME starts VSYNC (like a
    // real TV), not after a fixed 262 lines. Kernels whose timing drifts a
    // line or two can never roll the picture. The 192-row window starts at a
    // fixed offset below VSYNC (a real TV does the same — no auto-centering).
    public frameLines = 262;        // measured VSYNC-to-VSYNC distance
    private displayTop = 34;        // first kernel scanline shown (VBLANK off at 35; 37 VBLANK)

    // Register values
    public vsync = 0;
    public vblank = 0;
    public ctrlpf = 0;
    public nusiz0 = 0;
    public nusiz1 = 0;
    public p0col = 0;
    public p1col = 0;
    public pfcol = 0;
    public bcol = 0;
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

    // Object positions (in color clocks)
    public posP0 = 0;
    public posP1 = 0;
    public posM0 = 0;
    public posM1 = 0;
    public posBL = 0;

    // Horizontal motion registers
    public hmp0 = 0;
    public hmp1 = 0;
    public hmm0 = 0;
    public hmm1 = 0;
    public hmbl = 0;

    // Graphics latches (after VDEL delay)
    private grp0Active = 0;
    private grp1Active = 0;
    private enam0Active = 0;
    private enam1Active = 0;
    private enablActive = 0;

    // Collision latches (bit 7 set when latched)
    public collM0P0 = 0; public collM0P1 = 0;
    public collM1P0 = 0; public collM1P1 = 0;
    public collP0PF = 0; public collP0BL = 0;
    public collP1PF = 0; public collP1BL = 0;
    public collM0PF = 0; public collM0BL = 0;
    public collM1PF = 0; public collM1BL = 0;
    public collBLPF = 0;
    public collP0P1 = 0; public collM0M1 = 0;

    // Inputs (set by the emulator each frame)
    public inpt0 = 0x80;
    public inpt1 = 0x80;
    public inpt2 = 0x80;
    public inpt3 = 0x80;
    public inpt4 = 0x80;
    public inpt5 = 0x80;

    private phase = 0;

    constructor() {
        this.reset();
    }

    public reset() {
        this.scanline = 0;
        this.pixelClock = 0;
        this.frameComplete = false;
        this.wsyncRequested = false;
        this.framebuffer.fill(0);
        this._vsyncActive = false;
        this._frameStarted = false;
        this._linesSinceFrameStart = 0;
        this.displayTop = 34;
        this.frameLines = 262;
        this.vsync = 0;
        this.vblank = 0;
        this.ctrlpf = 0;
        this.nusiz0 = 0;
        this.nusiz1 = 0;
        this.p0col = 0; this.p1col = 0; this.pfcol = 0; this.bcol = 0;
        this.pf0 = 0; this.pf1 = 0; this.pf2 = 0;
        this.grp0 = 0; this.grp1 = 0;
        this.enam0 = 0; this.enam1 = 0; this.enabl = 0;
        this.vdelp0 = 0; this.vdelp1 = 0; this.vdelbl = 0;
        this.resmp0 = 0; this.resmp1 = 0;
        this.posP0 = 0; this.posP1 = 0; this.posM0 = 0; this.posM1 = 0; this.posBL = 0;
        this.hmp0 = 0; this.hmp1 = 0; this.hmm0 = 0; this.hmm1 = 0; this.hmbl = 0;
        this.grp0Active = 0; this.grp1Active = 0;
        this.enam0Active = 0; this.enam1Active = 0; this.enablActive = 0;
        this.audc[0] = 0; this.audc[1] = 0;
        this.audf[0] = 0; this.audf[1] = 0;
        this.audv[0] = 0; this.audv[1] = 0;
        this.audioReadPos = 0; this.audioWritePos = 0; this.audioCount = 0; this.sampleFrac = 0;
        this.chDiv[0] = 114; this.chDiv[1] = 114;
        this.p4Idx[0] = 0; this.p4Idx[1] = 0;
        this.p5Idx[0] = 0; this.p5Idx[1] = 0;
        this.p9Idx[0] = 0; this.p9Idx[1] = 0;
        this.sqLevel[0] = 1; this.sqLevel[1] = 1;
        this.clearCollisions();
    }

    public clearCollisions() {
        this.collM0P0 = 0; this.collM0P1 = 0;
        this.collM1P0 = 0; this.collM1P1 = 0;
        this.collP0PF = 0; this.collP0BL = 0;
        this.collP1PF = 0; this.collP1BL = 0;
        this.collM0PF = 0; this.collM0BL = 0;
        this.collM1PF = 0; this.collM1BL = 0;
        this.collBLPF = 0;
        this.collP0P1 = 0; this.collM0M1 = 0;
    }

    // ---- Register writes ----
    public write(addr: number, data: number) {
        data &= 0xFF;
        switch (addr & 0x3F) {
            case 0x00:
                this.vsync = data;
                if (data !== 0 && !this._vsyncActive) {
                    // VSYNC onset: THIS is where the TV would start a new frame.
                    // End the current frame here (TV-style frame lock).
                    this.frameLines = this._frameStarted
                        ? this._linesSinceFrameStart : 262;
                    this.endFrame();
                    this._vsyncActive = true;
                } else if (data === 0 && this._vsyncActive) {
                    // VSYNC end: the new frame begins (real TV behavior)
                    this._vsyncActive = false;
                    this.startFrame();
                }
                break;
            case 0x01: this.vblank = data; break;
            case 0x02: this.wsyncRequested = true; break; // WSYNC - CPU halts until end of scanline
            case 0x03: break; // RSYNC
            case 0x04: this.nusiz0 = data; break;
            case 0x05: this.nusiz1 = data; break;
            case 0x06: this.p0col = data; break;
            case 0x07: this.p1col = data; break;
            case 0x08: this.pfcol = data; break;
            case 0x09: this.bcol = data; break;
            case 0x0A: this.ctrlpf = data; break; // CTRLPF: reflect/score/priority/ball size
            case 0x0B: this.pf0 = data; break;
            case 0x0C: this.pf1 = data; break;
            case 0x0D: this.pf2 = data; break;
            // RESP/RESM/RESBL: reset object position to the current color clock.
            // Writes during HBLANK (clk < 68) place the object ~3 pixels into
            // the visible area on real hardware (counter starts at 0).
            case 0x0E: this.posP0 = this.respPosition(); break; // RESP0
            case 0x0F: this.posP1 = this.respPosition(); break; // RESP1
            case 0x10: this.posM0 = this.respPosition(); break; // RESM0
            case 0x11: this.posM1 = this.respPosition(); break; // RESM1
            case 0x12: this.posBL = this.respPosition(); break; // RESBL
            case 0x13: this.audc[0] = data; break; // AUDC0
            case 0x14: this.audc[1] = data; break; // AUDC1
            case 0x15: this.audf[0] = data & 0x1F; break; // AUDF0
            case 0x16: this.audf[1] = data & 0x1F; break; // AUDF1
            case 0x17: this.audv[0] = data & 0x0F; break; // AUDV0
            case 0x18: this.audv[1] = data & 0x0F; break; // AUDV1
            case 0x19: this.hmp0 = (data >> 4) & 0x0F; break; // HMP0
            case 0x1A: this.hmp1 = (data >> 4) & 0x0F; break; // HMP1
            case 0x1B:
                this.grp0 = data; // GRP0
                // VDELP1: writing GRP0 latches GRP1 into the active register
                if (this.vdelp1) this.grp1Active = this.grp1;
                // VDELP0 (not set): GRP0 becomes active immediately
                if (!this.vdelp0) this.grp0Active = data;
                break;
            case 0x1C:
                this.grp1 = data; // GRP1
                // VDELP0: writing GRP1 latches GRP0 into the active register
                if (this.vdelp0) this.grp0Active = this.grp0;
                // VDELBL: writing GRP1 latches ENABL into the active register
                if (this.vdelbl) this.enablActive = this.enabl;
                // VDELP1 (not set): GRP1 becomes active immediately
                if (!this.vdelp1) this.grp1Active = data;
                break;
            case 0x1D:
                this.enam0 = data & 0x01;
                if (!this.vdelp0) this.enam0Active = this.enam0;
                break;
            case 0x1E:
                this.enam1 = data & 0x01;
                if (!this.vdelp1) this.enam1Active = this.enam1;
                break;
            case 0x1F:
                this.enabl = data & 0x01;
                // VDELBL (not set): ball enable becomes active immediately
                if (!this.vdelbl) this.enablActive = this.enabl;
                break;
            case 0x20: this.hmm0 = (data >> 4) & 0x0F; break; // HMM0
            case 0x21: this.hmm1 = (data >> 4) & 0x0F; break; // HMM1
            case 0x22: this.hmbl = (data >> 4) & 0x0F; break; // HMBL
            case 0x23: this.vdelp0 = data & 0x01; break;
            case 0x24: this.vdelp1 = data & 0x01; break;
            case 0x25: this.vdelbl = data & 0x01; break;
            case 0x26: this.resmp0 = data & 0x01; break;
            case 0x27: this.resmp1 = data & 0x01; break;
            case 0x28: this.applyHMOVE(); break;
            case 0x29: this.hmp0 = 0; this.hmp1 = 0; this.hmm0 = 0; this.hmm1 = 0; this.hmbl = 0; break;
            case 0x2A: this.clearCollisions(); break;
            default: break;
        }
    }

    // ---- Register reads ----
    public read(addr: number): number {
        switch (addr & 0x3F) {
            case 0x00: return this.collM0P0 | this.collM0P1;
            case 0x01: return this.collM1P0 | this.collM1P1;
            case 0x02: return this.collP0PF | this.collP0BL;
            case 0x03: return this.collP1PF | this.collP1BL;
            case 0x04: return this.collM0PF | this.collM0BL;
            case 0x05: return this.collM1PF | this.collM1BL;
            case 0x06: return this.collBLPF;
            case 0x07: return this.collP0P1 | this.collM0M1;
            case 0x08: return this.inpt0;
            case 0x09: return this.inpt1;
            case 0x0A: return this.inpt2;
            case 0x0B: return this.inpt3;
            case 0x0C: return this.inpt4;
            case 0x0D: return this.inpt5;
            default: return 0xFF; // open bus
        }
    }

    // Position resulting from a RESP/RESM/RESBL write at the current clock.
    private respPosition(): number {
        const pos = (this.pixelClock + 1) % CLOCKS_PER_SCANLINE;
        if (pos < VISIBLE_CLOCK_START) return VISIBLE_CLOCK_START;
        return pos;
    }

    // HMOVE: apply horizontal motion registers (motion amount = hmp value)
    private applyHMOVE() {
        const apply = (pos: number, hmp: number) => {
            // Real TIA: motion = (hmp ^ 0x08) - 0x08, giving -8..+7 color clocks.
            // hmp 0-7 => move right 1-8... per Stella: 0x00-0x70 => -8..+7.
            const motion = ((hmp ^ 0x08) - 0x08);
            return (pos + motion + CLOCKS_PER_SCANLINE) % CLOCKS_PER_SCANLINE;
        };
        this.posP0 = apply(this.posP0, this.hmp0);
        this.posP1 = apply(this.posP1, this.hmp1);
        this.posM0 = apply(this.posM0, this.hmm0);
        this.posM1 = apply(this.posM1, this.hmm1);
        this.posBL = apply(this.posBL, this.hmbl);
    }

    // Advance one CPU cycle (3 color clocks)
    public clock() {
        for (let i = 0; i < 3; i++) {
            this.audioClockColor();
            this.renderPixel();
            this.pixelClock = (this.pixelClock + 1) % CLOCKS_PER_SCANLINE;
            if (this.pixelClock === 0) {
                this.onScanlineEnd();
            }
        }

        // WSYNC releases exactly at the end of the scanline (clock 0 of the
        // next line), matching real hardware timing.
        if (this.wsyncRequested && this.pixelClock === 0) {
            this.wsyncRequested = false;
        }
    }

    private onScanlineEnd() {
        this.scanline++;
        this._linesSinceFrameStart++;
        if (this.frameComplete) return; // frame already ended via VSYNC lock
        if (this._linesSinceFrameStart >= 320) {
            // Safety net: game never asserted VSYNC (crashed kernel) — end
            // anyway. Must exceed any LEGAL kernel frame (some run 265-280
            // lines); a 262 cutoff would chop the frame before its VSYNC and
            // shatter the picture into fragments.
            this.endFrame();
        }
    }

    private _contentFound = false;
    private _vsyncActive = false;
    private _frameStarted = false;
    private _linesSinceFrameStart = 0;

    private endFrame() {
        this.frameComplete = true;
        this._frameStarted = false;
    }

    private startFrame() {
        // Clear stale content from last frame BEFORE drawing the new one (the
        // shell reads the buffer after runFrame returns, so it must still hold
        // the finished picture here — clearing at endFrame would blank it).
        this.framebuffer.fill(0);
        this.scanline = 0;
        this._linesSinceFrameStart = 0;
        this._frameStarted = true;
    }

    // Decode NUSIZ: returns { size, copies: number[] } per real TIA semantics.
    // NUSIZ 0-7: 0=one copy, 1=two close (16), 2=two medium (32),
    // 3=three close (16,32), 4=two wide (64), 5=ONE double-size copy,
    // 6=three medium (32,64), 7=ONE quad-size copy.
    private decodeNusiz(nusiz: number): { size: number; copies: number[]; missile: boolean } {
        const code = nusiz & 0x07;
        let size = 1;
        let copies: number[] = [0];
        switch (code) {
            case 0: size = 1; copies = [0]; break;
            case 1: size = 1; copies = [0, 16]; break;
            case 2: size = 1; copies = [0, 32]; break;
            case 3: size = 1; copies = [0, 16, 32]; break;
            case 4: size = 1; copies = [0, 64]; break;
            case 5: size = 2; copies = [0]; break;
            case 6: size = 1; copies = [0, 32, 64]; break;
            case 7: size = 4; copies = [0]; break;
        }
        return { size, copies, missile: (nusiz & 0x20) !== 0 };
    }

    private renderPixel() {
        const clock = this.pixelClock;
        if (clock < VISIBLE_CLOCK_START) return;

        const x = clock - VISIBLE_CLOCK_START;
        if (x >= VISIBLE_PIXELS) return;

        const line = this.scanline;
        if (line >= SCANLINES_PER_FRAME) return;

        // Background
        let color = this.bcol;
        let pfOn = false;
        let p0On = false, p1On = false, m0On = false, m1On = false, blOn = false;

        // ---- Playfield ----
        // Each PF register bit is 4 color clocks wide. Left half: PF0 (nibbles
        // 4-7, MSB-first), PF1 (all 8 bits, MSB-first), PF2 (8 bits, LSB-first).
        // Right half mirrors the left when CTRLPF bit0 is set; otherwise it is
        // a copy of the same sequence in forward order.
        {
            const p = clock - VISIBLE_CLOCK_START; // 0..159
            const reflect = (this.ctrlpf & 0x01) !== 0;
            let pfBit = 0;
            if (p < 80) {
                // Left half: 20 playfield pixels of 4 clocks each
                const idx = p >> 2; // 0..19
                if (idx < 4) pfBit = (this.pf0 >> (7 - idx)) & 0x01;
                else if (idx < 12) pfBit = (this.pf1 >> (11 - idx)) & 0x01;
                else pfBit = (this.pf2 >> (idx - 12)) & 0x01;
            } else {
                // Right half: mirrored or repeated
                const idx = (p - 80) >> 2; // 0..19
                if (reflect) {
                    const midx = 19 - idx;
                    if (midx < 4) pfBit = (this.pf0 >> (7 - midx)) & 0x01;
                    else if (midx < 12) pfBit = (this.pf1 >> (11 - midx)) & 0x01;
                    else pfBit = (this.pf2 >> (midx - 12)) & 0x01;
                } else {
                    // Non-reflected: right half repeats PF0's LOW nibble
                    // (real TIA behavior — PF0 high nibble is left-half only)
                    if (idx < 4) pfBit = (this.pf0 >> idx) & 0x01;
                    else if (idx < 12) pfBit = (this.pf1 >> (11 - idx)) & 0x01;
                    else pfBit = (this.pf2 >> (idx - 12)) & 0x01;
                }
            }
            pfOn = pfBit !== 0;
        }

        // ---- Player/Missile/Ball positions ----
        const checkObject = (pos: number, nusiz: number): boolean => {
            const { size, copies } = this.decodeNusiz(nusiz);
            for (const off of copies) {
                const target = (pos + off) % CLOCKS_PER_SCANLINE;
                const diff = (clock - target + CLOCKS_PER_SCANLINE) % CLOCKS_PER_SCANLINE;
                if (diff < size) return true;
            }
            return false;
        };

        p0On = checkObject(this.posP0, this.nusiz0);
        p1On = checkObject(this.posP1, this.nusiz1);

        // Missiles: need ENAM enabled and RESMP cleared
        if (this.enam0Active && !this.resmp0 && this.grpHit(this.grp0Active, this.posP0, this.nusiz0, this.posM0, clock)) {
            m0On = true;
        }
        if (this.enam1Active && !this.resmp1 && this.grpHit(this.grp1Active, this.posP1, this.nusiz1, this.posM1, clock)) {
            m1On = true;
        }
        if (this.enablActive) {
            blOn = checkObject(this.posBL, (0x20 | 0x01)); // ball: 1x with double width
        }

        // ---- Collision detection (only in visible area) ----
        if (!this.vblank) {
            if (p0On && m0On) this.collM0P0 = 0x80;
            if (p1On && m0On) this.collM0P1 = 0x80;
            if (p0On && m1On) this.collM1P0 = 0x80;
            if (p1On && m1On) this.collM1P1 = 0x80;
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

        // ---- Priority resolution ----
        const playfieldInFront = (this.ctrlpf & 0x04) !== 0;
        const spritePresent = p0On || p1On || m0On || m1On || blOn;

        if (playfieldInFront) {
            if (pfOn) color = this.pfcol;
            else if (spritePresent) color = this.spriteColor(p0On, p1On, m0On, m1On, blOn);
        } else {
            if (spritePresent) color = this.spriteColor(p0On, p1On, m0On, m1On, blOn);
            else if (pfOn) color = this.pfcol;
        }

        // TIA color $XY: X = hue (palette row), Y = luminance (column).
        // The table is hue-major (16 hues x 8 lums) — a linear index would
        // scramble hues (e.g. $85 purple -> gray).
        const pal = NTSC_PALETTE[(((color >> 4) & 0x0F) << 3) | (color & 0x07)] ?? NTSC_PALETTE[0];
        // Map the physical scanline into the 192-row display window (TV-style
        // vertical hold: the window tracks the content, so kernels that start
        // a line or two off still fill the screen identically every frame).
        const dispLine = line - this.displayTop;
        if (dispLine < 0 || dispLine >= 192) return;
        this.framebuffer[dispLine * VISIBLE_PIXELS + x] = (0xFF << 24) | (pal[0] << 16) | (pal[1] << 8) | pal[2];
    }

    private grpHit(grp: number, playerPos: number, playerNusiz: number, missilePos: number, clock: number): boolean {
        // Simple missile rendering: missile appears when it overlaps the player's
        // graphic position region. The missile is 1-2 clocks wide.
        const { size } = this.decodeNusiz(playerNusiz);
        const diff = (clock - missilePos + CLOCKS_PER_SCANLINE) % CLOCKS_PER_SCANLINE;
        return diff < (size === 8 ? 8 : 2);
    }

    private spriteColor(p0On: boolean, p1On: boolean, m0On: boolean, m1On: boolean, blOn: boolean): number {
        // Priority: player0 > player1 > missile0 > missile1 > ball
        if (p0On) return this.p0col;
        if (p1On) return this.p1col;
        if (blOn) return this.bcol;
        if (m0On) return this.p0col;
        if (m1On) return this.p1col;
        return this.bcol;
    }

    public getFrameBuffer(): Uint32Array {
        return this.framebuffer;
    }

    // ===================== Audio =====================
    // Two tone generators clocked off the color clock. One output sample is
    // produced every 114 color clocks => 3579545/114 ~= 31399 Hz.
    public audc = [0, 0];
    public audf = [0, 0];
    public audv = [0, 0];

    private audioBuf = new Float32Array(16384);
    private audioReadPos = 0;
    private audioWritePos = 0;
    private audioCount = 0;
    private sampleFrac = 0;

    // Per-channel divider + poly-counter state
    private chDiv = [0, 0];
    private p4Idx = [0, 0];
    private p5Idx = [0, 0];
    private p9Idx = [0, 0];
    private sqLevel = [1, 1];

    public get audioSamplesAvailable(): number {
        return this.audioCount;
    }

    /** Drain up to out.length mono samples; returns how many were written. */
    public drainAudio(out: Float32Array): number {
        let n = 0;
        while (n < out.length && this.audioCount > 0) {
            out[n++] = this.audioBuf[this.audioReadPos];
            this.audioReadPos = (this.audioReadPos + 1) % this.audioBuf.length;
            this.audioCount--;
        }
        return n;
    }

    private pushSample(v: number) {
        if (this.audioCount >= this.audioBuf.length) {
            // Buffer full: drop oldest sample to keep latency bounded.
            this.audioReadPos = (this.audioReadPos + 1) % this.audioBuf.length;
            this.audioCount--;
        }
        this.audioBuf[this.audioWritePos] = v;
        this.audioWritePos = (this.audioWritePos + 1) % this.audioBuf.length;
        this.audioCount++;
    }

    /** Advance audio by one color clock. */
    private audioClockColor() {
        this.tickChannel(0);
        this.tickChannel(1);

        this.sampleFrac++;
        if (this.sampleFrac >= 114) {
            this.sampleFrac -= 114;
            const s0 = this.channelOutput(0);
            const s1 = this.channelOutput(1);
            // Each channel contributes -15..+15; normalize summed mix to -1..1.
            const mixed = (s0 + s1) / 30;
            this.pushSample(mixed > 1 ? 1 : mixed < -1 ? -1 : mixed);
        }
    }

    private tickChannel(ch: number) {
        this.chDiv[ch]--;
        if (this.chDiv[ch] > 0) return;
        // Poly/divider clock = 31400 / (AUDF+1) Hz => one tick every 114*(AUDF+1) color clocks.
        this.chDiv[ch] += 114 * (this.audf[ch] + 1);

        const audc = this.audc[ch];
        // Advance the relevant noise/tone stage(s).
        switch (audc) {
            case 0x01:
            case 0x02:
                this.p4Idx[ch] = (this.p4Idx[ch] + 1) % POLY4_LEN;
                break;
            case 0x03: // 5-bit poly gating 4-bit poly
                this.p5Idx[ch] = (this.p5Idx[ch] + 1) % POLY5_LEN;
                this.p4Idx[ch] = (this.p4Idx[ch] + 1) % POLY4_LEN;
                break;
            case 0x04:
            case 0x05:
            case 0x0B:
            case 0x0C:
            case 0x0D: // pure div-by-2 square
                this.sqLevel[ch] ^= 1;
                break;
            case 0x06:
            case 0x0A: // 9-bit poly then div2
                this.p9Idx[ch] = (this.p9Idx[ch] + 1) % POLY9_LEN;
                if (POLY9[this.p9Idx[ch]]) this.sqLevel[ch] ^= 1;
                break;
            case 0x07:
            case 0x09: // 5-bit poly
                this.p5Idx[ch] = (this.p5Idx[ch] + 1) % POLY5_LEN;
                break;
            case 0x08: // 5-bit poly gating 9-bit poly
                this.p5Idx[ch] = (this.p5Idx[ch] + 1) % POLY5_LEN;
                this.p9Idx[ch] = (this.p9Idx[ch] + 1) % POLY9_LEN;
                break;
            case 0x0E:
            case 0x0F: // 4-bit poly then div2
                this.p4Idx[ch] = (this.p4Idx[ch] + 1) % POLY4_LEN;
                if (POLY4[this.p4Idx[ch]]) this.sqLevel[ch] ^= 1;
                break;
            default: // 0x00: constant level (volume-only / PCM)
                break;
        }
    }

    private channelOutput(ch: number): number {
        const vol = this.audv[ch];
        if (vol === 0) return 0;

        const audc = this.audc[ch];
        let bit: number;
        switch (audc) {
            case 0x00: bit = 1; break; // constant (PCM via AUDV)
            case 0x01:
            case 0x02: bit = POLY4[this.p4Idx[ch]]; break;
            case 0x03: bit = POLY4[this.p4Idx[ch]] & POLY5[this.p5Idx[ch]]; break;
            case 0x04:
            case 0x05:
            case 0x0B:
            case 0x0C:
            case 0x0D: bit = this.sqLevel[ch]; break;
            case 0x06:
            case 0x0A: bit = this.sqLevel[ch]; break;
            case 0x07:
            case 0x09: bit = POLY5[this.p5Idx[ch]]; break;
            case 0x08: bit = POLY5[this.p5Idx[ch]] & POLY9[this.p9Idx[ch]]; break;
            case 0x0E:
            case 0x0F: bit = this.sqLevel[ch]; break;
            default: bit = 1; break;
        }
        return bit ? vol : -vol;
    }

    public saveState(): any {
        return {
            vsync: this.vsync, vblank: this.vblank, ctrlpf: this.ctrlpf,
            nusiz0: this.nusiz0, nusiz1: this.nusiz1,
            p0col: this.p0col, p1col: this.p1col, pfcol: this.pfcol, bcol: this.bcol,
            pf0: this.pf0, pf1: this.pf1, pf2: this.pf2,
            grp0: this.grp0, grp1: this.grp1,
            enam0: this.enam0, enam1: this.enam1, enabl: this.enabl,
            vdelp0: this.vdelp0, vdelp1: this.vdelp1, vdelbl: this.vdelbl,
            resmp0: this.resmp0, resmp1: this.resmp1,
            posP0: this.posP0, posP1: this.posP1, posM0: this.posM0, posM1: this.posM1, posBL: this.posBL,
            hmp0: this.hmp0, hmp1: this.hmp1, hmm0: this.hmm0, hmm1: this.hmm1, hmbl: this.hmbl,
            audc: [...this.audc], audf: [...this.audf], audv: [...this.audv],
            scanline: this.scanline, pixelClock: this.pixelClock,
        };
    }

    public loadState(s: any): void {
        if (!s) return;
        this.vsync = s.vsync ?? 0; this.vblank = s.vblank ?? 0; this.ctrlpf = s.ctrlpf ?? 0;
        this.nusiz0 = s.nusiz0 ?? 0; this.nusiz1 = s.nusiz1 ?? 0;
        this.p0col = s.p0col ?? 0; this.p1col = s.p1col ?? 0;
        this.pfcol = s.pfcol ?? 0; this.bcol = s.bcol ?? 0;
        this.pf0 = s.pf0 ?? 0; this.pf1 = s.pf1 ?? 0; this.pf2 = s.pf2 ?? 0;
        this.grp0 = s.grp0 ?? 0; this.grp1 = s.grp1 ?? 0;
        this.enam0 = s.enam0 ?? 0; this.enam1 = s.enam1 ?? 0; this.enabl = s.enabl ?? 0;
        this.vdelp0 = s.vdelp0 ?? 0; this.vdelp1 = s.vdelp1 ?? 0; this.vdelbl = s.vdelbl ?? 0;
        this.resmp0 = s.resmp0 ?? 0; this.resmp1 = s.resmp1 ?? 0;
        this.posP0 = s.posP0 ?? 0; this.posP1 = s.posP1 ?? 0;
        this.posM0 = s.posM0 ?? 0; this.posM1 = s.posM1 ?? 0; this.posBL = s.posBL ?? 0;
        this.hmp0 = s.hmp0 ?? 0; this.hmp1 = s.hmp1 ?? 0;
        this.hmm0 = s.hmm0 ?? 0; this.hmm1 = s.hmm1 ?? 0; this.hmbl = s.hmbl ?? 0;
        if (s.audc) this.audc = [...s.audc];
        if (s.audf) this.audf = [...s.audf];
        if (s.audv) this.audv = [...s.audv];
        this.scanline = s.scanline ?? 0;
        this.pixelClock = s.pixelClock ?? 0;
        this.grp0Active = this.vdelp0 ? this.grp0Active : this.grp0;
        this.grp1Active = this.vdelp1 ? this.grp1Active : this.grp1;
        this.enablActive = this.vdelbl ? this.enablActive : this.enabl;
        this.clearCollisions();
    }
}