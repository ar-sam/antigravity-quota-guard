'use strict';

/**
 * Antigravity Quota Guard — Official Hook Handler
 * Authoritative turn boundary halting and tool execution safety gates.
 * 
 * Invariants:
 * 1. PostInvocation with terminationBehavior: "terminate" authoritatively halts model loop at turn boundary.
 * 2. PreToolUse enforces deny-by-default on side-effecting tools when HALTED or UNKNOWN_BLOCKED,
 *    preserving audited read-only diagnostic MCP allowlist.
 * 3. Stop hook inspects fullyIdle; if false, enters HALTED_BACKGROUND_ACTIVE and never issues continue.
 * 4. PreInvocation is strictly advisory and contextual (injectSteps).
 */

const { EXPORTED_READ_ONLY_TOOLS } = require('../../mcp/read-only-server.js');
const { DEFAULT_CONFIG } = require('../../core/config-defaults.js');
const { calculateEffectiveQuota } = require('../../core/quota-policy.js');

class HookHandler {
  constructor(options = {}) {
    this.coordinatorClient = options.coordinatorClient || null;
    // Use the canonical read-only allowlist directly (no class instantiation needed)
    this._allowlist = options.allowlist || [...EXPORTED_READ_ONLY_TOOLS];
    this.stopPercent = options.stopPercent ?? DEFAULT_CONFIG.thresholds.stopPercent;
    this.snapshotEngine = options.snapshotEngine || null;
    this.state = options.initialState || 'SAFE'; // 'SAFE' | 'HALTED' | 'UNKNOWN_BLOCKED' | 'HALTED_BACKGROUND_ACTIVE'
  }

  /**
   * PreInvocation Hook: Advisory and contextual only (injectSteps).
   */
  async handlePreInvocation(context = {}) {
    const quotaHealth = context.quotaHealth || (this.coordinatorClient ? await this.coordinatorClient.getQuotaHealth() : null);
    const eff = calculateEffectiveQuota(quotaHealth, context.modelName);

    if (eff !== null && eff <= 20) {
      return {
        injectSteps: [
          { ephemeralMessage: `[QuotaGuard Advisory]: Current AI quota remaining is ${Math.round(eff)}%. Execution will pause cleanly at turn boundary when reaching ${this.stopPercent}%.` }
        ]
      };
    }

    return {};
  }

  /**
   * PreToolUse Hook: Deny-by-default on side-effecting tools when HALTED or UNKNOWN_BLOCKED.
   * Official payload: { toolCall: { name: string, args: object }, ... }
   */
  async handlePreToolUse(context = {}) {
    // Official contract: tool name is in toolCall.name, not top-level toolName
    const toolName = context.toolCall?.name || context.toolName;
    const { bypassToken } = context;

    // Check if system is currently halted or blocked
    const isBlocked = (this.state === 'HALTED' || this.state === 'UNKNOWN_BLOCKED' || this.state === 'HALTED_BACKGROUND_ACTIVE');

    if (!isBlocked) {
      return { decision: 'allow' };
    }

    // Check if user consciously bypassed via ephemeral session token with active validation
    if (bypassToken && this.isBypassValid(bypassToken, context)) {
      return { decision: 'allow', reason: 'UNMONITORED_BYPASS_ACKNOWLEDGED' };
    }

    // Check allowlist: Allow strictly read-only diagnostic MCP tools
    if (toolName && this._allowlist.includes(toolName)) {
      return { decision: 'allow', reason: 'READ_ONLY_RECOVERY_ALLOWLIST' };
    }

    // Deny all side-effecting tools
    return {
      decision: 'deny',
      reason: 'QUOTA_GUARD_HALTED',
      message: `Tool execution of "${toolName}" denied because Quota Guard has paused execution for safe multi-account handover.`
    };
  }

  /**
   * Validates ephemeral unmonitored bypass token.
   * Auto-revoked if quota <= stopPercent (12%).
   */
  isBypassValid(bypassToken, context = {}) {
    if (!bypassToken) return false;

    // Invariant: Automatic revocation if current quota <= stopPercent (12%)
    const quotaHealth = context.quotaHealth || this.quotaHealth;
    const eff = calculateEffectiveQuota(quotaHealth, context.modelName);
    if (eff !== null && eff <= this.stopPercent) {
      return false; // Auto-revoked to protect account from hard quota penalty
    }

    if (typeof bypassToken === 'object') {
      if (bypassToken.revoked === true) return false;
      if (bypassToken.expiresAt && Date.now() > bypassToken.expiresAt) return false;
      if (context.conversationId && bypassToken.conversationId && bypassToken.conversationId !== context.conversationId) {
        return false;
      }
      return true;
    }

    return typeof bypassToken === 'string' && bypassToken.length > 0;
  }

  /**
   * PostInvocation Hook: Authoritative turn boundary halting.
   */
  async handlePostInvocation(context = {}) {
    const { conversationId, transcriptPath, modelName, artifactDirectoryPath, quotaHealth } = context;

    const health = quotaHealth || (this.coordinatorClient ? await this.coordinatorClient.getQuotaHealth() : null);
    const eff = calculateEffectiveQuota(health, modelName);

    if (eff !== null && eff <= this.stopPercent) {
      this.state = 'HALTED';

      if (this.coordinatorClient && typeof this.coordinatorClient.transitionToHalted === 'function') {
        try { await this.coordinatorClient.transitionToHalted({ reason: 'QUOTA_SAFETY_THRESHOLD_REACHED' }); } catch (_) {}
      }

      // Trigger durable checkpoint creation if snapshot engine is attached
      if (this.snapshotEngine && typeof this.snapshotEngine.createCheckpoint === 'function') {
        try {
          await this.snapshotEngine.createCheckpoint({
            conversationId,
            transcriptPath,
            artifactDirectoryPath,
            modelName,
            quotaHealth: health
          });
        } catch (_) {}
      }

      // Authoritative turn boundary termination
      return {
        terminationBehavior: 'terminate',
        reason: 'QUOTA_SAFETY_THRESHOLD_REACHED',
        effectiveQuota: eff,
        stopPercent: this.stopPercent
      };
    }

    return {};
  }

  /**
   * Stop Hook: Inspects fullyIdle signal from agent execution engine.
   * Official contract output:
   *   - Must return required decision: string.
   *   - "continue" re-enters the execution loop (NEVER allowed when HALTED).
   *   - "stop" cleanly allows termination.
   */
  async handleStop(event = {}) {
    const { fullyIdle } = event;

    if (fullyIdle === false) {
      // Background tasks still active — update internal state for tracking
      this.state = 'HALTED_BACKGROUND_ACTIVE';
      if (this.coordinatorClient && typeof this.coordinatorClient.transitionToBackgroundActive === 'function') {
        try { await this.coordinatorClient.transitionToBackgroundActive(); } catch (_) {}
      }
      // INVARIANT: Never return { decision: "continue" } when HALTED
      return { decision: 'stop' };
    }

    // Fully idle — allow stop to proceed normally
    return { decision: 'stop' };
  }
}

module.exports = {
  HookHandler
};
