---
name: gba-video-testing-protocol
description: Strict workflow protocol for GBA video hardware subtest debugging: zero test modifications, subagent parallelization, manual review before pushing, and visual screenshot verification.
---

# GBA Video Hardware Testing Protocol

## Core Rules & Constraints

1. **Zero Test Code Modifications**:
   - Never alter, modify, or rewrite test runner files (`cat13_video.test.ts`, `rom_suite.test.ts`, `run_visual_video_test_suite.ts`).
   - Tests must strictly run the original visual parity comparison logic (comparing live PPU output via LEFT keypress against golden reference output via RIGHT keypress).

2. **No Unapproved Git Pushes**:
   - Do **NOT** run `git push` or close GitHub tickets until the user has manually reviewed and approved the code fixes and visual screenshot diffs.

3. **Parallel Subagent Workflows**:
   - Always assign specific failing subtests or PPU components (`ppu.ts`, `memory.ts`) to separate background subagents to work in parallel.

4. **Screenshot Directory Management**:
   - All test screenshots and visual debug artifacts MUST be saved in `gba/public/debug/screenshots/`. Never save temporary image files in the workspace root directory.
