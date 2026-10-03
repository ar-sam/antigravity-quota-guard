# Recovery & Continuity Reference

## Handoff & Checkpoint Format

Checkpoints are written atomically to `~/.gemini/antigravity-quota-safety/checkpoints/`.
Each checkpoint produces two companion files with permissions `0600`:
1. `checkpoint_<timestamp>.json`: Complete structured session metadata.
2. `checkpoint_<timestamp>.md`: Formatted Markdown recovery document for successor agent.
