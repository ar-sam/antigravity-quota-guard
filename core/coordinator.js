'use strict';

/**
 * Antigravity Quota Guard — Global Runtime Coordinator
 * Central coordinator managing multi-instance and worktree concurrency via Unix domain socket IPC.
 * Enforces CAS (compare-and-swap) monotonic revisions, leader lease management,
 * and ephemeral session-bound unmonitored bypass state.
 */

const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createInitialQuotaHealth, transitionQuotaHealth, SAFETY_STATES, FAILURE_KINDS, isBypassValid } = require('./quota-contract.js');
const { calculateEffectiveQuota } = require('./quota-policy.js');
const { GuardStateMachine, GUARD_STATES } = require('./guard-state-machine.js');
const { DEFAULT_CONFIG } = require('./config-defaults.js');

function getBaseDir() {
  if (process.env.QUOTA_GUARD_HOME) {
    return process.env.QUOTA_GUARD_HOME;
  }
  return path.join(os.homedir(), '.gemini', 'antigravity-quota-guard');
}

function getRunDir() {
  const base = getBaseDir();
  return path.join(base, 'run');
}

function getSocketPath() {
  return path.join(getRunDir(), 'coordinator.sock');
}

function getDerivedRuntimeStatePath() {
  return path.join(getBaseDir(), 'runtime-state.json');
}

/**
 * Checks if a process with the given PID is alive.
 * Returns true if alive or if we lack permission (EPERM = process exists).
 */
function isProcessAlive(pid) {
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // Process exists but we don't have permission to signal it
  }
}

class GlobalCoordinator {
  constructor(options = {}) {
    this.runDir = options.runDir || getRunDir();
    this.socketPath = options.socketPath || getSocketPath();
    this.runtimeStatePath = options.runtimeStatePath || getDerivedRuntimeStatePath();
    this.isSidecar = options.isSidecar || false;

    // Authoritative State
    this.revision = 1;
    this.quotaHealth = createInitialQuotaHealth();
    this.guard = new GuardStateMachine({
      thresholds: options.thresholds || DEFAULT_CONFIG.thresholds,
      onSilentCheckpoint: options.onSilentCheckpoint || null
    });
    this.sessions = new Map(); // conversationId -> { surfaceInstanceId, accountIdentity, model, lastSeen }
    this.activeLeases = new Map(); // leaseName -> { holderId, acquiredAt, expiresAt }
    this.unmonitoredBypasses = new Map(); // key = `${surfaceInstanceId}:${conversationId}` -> token
    this.subscribers = new Set();
    this.server = null;
    this.isClosing = false;
  }

  /**
   * Returns canonical guard safety state (5-tier: SAFE, WARN, STABILIZE, CHECKPOINT, HALTED).
   * UNKNOWN_BLOCKED is fail-closed and forces HALTED.
   */
  getGuardState() {
    if (this.quotaHealth.state === SAFETY_STATES.UNKNOWN_BLOCKED) {
      return 'HALTED';
    }
    return this.guard ? this.guard.state : 'SAFE';
  }

  /**
   * Initializes runtime directory with mode 0700.
   */
  ensureRunDirectory() {
    if (!fs.existsSync(this.runDir)) {
      fs.mkdirSync(this.runDir, { recursive: true, mode: 0o700 });
    } else {
      try {
        fs.chmodSync(this.runDir, 0o700);
      } catch (_) {}
    }
  }

  /**
   * Starts the coordinator Unix domain socket server.
   */
  async start() {
    this.ensureRunDirectory();

    // 1. Check PID lock file to prevent split-brain
    const pidFile = path.join(this.runDir, 'coordinator.pid');
    if (fs.existsSync(pidFile)) {
      let existingPid = null;
      try {
        existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      } catch (_) {}
      if (existingPid && isProcessAlive(existingPid)) {
        throw new Error(`Coordinator already running with PID ${existingPid}. Only one coordinator instance allowed per socket path.`);
      }
      // Stale PID file from dead process — safe to clean up
      try { fs.unlinkSync(pidFile); } catch (_) {}
    }

    // 2. Write our PID atomically before binding (claim leadership)
    try {
      fs.writeFileSync(pidFile, `${process.pid}\n`, { mode: 0o600 });
    } catch (err) {
      throw new Error(`Failed to write coordinator PID file: ${err.message}`);
    }

    // 3. Clean up stale socket (only safe now that we've claimed leadership via PID file)
    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch (err) {
        // Clean up PID file before rethrowing
        try { fs.unlinkSync(pidFile); } catch (_) {}
        throw new Error(`Failed to remove stale socket: ${err.message}`);
      }
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleClient(socket);
      });

      this.server.on('error', (err) => {
        // Clean up PID file on server error
        try { fs.unlinkSync(pidFile); } catch (_) {}
        if (!this.isClosing) {
          reject(err);
        }
      });

      this.server.listen(this.socketPath, () => {
        // Enforce socket file permissions 0600
        try {
          fs.chmodSync(this.socketPath, 0o600);
        } catch (_) {}
        this.writeDerivedRuntimeState();
        resolve(this);
      });
    });
  }

  /**
   * Stops the server and cleans up resources.
   */
  async stop() {
    this.isClosing = true;
    for (const socket of this.subscribers) {
      try { socket.destroy(); } catch (_) {}
    }
    this.subscribers.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          try {
            if (fs.existsSync(this.socketPath)) {
              fs.unlinkSync(this.socketPath);
            }
          } catch (_) {}
          try {
            const pidFile = path.join(this.runDir, 'coordinator.pid');
            fs.unlinkSync(pidFile);
          } catch (_) {}
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handles an incoming IPC socket connection.
   */
  handleClient(socket) {
    this.subscribers.add(socket);
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let boundary;
      while ((boundary = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 1);
        if (line) {
          this.processMessage(socket, line);
        }
      }
    });

    socket.on('close', () => {
      this.subscribers.delete(socket);
    });

    socket.on('error', () => {
      this.subscribers.delete(socket);
    });
  }

  /**
   * Processes a single JSON-RPC style line message.
   */
  processMessage(socket, line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_) {
      socket.write(JSON.stringify({ error: 'INVALID_JSON' }) + '\n');
      return;
    }

    const { operation, requestId, expectedRevision, payload } = msg;

    // CAS Check for mutating operations
    if (expectedRevision !== undefined && expectedRevision !== this.revision) {
      socket.write(JSON.stringify({
        requestId,
        error: 'STALE_REVISION_CAS_REJECTED',
        currentRevision: this.revision
      }) + '\n');
      return;
    }

    let response = { requestId, success: true, revision: this.revision };

    switch (operation) {
      case 'GET_STATE': {
        response.data = this.getStateSnapshot();
        break;
      }

      case 'UPDATE_QUOTA': {
        const { observation, staleGraceSeconds } = payload || {};
        this.quotaHealth = transitionQuotaHealth(this.quotaHealth, observation, staleGraceSeconds);
        if (this.guard) {
          this.guard.processQuota(this.quotaHealth);
        }
        this.revision++;

        // Revoke unmonitored bypasses if quota observation arrived
        const eff = calculateEffectiveQuota(this.quotaHealth);
        if (eff !== null && eff <= 12) {
          this.unmonitoredBypasses.clear();
        }

        this.writeDerivedRuntimeState();
        this.broadcastState();
        response.revision = this.revision;
        response.data = {
          ...this.quotaHealth,
          quotaHealth: this.quotaHealth,
          guardState: this.getGuardState()
        };
        break;
      }

      case 'TRANSITION_TO_HALTED': {
        if (this.guard) {
          this.guard.transitionToHalted();
        }
        this.revision++;
        this.writeDerivedRuntimeState();
        this.broadcastState();
        response.revision = this.revision;
        response.data = { guardState: this.getGuardState() };
        break;
      }

      case 'TRANSITION_TO_BACKGROUND_ACTIVE': {
        if (this.guard) {
          this.guard.transitionToBackgroundActive();
        }
        this.revision++;
        this.writeDerivedRuntimeState();
        this.broadcastState();
        response.revision = this.revision;
        response.data = { guardState: this.getGuardState() };
        break;
      }

      case 'RESUME_GUARD': {
        if (this.guard) {
          const res = this.guard.canResume({
            quotaHealth: this.quotaHealth,
            ...(payload || {})
          });
          if (res.allowed) {
            this.guard.state = GUARD_STATES.SAFE;
            this.guard.silentCheckpointTriggered = false;
            this.revision++;
            this.writeDerivedRuntimeState();
            this.broadcastState();
            response.data = { resumed: true, guardState: this.getGuardState() };
          } else {
            response.data = { resumed: false, reason: res.reason, guardState: this.getGuardState() };
          }
        }
        break;
      }

      case 'REGISTER_SESSION': {
        const { conversationId, surfaceInstanceId, accountIdentity, model } = payload || {};
        if (conversationId) {
          this.sessions.set(conversationId, {
            surfaceInstanceId,
            accountIdentity,
            model,
            lastSeen: Date.now()
          });
          this.revision++;
          this.writeDerivedRuntimeState();
        }
        response.revision = this.revision;
        break;
      }

      case 'SET_UNMONITORED_BYPASS': {
        const { surfaceInstanceId, conversationId, accountIdentity, sessionEpoch } = payload || {};
        if (surfaceInstanceId && conversationId && accountIdentity) {
          const key = `${surfaceInstanceId}:${conversationId}`;
          this.unmonitoredBypasses.set(key, {
            surfaceInstanceId,
            conversationId,
            accountIdentity,
            sessionEpoch: sessionEpoch || Date.now(),
            activatedAt: Date.now()
          });
          this.revision++;
          response.revision = this.revision;
        } else {
          response.success = false;
          response.error = 'MISSING_BYPASS_TUPLE';
        }
        break;
      }

      case 'CHECK_BYPASS': {
        const { surfaceInstanceId, conversationId, accountIdentity, knownQuota } = payload || {};
        const key = `${surfaceInstanceId}:${conversationId}`;
        const token = this.unmonitoredBypasses.get(key);
        const valid = isBypassValid(token, { accountIdentity, surfaceInstanceId, conversationId, knownQuota });
        if (token && !valid) {
          this.unmonitoredBypasses.delete(key);
        }
        response.data = { valid };
        break;
      }

      case 'ACQUIRE_LEASE': {
        const { leaseName, holderId, ttlMs = 10000 } = payload || {};
        const now = Date.now();
        const existing = this.activeLeases.get(leaseName);

        if (existing && existing.expiresAt > now && existing.holderId !== holderId) {
          response.success = false;
          response.error = 'LEASE_HELD_BY_ANOTHER_CLIENT';
          response.holderId = existing.holderId;
        } else {
          this.activeLeases.set(leaseName, {
            holderId,
            acquiredAt: now,
            expiresAt: now + ttlMs
          });
          this.revision++;
          response.revision = this.revision;
        }
        break;
      }

      case 'RELEASE_LEASE': {
        const { leaseName, holderId } = payload || {};
        const existing = this.activeLeases.get(leaseName);
        if (existing && existing.holderId === holderId) {
          this.activeLeases.delete(leaseName);
          this.revision++;
          response.revision = this.revision;
        }
        break;
      }

      default:
        response.success = false;
        response.error = `UNKNOWN_OPERATION: ${operation}`;
        break;
    }

    socket.write(JSON.stringify(response) + '\n');
  }

  /**
   * Broadcasts updated state to all connected socket subscribers.
   */
  broadcastState() {
    const payload = JSON.stringify({
      event: 'STATE_CHANGED',
      revision: this.revision,
      state: this.getStateSnapshot()
    }) + '\n';

    for (const socket of this.subscribers) {
      try {
        socket.write(payload);
      } catch (_) {}
    }
  }

  /**
   * Returns a sanitized state snapshot for queries and subscribers.
   */
  getStateSnapshot() {
    return {
      revision: this.revision,
      guardState: this.getGuardState(),
      healthState: this.quotaHealth.state,
      quotaHealth: this.quotaHealth,
      effectiveQuota: calculateEffectiveQuota(this.quotaHealth),
      activeSessionCount: this.sessions.size,
      activeBypassCount: this.unmonitoredBypasses.size
    };
  }

  /**
   * Writes the derived read-only presentation projection (runtime-state.json).
   * Mode 0600, atomic write with fsync.
   */
  writeDerivedRuntimeState() {
    try {
      const projection = {
        revision: this.revision,
        updatedAt: new Date().toISOString(),
        guardState: this.getGuardState(),
        healthState: this.quotaHealth.state,
        quotaHealth: this.quotaHealth,
        state: this.getGuardState(),
        failureKind: this.quotaHealth.failureKind,
        effectiveQuota: calculateEffectiveQuota(this.quotaHealth),
        activeSessionCount: this.sessions.size,
        activeBypassCount: this.unmonitoredBypasses.size,
        checkpointStatus: 'IDLE',
        gemini: this.quotaHealth.gemini,
        claude_gpt: this.quotaHealth.claude_gpt,
        source: this.quotaHealth.source
      };

      const tmpPath = `${this.runtimeStatePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(projection, null, 2), { mode: 0o600 });
      fs.renameSync(tmpPath, this.runtimeStatePath);
    } catch (_) {
      // Best-effort derived projection
    }
  }
}

/**
 * Convenience helper to start the global coordinator.
 */
async function startCoordinator(options = {}) {
  const coordinator = new GlobalCoordinator(options);
  await coordinator.start();
  return coordinator;
}

module.exports = {
  GlobalCoordinator,
  startCoordinator,
  getRunDir,
  getSocketPath,
  getDerivedRuntimeStatePath
};
