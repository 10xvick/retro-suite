# Atari 2600 Core — Completion & Testing Plan

## State (assessed)
- `atari/` workspace package exists (`atari-core`): CPU (6507), TIA, PIA, cartridge, bus, controller.
- `AtariEmulatorCore` already registered in shell (`App.tsx` line 740), implements full `EmulatorCore` interface.
- Gaps: no interrupt handling in CPU; mapper detection only 2K/4K/F8/F6/F4 by size; no test suite; no dedicated public ROM folder.
- The user-provided "super-mario" ROM was NOT found in `public/`. Only Atari ROM present: `public/more roms/atari/Pac-Man (1981) (Atari)/Pac-Man (1981) (Atari).a26` (4 KB).

## Steps
- [ ] Acquire open test ROMs from GitHub (Stella test suite / open homebrew repos) into `atari/public/test/`.
- [ ] Move default ROM (Pac-Man) into `atari/public/`; attempt to fetch open SMB-style homebrew ("Princess Rescue") as Mario default.
- [ ] Harden core: verify/fix WSYNC, frame timing, audio, controller mapping, save-state completeness.
- [ ] Shell integration: confirm registration; add safe `.a26`/`.bin` → atari auto-select; wire default ROM per core.
- [ ] Add vitest test suite: CPU instruction tests, cartridge mapper tests, TIA smoke tests, ROM suite test (Pac-Man 60 frames). Add `test:atari` root script.
- [ ] Regression check: shell build (`tsc`), existing core test subset, atari tests.
- [ ] Write `atari/test-report.md` documenting results.