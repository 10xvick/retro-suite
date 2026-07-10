# SNES Audio Debug Findings

## Goal
Get audio working for **The Jungle Book (Sample)** ROM. Audio should play starting at the **Virgin Interactive logo screen**. The ROM works correctly in other SNES emulators.

---

## Architecture Overview

```
SNES CPU → Bus ($2140–$2143) → ApuPortBridge → AudioEngine (onSync/onReadPort)
                                                    ↓
                                              Apu.stepSpc()
                                                    ↓
                                     SPC700 CPU ($F2/$F3 writes)
                                                    ↓
                                               DSP.writeRegister()
                                                    ↓
                                          Voices → BRR decode → samples
                                                    ↓
                                          AudioEngine → WebAudio
```

---

## Bugs Found and Fixed

### Bug 1 — `Apu.reset()` disabled audio on every reset
- **File:** `src/emulator/audio/Apu.ts` line 56
- **Problem:** `this.audioEnabled = false` in reset() silenced all output after every game reset.
- **Fix:** Changed to `this.audioEnabled = true`.
- **Status:** ✅ Fixed

### Bug 2 — Envelope initialized to `release` mode on key-on
- **File:** `src/emulator/audio/Dsp.ts`, `keyOnVoice()`
- **Problem:** Voices started in `envMode='release'` with `env=0`. Any multiplication by env=0 yields silence.
- **Fix:** `keyOnVoice()` now initializes envelope based on ADSR vs GAIN mode:
  - ADSR mode → `envMode='attack'`, `env=0`
  - GAIN direct → `env=(gain&0x7F)*16`, `envMode='sustain'`
  - GAIN decrease → `env=2047`, `envMode='attack'`
  - GAIN increase → `env=0`, `envMode='attack'`
- **Status:** ✅ Fixed

### Bug 3 — GAIN decrease mode started from 0 (stayed silent)
- **File:** `src/emulator/audio/Dsp.ts`, `keyOnVoice()`
- **Problem:** GAIN=0x82 is "decrease" mode. Starting from env=0 and decreasing keeps it at 0.
- **Fix:** Decrease modes now start from `env=2047`.
- **Status:** ✅ Fixed

### Bug 4 — `advanceEnvelope()` GAIN mode handling broken
- **File:** `src/emulator/audio/Dsp.ts`, `advanceEnvelope()`
- **Problem:** GAIN envelope transitions weren't handling sustain/release correctly.
- **Fix:** Improved sustain decay rate and exponential release behaviour.
- **Status:** ✅ Fixed

### Bug 5 — SPC700 opcode 0x40 implemented as DI instead of SETP ← **ROOT CAUSE**
- **File:** `src/emulator/audio/Spc700.ts` line 324
- **Problem:** Opcode `0x40` in the SPC700 ISA is `SETP` (set direct-page flag P in PSW, switching the direct page from 0x0000 to 0x0100). Our code had it as `setFlagI(false)` (Disable Interrupts — which is opcode 0xC0). The audio program executes SETP at addresses 0x804, 0x84E, 0x865, 0x903, 0xB7C, 0xDE3, 0xE5D, 0x10A6 to move its variable workspace to page 1 (0x0100–0x01FF). Without SETP working, ALL direct-page variable reads/writes use page 0 (0x0000–0x00FF), completely corrupting the audio program's variable space. This explains: no DSP writes, all voice volumes = 0, audio program appears to run but produces silence.
- **Fix:** `case 0x40: this.setFlagP(true); return 2;  // SETP`
- **Status:** ✅ Fixed

### Bug 6 — MOVW hi-byte uses wrong address (ignores P flag / direct page)
- **File:** `src/emulator/audio/Spc700.ts`, `case 0xBA` and `case 0xDA`
- **Problem:** `MOVW YA, dp` reads the high byte with `readByte((dp+1) & 0xFF)` instead of `readByte(getDpAddr((dp+1) & 0xFF))`. Same for `MOVW dp, YA` write. When P=1 (direct page at 0x0100), the second byte of a MOVW pair always went to/from page 0 instead of page 1.
- **Fix:** Both now use `getDpAddr((dp + 1) & 0xFF)` for the second byte.
- **Status:** ✅ Fixed

### Bug 7 — `$F1` bit 7 (IPL ROM enable) not handled in `handleTimerControl`
- **File:** `src/emulator/audio/Spc700.ts`, `handleTimerControl()` line 156
- **Problem:** `$F1` bit 7 controls whether the IPL ROM (64 bytes) is mapped at 0xFFC0–0xFFFF (1) or RAM is visible there (0). The audio program writes `$F1` to disable the IPL ROM, but `handleTimerControl` only handled bits 0–2 (timer enables). `iplRomEnabled` was never set to `false`, so the IPL ROM remained mapped forever, shadowing any audio data the game might store at 0xFFC0+.
- **Fix:** Added `this.iplRomEnabled = (value & 0x80) !== 0;` at the top of `handleTimerControl`.
- **Status:** ✅ Fixed

### Bug 8 — KON re-trigger guard prevents re-keying already-active voices
- **File:** `src/emulator/audio/Dsp.ts`, `writeRegister()` KON handler
- **Problem:** The condition `((v >> i) & 1) !== 0 && !this.voices[i].keyOn` prevented a write to KON from re-triggering a voice that was already playing. On real SNES hardware, KON always restarts the voice (resets the BRR decoder and envelope) when its bit is written.
- **Fix:** Removed the `!this.voices[i].keyOn` guard — KON always calls `keyOnVoice(i)`.
- **Status:** ✅ Fixed

---

## Current Problem: Zero DSP Register Writes

Despite the SPC700 running, **no values are ever written to DSP registers** by the audio program.

### Evidence

| Observation | Value | Meaning |
|---|---|---|
| `AudioEngine.enabled` | `true` | Audio enabled correctly |
| `AudioEngine.updateFrame` call count | ~60/sec | Frame loop running |
| `onSync` call count (1 sec) | 144,198 | SPC700 being stepped |
| `apu.stepSpc` call count (1 sec) | 141,535 | SPC cycles advancing |
| DSP `writeRegister` intercept (2 sec) | **0 calls** | ❌ DSP never written |
| SPC700 writeByte prototype intercept (1 sec) | **0 calls** | ❌ I/O path not reached (or intercept broken) |
| SPC RAM $F2 (DSP addr) | Changes (e.g. 0→0x4D→0x01) | SPC IS writing $F2 |
| SPC RAM $F3 (DSP data) | Always 0 | Either writing 0 or never written |
| All DSP voice volumes (volL/volR) | All 0 | No volume configured |
| Voice envMode | All `attack` | KON was fired |
| Voice env | All 0 | Envelope not advancing |
| DSP registers snapshot diff (2 sec) | No changes | Registers frozen |

### Contradiction

- **RAM at $F2 changes** → `writeByte(0xF2, ...)` IS being called
- **writeByte prototype intercept shows 0 calls** → Intercept not working

**Likely reason:** In Vite/esbuild compiled output, TypeScript `private` class methods may be compiled as class fields (arrow functions on instances), not prototype methods. Intercepting via `Object.getPrototypeOf(spc).writeByte` would fail silently in that case — the real method is `spc.writeByte` (own property).

### Suspect: $F3 (DSP data) is never written non-zero

RAM snapshot at $F3 consistently shows `0x00`. Possibilities:
1. SPC program writes $F2 (DSP addr) but only *reads* $F3 (reads DSP registers), never writes
2. SPC program writes $F3 but always with value `0x00`
3. SPC program is stuck in a wait loop before reaching the DSP setup code

### Current SPC700 PC Behaviour

PC bounces around range `0x0BBC–0x0FC4` — the main game audio loop. It's not stuck in the IPL boot loop (0xFFCF/0xFFD2) anymore; the audio program was loaded successfully.

---

## Current Status After Bug Fixes (Bugs 5–8)

**Root cause identified and fixed.** The SETP bug (opcode 0x40) was the primary cause of audio silence.

The audio program uses SETP at 8 locations in its active code range to switch its variable workspace from direct page 0 (0x0000–0x00FF) to direct page 1 (0x0100–0x01FF). Without SETP working:
- All the audio program's working variables (voice state, note data pointers, channel configs) were read/written at the wrong addresses
- DSP register setup data (volumes, pitches, ADSR params) was corrupted or read as zeros
- The program appeared to run (PC advancing) but produced meaningless I/O due to the wrong variable locations

The MOVW hi-byte bug compounded this: MOVW with P=1 would read/write the second byte from page 0 instead of page 1.

### Expected outcomes after fixes

- Voice volumes (volL, volR) should now be set to non-zero values during audio program init
- DSP register writes should now be observed via `writeRegister`
- KON writes will now correctly trigger voices from their proper state
- Audio should be audible at the Virgin Interactive logo screen

---

## Pending Investigations

### Investigation A — Verify audio is working after SETP fix
- Reload the emulator, check DSP voice volumes and register writes after a few seconds
- Expected: volL/volR non-zero, DSP writeRegister calls observed

### Investigation B — Noise voices (NON=0x7F)
- The DSP snapshot showed NON=0x7F (voices 0–6 using noise generator)
- After SETP fix, verify if audio program sets NON correctly or if this is intentional for percussion
- If music uses BRR samples, NON should be 0x00 for melodic voices

---

## Key DSP State Snapshot (current)

```
MVOLL=127, MVOLR=127      ✅ Master volume is fine
FLG=0x3F                  ❌ Bit 6 (MUTE) might be set — need to verify
NON=0x7F                  ⚠ Voices 0–6 use noise instead of BRR samples
KON=0x80                  Only voice 7 keyed on (at time of snapshot)
DIR=0x02                  Sample directory at 0x0200
All voice volL=0, volR=0  ❌ No per-voice volume set
All voice env=0           ❌ Envelope at floor
```

**FLG register (0x6C) = 0x3F:**
- Bits 5–0 = noise clock select = 0x1F (31) — max noise frequency
- Bit 6 = MUTE flag = **(0x3F >> 6) & 1 = 0** — mute is NOT set ✅
- Bit 7 = RESET flag = 0 ✅

**NON=0x7F issue:** Voices 0–6 configured as noise sources. Only voice 7 plays BRR. This may be intentional (game uses noise for percussion) but voice 7 still needs non-zero volume.

---

## What Works

| Component | Status |
|---|---|
| BRR decoder | ✅ Produces correct waveforms when called |
| Envelope advancement (manual) | ✅ Advances from 0 to 2047 correctly |
| AudioWorklet receiving samples | ✅ |
| SPC700 IPL boot + program load | ✅ |
| SPC700 running game audio program | ✅ |
| APU port bridge (CPU ↔ SPC700) | ✅ Handshake completes |
| DSP writeRegister (manual test) | ✅ Volumes stick when set by hand |

---

## Files of Interest

| File | Role |
|---|---|
| `src/emulator/audio/Dsp.ts` | DSP chip, voices, BRR decode, envelope |
| `src/emulator/audio/Spc700.ts` | SPC700 CPU, I/O routing ($F2/$F3) |
| `src/emulator/audio/Apu.ts` | APU coordinator, owns SPC700 + DSP |
| `src/emulator/audio/AudioEngine.ts` | WebAudio, onSync, updateFrame |
| `src/emulator/audio/ApuPortBridge.ts` | CPU↔SPC700 port bridge |
| `src/emulator/EmulatorFacade.ts` | Wires apuBridge to Bus and AudioEngine |
