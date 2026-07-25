# Game Boy Advance (GBA) Core Engine

A cycle-accurate, high-performance Game Boy Advance emulator core written in TypeScript.

## 1. Codebase Structure
The GBA core files reside in `gba/src/core/`:
- **`gba.ts`**: Coordinates the overall emulation loop, frame/scanline cycles, DMA transfers, interrupt triggering (IE/IF/IME), and timers.
- **`arm7tdmi.ts`**: Implements the ARM7TDMI processor. Supports ARM and THUMB instruction sets, ALU operations, register banking, and hardware exception handling.
- **`memory.ts`**: Manages the GBA memory controller, memory map mappings (BIOS, WRAM, I/O registers, VRAM, OAM, GamePak ROM/SRAM), and bus reads/writes.
- **`ppu.ts`**: Implements the Pixel Processing Unit. Handles rendering modes (0-5), tile backgrounds, affine scaling/rotation, sprite composition, and windowing.

---

## 2. Monorepo Configuration
The repository is set up as an npm workspaces monorepo:
- **Root workspaces**: `shell` (UI dashboard), `snes`, `nes`, `gb`, and `gba`.
- **Root scripts**: Proxy common tasks to sub-workspaces, e.g., `npm run dev` starts the shell UI, and `npm run test:cat00` targets the GBA test suite.

---

## 3. Emulation Flow
On each frame:
1. **Clock Steps**: `GBA.step()` executes instructions on the CPU (`arm7tdmi`).
2. **Scanline Loop**: Emulation executes 228 lines per frame (160 active visible, 68 V-Blank).
3. **PPU Sync**: PPU draws scanlines to the 32-bit framebuffer.
4. **DMA & Timers**: Peripherals update based on CPU clock cycle progression.
5. **Interrupts**: V-Blank, H-Blank, and Timer interrupts are signaled to the CPU when their trigger conditions are met.

---

## 4. Test Runner Setup
The GBA core uses **Vitest** for headless hardware compliance testing.
The test harness runs the `suite.gba` compliance ROM and checks the execution status table at `0x03007b08` in WRAM.

### Commands to Run Tests (from package root):
- **Full Suite**: `npm test`
- **Memory Tests**: `npm run test:cat00`
- **I/O Read Tests**: `npm run test:cat01`
- **Timing Tests**: `npm run test:cat02`
- **SIO Register R/W Tests**: `npm run test:cat10`
- **SIO Timing Tests**: `npm run test:cat11`
