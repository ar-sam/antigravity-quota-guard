'use strict';

/**
 * Antigravity Quota Guard — Durable Snapshot Engine
 * Implements 6-phase crash-durable checkpoint serialization, byte-level newline scanning (0x0A)
 * for split multi-byte UTF-8 Persian/emoji strings, single-flight mutex, and auto-pruning.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { DEFAULT_CONFIG } = require('./config-defaults.js');

function getDefaultCheckpointsDir() {
  if (process.env.QUOTA_GUARD_CHECKPOINTS_DIR) {
    return process.env.QUOTA_GUARD_CHECKPOINTS_DIR;
  }
  return path.join(os.homedir(), '.gemini', 'antigravity-quota-safety', 'checkpoints');
}

/**
 * Reads lines backwards from a file using binary buffer scanning for 0x0A bytes
 * to prevent splitting multi-byte UTF-8 sequences (Persian, emojis, combining marks).
 */
function readLastLinesBufferSafe(filePath, maxLines = 5, maxCharsPerMessage = 2000) {
  if (!fs.existsSync(filePath)) return [];

  const fd = fs.openSync(filePath, 'r');
  const CHUNK_SIZE = 8192;
  const fileSize = fs.fstatSync(fd).size;
  let position = fileSize;
  let remainingBuffer = Buffer.alloc(0);
  const rawLines = [];

  try {
    while (position > 0 && rawLines.length < maxLines + 1) {
      const bytesToRead = Math.min(CHUNK_SIZE, position);
      position -= bytesToRead;

      const chunk = Buffer.alloc(bytesToRead);
      fs.readSync(fd, chunk, 0, bytesToRead, position);

      // Concatenate chunk with remainingBuffer
      const combined = Buffer.concat([chunk, remainingBuffer]);
      let lastNewline = combined.length;

      // Scan backwards for 0x0A byte
      for (let i = combined.length - 1; i >= 0; i--) {
        if (combined[i] === 0x0a) {
          if (lastNewline > i + 1) {
            const lineBuf = combined.subarray(i + 1, lastNewline);
            rawLines.push(lineBuf.toString('utf8'));
            if (rawLines.length >= maxLines + 1) break;
          }
          lastNewline = i;
        }
      }

      remainingBuffer = combined.subarray(0, lastNewline);
    }

    if (remainingBuffer.length > 0 && rawLines.length < maxLines + 1) {
      rawLines.push(remainingBuffer.toString('utf8'));
    }
  } finally {
    fs.closeSync(fd);
  }

  // Parse lines from JSONL
  const parsedMessages = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      let content = obj.content || '';
      if (typeof content !== 'string') content = JSON.stringify(content);
      if (content.length > maxCharsPerMessage) {
        content = content.slice(0, maxCharsPerMessage) + '... [truncated]';
      }
      parsedMessages.push({
        source: obj.source || 'UNKNOWN',
        type: obj.type || 'MESSAGE',
        content,
        created_at: obj.created_at || null
      });
      if (parsedMessages.length >= maxLines) break;
    } catch (_) {}
  }

  return parsedMessages.reverse();
}

/**
 * Scans artifact directory with strict bounds.
 */
function scanArtifactsBounded(artifactDir, maxDepth = 4, maxFiles = 50, maxTotalBytes = 50 * 1024 * 1024) {
  const artifacts = [];
  if (!artifactDir || !fs.existsSync(artifactDir)) return artifacts;

  let totalBytes = 0;

  function walk(currentDir, currentDepth) {
    if (currentDepth > maxDepth || artifacts.length >= maxFiles || totalBytes >= maxTotalBytes) return;

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_) { return; }

    for (const entry of entries) {
      if (artifacts.length >= maxFiles || totalBytes >= maxTotalBytes) break;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath, currentDepth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const stat = fs.statSync(fullPath);
          totalBytes += stat.size;
          artifacts.push({
            name: entry.name,
            relativePath: path.relative(artifactDir, fullPath),
            sizeBytes: stat.size,
            updatedAt: stat.mtime.toISOString()
          });
        } catch (_) {}
      }
    }
  }

  walk(artifactDir, 1);
  return artifacts;
}

class SnapshotEngine {
  constructor(options = {}) {
    this.checkpointsDir = options.checkpointsDir || getDefaultCheckpointsDir();
    this.retentionCount = options.retentionCount ?? DEFAULT_CONFIG.snapshot.retentionCount;
    this.includeAccountEmail = options.includeAccountEmail ?? false;
    this.isCreating = false; // Single-flight mutex
  }

  ensureCheckpointsDir() {
    if (!fs.existsSync(this.checkpointsDir)) {
      fs.mkdirSync(this.checkpointsDir, { recursive: true, mode: 0o700 });
    } else {
      try {
        fs.chmodSync(this.checkpointsDir, 0o700);
      } catch (_) {}
    }
  }

  /**
   * Generates English Markdown recovery companion document.
   */
  generateRecoveryMarkdown(checkpointData) {
    const { metadata = {}, recentMessages = [], artifacts = [] } = checkpointData;
    const effectiveQuota = checkpointData.effectiveQuota ?? metadata.effectiveQuota ?? null;
    const accountStr = this.includeAccountEmail && metadata.accountEmail
      ? metadata.accountEmail
      : '[Connected Account (Protected)]';

    let doc = `# Quota Guard Recovery Checkpoint\n\n`;
    doc += `> Generated at: ${metadata.createdAt}\n`;
    doc += `> Effective Quota: ${effectiveQuota !== null ? `${Math.round(effectiveQuota)}%` : 'Unknown'}\n`;
    doc += `> Account: ${accountStr}\n`;
    doc += `> Conversation ID: ${metadata.conversationId || 'N/A'}\n`;
    doc += `> Active Model: ${metadata.modelName || 'Standard'}\n\n`;

    doc += `## Active Artifacts\n`;
    if (artifacts && artifacts.length > 0) {
      for (const a of artifacts) {
        doc += `- **${a.name}** (${a.sizeBytes} bytes, last updated ${a.updatedAt})\n`;
      }
    } else {
      doc += `_No active artifacts recorded._\n`;
    }
    doc += `\n`;

    doc += `## Recent Context (Last ${recentMessages.length} Messages)\n`;
    for (const m of recentMessages) {
      doc += `### [${m.source}] (${m.created_at || 'time unknown'})\n`;
      doc += `${m.content}\n\n`;
    }

    doc += `## Safe Resume Instructions\n`;
    doc += `To resume execution seamlessly with a fresh account:\n`;
    doc += `1. Verify new account quota is healthy (> 70%).\n`;
    doc += `2. Run \`agy --conversation ${metadata.conversationId || '<id>'}\` or click "Resume Work with New Account" in the HUD.\n`;
    doc += `3. Continue from the exact task active above without repeating this document.\n`;

    return doc;
  }

  /**
   * Creates a crash-durable checkpoint.
   * Single-flight mutex prevents concurrent race conditions.
   */
  async createCheckpoint(options = {}) {
    if (this.isCreating) {
      return { success: false, reason: 'CONCURRENT_SNAPSHOT_IN_PROGRESS' };
    }
    this.isCreating = true;
    this.ensureCheckpointsDir();

    try {
      const {
        conversationId,
        transcriptPath,
        artifactDirectoryPath,
        modelName,
        quotaHealth,
        accountEmail
      } = options;

      const now = new Date();
      const timestampStr = now.toISOString().replace(/[:.]/g, '-');
      const checkpointId = `checkpoint-${timestampStr}`;

      // 1. Transcript extraction
      const recentMessages = transcriptPath
        ? readLastLinesBufferSafe(transcriptPath, 5, 2000)
        : [];

      // 2. Artifact inventory
      const artifacts = scanArtifactsBounded(artifactDirectoryPath);

      // 3. Metadata assembly
      let effectiveQuota = null;
      if (quotaHealth) {
        try {
          const { calculateEffectiveQuota } = require('./quota-policy.js');
          effectiveQuota = calculateEffectiveQuota(quotaHealth, modelName);
        } catch (_) {}
        if (effectiveQuota === null) {
          effectiveQuota = quotaHealth.effectiveQuota ?? (quotaHealth.gemini?.fiveHour ?? quotaHealth.claude_gpt?.fiveHour ?? null);
        }
      }

      const checkpointData = {
        checkpointId,
        schemaVersion: '2.2.0',
        metadata: {
          conversationId,
          modelName,
          accountEmail,
          createdAt: now.toISOString(),
          effectiveQuota
        },
        quotaHealth,
        artifacts,
        recentMessages
      };

      // 4. Markdown handoff document
      const markdown = this.generateRecoveryMarkdown(checkpointData);

      // 5. Atomic fsync serialization of JSON and MD
      const jsonFileName = `${checkpointId}.json`;
      const mdFileName = `${checkpointId}.md`;
      const jsonPath = path.join(this.checkpointsDir, jsonFileName);
      const mdPath = path.join(this.checkpointsDir, mdFileName);
      const companionMdPath = path.join(this.checkpointsDir, 'checkpoint.md');

      this.atomicWriteFile(jsonPath, JSON.stringify(checkpointData, null, 2));
      this.atomicWriteFile(mdPath, markdown);
      this.atomicWriteFile(companionMdPath, markdown);

      // 6. Auto-prune old checkpoints
      this.pruneOldCheckpoints();

      return {
        success: true,
        checkpointId,
        jsonPath,
        mdPath,
        companionMdPath,
        effectiveQuota
      };
    } finally {
      this.isCreating = false;
    }
  }

  atomicWriteFile(filePath, contentString) {
    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const fd = fs.openSync(tmpPath, 'w', 0o600);
    try {
      fs.writeSync(fd, contentString, 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath);

    try {
      const dirFd = fs.openSync(path.dirname(filePath), 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (_) {}
  }

  pruneOldCheckpoints() {
    try {
      const files = fs.readdirSync(this.checkpointsDir);
      const jsonFiles = files
        .filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(this.checkpointsDir, f),
          time: fs.statSync(path.join(this.checkpointsDir, f)).mtimeMs
        }))
        .sort((a, b) => b.time - a.time);

      if (jsonFiles.length > this.retentionCount) {
        const toRemove = jsonFiles.slice(this.retentionCount);
        for (const item of toRemove) {
          try { fs.unlinkSync(item.path); } catch (_) {}
          const baseName = item.name.replace('.json', '');
          const mdPath = path.join(this.checkpointsDir, `${baseName}.md`);
          try { if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath); } catch (_) {}
        }
      }
    } catch (_) {}
  }
}

module.exports = {
  readLastLinesBufferSafe,
  scanArtifactsBounded,
  SnapshotEngine,
  getDefaultCheckpointsDir
};
