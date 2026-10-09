import './style.css';
import { Atari2600 } from './index';

const root = document.getElementById('root');
if (root) {
  root.innerHTML = `
    <header>
      <h1>ATARI 2600 CORE</h1>
      <div class="subtitle">MOS 6507 + TIA + 6532 RIOT Virtual Machine</div>
    </header>
    <div class="container">
      <div class="screen-card">
        <canvas id="screen" width="160" height="192"></canvas>
      </div>
      <div class="controls-card">
        <button id="btn-default" class="btn btn-primary">LOAD PAC-MAN</button>
        <label class="btn" style="text-align: center;">
          UPLOAD .A26 / .BIN
          <input type="file" id="rom-input" accept=".a26,.bin" style="display:none;" />
        </label>
        <button id="btn-pause" class="btn">PAUSE</button>
        <button id="btn-reset" class="btn">RESET</button>
        <button id="btn-audio" class="btn">ENABLE AUDIO</button>

        <div class="stat-row">
          <span class="stat-label">Status</span>
          <span class="stat-value" id="val-status">No ROM</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Mapper</span>
          <span class="stat-value" id="val-mapper">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">FPS</span>
          <span class="stat-value" id="val-fps">0</span>
        </div>

        <div class="keymap">
          <strong>CONTROLS:</strong><br>
          <span class="key">Arrows</span>: Joystick Up / Down / Left / Right<br>
          <span class="key">Space / Z</span>: Fire<br>
          <span class="key">Enter</span>: Console Reset<br>
          <span class="key">Shift</span>: Console Select
        </div>
      </div>
    </div>
  `;

  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(160, 192);
  const pixelBuf = new Uint32Array(imgData.data.buffer);

  const atari = new Atari2600();
  let isRunning = false;
  let animId = 0;
  let controllerBitmask = 0;

  // Keyboard mapping to SNES controller bitmask expected by Atari2600
  // Up=0x0800, Down=0x0400, Left=0x0200, Right=0x0100, Fire=0x0080, Start/Reset=0x1000, Select=0x2000
  window.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'ArrowUp': controllerBitmask |= 0x0800; break;
      case 'ArrowDown': controllerBitmask |= 0x0400; break;
      case 'ArrowLeft': controllerBitmask |= 0x0200; break;
      case 'ArrowRight': controllerBitmask |= 0x0100; break;
      case 'Space':
      case 'KeyZ': controllerBitmask |= 0x0080; break;
      case 'Enter': controllerBitmask |= 0x1000; break;
      case 'ShiftLeft':
      case 'ShiftRight': controllerBitmask |= 0x2000; break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp': controllerBitmask &= ~0x0800; break;
      case 'ArrowDown': controllerBitmask &= ~0x0400; break;
      case 'ArrowLeft': controllerBitmask &= ~0x0200; break;
      case 'ArrowRight': controllerBitmask &= ~0x0100; break;
      case 'Space':
      case 'KeyZ': controllerBitmask &= ~0x0080; break;
      case 'Enter': controllerBitmask &= ~0x1000; break;
      case 'ShiftLeft':
      case 'ShiftRight': controllerBitmask &= ~0x2000; break;
    }
  });

  let lastTime = performance.now();
  let frames = 0;

  function renderLoop() {
    if (isRunning && atari.romLoaded) {
      const frame = atari.runFrame(controllerBitmask);
      pixelBuf.set(frame.pixels);
      ctx.putImageData(imgData, 0, 0);

      frames++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        const fpsElem = document.getElementById('val-fps');
        if (fpsElem) fpsElem.textContent = frames.toString();
        frames = 0;
        lastTime = now;
      }
    }
    animId = requestAnimationFrame(renderLoop);
  }

  function start() {
    if (!isRunning) {
      isRunning = true;
      document.getElementById('val-status')!.textContent = 'Running';
    }
  }

  document.getElementById('btn-default')?.addEventListener('click', async () => {
    try {
      const resp = await fetch('/Pac-Man.a26');
      const buf = await resp.arrayBuffer();
      atari.loadRom(buf);
      document.getElementById('val-status')!.textContent = 'Loaded';
      document.getElementById('val-mapper')!.textContent = atari.cart?.mapper || 'Unknown';
      start();
    } catch (err) {
      console.error(err);
    }
  });

  document.getElementById('rom-input')?.addEventListener('change', async (e: any) => {
    const file = e.target.files?.[0];
    if (file) {
      const buf = await file.arrayBuffer();
      atari.loadRom(buf);
      document.getElementById('val-status')!.textContent = file.name;
      document.getElementById('val-mapper')!.textContent = atari.cart?.mapper || 'Unknown';
      start();
    }
  });

  document.getElementById('btn-pause')?.addEventListener('click', () => {
    isRunning = !isRunning;
    document.getElementById('btn-pause')!.textContent = isRunning ? 'PAUSE' : 'RESUME';
    document.getElementById('val-status')!.textContent = isRunning ? 'Running' : 'Paused';
  });

  document.getElementById('btn-reset')?.addEventListener('click', () => {
    atari.reset();
  });

  animId = requestAnimationFrame(renderLoop);
}
