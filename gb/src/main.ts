import "./style.css";
import { GameBoy } from "./gb/gameboy";

// ---- Audio setup (Web Audio API) ----
// The APU generates stereo samples at 32768 Hz into a ring buffer.
// We use a ScriptProcessorNode to pull samples and play them through
// the browser's audio context (typically 44100 Hz).
// A GainNode boosts the volume (GB audio is quiet compared to modern audio).
let audioCtx: AudioContext | null = null;
let audioNode: ScriptProcessorNode | null = null;
let gainNode: GainNode | null = null;
let audioEnabled = false;

function initAudio() {
  if (audioCtx) return;
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  audioCtx = new AudioCtxClass();
  console.log("[Audio] Context created, sample rate:", audioCtx.sampleRate);

  // Gain node for volume control
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.0;

  const bufferSize = 2048;
  audioNode = audioCtx.createScriptProcessor(bufferSize, 0, 2);

  audioNode.onaudioprocess = (e: AudioProcessingEvent) => {
    const output = e.outputBuffer;
    const leftData = output.getChannelData(0);
    const rightData = output.getChannelData(1);
    const samplesNeeded = output.length;

    if (!audioEnabled || !gb) {
      // Output silence when disabled
      for (let i = 0; i < samplesNeeded; i++) {
        leftData[i] = 0;
        rightData[i] = 0;
      }
      return;
    }

    // Read interleaved stereo samples from the APU ring buffer
    const tempBuf = audioTempBuf;
    const available = gb.apu.readSamples(tempBuf, samplesNeeded * 2);

    // The APU generates at 32768 Hz but browser runs at 44100 Hz.
    // Simple resampling: repeat samples to fill the gap.
    const ratio = (samplesNeeded * 2) / Math.max(1, available);
    for (let i = 0; i < samplesNeeded; i++) {
      const srcIdx = Math.floor(i * 2 / ratio);
      if (srcIdx + 1 < available) {
        leftData[i] = tempBuf[srcIdx];
        rightData[i] = tempBuf[srcIdx + 1];
      } else if (srcIdx < available) {
        leftData[i] = tempBuf[srcIdx];
        rightData[i] = 0;
      } else {
        leftData[i] = 0;
        rightData[i] = 0;
      }
    }
  };

  audioNode.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  console.log("[Audio] Nodes connected");
}

// Reusable temp buffer to avoid GC pressure
const audioTempBuf = new Float32Array(8192);

async function toggleAudio(): Promise<boolean> {
  if (!audioCtx) {
    initAudio();
  }
  // Must resume within the user gesture (click handler)
  if (audioCtx && audioCtx.state === "suspended") {
    try {
      await audioCtx.resume();
      console.log("[Audio] Context resumed, state:", audioCtx.state);
    } catch (err) {
      console.error("[Audio] Failed to resume:", err);
    }
  }
  audioEnabled = !audioEnabled;
  console.log("[Audio] Enabled:", audioEnabled);
  return audioEnabled;
}

// Auto-enable audio on first user interaction (browser requires a gesture).
// We listen for the first click or keypress anywhere on the page.
let audioAutoStarted = false;
function tryAutoStartAudio() {
  if (audioAutoStarted) return;
  audioAutoStarted = true;
  if (!audioCtx) {
    initAudio();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().then(() => {
      audioEnabled = true;
      if (audioBtn) audioBtn.textContent = "Disable Audio";
      console.log("[Audio] Auto-enabled on first interaction");
    }).catch(() => {});
  } else {
    audioEnabled = true;
    if (audioBtn) audioBtn.textContent = "Disable Audio";
  }
}

// ---- DOM elements ----
const canvas = document.getElementById("screen") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
const loadRomBtn = document.getElementById("loadRomBtn") as HTMLButtonElement;
const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement;
const screenshotBtn = document.getElementById("screenshotBtn") as HTMLButtonElement;
const downloadLogBtn = document.getElementById("downloadLogBtn") as HTMLButtonElement;
const romInput = document.getElementById("romInput") as HTMLInputElement;
const speedSlider = document.getElementById("speedSlider") as HTMLInputElement;
const speedValue = document.getElementById("speedValue") as HTMLSpanElement;
const debugCheck = document.getElementById("debugCheck") as HTMLInputElement;
const debugCard = document.getElementById("debugCard") as HTMLDivElement;
const debugInfo = document.getElementById("debugInfo") as HTMLPreElement;
const serialOutput = document.getElementById("serialOutput") as HTMLPreElement;
const audioBtn = document.getElementById("audioBtn") as HTMLButtonElement;

// ---- ImageData for fast framebuffer blits ----
const imageData = ctx.createImageData(160, 144);
const pixels = imageData.data;

// ---- Game Boy instance ----
const gb = new GameBoy({
  onFrame: (fb) => {
    // Framebuffer is RGBA32. The PPU stashes sprite-priority info in the
    // alpha channel, so we must force alpha to 255 (opaque) when blitting
    // to the canvas, otherwise pixels would appear transparent.
    pixels.set(fb);
    for (let i = 3; i < pixels.length; i += 4) {
      pixels[i] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  },
  onSerialByte: (b) => {
    // Append to serial output (used by Blargg tests and games that print)
    if (b === 0x0A) {
      serialOutput.appendChild(document.createElement("br"));
    } else if (b === 0x0D) {
      // ignore CR
    } else if (b >= 0x20 && b < 0x7F) {
      serialOutput.appendChild(document.createTextNode(String.fromCharCode(b)));
    } else {
      serialOutput.appendChild(document.createTextNode(`\\x${b.toString(16).padStart(2, "0")}`));
    }
    // Auto-scroll
    serialOutput.scrollTop = serialOutput.scrollHeight;
  },
});

// ---- Emulator loop ----
let running = true;
let speed = 1.0;
let romLoaded = false;   // Don't run frames until ROM is loaded
const TARGET_FPS = 59.7;   // Game Boy runs at ~59.7 fps
let lastTime = performance.now();
let frameAccumulator = 0;

// Expose for debugging in the browser console
(window as any).__gb = gb;

function loop(now: number) {
  const delta = now - lastTime;
  lastTime = now;

  if (running && romLoaded) {
    frameAccumulator += delta * speed;
    const frameInterval = 1000 / TARGET_FPS;
    // Catch up if behind (max 4 frames per loop)
    let frames = 0;
    while (frameAccumulator >= frameInterval && frames < 4) {
      gb.runFrame();
      frameAccumulator -= frameInterval;
      frames++;
    }
    // If too far behind, drop the backlog
    if (frameAccumulator > frameInterval * 4) {
      frameAccumulator = 0;
    }
  }

  if (debugCheck.checked) {
    const cpu: any = gb.cpu;
    debugInfo.textContent =
      `PC: 0x${cpu.pc.toString(16).padStart(4, "0")}  ` +
      `AF: 0x${cpu.af.toString(16).padStart(4, "0")}  ` +
      `BC: 0x${cpu.bc.toString(16).padStart(4, "0")}  ` +
      `DE: 0x${cpu.de.toString(16).padStart(4, "0")}  ` +
      `HL: 0x${cpu.hl.toString(16).padStart(4, "0")}  ` +
      `SP: 0x${cpu.sp.toString(16).padStart(4, "0")}\n` +
      `Flags: Z=${cpu.flagZ ? 1 : 0} N=${cpu.flagN ? 1 : 0} H=${cpu.flagH ? 1 : 0} C=${cpu.flagC ? 1 : 0}\n` +
      `Total M-cycles: ${cpu.totalCycles.toLocaleString()}\n` +
      `Frames: ${gb.ppu.frameCount.toLocaleString()}\n` +
      `ROM banks: ${gb.mmu.romBanks}  cur bank: ${gb.mmu.romBank}\n` +
      `IME: ${cpu.ime}  HALT: ${cpu.halted}`;
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// ---- ROM loading ----
async function loadRomFromUrl(url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    gb.loadRom(buf);
    romLoaded = true;
    serialOutput.textContent = `Loaded ROM from ${url}\nSize: ${buf.length} bytes\n`;
    const title = buf.slice(0x134, 0x144);
    const cartType = buf[0x147];
    serialOutput.textContent += `Title: "${titleToAscii(title)}"\nCartridge type: 0x${cartType.toString(16)}\n`;
    console.log("[GameBoy] ROM loaded, emulator running");
  } catch (e) {
    serialOutput.textContent = `Failed to load ${url}: ${(e as Error).message}\n`;
    console.error("[GameBoy] ROM load failed:", e);
  }
}

function loadRomBuffer(buf: Uint8Array, name: string) {
  gb.loadRom(buf);
  romLoaded = true;
  serialOutput.textContent = `Loaded ROM: ${name}\nSize: ${buf.length} bytes\n`;
  const title = buf.slice(0x134, 0x144);
  serialOutput.textContent += `Title: "${titleToAscii(title)}"\n`;
  console.log("[GameBoy] ROM loaded, emulator running");
}

function titleToAscii(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) {
    if (b === 0) break;
    if (b >= 0x20 && b < 0x7F) s += String.fromCharCode(b);
    else s += ".";
  }
  return s;
}

function loadRomFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const buf = new Uint8Array(reader.result as ArrayBuffer);
    loadRomBuffer(buf, file.name);
  };
  reader.readAsArrayBuffer(file);
}

// Auto-load ROM: use embedded ROM if present (standalone HTML mode),
// otherwise fetch the ROM from the server (dev mode).
// Prefer spiderman.gbc (CGB) if available, fall back to batman.gb (DMG).
const embeddedRom = (window as any).__EMBEDDED_ROM;
if (embeddedRom instanceof Uint8Array) {
  loadRomBuffer(embeddedRom, "rom (embedded)");
} else {
  // Try GBC ROM first, then DMG ROM
  fetch("/spiderman.gbc").then(r => {
    if (r.ok) return r.arrayBuffer().then(buf => {
      loadRomBuffer(new Uint8Array(buf), "spiderman.gbc");
    });
    throw new Error("GBC ROM not found");
  }).catch(() => {
    loadRomFromUrl("/batman.gb");
  });
}

// ---- Button handlers ----
loadRomBtn.addEventListener("click", () => romInput.click());
romInput.addEventListener("change", () => {
  if (romInput.files && romInput.files[0]) {
    loadRomFile(romInput.files[0]);
  }
});

pauseBtn.addEventListener("click", () => {
  running = !running;
  pauseBtn.textContent = running ? "Pause" : "Resume";
});

resetBtn.addEventListener("click", () => {
  // Reload the current ROM to reset state
  gb.cpu.reset();
  gb.ppu.reset();
  serialOutput.textContent = "[Reset]\n";
});

screenshotBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = `gameboy-frame-${gb.ppu.frameCount}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});

audioBtn.addEventListener("click", async () => {
  const enabled = await toggleAudio();
  audioBtn.textContent = enabled ? "Disable Audio" : "Enable Audio";
});

// Auto-enable audio on first user interaction (browser autoplay policy).
// The first click or keypress anywhere will start audio.
window.addEventListener("click", tryAutoStartAudio, { once: true });
window.addEventListener("keydown", tryAutoStartAudio, { once: true });

downloadLogBtn.addEventListener("click", () => {
  const blob = new Blob([serialOutput.textContent || ""], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = "gameboy-serial.log";
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
});

speedSlider.addEventListener("input", () => {
  speed = parseFloat(speedSlider.value);
  speedValue.textContent = `${speed.toFixed(1)}x`;
});

debugCheck.addEventListener("change", () => {
  debugCard.style.display = debugCheck.checked ? "block" : "none";
});

// ---- Keyboard input ----
window.addEventListener("keydown", (e) => {
  // Prevent default for arrow keys / space / backspace to avoid page scroll
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", " "].includes(e.key)) {
    e.preventDefault();
  }
  gb.setKey(e.key, true);
});

window.addEventListener("keyup", (e) => {
  gb.setKey(e.key, false);
});

// Prevent key events when focus is on inputs
[loadRomBtn, pauseBtn, resetBtn, screenshotBtn, downloadLogBtn, speedSlider, romInput].forEach(el => {
  el.addEventListener("keydown", (e) => e.stopPropagation());
});
