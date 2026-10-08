// Headless Atari 2600 verification: graphics + audio, no browser needed.
// Loads a real ROM, runs frames through the bus exactly like the shell does,
// writes a PPM screenshot, and checks TIA audio sample production.

import * as fs from 'fs';
import * as path from 'path';
import { Bus } from '../src/atari/bus';
import { Cartridge } from '../src/atari/cartridge';

const ROM_PATH = '/home/vishal/dev/emulator/retro-suite/atari/public/Pac-Man.a26';
const OUT_DIR = '/home/vishal/dev/emulator/retro-suite/atari/testout';

function writePPM(file: string, w: number, h: number, fb: Uint32Array) {
    const buf = Buffer.alloc(15 + w * h * 3);
    buf.write(`P6\n${w} ${h}\n255\n`, 0);
    let o = 15;
    for (let i = 0; i < w * h; i++) {
        const px = fb[i];
        buf[o++] = (px >> 16) & 0xFF; // R
        buf[o++] = (px >> 8) & 0xFF;  // G
        buf[o++] = px & 0xFF;         // B
    }
    fs.writeFileSync(file, buf);
}

function main() {
    if (!fs.existsSync(ROM_PATH)) {
        console.error(`FAIL: ROM not found at ${ROM_PATH}`);
        process.exit(1);
    }
    const rom = fs.readFileSync(ROM_PATH);
    const cart = new Cartridge(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
    const bus = new Bus();
    bus.insertCartridge(cart);
    bus.reset();

    // ---- Graphics test: run 120 frames with neutral input ----
    const W = 160, H = 192;
    const seenColors = new Set<number>();
    for (let f = 0; f < 120; f++) {
        bus.joystick = 0; // neutral
        bus.runFrame();
        const fb = bus.tia.framebuffer;
        for (let y = 20; y < H - 20; y += 4) {
            for (let x = 4; x < W - 4; x += 4) {
                const px = fb[y * W + x];
                const rgb = px & 0xFFFFFF;
                if (rgb !== 0) seenColors.add(rgb);
            }
        }
    }

    const fb = bus.tia.framebuffer.subarray(0, W * H);
    let nonBlack = 0;
    for (let i = 0; i < W * H; i++) if ((fb[i] & 0xFFFFFF) !== 0) nonBlack++;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    writePPM(path.join(OUT_DIR, 'atari_frame_120.ppm'), W, H, fb);

    console.log('=== GRAPHICS ===');
    console.log(`frames run:      120`);
    console.log(`non-black px:    ${nonBlack}/${W * H} (${((nonBlack / (W * H)) * 100).toFixed(1)}%)`);
    console.log(`distinct colors: ${seenColors.size}`);
    const pal = [...seenColors].slice(0, 8).map(c =>
        `#${c.toString(16).padStart(6, '0')}`).join(' ');
    console.log(`sample palette:  ${pal}`);

    // ---- Audio test: force tone registers, clock TIA, count samples ----
    const tia = bus.tia;
    tia.drainAudio(new Float32Array(tia.audioSamplesAvailable)); // empty the ring first
    tia.audv[0] = 8;   // volume
    tia.audf[0] = 1;   // pitch
    tia.audc[0] = 12;  // pure square
    const before = tia.audioSamplesAvailable;
    for (let c = 0; c < 3579545 / 60; c++) tia.clock(); // one frame worth of color clocks
    const produced = tia.audioSamplesAvailable - before;

    const out = new Float32Array(Math.min(produced, 4096));
    const drained = tia.drainAudio(out);
    let peak = 0;
    for (let i = 0; i < drained; i++) peak = Math.max(peak, Math.abs(out[i]));

    console.log('\n=== AUDIO ===');
    console.log(`samples produced in 1 frame: ${produced} (expect ~523)`);
    console.log(`drained: ${drained}, peak amplitude: ${peak.toFixed(3)} (expect > 0.1)`);

    // ---- Verdict ----
    const gfxOk = nonBlack > W * H * 0.3 && seenColors.size >= 3;
    const audOk = produced > 400 && peak > 0.1;
    console.log(`\nGRAPHICS: ${gfxOk ? 'PASS' : 'FAIL'}`);
    console.log(`AUDIO:    ${audOk ? 'PASS' : 'FAIL'}`);
    process.exit(gfxOk && audOk ? 0 : 1);
}

main();
