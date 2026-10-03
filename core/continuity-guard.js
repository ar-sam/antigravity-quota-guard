/**
 * Antigravity Quota Guard — Continuity Guard
 * Multi-folder native workspace recovery capsule, context window pressure tracking,
 * and workspace divergence detection.
 *
 * Implements R17 from architecture specification.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

/**
 * Computes a SHA-256 hash of a string or buffer.
 * @param {string|Buffer} data
 * @returns {string}
 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Checks if a directory is a Git repository.
 * @param {string} dirPath
 * @returns {boolean}
 */
function isGitRepo(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return false;
    const gitDir = path.join(dirPath, '.git');
    if (fs.existsSync(gitDir)) return true;
    // Check if inside a git worktree or submodule
    const res = execSync('git rev-parse --is-inside-work-tree', {
      cwd: dirPath,
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 2000
    });
    return res.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Inspects a Git repository and produces a VCS metadata descriptor.
 * @param {string} repoPath
 * @returns {object}
 */
function inspectGitRepo(repoPath) {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 2000
    }).trim();

    const headSha = execSync('git rev-parse HEAD', {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 2000
    }).trim();

    const statusOutput = execSync('git status --porcelain', {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 3000
    });

    const dirtyFingerprint = sha256(statusOutput);

    let worktreePath = null;
    try {
      const topLevel = execSync('git rev-parse --show-toplevel', {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: 2000
      }).trim();
      worktreePath = path.resolve(topLevel);
    } catch {
      worktreePath = path.resolve(repoPath);
    }

    return {
      kind: 'git',
      vcsType: 'git',
      worktreePath,
      branch,
      headSha,
      dirtyFingerprint,
      isDirty: statusOutput.trim().length > 0
    };
  } catch (err) {
    return {
      kind: 'git',
      vcsType: 'git',
      worktreePath: path.resolve(repoPath),
      branch: 'UNKNOWN',
      headSha: 'UNKNOWN',
      dirtyFingerprint: 'UNKNOWN',
      isDirty: false,
      inspectionError: err.message
    };
  }
}

/**
 * Inspects a non-Git directory and computes a deterministic dirty fingerprint based on file mtimes.
 * Strictly assigns vcsType: null (no fabricated VCS metadata).
 * @param {string} dirPath
 * @returns {object}
 */
function inspectLocalFolder(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      return {
        kind: 'local',
        vcsType: null,
        worktreePath: null,
        branch: null,
        headSha: null,
        dirtyFingerprint: null,
        missing: true
      };
    }

    // Inspect top-level directory entries (up to 50 entries)
    const entries = fs.readdirSync(dirPath).slice(0, 50);
    const mtimes = entries.map(name => {
      try {
        const stat = fs.statSync(path.join(dirPath, name));
        return `${name}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        return `${name}:missing`;
      }
    });

    const dirtyFingerprint = sha256(mtimes.join('|'));

    return {
      kind: 'local',
      vcsType: null,
      worktreePath: null,
      branch: null,
      headSha: null,
      dirtyFingerprint,
      isDirty: false
    };
  } catch (err) {
    return {
      kind: 'local',
      vcsType: null,
      worktreePath: null,
      branch: null,
      headSha: null,
      dirtyFingerprint: null,
      inspectionError: err.message
    };
  }
}

/**
 * Creates a single workspace entry for a given folder path.
 * @param {string} folderPath
 * @returns {object}
 */
function createWorkspaceEntry(folderPath) {
  const resolved = path.resolve(folderPath);
  const isGit = isGitRepo(resolved);
  const metadata = isGit ? inspectGitRepo(resolved) : inspectLocalFolder(resolved);

  return {
    path: resolved,
    ...metadata
  };
}

/**
 * Extracts context window pressure from official telemetry if available.
 * Telemetry must come from official CLI statusline or API telemetry.
 * If telemetry is absent, returns 'UNAVAILABLE' (never fabricates a percentage).
 * @param {object|null} telemetry
 * @returns {object|string}
 */
function resolveContextWindowPressure(telemetry) {
  if (!telemetry || typeof telemetry !== 'object') {
    return 'UNAVAILABLE';
  }

  // Check for official CLI context_window fields
  const cw = telemetry.context_window || telemetry.contextWindow;
  if (!cw || typeof cw !== 'object') {
    return 'UNAVAILABLE';
  }

  const used = Number(cw.used ?? cw.current_tokens);
  const total = Number(cw.total ?? cw.max_tokens);

  if (Number.isFinite(used) && Number.isFinite(total) && total > 0) {
    const percent = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
    return {
      status: 'AVAILABLE',
      used,
      total,
      percent,
      observedAt: new Date().toISOString()
    };
  }

  return 'UNAVAILABLE';
}

/**
 * Creates a multi-folder native workspace recovery capsule.
 * @param {string[]} workspacePaths
 * @param {object} [options]
 * @param {object} [options.telemetry]
 * @returns {object}
 */
function createWorkspaceCapsule(workspacePaths, options = {}) {
  const paths = Array.isArray(workspacePaths) ? workspacePaths : [];
  const workspaceEntries = paths.map(p => createWorkspaceEntry(p));
  const contextPressure = resolveContextWindowPressure(options.telemetry);

  return {
    version: '2.2.0',
    createdAt: new Date().toISOString(),
    workspaceEntries,
    contextPressure
  };
}

/**
 * Verifies whether the active workspace has diverged from a saved checkpoint capsule.
 * R17 Invariant: Detects changed paths, branches, HEAD SHAs, and dirty fingerprints.
 * Does NOT automatically stash or commit changes.
 * @param {object} savedCapsule
 * @param {object} currentCapsule
 * @returns {object}
 */
function verifyWorkspaceDivergence(savedCapsule, currentCapsule) {
  if (!savedCapsule || !savedCapsule.workspaceEntries) {
    return {
      diverged: false,
      state: 'WORKSPACE_ALIGNED',
      reasons: ['No previous workspace capsule to compare.']
    };
  }

  if (!currentCapsule || !currentCapsule.workspaceEntries) {
    return {
      diverged: true,
      state: 'WORKSPACE_DIVERGED',
      reasons: ['Current workspace capsule is invalid or missing.']
    };
  }

  const reasons = [];
  const savedEntries = new Map(savedCapsule.workspaceEntries.map(e => [e.path, e]));
  const currentEntries = new Map(currentCapsule.workspaceEntries.map(e => [e.path, e]));

  // Check for removed workspaces
  for (const [savedPath, saved] of savedEntries.entries()) {
    if (!currentEntries.has(savedPath)) {
      reasons.push(`Workspace folder removed: ${savedPath}`);
      continue;
    }

    const current = currentEntries.get(savedPath);

    // Kind mismatch
    if (saved.kind !== current.kind) {
      reasons.push(`Workspace kind changed for ${savedPath}: was ${saved.kind}, now ${current.kind}`);
      continue;
    }

    // Git comparisons
    if (saved.kind === 'git') {
      if (saved.branch !== current.branch) {
        reasons.push(`Git branch changed for ${savedPath}: was '${saved.branch}', now '${current.branch}'`);
      }
      if (saved.headSha !== current.headSha) {
        reasons.push(`Git HEAD commit diverged for ${savedPath}: was ${saved.headSha?.slice(0, 8)}, now ${current.headSha?.slice(0, 8)}`);
      }
      if (saved.dirtyFingerprint !== current.dirtyFingerprint) {
        reasons.push(`Working directory dirty state changed for ${savedPath}`);
      }
    } else {
      // Local non-git folder comparison
      if (saved.dirtyFingerprint !== current.dirtyFingerprint) {
        reasons.push(`Local folder contents modified for ${savedPath}`);
      }
    }
  }

  // Check for newly added workspaces
  for (const currentPath of currentEntries.keys()) {
    if (!savedEntries.has(currentPath)) {
      reasons.push(`New workspace folder added: ${currentPath}`);
    }
  }

  if (reasons.length > 0) {
    return {
      diverged: true,
      state: 'WORKSPACE_DIVERGED',
      reasons
    };
  }

  return {
    diverged: false,
    state: 'WORKSPACE_ALIGNED',
    reasons: []
  };
}

module.exports = {
  createWorkspaceEntry,
  createWorkspaceCapsule,
  verifyWorkspaceDivergence,
  resolveContextWindowPressure,
  isGitRepo,
  inspectGitRepo,
  inspectLocalFolder
};
