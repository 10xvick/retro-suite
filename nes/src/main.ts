import { Bus } from './nes/bus';
import { CPU } from './nes/cpu';
import { PPU } from './nes/ppu';
import { Cartridge } from './nes/cartridge';
import { Controller } from './nes/controller';

// DOM elements
const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const imgData = ctx.createImageData(256, 240);

const fileInput = document.getElementById('rom-upload') as HTMLInputElement;
const btnLoadTmnt = document.getElementById('btn-load-tmnt') as HTMLButtonElement;
const btnLoadJungle = document.getElementById('btn-load-jungle') as HTMLButtonElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;

// Stretch slider and fullscreen elements
const stretchSlider = document.getElementById('stretch-slider') as HTMLInputElement;
const stretchValue = document.getElementById('stretch-value') as HTMLSpanElement;
const appLayout = document.getElementById('app-layout') as HTMLDivElement;
const btnFullscreen = document.getElementById('btn-fullscreen') as HTMLButtonElement;

// HUD registers
const regPc = document.getElementById('reg-pc') as HTMLSpanElement;
const regSp = document.getElementById('reg-sp') as HTMLSpanElement;
const regA = document.getElementById('reg-a') as HTMLSpanElement;
const regX = document.getElementById('reg-x') as HTMLSpanElement;
const regY = document.getElementById('reg-y') as HTMLSpanElement;
const regScanline = document.getElementById('reg-scanline') as HTMLSpanElement;

// Status details
const infoRom = document.getElementById('info-rom') as HTMLSpanElement;
const infoFps = document.getElementById('info-fps') as HTMLSpanElement;
const infoCycles = document.getElementById('info-cycles') as HTMLSpanElement;

// Instantiate NES
const bus = new Bus();
const ppu = new PPU();
const cpu = new CPU(bus);

bus.connect(cpu, ppu);
new Controller(bus);

// Emulator loop state
let isPaused = false;
let animationFrameId: number | null = null;
let lastTime = 0;
let fpsCount = 0;
let fpsTime = 0;

function updateHUD() {
  regPc.textContent = `0x${cpu.pc.toString(16).toUpperCase().padStart(4, '0')}`;
  regSp.textContent = `0x${cpu.stkp.toString(16).toUpperCase().padStart(2, '0')}`;
  regA.textContent = `0x${cpu.a.toString(16).toUpperCase().padStart(2, '0')}`;
  regX.textContent = `0x${cpu.x.toString(16).toUpperCase().padStart(2, '0')}`;
  regY.textContent = `0x${cpu.y.toString(16).toUpperCase().padStart(2, '0')}`;
  regScanline.textContent = ppu.scanline.toString();
  infoCycles.textContent = cpu.cycles.toString();

  // Highlight status flags active bits
  const flags = ['C', 'Z', 'I', 'D', 'B', 'U', 'V', 'N'];
  const flagBits = [1, 2, 4, 8, 16, 32, 64, 128];
  
  for (let idx = 0; idx < flags.length; idx++) {
    const el = document.getElementById(`flag-${flags[idx]}`);
    if (el) {
      if ((cpu.status & flagBits[idx]) !== 0) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  }
}

function renderFrame() {
  for (let i = 0; i < 256 * 240; i++) {
    const color = ppu.frameBuffer[i];
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;

    const pixelIdx = i * 4;
    imgData.data[pixelIdx] = r;
    imgData.data[pixelIdx + 1] = g;
    imgData.data[pixelIdx + 2] = b;
    imgData.data[pixelIdx + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

function emulateFrame() {
  let frameComplete = false;
  
  while (!frameComplete) {
    // 1. Clock PPU (3 times faster than CPU)
    for (let p = 0; p < 3; p++) {
      ppu.clock();
      if (ppu.scanline === 0 && ppu.cycle === 0) {
        frameComplete = true;
      }
    }

    // 2. Clock CPU
    cpu.clock();
    // 3. Clock APU
    bus.apu.clock();
  }
}

function loop(time: number) {
  if (lastTime === 0) lastTime = time;
  const delta = time - lastTime;
  lastTime = time;

  // Track FPS
  fpsCount++;
  fpsTime += delta;
  if (fpsTime >= 1000) {
    infoFps.textContent = fpsCount.toString();
    fpsCount = 0;
    fpsTime = 0;
  }

  if (!isPaused && bus.cart) {
    emulateFrame();
    renderFrame();
    updateHUD();
  }

  animationFrameId = requestAnimationFrame(loop);
}

function startEmulator() {
  isPaused = false;
  btnPause.textContent = "Pause";
  lastTime = 0;
  if (animationFrameId === null) {
    animationFrameId = requestAnimationFrame(loop);
  }
}

// ----------------------------------------
// UI Event Handlers
// ----------------------------------------

function loadROM(buffer: ArrayBuffer, name: string) {
  try {
    // Initialize Web Audio context (must be triggered from user gesture)
    bus.apu.init();

    const cart = new Cartridge(buffer);
    bus.insertCartridge(cart);
    
    // Reset processors
    cpu.reset();
    ppu.reset();
    bus.apu.reset();
    
    infoRom.textContent = name;
    console.log(`Successfully parsed ROM: ${name}`);
    startEmulator();
  } catch (err: any) {
    console.error(err);
    alert(`Failed to load ROM: ${err.message}`);
  }
}

// Local File Upload
fileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      loadROM(reader.result as ArrayBuffer, file.name);
    };
    reader.readAsArrayBuffer(file);
  }
});

// Quick Load TMNT III Action
btnLoadTmnt.addEventListener('click', async () => {
  btnLoadTmnt.textContent = "Loading TMNT III...";
  btnLoadTmnt.disabled = true;
  
  try {
    // Fetch ROM file stored in static public folder
    const response = await fetch('/tmnt3.nes');
    if (!response.ok) {
      throw new Error(`Server returned: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    loadROM(buffer, "TMNT III - The Manhattan Project");
  } catch (err) {
    console.error("Failed to quick load TMNT III:", err);
    alert("Could not load TMNT III. Please use the Browse button to upload it manually!");
  } finally {
    btnLoadTmnt.textContent = "Quick Load TMNT III";
    btnLoadTmnt.disabled = false;
  }
});

// Quick Load Jungle Book Action
btnLoadJungle.addEventListener('click', async () => {
  btnLoadJungle.textContent = "Loading Jungle Book...";
  btnLoadJungle.disabled = true;
  
  try {
    const response = await fetch('/Jungle Book, The (USA).nes');
    if (!response.ok) {
      throw new Error(`Server returned: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    loadROM(buffer, "The Jungle Book");
  } catch (err) {
    console.error("Failed to quick load Jungle Book:", err);
    alert("Could not load Jungle Book.");
  } finally {
    btnLoadJungle.textContent = "Quick Load Jungle Book";
    btnLoadJungle.disabled = false;
  }
});

// Reset Console
btnReset.addEventListener('click', () => {
  if (bus.cart) {
    cpu.reset();
    ppu.reset();
    bus.apu.reset();
    console.log("Console Reset");
  }
});

// Pause / Resume Console
btnPause.addEventListener('click', () => {
  isPaused = !isPaused;
  btnPause.textContent = isPaused ? "Resume" : "Pause";
});

// Stretch Slider Event Handler
stretchSlider.addEventListener('input', (e) => {
  const value = parseInt((e.target as HTMLInputElement).value, 10);
  stretchValue.textContent = `${value}%`;
  
  // Set the custom property for the canvas stretch factor (0 to 1)
  appLayout.style.setProperty('--stretch-factor', (value / 100).toString());
});

// Fullscreen button interaction
btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.warn("Native fullscreen failed, toggling CSS-only fullscreen", err);
      appLayout.classList.toggle('fullscreen-active');
      const isActive = appLayout.classList.contains('fullscreen-active');
      btnFullscreen.textContent = isActive ? "Exit Fullscreen" : "Fullscreen";
    });
  } else {
    document.exitFullscreen().catch(err => {
      console.error("Failed to exit native fullscreen:", err);
    });
  }
});

// Sync layout class with native browser fullscreen state
document.addEventListener('fullscreenchange', () => {
  const isFullscreen = !!document.fullscreenElement;
  if (isFullscreen) {
    appLayout.classList.add('fullscreen-active');
    btnFullscreen.textContent = "Exit Fullscreen";
  } else {
    appLayout.classList.remove('fullscreen-active');
    btnFullscreen.textContent = "Fullscreen";
  }
});

// Initial black screen render
ctx.fillStyle = "#000000";
ctx.fillRect(0, 0, canvas.width, canvas.height);
updateHUD();

// Expose for runtime debugging
(window as any).nes = { bus, cpu, ppu };

