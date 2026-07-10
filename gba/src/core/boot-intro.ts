// Faithful recreation of the GBA BIOS boot animation (the "GAME BOY" logo rising
// with a spring bounce, plus "Nintendo" wordmark and the startup chime).
// Rendered at GBA native resolution (240x160) onto a canvas.
import { GBA_WIDTH, GBA_HEIGHT } from "./types";

// Pixel bitmap of the classic "GAME BOY" wordmark (white on transparent).
// 96 x 32 px, 1 bit per pixel (1 = white). Hand-crafted to evoke the logo.
// Each row is 96 bits = 12 bytes. 32 rows.
// We build it programmatically from a compact string grid for clarity.
const LOGO_ART: string[] = [
  "                                                                                                ",
  "  GGGG   AAAA  M   M  EEEEE       B   B   OOO   Y   Y       RRRR    EEEEE   GGGG   III  SSSS  TTTTT",
  " G      A    A MM MM  E           B  B   O   O  Y   Y       R   R   E      G       I  S        T  ",
  " G  GG  AAAAAA M M M  EEEE        BBB    O   O   Y Y        RRRR    EEEE   G  GG   I   SSS     T  ",
  " G   G  A    A M   M  E           B  B   O   O    Y         R  R    E      G   G   I      S    T  ",
  "  GGGG  A    A M   M  EEEEE       B   B   OOO     Y         R   R   EEEEE   GGGG   III SSSS    T  ",
  "                                                                                                ",
];

function buildLogoBitmap(): { w: number; h: number; data: Uint8Array } {
  const h = LOGO_ART.length;
  const w = LOGO_ART[0].length;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = LOGO_ART[y][x];
      data[y * w + x] = ch !== " " ? 1 : 0;
    }
  }
  return { w, h, data };
}

const LOGO = buildLogoBitmap();

export interface BootIntroState {
  started: boolean;
  startTime: number;
  chimePlayed: boolean;
  finished: boolean;
}

export function createBootIntroState(): BootIntroState {
  return { started: false, startTime: 0, chimePlayed: false, finished: false };
}

// Ease-out-back: overshoots above 1 then settles to 1
function easeOutBack(p: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

// Damped spring position for the logo rise with a bounce.
// Returns the logo's center Y (in GBA pixel coords).
function logoY(t: number): number {
  const startY = GBA_HEIGHT + 30; // below the screen
  const targetY = 64; // centered-ish (upper portion)
  const rise = 0.55; // seconds to first reach target
  if (t <= 0) return startY;
  const p = Math.min(1, t / rise);
  const e = easeOutBack(p);
  return startY + (targetY - startY) * e;
}

// Render the boot intro at time `t` (seconds since start) into ctx (GBA resolution).
export function renderBootIntro(ctx: CanvasRenderingContext2D, t: number, _state: BootIntroState) {
  // Clear to black (GBA boot backdrop)
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, GBA_WIDTH, GBA_HEIGHT);

  // Subtle vignette / scanline texture for retro feel (optional, keep subtle)
  // (kept off to match the real clean GBA boot)

  // Logo vertical position
  const ly = logoY(t);

  // Draw the "GAME BOY" wordmark as white pixels
  const scale = 1; // native pixel size
  const logoW = LOGO.w * scale;
  const logoH = LOGO.h * scale;
  const lx = Math.floor((GBA_WIDTH - logoW) / 2);
  ctx.fillStyle = "#ffffff";
  for (let y = 0; y < LOGO.h; y++) {
    for (let x = 0; x < LOGO.w; x++) {
      if (LOGO.data[y * LOGO.w + x]) {
        ctx.fillRect(lx + x * scale, Math.floor(ly) + y * scale, scale, scale);
      }
    }
  }

  // "Nintendo" wordmark appears below the logo after it settles (~0.6s), fading in.
  if (t > 0.55) {
    const fadeP = Math.min(1, (t - 0.55) / 0.35);
    const alpha = fadeP;
    // The classic "Nintendo" logo is a flowing script; approximate with bold italic serif.
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffffff";
    ctx.font = "italic bold 16px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Position below the settled logo center
    const ny = Math.min(ly + logoH + 14, 116);
    ctx.fillText("Nintendo", GBA_WIDTH / 2, ny);
    ctx.restore();
  }

  // A faint copyright line that fades in late (like real BIOS extras)
  if (t > 1.2) {
    const a = Math.min(1, (t - 1.2) / 0.6) * 0.5;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "#888888";
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    ctx.fillText("(C) 2001 Nintendo", GBA_WIDTH / 2, GBA_HEIGHT - 8);
    ctx.restore();
  }
}

// Web Audio chime: the GBA startup sound — a quick upward pitch sweep "bling!"
let audioCtx: AudioContext | null = null;
export function playBootChime() {
  try {
    if (!audioCtx) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      if (!AC) return;
      audioCtx = new AC();
    }
    const ac = audioCtx;
    if (ac.state === "suspended") ac.resume();
    const now = ac.currentTime;

    // Master gain
    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    master.connect(ac.destination);

    // Tone 1: rising sweep (the "bli")
    const o1 = ac.createOscillator();
    o1.type = "square";
    o1.frequency.setValueAtTime(660, now);
    o1.frequency.exponentialRampToValueAtTime(990, now + 0.12);
    const g1 = ac.createGain();
    g1.gain.setValueAtTime(0.5, now);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    o1.connect(g1).connect(master);
    o1.start(now);
    o1.stop(now + 0.25);

    // Tone 2: higher "ng!" bell
    const o2 = ac.createOscillator();
    o2.type = "triangle";
    o2.frequency.setValueAtTime(1320, now + 0.12);
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(0.0001, now + 0.12);
    g2.gain.exponentialRampToValueAtTime(0.4, now + 0.16);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    o2.connect(g2).connect(master);
    o2.start(now + 0.12);
    o2.stop(now + 0.62);
  } catch (e) {
    // ignore audio errors
  }
}
