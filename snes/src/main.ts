import { SnesEmulator } from './snes/EmulatorFacade';
import { InputHandler } from './snes/InputHandler';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const imgData = ctx.createImageData(256, 224);

const fileInput = document.getElementById('rom-upload') as HTMLInputElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
const btnFullscreen = document.getElementById('btn-fullscreen') as HTMLButtonElement;
const stretchSlider = document.getElementById('stretch-slider') as HTMLInputElement;
const stretchValue = document.getElementById('stretch-value') as HTMLSpanElement;
const appLayout = document.getElementById('app-layout') as HTMLDivElement;
const infoRom = document.getElementById('info-rom') as HTMLSpanElement;
const infoFps = document.getElementById('info-fps') as HTMLSpanElement;

// HUD registers
const regPc = document.getElementById('reg-pc') as HTMLSpanElement;
const regA = document.getElementById('reg-a') as HTMLSpanElement;
const regX = document.getElementById('reg-x') as HTMLSpanElement;
const regY = document.getElementById('reg-y') as HTMLSpanElement;
const regS = document.getElementById('reg-s') as HTMLSpanElement;
const regScanline = document.getElementById('reg-scanline') as HTMLSpanElement;

const emulator = new SnesEmulator();
const input = new InputHandler();
let isPaused = false;
let animationFrameId: number | null = null;
let lastTime = 0;
let fpsCount = 0;
let fpsTime = 0;

function renderFrame(pixels: Uint32Array) {
  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i];
    const pixelIdx = i * 4;
    imgData.data[pixelIdx] = (pixel >> 0) & 0xFF;
    imgData.data[pixelIdx + 1] = (pixel >> 8) & 0xFF;
    imgData.data[pixelIdx + 2] = (pixel >> 16) & 0xFF;
    imgData.data[pixelIdx + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

function updateHUD() {
  regPc.textContent = `0x${emulator['cpu'].pc.toString(16).toUpperCase().padStart(6, '0')}`;
  regA.textContent = `0x${emulator['cpu'].a.toString(16).toUpperCase().padStart(4, '0')}`;
  regX.textContent = `0x${emulator['cpu'].x.toString(16).toUpperCase().padStart(4, '0')}`;
  regY.textContent = `0x${emulator['cpu'].y.toString(16).toUpperCase().padStart(4, '0')}`;
  regS.textContent = `0x${emulator['cpu'].s.toString(16).toUpperCase().padStart(4, '0')}`;
  regScanline.textContent = emulator['ppu'].currentScanline.toString();
}

function loop(time: number) {
  if (lastTime === 0) lastTime = time;
  const delta = time - lastTime;
  lastTime = time;

  fpsCount++;
  fpsTime += delta;
  if (fpsTime >= 1000) {
    infoFps.textContent = fpsCount.toString();
    fpsCount = 0;
    fpsTime = 0;
  }

  if (!isPaused) {
    const controllerState = input.getController1State();
    const { pixels } = emulator.runFrame(controllerState, 1);
    renderFrame(pixels);
    updateHUD();
  }

  animationFrameId = requestAnimationFrame(loop);
}

function startEmulator() {
  isPaused = false;
  btnPause.textContent = 'Pause';
  lastTime = 0;
  if (animationFrameId === null) {
    animationFrameId = requestAnimationFrame(loop);
  }
}

function loadROM(buffer: ArrayBuffer, name: string) {
  try {
    const bytes = new Uint8Array(buffer);
    emulator.loadRomBytes(bytes);
    infoRom.textContent = name;
    console.log(`Loaded ROM: ${name}`);
    startEmulator();
  } catch (err: any) {
    console.error(err);
    alert(`Failed to load ROM: ${err.message}`);
  }
}

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

btnPause.addEventListener('click', () => {
  isPaused = !isPaused;
  btnPause.textContent = isPaused ? 'Resume' : 'Pause';
});

btnReset.addEventListener('click', () => {
  emulator.reset();
});

stretchSlider.addEventListener('input', (e) => {
  const value = parseInt((e.target as HTMLInputElement).value, 10);
  stretchValue.textContent = `${value}%`;
  appLayout.style.setProperty('--stretch-factor', (value / 100).toString());
});

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {
      appLayout.classList.toggle('fullscreen-active');
      btnFullscreen.textContent = appLayout.classList.contains('fullscreen-active') ? 'Exit Fullscreen' : 'Fullscreen';
    });
  } else {
    document.exitFullscreen();
  }
});

document.addEventListener('fullscreenchange', () => {
  const isFullscreen = !!document.fullscreenElement;
  btnFullscreen.textContent = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
  if (isFullscreen) {
    appLayout.classList.add('fullscreen-active');
  } else {
    appLayout.classList.remove('fullscreen-active');
  }
});

input.attach();
ctx.fillStyle = '#000000';
ctx.fillRect(0, 0, canvas.width, canvas.height);

emulator.loadDemoRom();
infoRom.textContent = 'Demo ROM (built-in)';
startEmulator();

(window as any).snes = { emulator, input };
