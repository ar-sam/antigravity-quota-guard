# Handover & Account Switching Workflow

When the active model quota reaches the stop threshold (default: 12%), the following graceful lifecycle occurs:

1. **Silent Pre-Checkpoint at 13%:** A pre-staged snapshot is silently written to disk to eliminate latency when the stop threshold is reached.
2. **Turn Boundary Halting:** Model execution concludes cleanly at the current turn boundary, entering `HALTED` state.
3. **Background Idle Inspection:** If subagents or background tasks are still running, the system transitions to `HALTED_BACKGROUND_ACTIVE` to prevent disruption.
4. **Account Switch:**
   - **Desktop:** Open Settings using `⌘,` (or `Ctrl+,`), navigate to Accounts, and sign in with an alternative account.
   - **CLI:** Execute `agy /logout` followed by `agy login`.
5. **Exact Resumption:** Click "Resume Work with New Account" in the Desktop HUD, or run `agy --conversation <conversationId>` in CLI.
