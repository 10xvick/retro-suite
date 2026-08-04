// Atari 2600 TIA (Television Interface Adaptor)
// Handles scanline timing, playfield/player/missile/ball rendering, collision latches.
// Clocking: called once per CPU cycle (= 3 color clocks). Scanline = 228 color clocks.

const CLOCKS_PER_SCANLINE = 228;
const SCANLINES_PER_FRAME = 262;
const VISIBLE_CLOCK_START = 68;
const VISIBLE_PIXELS = 160;

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
            case 0x00: this.vsync = data; break;
            case 0x01: this.vblank = data; break;
            case 0x02: this.wsyncRequested = true; break; // WSYNC - CPU halts until end of scanline
            case 0x03: break; // RSYNC
            case 0x04: this.nusiz0 = data; break;
            case 0x05: this.nusiz1 = data; break;
            case 0x06: this.p0col = data; break;
            case 0x07: this.p1col = data; break;
            case 0x08: this.pfcol = data; break;
            case 0x09: this.bcol = data; break;
            case 0x0A: this.pf0 = data; break;
            case 0x0B: this.pf1 = data; break;
            case 0x0C: this.pf2 = data; break;
            case 0x0D: this.posP0 = (this.pixelClock + 1) % CLOCKS_PER_SCANLINE; break; // RESP0
            case 0x0E: this.posP1 = (this.pixelClock + 1) % CLOCKS_PER_SCANLINE; break; // RESP1
            case 0x0F: this.posM0 = (this.pixelClock + 1) % CLOCKS_PER_SCANLINE; break; // RESM0
            case 0x10: this.posM1 = (this.pixelClock + 1) % CLOCKS_PER_SCANLINE; break; // RESM1
            case 0x11: this.posBL = (this.pixelClock + 1) % CLOCKS_PER_SCANLINE; break; // RESBL
            case 0x12: break; // AUDC0
            case 0x13: break; // AUDC1
            case 0x14: break; // AUDF0
            case 0x15: break; // AUDF1
            case 0x16: break; // AUDV0
            case 0x17: break; // AUDV1
            case 0x1B:
                this.grp0 = data;
                if (!this.vdelp0) this.grp0Active = data;
                break;
            case 0x1C:
                this.grp1 = data;
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
                if (!this.vdelbl) this.enablActive = this.enabl;
                break;
            case 0x20: this.hmp0 = (data >> 4) & 0x0F; break;
            case 0x21: this.hmp1 = (data >> 4) & 0x0F; break;
            case 0x22: this.hmm0 = (data >> 4) & 0x0F; break;
            case 0x23: this.hmm1 = (data >> 4) & 0x0F; break;
            case 0x24: this.hmbl = (data >> 4) & 0x0F; break;
            case 0x25: this.vdelp0 = data & 0x01; break;
            case 0x26: this.vdelp1 = data & 0x01; break;
            case 0x27: this.vdelbl = data & 0x01; break;
            case 0x28: this.resmp0 = data & 0x01; break;
            case 0x29: this.resmp1 = data & 0x01; break;
            case 0x2A: this.applyHMOVE(); break;
            case 0x2B: this.hmp0 = 0; this.hmp1 = 0; this.hmm0 = 0; this.hmm1 = 0; this.hmbl = 0; break;
            case 0x2C: this.clearCollisions(); break;
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

    // HMOVE: apply horizontal motion registers (motion amount = hmp value)
    private applyHMOVE() {
        const apply = (pos: number, hmp: number) => {
            // hmp 0-7 => move left (negative), 8-15 => move right (positive)
            const motion = hmp & 0x08 ? (hmp & 0x07) : -(hmp & 0x07);
            return (pos + motion) & 0xFF;
        };
        this.posP0 = apply(this.posP0, this.hmp0);
        this.posP1 = apply(this.posP1, this.hmp1);
        this.posM0 = apply(this.posM0, this.hmm0);
        this.posM1 = apply(this.posM1, this.hmm1);
        this.posBL = apply(this.posBL, this.hmbl);
    }

    // Advance one CPU cycle (3 color clocks)
    public clock() {
        // Advance graphics latches for VDEL at start of scanline
        if (this.pixelClock === 0) {
            if (this.vdelp0) this.grp0Active = this.grp0;
            if (this.vdelp1) this.grp1Active = this.grp1;
            if (this.vdelbl) this.enablActive = this.enabl;
            if (!this.vdelp0) this.enam0Active = this.enam0;
            if (!this.vdelp1) this.enam1Active = this.enam1;
        }

        for (let i = 0; i < 3; i++) {
            if (this.pixelClock === 0) {
                this.onScanlineStart();
            }
            this.renderPixel();
            this.pixelClock = (this.pixelClock + 1) % CLOCKS_PER_SCANLINE;
            if (this.pixelClock === 0) {
                this.onScanlineEnd();
            }
        }

        // If WSYNC was requested and we've reached the end (or near-end) of the
        // scanline, let the CPU continue.
        if (this.wsyncRequested && this.pixelClock >= 224) {
            this.wsyncRequested = false;
        }
    }

    private onScanlineStart() {
        if (this.scanline === SCANLINES_PER_FRAME) {
            this.scanline = 0;
            this.frameComplete = true;
        }
    }

    private onScanlineEnd() {
        if (this.frameComplete) {
            this.frameComplete = false;
        }
        this.scanline = (this.scanline + 1) % SCANLINES_PER_FRAME;
    }

    // Decode NUSIZ: returns { size, copies: number[], widthPerCopy }
    private decodeNusiz(nusiz: number): { size: number; copies: number[]; missile: boolean } {
        const size = 1 << (nusiz & 0x03); // 1, 2, 4, 8
        const copyCode = (nusiz >> 2) & 0x07;
        let copies: number[] = [0];
        switch (copyCode) {
            case 0: copies = [0]; break;
            case 1: copies = [0, 16]; break;
            case 2: copies = [0, 32]; break;
            case 3: copies = [0, 16, 32]; break;
            case 4: copies = [0, 64]; break;
            case 5: copies = [0, 32, 64]; break;
            case 6: copies = [0, 64, 128]; break;
            case 7: copies = [0]; break;
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
        {
            // Left half
            let pfBit = 0;
            if (clock < VISIBLE_CLOCK_START + 20) {
                const p = clock - VISIBLE_CLOCK_START;
                if (p < 4) pfBit = (this.pf0 >> (7 - p)) & 0x01;
                else if (p < 12) pfBit = (this.pf1 >> (11 - p)) & 0x01;
                else pfBit = (this.pf2 >> (p - 12)) & 0x01;
            } else {
                // Right half
                const rp = clock - (VISIBLE_CLOCK_START + 20);
                if (rp < 8) pfBit = (this.pf2 >> (7 - rp)) & 0x01;
                else if (rp < 16) pfBit = (this.pf1 >> (rp - 8)) & 0x01;
                else pfBit = (this.pf0 >> (rp - 16)) & 0x01;
                // If not reflected, the right half isn't a mirror; in reflect mode
                // the right half mirrors the left. Keep simple mirror behavior.
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

        // Missiles: enabled by GRP/ENAM, and positioned via RESMP
        if (!this.resmp0 && this.grpHit(this.grp0Active, this.posP0, this.nusiz0, this.posM0, clock)) {
            m0On = true;
        }
        if (!this.resmp1 && this.grpHit(this.grp1Active, this.posP1, this.nusiz1, this.posM1, clock)) {
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

        const idx = line * VISIBLE_PIXELS + x;
        const pal = NTSC_PALETTE[color & 0x7F] ?? NTSC_PALETTE[0];
        this.framebuffer[idx] = (0xFF << 24) | (pal[0] << 16) | (pal[1] << 8) | pal[2];
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
}