# Antigravity Quota Guard V2.2 Overview

Intelligent quota monitoring and graceful handover coordination for Antigravity (Desktop & CLI).

## Key Features
- **Official Hybrid Architecture:** Strictly prioritizes official Antigravity plugin hooks and sidecars (*Plugin First, ASAR Last*).
- **Turn Boundary Halting:** Halts model execution cleanly at turn conclusion, avoiding mid-sentence cuts or corrupted tool arguments.
- **Unicode-Safe Snapshot Engine:** Uses 0x0A binary newline scanning to safely extract transcript chunks containing multi-byte Persian and emoji sequences.
- **Multi-Folder Workspace Capsule:** Captures git HEAD, dirty fingerprints, and non-git folder integrity without altering user repositories.
- **Strict Logic vs Presentation Separation:** All quota and state machine logic runs strictly in UTC; UI displays user-local timezone dynamically.
