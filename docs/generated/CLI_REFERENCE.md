# Antigravity Quota Guard — CLI Command Reference

## Available Commands

| Command | Arguments | Description |
| :--- | :--- | :--- |
| `quota-guard` | None | Launches interactive menu |
| `quota-guard patch` | `[--dry-run] [--force]` | Transactionally patches Antigravity app.asar |
| `quota-guard doctor` | None | Runs read-only diagnostic system audit |
| `quota-guard resume` | `[--copy]` | Lists checkpoints and copies recovery handoff text |
| `quota-guard rollback`| `[backup-id]` | Restores original or selected ASAR backup |
