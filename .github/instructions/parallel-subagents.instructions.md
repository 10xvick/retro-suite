---
applyTo: "**"
description: "Always-on workflow rule: run divisible tasks IN PARALLEL — launch all their subagents together in one simultaneous batch — to speed up execution while respecting the machine's memory/CPU limits."
---

# Parallelize Divisible Tasks with Subagents

## When to parallelize
- Before starting any multi-part task, ask: "Can this be split into independent pieces?"
  Examples: exploring multiple modules or cores, surveying many files, bulk searches/greps,
  per-file analysis, independent bug investigations, generating unrelated artifacts.
- If yes → you MUST run those pieces as parallel subagents (`runSubagent`). Do not execute
  them one-by-one in the main thread. Treat missed parallelization opportunities as a defect.
- Prefer batching the research/exploration phase into parallel read-only agents even when the
  final edit phase is single-threaded.

## How
- Launch all independent pieces AT THE SAME TIME in one parallel batch — never sequentially
  and never staggered. Parallel = simultaneous; queuing several tasks one-by-one does NOT count.
- Use the harness's built-in `runSubagent` tool (runs in-process). NEVER spawn extra CLI agent
  processes (e.g., `opencode run`, extra node instances) for fan-out — they each cost a full
  runtime and have OOM'd this machine before.
- Write self-contained agent prompts: each agent must know exactly what to investigate and
  exactly what to report back, since it returns a single message and cannot ask follow-ups.

## Resource limits (hard rules)
- Machine budget: 14 GB RAM laptop with limited CPU headroom.
- Batch size is **dynamic**: size the parallel batch to the work. Lightweight read-only
  exploration (greps, file surveys) → up to 4–5 agents in parallel. Heavy tasks (large code
  analysis, multi-file edits, builds) → 2–3 max. Before large batches or any shell fan-out,
  verify headroom via `free -h` / load average and scale down if the machine is loaded.
- If agents appear queued, slow, or timing out, run FEWER in parallel — don't raise wait budgets.
- Any shell-command fan-out must be sequential unless verified safe via `free -h` first.

## Merging results
- After all subagents return, synthesize their findings into one plan BEFORE making edits, so
  changes stay consistent across the parallel pieces.
