# Troubleshooting & Frequently Asked Questions

### 1. Quota displays `--%` with a yellow badge
- This indicates the official telemetry provider is temporarily unreachable or the system is in Cold-Start.
- If you need to proceed anyway, click "Temporary Unmonitored Session Bypass" in the Desktop panel.

### 2. Workspace Divergence Alert (`WORKSPACE_DIVERGED`)
- Triggered when the current git branch, commit HEAD, or working tree state differs from the checkpoint.
- Verify your git status and confirm resume to continue.

### 3. Warning panel does not appear on Login / Settings windows
- By security design (Window Allowlist), Quota Guard strictly avoids mounting inside OAuth, Google Sign-in, or DevTools windows.
