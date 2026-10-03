# Project: antigravity-quota-guard

## Architecture
- Module/package boundaries, data flow, shared interfaces:
  1. `bin/config.js`: Runtime configuration & schema (`~/.gemini/antigravity-quota-guard/config.json`)
  2. `bin/payload.js`: Injected Electron renderer script & main process hooks
  3. `bin/index.js`: CLI manager, patching, update engine, and status reporting
  4. `patch.sh`: Shell wrapper script
  5. `test/`: Automated test suite (unit, integration, sandbox ASAR)

## Feature Inventory
Every feature from the Survey phase appears here with its assigned milestone.
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Dual-Bucket Usage Parsing | Parse Gemini Models and Claude/GPT models into isolated data structures capturing 5h, weekly, and reset timestamps | M1 | ORIGINAL_REQUEST §R1 |
| F2 | Telemetry Status Reporting | CLI `status` command displays independent quotas for Gemini and Claude/GPT | M2 | ORIGINAL_REQUEST §R1 |
| F3 | Real-Time DOM Model Tracking | Injected script detects active model from DOM (`[data-testid="model-selector-trigger"]`), tab switching, and composer changes | M1 | ORIGINAL_REQUEST §R2 |
| F4 | Dynamic Quota Fallback | Fall back to lowest remaining percentage across buckets when outside active chat or on welcome states | M1 | ORIGINAL_REQUEST §R2 |
| F5 | Configurable HUD Scope Schema | Store `hudScope` (`fiveHour`, `weekly`, `both`) with validation in config store | M1 | ORIGINAL_REQUEST §R3 |
| F6 | Titlebar HUD Dynamic Formatting | Format badge display dynamically according to `hudScope` and active model | M1 | ORIGINAL_REQUEST §R3 |
| F7 | In-App Bilingual User Guide | 4-tab interactive modal in Persian RTL / English LTR covering Quotas, 12% Handover, Settings, FAQ | M1 | ORIGINAL_REQUEST §R4 |
| F8 | Guide Button in Settings Modal | Dedicated button in Settings dialog launching User Guide modal | M1 | ORIGINAL_REQUEST §R4 |
| F9 | CLI Update Engine | `./patch.sh update`, `upgrade`, `quota-guard update` with running check, git pull, backup preservation, and in-place payload refresh | M2 | ORIGINAL_REQUEST §R5 |
| F10 | Zero External Workspace Mutation | Strictly isolate all code and tests from modifying any external workspace or repository | M-All | ORIGINAL_REQUEST §R6 |
| F11 | Automated Test Suite & Sandbox Verification | Syntax checks, parser unit test, and /tmp/ ASAR sandbox test harness | E2E-Track | ORIGINAL_REQUEST Acceptance Criteria |
| F12 | Git Commit on Main | Clean git commit on main documenting all enhancements | M3 | ORIGINAL_REQUEST Acceptance Criteria |
| F13 | 6-Phase Durable Snapshot Engine | Deterministic metadata, transcript extraction, artifact inventory, atomic writes, auto-prune to 10 | M1 | SNAPSHOT_HANDOVER_PLAN §R1 |
| F14 | Non-Blocking Floating Warning Panel | Bottom-right floating panel with RTL, minimize pill, progress bar, 100% settings lock, copy button | M2 | SNAPSHOT_HANDOVER_PLAN §R2 |
| F15 | Turn Boundary Halting Protocol | Defers stop trigger until active in-DOM execution concludes cleanly | M2 | SNAPSHOT_HANDOVER_PLAN §R3 |
| F16 | CLI Resume & Checkpoint Management | `./patch.sh resume` command with interactive list, view, pbcopy, and open in Finder | M3 | SNAPSHOT_HANDOVER_PLAN §R4 |
| F17 | Complete Config Persistence Invariant | Permanent persistence in ~/.gemini/antigravity-quota-guard/config.json across app restarts | M1 | SNAPSHOT_HANDOVER_PLAN §R5 |
| F18 | Checkpoint Handoff Document & SHA-256 Integrity | English handoff document generation and read-back checksum verification | M1 | SNAPSHOT_HANDOVER_PLAN §R1 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Runtime & Config Subsystem | Dual-bucket parser, real-time DOM model tracking, configurable HUD scope, dynamic badge, bilingual guide, and snapshot engine | none | COMPLETE ✅ |
| M2 | Floating Panel & Halting Subsystem | Floating warning panel, turn-boundary halting, auto-minimize on settings, and progress bar IPC bridge | M1 | COMPLETE ✅ |
| M3 | CLI Resume, Verification & Git Commit | CLI resume command, interactive checkpoints menu, pbcopy integration, 108/108 E2E tests, and git commit | M1, M2 | COMPLETE ✅ |

## Interface Contracts
### Config Contract (`bin/config.js`)
- `DEFAULT_CONFIG.visuals.hudScope`: `'fiveHour' | 'weekly' | 'both'` (default `'fiveHour'`)
- `validateConfig(config)`: validates `hudScope` against enum `['fiveHour', 'weekly', 'both']`
- `loadConfig()`: returns config with validated `hudScope`

### Quota Telemetry Contract (`bin/payload.js`, `bin/index.js`)
- Quota structure:
```javascript
{
  gemini: { fiveHour: number, weekly: number, resetTimeFiveHour: string, resetTimeWeekly: string },
  claude_gpt: { fiveHour: number, weekly: number, resetTimeFiveHour: string, resetTimeWeekly: string },
  activeModel: 'gemini' | 'claude_gpt' | 'fallback',
  lastUpdated: string
}
```
- Parser function signature: `parseUsageStdout(stdout: string) => { gemini: Bucket, claude_gpt: Bucket }`

### Model Detection Contract (`bin/payload.js`)
- `detectActiveModel(): 'gemini' | 'claude_gpt' | 'unknown'`
- Scans `[data-testid="model-selector-trigger"]`, URL path `/c/:id`, and fallback heuristics
- Model category mapping:
  - Gemini: `/gemini|flash|pro/i` -> `'gemini'`
  - Claude / GPT: `/claude|gpt|sonnet|opus|haiku|o3|o1/i` -> `'claude_gpt'`

### CLI Update Contract (`bin/index.js`, `patch.sh`)
- `patch.sh update` and `patch.sh upgrade` map to `node bin/index.js update`
- `updatePatch()`:
  - Check `isAntigravityRunning()`
  - Optional `git pull --ff-only`
  - Check `isAsarPatched(asarPath)`: if fresh Google update, create fresh `app.asar.bak`; if already patched, preserve `app.asar.bak`
  - In-place payload refresh (extract, replace `quota-guard-payload.js`, update hook, repack, copy)

## Code Layout
- `bin/config.js`: Configuration schemas, defaults, validation, and storage (Owned by M1)
- `bin/payload.js`: Electron main & renderer injection payload (Owned by M1)
- `bin/index.js`: CLI commands, status display, interactive menu, update engine (Owned by M2)
- `patch.sh`: Bash launcher script (Owned by M2)
- `test/`:
  - `test/parser.test.js`: Dual-bucket parser unit test fixture (Owned by E2E-Track)
  - `test/model-detect.test.js`: Model classification heuristics unit test (Owned by E2E-Track)
  - `test/hud-scope.test.js`: Scope formatting (`fiveHour`, `weekly`, `both`) and config validation (Owned by E2E-Track)
  - `test/asar-sandbox.test.js`: Mock ASAR sandbox extraction/repack test in `/tmp/` (Owned by E2E-Track)
  - `test/workspace-isolation.test.js`: Automated git status verification on external workspace (Owned by E2E-Track)
  - `test/e2e-runner.js`: Master test suite runner executing all tests (Owned by E2E-Track)
