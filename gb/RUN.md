# How to run the Game Boy emulator

## Option 1: Download and run locally (recommended)

Download the entire `gameboy/` folder to your machine, then:

```bash
cd gameboy
npm install
npm run dev
```

Vite will print a URL like `http://localhost:5173/`. Open it in your browser.
The emulator auto-loads `batman.gb` from `public/`.

## Option 2: Standalone single-file HTML

If you don't want to install Node.js, download `gameboy-standalone.html`
(located one level up, next to this README) and double-click it. It opens
in any modern browser. The ROM is embedded inside the file.

## Controls

| Game Boy | Keyboard            |
|----------|---------------------|
| A        | Z or A              |
| B        | X, S, or B          |
| Start    | Enter               |
| Select   | Backspace           |
| D-Pad    | Arrow keys          |

## Project structure

```
gameboy/
├── index.html              ← Vite entry HTML
├── package.json            ← npm scripts: dev / build / preview
├── tsconfig.json           ← TypeScript config
├── public/
│   └── batman.gb           ← The Batman ROM (auto-loaded on startup)
├── src/
│   ├── main.ts             ← Browser entry: Canvas renderer, keyboard, UI
│   ├── style.css           ← Page styling
│   └── gb/                 ← The emulator core (all TypeScript)
│       ├── cpu.ts          ← Sharp LR35902 CPU: 256 main + 256 CB opcodes
│       ├── mmu.ts          ← Memory map + MBC1/MBC2/MBC3/MBC5 banking
│       ├── ppu.ts          ← Graphics: BG, Window, Sprites, VBlank/STAT IRQs
│       ├── timer.ts        ← DIV + TIMA timers
│       ├── joypad.ts       ← Input handling
│       ├── serial.ts       ← Serial transfer (Blargg test output)
│       └── gameboy.ts      ← Top-level integration
└── scripts/                ← Headless Node.js test harnesses
    ├── headless_test.ts    ← Run ROM for N frames, dump PNG snapshots
    ├── count_interrupts.ts ← Debug: count interrupt requests
    └── test_input.ts       ← Simulate button presses
```

## npm scripts

| Command         | What it does                                    |
|-----------------|-------------------------------------------------|
| `npm run dev`   | Start Vite dev server with hot-reload           |
| `npm run build` | Type-check + production build to `dist/`        |
| `npm run preview` | Serve the production build locally            |

## Headless testing (optional, requires tsx)

```bash
npx tsx scripts/headless_test.ts path/to/rom.gb output.png 3000
```

Runs the ROM for 3000 frames and saves PNG snapshots at intervals,
plus a serial-port log. Useful for verifying without a browser.

## Verification results

- **Blargg's cpu_instrs test suite**: All 11 individual tests print PASSED.
  Screenshots in `download/screenshots/blargg_test_*.png`.
- **Batman: The Animated Series** (MBC1, 128KB): Boots, shows title screen
  with logo at ~frame 180, reaches full 4-color graphics by ~frame 1200.
  Screenshots in `download/screenshots/batman_*.png`.

## Debugging

The emulator instance is exposed as `window.__gb` in the browser console.
You can inspect CPU state, call `__gb.runFrame()` manually, etc.

Enable the "Show debug info" checkbox to see live CPU registers on the page.
