---
name: autonomous-execution-protocol
description: Rules and guidelines to prevent stopping prematurely, dumping status reports mid-investigation, or asking the user for next steps during autonomous problem solving.
---

# Autonomous Goal Execution Protocol

## Guidelines

1. **No Premature Stopping**:
   - Never stop work mid-investigation to present a intermediate summary or status report.
   - Always implement the code fix and run test verification before presenting results.

2. **No Interactive Stalling**:
   - Never ask "what should I do next?" or "shall I proceed with X?".
   - Act autonomously: modify code, execute tests, and analyze results until the objective is accomplished.

3. **Empirical Verification**:
   - Always verify code edits by running the test suite (`npm --prefix gba run test:cat13`) and checking log output before declaring completion.
