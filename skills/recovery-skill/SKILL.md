---
name: quota-guard-recovery
description: Context recovery and resume guidance skill for Antigravity Quota Guard checkpoints. Use when an agent turn resumes following a quota halt or multi-account switch.
---

# Quota Guard Recovery & Resume Skill

This skill guides an incoming agent on how to safely resume work after a Quota Guard turn boundary halt or account handover.

## Principles

1. **Verify Quota Health Before Execution**:
   - Check current quota using `quota_guard.get_quota_health`.
   - Ensure safety state is `FRESH` and effective quota is above `minResumePercent`.
2. **Review Checkpoint Metadata**:
   - Inspect the latest checkpoint generated in `~/.gemini/antigravity-quota-safety/checkpoints/checkpoint.md`.
   - Review recent user prompts, model responses, and active artifacts.
3. **Check Workspace Integrity**:
   - Verify that local files and Git HEAD match the checkpoint's recovery capsule.
   - If workspace diverged, notify the user and ask for confirmation before modifying code.
4. **Continue Transparently**:
   - Briefly inform the user that work is resuming from the saved checkpoint.
   - Do NOT repeat the entire recovery document to the user; continue directly with the next logical task.
