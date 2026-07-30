# Project Rules & Customizations

## Debugging & Screenshot Management
- All test screenshots, visual logs, and debugging artifacts MUST be saved in `gba/public/debug/screenshots/`.
- Do NOT save temporary image files or screenshots in the workspace root directory.

## Autonomous Goal Execution Protocol
- NEVER stop execution mid-investigation to print a status report without writing the code fix first.
- NEVER ask the user "what should I do next?" or wait for prompts when given an objective.
- Continuously iterate, edit source code, run tests, and verify results autonomously until the goal is fully achieved.

