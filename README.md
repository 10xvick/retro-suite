# Retro Station Multi-System Emulator

An elegant, decoupled multi-system console emulator built in TypeScript/React and configured as a monorepo workspace.

## Supported Cores
- **Super Nintendo (SNES)**: Main-thread high-fidelity frame-accumulated emulator.
- **Nintendo Entertainment System (NES)**: High-performance NES emulator core.
- **Game Boy / Game Boy Color (GB/GBC)**: Fully cycle-accurate Game Boy emulator with complete GBC backward compatibility, dynamic boot modes, and H-Blank DMA synchronization.
- **Game Boy Advance (GBA)**: Cycle-accurate ARM7TDMI emulator core with high-performance PPU and DMA scheduler.

## Architecture
The repository uses an npm workspaces monorepo structure:
- `shell/`: React UI dashboard shell (Retro Station).
- `nes/`: Isolated NES core package.
- `gb/`: Isolated Game Boy & Game Boy Color core package.
- `gba/`: Isolated Game Boy Advance core package.

## Features
- **Precise Speed Tuning**: Real-time adjustable speed multiplier slider (0.25x - 5.00x).
- **Settings Menu**: Custom slider range configurability (min/max limits) and instant presets reset.
- **Focus Auto-Mute**: Automatically suspends/resumes audio playback when tab focus is lost, eliminating buzzing oscillators.
- **Aspect Ratio Control**: Live retro screen aspect stretch control.

## Running Locally
At the repository root:
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Compile production builds:
   ```bash
   npm run build
   ```
