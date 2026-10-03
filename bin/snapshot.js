'use strict';

/**
 * Antigravity Quota Guard — 6-Phase Durable Snapshot Engine
 * 
 * Deterministic, zero-dependency, crash-resilient session capture pipeline.
 * Captures conversation metadata, active model detection, quota metrics,
 * transcript history, and workspace artifacts when remaining AI quota reaches
 * the safety stop threshold.
 * 
 * 100% Clean Room Implementation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');

// Default paths & constants
const DEFAULT_ANTIGRAVITY_DIR = path.join(os.homedir(), '.gemini', 'antigravity');
const DEFAULT_DB_PATH = path.join(DEFAULT_ANTIGRAVITY_DIR, 'conversation_summaries.db');
const DEFAULT_BRAIN_DIR = path.join(DEFAULT_ANTIGRAVITY_DIR, 'brain');
const LEGACY_CHECKPOINTS_DIR = path.join(os.homedir(), '.gemini', 'antigravity-quota-safety', 'checkpoints');
const DEFAULT_CHECKPOINTS_DIR = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard', 'checkpoints');

/**
 * Migrates legacy checkpoints if target directory is newly used.
 */
function migrateLegacyCheckpoints(targetDir) {
  try {
    if (fs.existsSync(LEGACY_CHECKPOINTS_DIR) && fs.existsSync(targetDir) && LEGACY_CHECKPOINTS_DIR !== targetDir) {
      const files = fs.readdirSync(LEGACY_CHECKPOINTS_DIR);
      for (const file of files) {
        if (file.endsWith('.json') || file.endsWith('.md')) {
          const src = path.join(LEGACY_CHECKPOINTS_DIR, file);
          const dest = path.join(targetDir, file);
          if (!fs.existsSync(dest)) {
            try { fs.copyFileSync(src, dest); } catch (_) {}
          }
        }
      }
    }
  } catch (_) {}
}

const CHECKPOINTS_DIR = DEFAULT_CHECKPOINTS_DIR;
const MAX_CHECKPOINTS = 10;
const MAX_MSG_CHARS = 2000;
const TRANSCRIPT_CHUNK_SIZE = 128 * 1024; // 128KB tail chunk

/**
 * Classify model string into canonical model category ('gemini', 'claude_gpt', or 'unknown')
 * @param {string} modelString 
 * @returns {string}
 */
function classifyModel(modelString) {
  if (!modelString || typeof modelString !== 'string') return 'unknown';
  const s = modelString.toLowerCase();
  if (/claude|gpt|sonnet|opus|haiku|o1|o3/.test(s)) {
    return 'claude_gpt';
  }
  if (/gemini|flash|pro/.test(s)) {
    return 'gemini';
  }
  return 'unknown';
}

/**
 * Tier 1: Query conversation title using Node.js built-in node:sqlite (DatabaseSync)
 * Available in Node >= 22.5.0. Opened with readOnly: true for safe SQLite WAL mode access.
 * @param {string} dbPath 
 * @param {string} conversationId 
 * @returns {string|null}
 */
function queryTitleWithNodeSqlite(dbPath, conversationId) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare('SELECT title FROM conversation_summaries WHERE conversation_id = ?').get(conversationId);
      if (row && typeof row.title === 'string' && row.title.trim().length > 0) {
        return row.title.trim();
      }
    } finally {
      try { db.close(); } catch (_) {}
    }
  } catch (_) {}
  return null;
}

/**
 * Tier 2: Query conversation title using system /usr/bin/sqlite3 CLI
 * @param {string} dbPath 
 * @param {string} conversationId 
 * @returns {string|null}
 */
function queryTitleWithSqliteCli(dbPath, conversationId) {
  const sqliteBins = ['/usr/bin/sqlite3', 'sqlite3'];
  const escapedId = conversationId.replace(/'/g, "''");
  const query = `SELECT title FROM conversation_summaries WHERE conversation_id = '${escapedId}';`;

  for (const bin of sqliteBins) {
    try {
      const stdout = cp.execFileSync(bin, [dbPath, query], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      if (stdout && stdout.trim().length > 0) {
        return stdout.trim();
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Tier 3: Query conversation title using python3 standard library sqlite3
 * @param {string} dbPath 
 * @param {string} conversationId 
 * @returns {string|null}
 */
function queryTitleWithPython(dbPath, conversationId) {
  const pyBins = ['python3', '/usr/bin/python3', 'python'];
  const pyScript = [
    'import sqlite3, sys',
    'try:',
    '  conn = sqlite3.connect(sys.argv[1])',
    '  c = conn.cursor()',
    '  c.execute("SELECT title FROM conversation_summaries WHERE conversation_id = ?", (sys.argv[2],))',
    '  row = c.fetchone()',
    '  if row and row[0]:',
    '    print(str(row[0]).strip())',
    'except Exception:',
    '  pass'
  ].join('\n');

  for (const bin of pyBins) {
    try {
      const stdout = cp.execFileSync(bin, ['-c', pyScript, dbPath, conversationId], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      if (stdout && stdout.trim().length > 0) {
        return stdout.trim();
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Query the latest modified conversation from conversation_summaries.db
 * @param {string} dbPath 
 * @returns {{ conversationId: string, title: string }|null}
 */
function queryLatestConversation(dbPath) {
  if (!fs.existsSync(dbPath)) return null;

  // Try node:sqlite
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare('SELECT conversation_id, title FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 1').get();
      if (row && row.conversation_id) {
        const titleStr = typeof row.title === 'string' && row.title.trim().length > 0
          ? row.title.trim()
          : 'Untitled Conversation';
        return { conversationId: String(row.conversation_id), title: titleStr };
      }
    } finally {
      try { db.close(); } catch (_) {}
    }
  } catch (_) {}

  // Try sqlite3 CLI
  try {
    const query = 'SELECT conversation_id, title FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 1;';
    const stdout = cp.execFileSync('/usr/bin/sqlite3', ['-separator', '|||', dbPath, query], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    if (stdout && stdout.trim().length > 0) {
      const parts = stdout.trim().split('|||');
      if (parts[0]) {
        const titleStr = parts[1] && parts[1].trim().length > 0 ? parts[1].trim() : 'Untitled Conversation';
        return { conversationId: parts[0].trim(), title: titleStr };
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Read conversation title using 4-tier query strategy:
 * Tier 1 (node:sqlite) -> Tier 2 (/usr/bin/sqlite3) -> Tier 3 (python3) -> Tier 4 ('Untitled Conversation')
 * @param {string} conversationId 
 * @param {string} [customDbPath]
 * @returns {string}
 */
function readConversationTitle(conversationId, customDbPath = null) {
  if (!conversationId || typeof conversationId !== 'string') {
    return 'Untitled Conversation';
  }

  const dbPath = customDbPath || DEFAULT_DB_PATH;
  if (!fs.existsSync(dbPath)) {
    return 'Untitled Conversation';
  }

  // Tier 1: node:sqlite
  const t1 = queryTitleWithNodeSqlite(dbPath, conversationId);
  if (t1) return t1;

  // Tier 2: /usr/bin/sqlite3 CLI
  const t2 = queryTitleWithSqliteCli(dbPath, conversationId);
  if (t2) return t2;

  // Tier 3: python3 sqlite3 module
  const t3 = queryTitleWithPython(dbPath, conversationId);
  if (t3) return t3;

  // Tier 4: Fallback safe title
  return 'Untitled Conversation';
}

/**
 * Normalize quota metrics structure supporting both flat and nested keys
 * @param {object} rawMetrics 
 * @returns {object}
 */
function normalizeQuotaMetrics(rawMetrics) {
  if (!rawMetrics || typeof rawMetrics !== 'object') {
    return {
      gemini_5h: null,
      gemini_weekly: null,
      claude_5h: null,
      claude_weekly: null,
      gemini_reset: null,
      claude_reset: null,
      account_email: 'unknown'
    };
  }

  return {
    gemini_5h: rawMetrics.gemini_5h ?? rawMetrics.gemini?.fiveHour ?? null,
    gemini_weekly: rawMetrics.gemini_weekly ?? rawMetrics.gemini?.weekly ?? null,
    claude_5h: rawMetrics.claude_5h ?? rawMetrics.claude_gpt?.fiveHour ?? null,
    claude_weekly: rawMetrics.claude_weekly ?? rawMetrics.claude_gpt?.weekly ?? null,
    gemini_reset: rawMetrics.gemini_reset ?? rawMetrics.gemini?.resetTimeFiveHour ?? rawMetrics.gemini?.resetTime ?? null,
    claude_reset: rawMetrics.claude_reset ?? rawMetrics.claude_gpt?.resetTimeFiveHour ?? rawMetrics.claude_gpt?.resetTime ?? null,
    account_email: rawMetrics.account_email || rawMetrics.email || rawMetrics.account || 'unknown'
  };
}

/**
 * Phase 1: Extract conversation metadata from ID, active model, and SQLite database
 * @param {string} [conversationId] 
 * @param {object} [options]
 * @returns {object}
 */
function extractConversationMetadata(conversationId = null, options = {}) {
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  let activeId = conversationId;
  let title = 'Untitled Conversation';

  if (!activeId) {
    const latest = queryLatestConversation(dbPath);
    if (latest) {
      activeId = latest.conversationId;
      title = latest.title;
    } else {
      activeId = 'unknown';
    }
  } else {
    title = readConversationTitle(activeId, dbPath);
  }

  const modelName = options.activeModel || options.model || 'unknown';
  const modelCategory = options.modelCategory || classifyModel(modelName);
  const quota = normalizeQuotaMetrics(options.quotaMetrics || options.quotaData);
  const accountEmail = options.accountEmail || options.email || quota.account_email || 'unknown';

  return {
    conversation_id: activeId,
    title,
    active_model: {
      name: modelName,
      category: modelCategory
    },
    account_email: accountEmail,
    quota_at_pause: quota
  };
}

/**
 * Parse an individual transcript line into a normalized message record
 * @param {string} line 
 * @param {number} maxChars 
 * @returns {object|null}
 */
function parseTranscriptLine(line, maxChars = MAX_MSG_CHARS) {
  if (!line || !line.trim()) return null;
  try {
    const item = JSON.parse(line);
    const isUser = item.type === 'USER_INPUT' || item.source === 'USER_EXPLICIT' || item.source === 'USER';
    const isAssistant = item.type === 'PLANNER_RESPONSE' || (item.source === 'MODEL' && (item.type === 'PLANNER_RESPONSE' || item.type === 'GENERIC'));

    if (!isUser && !isAssistant) {
      return null;
    }

    let content = '';
    if (typeof item.content === 'string') {
      content = item.content;
    } else if (typeof item.text === 'string') {
      content = item.text;
    } else if (typeof item.thinking === 'string') {
      content = item.thinking;
    } else if (item.content && typeof item.content === 'object') {
      content = JSON.stringify(item.content);
    }

    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
    }

    const timestamp = item.created_at || item.timestamp || (item.step_index !== undefined ? `step-${item.step_index}` : new Date().toISOString());

    return {
      role: isUser ? 'user' : 'assistant',
      content,
      timestamp,
      step_index: typeof item.step_index === 'number' ? item.step_index : undefined
    };
  } catch (_) {
    return null;
  }
}

/**
 * Phase 2: Extract recent dialogue messages from transcript.jsonl using fast reverse chunked reading
 * @param {string} conversationId 
 * @param {number|object} [maxCountOrOptions] 
 * @param {object} [maybeOptions] 
 * @returns {Array<{ role: string, content: string, timestamp: string }>}
 */
function extractTranscriptMessages(conversationId, maxCountOrOptions = 5, maybeOptions = {}) {
  let count = 5;
  let opts = {};

  if (typeof maxCountOrOptions === 'number') {
    count = maxCountOrOptions;
    if (typeof maybeOptions === 'object' && maybeOptions !== null) {
      opts = maybeOptions;
    }
  } else if (typeof maxCountOrOptions === 'object' && maxCountOrOptions !== null) {
    opts = maxCountOrOptions;
    if (typeof opts.maxCount === 'number') count = opts.maxCount;
  }

  const maxChars = typeof opts.maxChars === 'number' ? opts.maxChars : MAX_MSG_CHARS;

  // Resolve transcript file path
  let transcriptPath = opts.transcriptPath;
  if (!transcriptPath) {
    if (!conversationId || conversationId === 'unknown') return [];
    const brainDir = opts.brainDir || DEFAULT_BRAIN_DIR;
    transcriptPath = path.join(brainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
  }

  if (!fs.existsSync(transcriptPath)) {
    return [];
  }

  let stat;
  try {
    stat = fs.statSync(transcriptPath);
  } catch (_) {
    return [];
  }

  if (stat.size === 0) return [];

  const chunkSize = Math.max(4096, opts.chunkSize || TRANSCRIPT_CHUNK_SIZE);
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
  } catch (_) {
    return [];
  }

  try {
    let position = stat.size;
    let leftover = '';
    const collected = [];

    while (position > 0 && collected.length < count) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, position);
      const textChunk = buf.toString('utf8') + leftover;
      const lines = textChunk.split('\n');

      if (position > 0) {
        // First line in chunk may be partial across boundary
        leftover = lines.shift() || '';
      } else {
        leftover = '';
      }

      // Process lines bottom to top (newest to oldest)
      for (let i = lines.length - 1; i >= 0; i--) {
        const msg = parseTranscriptLine(lines[i], maxChars);
        if (msg) {
          collected.unshift(msg);
          if (collected.length >= count) {
            break;
          }
        }
      }
    }

    // If leftover remains and we still need messages
    if (leftover && collected.length < count) {
      const msg = parseTranscriptLine(leftover, maxChars);
      if (msg) collected.unshift(msg);
    }

    return collected.slice(-count);
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
  }
}

/**
 * Phase 3: Scan conversation workspace for active Markdown artifacts (*.md)
 * Excludes metadata sidecars (*.metadata.json), hidden directories (.system_generated, .user_uploaded),
 * and scratch directories.
 * @param {string} conversationId 
 * @param {object} [options] 
 * @returns {Array<{ name: string, path: string, relative_path: string, size_bytes: number, modified: string }>}
 */
function scanActiveArtifacts(conversationId, options = {}) {
  let targetDir = options.artifactsDir;
  if (!targetDir) {
    if (!conversationId || conversationId === 'unknown') return [];
    const brainDir = options.brainDir || DEFAULT_BRAIN_DIR;
    targetDir = path.join(brainDir, conversationId);
  }

  if (!fs.existsSync(targetDir)) return [];

  const artifacts = [];
  const EXCLUDED_DIRS = new Set(['.system_generated', '.user_uploaded', 'scratch']);

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      const entryName = entry.name;
      // Skip hidden files/directories (starting with dot) or excluded names
      if (entryName.startsWith('.') || EXCLUDED_DIRS.has(entryName.toLowerCase())) {
        continue;
      }

      const fullPath = path.join(currentDir, entryName);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        // Must be .md and NOT .metadata.json
        if (entryName.toLowerCase().endsWith('.md') && !entryName.toLowerCase().endsWith('.metadata.json')) {
          try {
            const stat = fs.statSync(fullPath);
            artifacts.push({
              name: entryName,
              path: fullPath,
              relative_path: path.relative(targetDir, fullPath),
              size_bytes: stat.size,
              modified: stat.mtime.toISOString()
            });
          } catch (_) {}
        }
      }
    }
  }

  walk(targetDir);

  // Sort artifacts by modification time descending (newest first)
  artifacts.sort((a, b) => (a.modified > b.modified ? -1 : a.modified < b.modified ? 1 : 0));
  return artifacts;
}

/**
 * Format numerical bytes into readable format
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format a quota percentage for display in the table
 * @param {number|string|null|undefined} val 
 * @returns {string}
 */
function formatQuotaVal(val) {
  if (val === null || val === undefined) return 'N/A';
  const s = String(val).trim();
  if (s.endsWith('%')) return s;
  return `${s}%`;
}

/**
 * Phase 4: Generate a clean English Markdown recovery handoff document (checkpoint.md)
 * @param {object} dataOrMetadata 
 * @param {object} [quotaMetrics] 
 * @param {Array} [artifacts] 
 * @param {Array} [messages] 
 * @returns {string}
 */
function generateHandoffMarkdown(dataOrMetadata, quotaMetrics = null, artifacts = null, messages = null) {
  let meta = {};
  let quota = {};
  let artifactList = [];
  let messageList = [];

  if (dataOrMetadata && typeof dataOrMetadata === 'object') {
    if (dataOrMetadata.metadata || dataOrMetadata.conversation_id) {
      meta = dataOrMetadata.metadata || dataOrMetadata;
      quota = dataOrMetadata.quotaMetrics || dataOrMetadata.quota_at_pause || meta.quota_at_pause || {};
      artifactList = dataOrMetadata.artifacts || [];
      messageList = dataOrMetadata.transcript || dataOrMetadata.messages || [];
    } else {
      meta = dataOrMetadata;
      quota = quotaMetrics || meta.quota_at_pause || {};
      artifactList = artifacts || [];
      messageList = messages || [];
    }
  }

  const conversationId = meta.conversation_id || 'unknown';
  const title = meta.title || 'Untitled Conversation';
  const modelName = (meta.active_model && meta.active_model.name) || meta.activeModel || 'unknown';
  const modelCategory = (meta.active_model && meta.active_model.category) || classifyModel(modelName);
  const accountEmail = meta.account_email || quota.account_email || 'unknown';
  const createdAt = meta.created_at || new Date().toISOString();

  // Normalize quota values
  const g5h = formatQuotaVal(quota.gemini_5h);
  const gWeekly = formatQuotaVal(quota.gemini_weekly);
  const gReset = quota.gemini_reset || 'N/A';

  const c5h = formatQuotaVal(quota.claude_5h);
  const cWeekly = formatQuotaVal(quota.claude_weekly);
  const cReset = quota.claude_reset || 'N/A';

  const sections = [];

  // Header & Session Metadata
  sections.push([
    '# 📋 Conversation Recovery Document (Quota Guard Checkpoint)',
    '',
    '> ⚠️ **Automatic Safety Pause**: This recovery checkpoint was generated by Antigravity Quota Guard',
    '> when remaining AI quota reached the safety stop threshold.',
    '> Please review the context below and resume task execution seamlessly.',
    '',
    '## Session Metadata',
    `- **Created At:** ${createdAt}`,
    `- **Conversation ID:** \`${conversationId}\``,
    `- **Title:** ${title}`,
    `- **Active Model:** ${modelName} (${modelCategory})`,
    `- **Account:** \`${accountEmail}\``
  ].join('\n'));

  // Quota Status Table
  sections.push([
    '## Quota Status at Pause',
    '| Model Bucket | 5-Hour Rolling Limit | Weekly Limit | 5-Hour Reset Time |',
    '|:---|:---|:---|:---|',
    `| **Gemini Models** | ${g5h} | ${gWeekly} | ${gReset} |`,
    `| **Claude / GPT Models** | ${c5h} | ${cWeekly} | ${cReset} |`
  ].join('\n'));

  // Active Artifacts Table
  if (artifactList && artifactList.length > 0) {
    const rows = artifactList.map(a => {
      const sizeStr = formatBytes(a.size_bytes);
      return `| \`${a.name}\` | \`${a.relative_path}\` | ${sizeStr} (${a.size_bytes} bytes) | ${a.modified} |`;
    });
    sections.push([
      '## Active Artifacts Inventory',
      '| Filename | Relative Path | Size | Last Modified |',
      '|:---|:---|:---|:---|',
      ...rows
    ].join('\n'));
  } else {
    sections.push([
      '## Active Artifacts Inventory',
      '_No active markdown artifacts found in the conversation workspace._'
    ].join('\n'));
  }

  // Recent Dialogue Messages
  if (messageList && messageList.length > 0) {
    const formattedMsgs = messageList.map(m => {
      const isUser = m.role === 'user';
      const icon = isUser ? '👤' : '🤖';
      const label = isUser ? 'User' : 'Assistant';
      const timeStr = m.timestamp ? ` (${m.timestamp})` : '';
      return [
        `### ${icon} ${label}${timeStr}`,
        '```',
        m.content,
        '```'
      ].join('\n');
    });

    sections.push([
      '## Recent Conversation Transcript (Last 5 Turns)',
      ...formattedMsgs
    ].join('\n\n'));
  } else {
    sections.push([
      '## Recent Conversation Transcript',
      '_No recent messages found in transcript._'
    ].join('\n'));
  }

  // Step-by-Step Resume Instructions
  sections.push([
    '---',
    '',
    '## Resume Instructions for Successor Agent',
    '1. **Context Recovery**: Review the session title, active model, and the recent conversation turns above to understand the current task state.',
    '2. **Artifact Verification**: Inspect the workspace artifacts listed in the inventory above to verify what was already generated or completed.',
    '3. **Execution Continuity**: Resume the task from the last incomplete step. Do NOT repeat actions that have already produced verified artifacts.',
    '4. **Account & Quota Status**: The previous session was paused to protect against quota exhaustion. You are running with fresh or replenished quota.'
  ].join('\n'));

  return sections.join('\n\n') + '\n';
}

/**
 * Phase 5: Atomically save content to target file via temporary file and fs.renameSync
 * @param {string} filepath 
 * @param {string} content 
 * @returns {string}
 */
function saveCheckpointAtomic(filepath, content) {
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${filepath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filepath);
  return filepath;
}

/**
 * Phase 5: Automatically prune old checkpoints in directory to maintain max retention limit (default 10)
 * Deletes corresponding pair of .json and .md files for oldest checkpoints.
 * @param {string} checkpointsDir 
 * @param {number} [maxRetention] 
 * @returns {string[]} List of deleted file paths
 */
function pruneCheckpoints(checkpointsDir = DEFAULT_CHECKPOINTS_DIR, maxRetention = MAX_CHECKPOINTS) {
  if (!fs.existsSync(checkpointsDir)) return [];

  const limit = typeof maxRetention === 'number' && maxRetention > 0 ? maxRetention : MAX_CHECKPOINTS;
  let entries;
  try {
    entries = fs.readdirSync(checkpointsDir);
  } catch (_) {
    return [];
  }

  // Find all checkpoint-*.json files sorted descending (newest first)
  const jsonFiles = entries
    .filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'))
    .sort()
    .reverse();

  const deleted = [];

  if (jsonFiles.length > limit) {
    const toRemove = jsonFiles.slice(limit);
    for (const jsonFile of toRemove) {
      const jsonPath = path.join(checkpointsDir, jsonFile);
      const mdPath = path.join(checkpointsDir, jsonFile.replace(/\.json$/, '.md'));

      try {
        if (fs.existsSync(jsonPath)) {
          fs.unlinkSync(jsonPath);
          deleted.push(jsonPath);
        }
      } catch (_) {}

      try {
        if (fs.existsSync(mdPath)) {
          fs.unlinkSync(mdPath);
          deleted.push(mdPath);
        }
      } catch (_) {}
    }
  }

  // Also prune any orphaned excess .md checkpoints
  const mdFiles = entries
    .filter(f => f.startsWith('checkpoint-') && f.endsWith('.md'))
    .sort()
    .reverse();

  if (mdFiles.length > limit) {
    const toRemoveMd = mdFiles.slice(limit);
    for (const mdFile of toRemoveMd) {
      const mdPath = path.join(checkpointsDir, mdFile);
      try {
        if (fs.existsSync(mdPath)) {
          fs.unlinkSync(mdPath);
          deleted.push(mdPath);
        }
      } catch (_) {}
    }
  }

  return deleted;
}

/**
 * Phase 6: Compute SHA-256 digest of pre-hash checkpoint payload and verify on-disk integrity
 * @param {string|object} filepathOrObject 
 * @param {string} [expectedDigest] 
 * @returns {boolean}
 */
function verifyChecksum(filepathOrObject, expectedDigest = null) {
  let data;
  let targetDigest = expectedDigest;

  if (typeof filepathOrObject === 'string') {
    if (!fs.existsSync(filepathOrObject)) {
      return false;
    }
    const rawContent = fs.readFileSync(filepathOrObject, 'utf8');
    try {
      data = JSON.parse(rawContent);
    } catch (_) {
      // Non-JSON file fallback: direct file content SHA-256 check
      if (targetDigest) {
        const rawHash = crypto.createHash('sha256').update(rawContent).digest('hex');
        return rawHash.toLowerCase() === targetDigest.toLowerCase();
      }
      return false;
    }
  } else if (filepathOrObject && typeof filepathOrObject === 'object') {
    data = JSON.parse(JSON.stringify(filepathOrObject));
  } else {
    return false;
  }

  if (!targetDigest && data.integrity_sha256) {
    targetDigest = data.integrity_sha256;
  }

  if (!targetDigest || typeof targetDigest !== 'string' || targetDigest.length !== 64) {
    return false;
  }

  // Remove recorded digest prior to re-computing SHA-256
  delete data.integrity_sha256;
  const preHashStr = JSON.stringify(data, null, 2);
  const recomputed = crypto.createHash('sha256').update(preHashStr).digest('hex');

  return recomputed.toLowerCase() === targetDigest.toLowerCase();
}

/**
 * List all saved checkpoints in the checkpoints directory
 * @param {string} [checkpointsDir] 
 * @returns {Array<{ filename: string, path: string, conversation_id: string, title: string, model: string, created_at: string, account: string, integrity_sha256: string|null }>}
 */
function listCheckpoints(checkpointsDir = DEFAULT_CHECKPOINTS_DIR) {
  if (!fs.existsSync(checkpointsDir)) return [];

  let files;
  try {
    files = fs.readdirSync(checkpointsDir)
      .filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'))
      .sort()
      .reverse();
  } catch (_) {
    return [];
  }

  const results = [];
  for (const file of files) {
    try {
      const fullPath = path.join(checkpointsDir, file);
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      results.push({
        filename: file,
        path: fullPath,
        conversation_id: data.conversation_id || 'unknown',
        title: data.title || 'Untitled Conversation',
        model: (data.active_model && data.active_model.name) || 'unknown',
        created_at: data.created_at || 'unknown',
        account: data.account_email || 'unknown',
        integrity_sha256: data.integrity_sha256 || null
      });
    } catch (_) {}
  }
  return results;
}

/**
 * Read the companion Markdown recovery document for a checkpoint
 * @param {string} filenameOrPath 
 * @param {string} [checkpointsDir] 
 * @returns {string}
 */
function readCheckpointHandoff(filenameOrPath, checkpointsDir = DEFAULT_CHECKPOINTS_DIR) {
  let targetPath = filenameOrPath;
  if (!path.isAbsolute(targetPath)) {
    targetPath = path.join(checkpointsDir, targetPath);
  }

  if (targetPath.endsWith('.json')) {
    targetPath = targetPath.replace(/\.json$/, '.md');
  }

  if (fs.existsSync(targetPath)) {
    try {
      return fs.readFileSync(targetPath, 'utf8');
    } catch (_) {}
  }

  // Fallback: extract from companion JSON if available
  const jsonPath = targetPath.replace(/\.md$/, '.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      return data.handoff_document || data.handoff_markdown || '';
    } catch (_) {}
  }

  return '';
}

/**
 * Complete 6-phase durable snapshot pipeline
 * 
 * @param {object} options
 * @param {string} [options.conversationId] Active conversation UUID
 * @param {string} [options.activeModel] Active model name
 * @param {object} [options.quotaMetrics] Dual-bucket quota metrics object
 * @param {string} [options.checkpointsDir] Custom destination directory
 * @param {function} [options.onProgress] Progress callback
 * @param {number} [options.delayMs] Optional inter-phase delay in ms (default: 0)
 * @param {function} [maybeOnProgress] Optional progress callback when passed as 2nd arg
 * @param {object} [maybeOptions] Optional options when passed as 3rd arg
 * @returns {Promise<{ success: boolean, checkpointPath: string, markdownPath: string, digest: string, checkpoint: object }>}
 */
async function createSnapshot(options = {}, maybeOnProgress = null, maybeOptions = {}) {
  let opts = {};
  let progressFn = () => {};

  if (options && typeof options === 'object') {
    opts = { ...options };
    if (typeof options.onProgress === 'function') {
      progressFn = options.onProgress;
    }
  }

  if (typeof maybeOnProgress === 'function') {
    progressFn = maybeOnProgress;
  } else if (maybeOnProgress && typeof maybeOnProgress === 'object') {
    opts = { ...opts, ...maybeOnProgress };
  }

  if (maybeOptions && typeof maybeOptions === 'object') {
    opts = { ...opts, ...maybeOptions };
  }

  function report(phase, percent, message, extra = {}) {
    const payload = { phase, percent, pct: percent, message, statusMsg: message, ...extra };
    if (typeof progressFn === 'function') {
      try {
        if (progressFn.length >= 2) {
          progressFn(phase, percent, message, payload);
        } else {
          progressFn(payload);
        }
      } catch (_) {}
    }
  }

  const delayMs = typeof opts.delayMs === 'number' ? Math.max(0, opts.delayMs) : 0;
  async function yieldStep() {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  const checkpointsDir = opts.checkpointsDir || DEFAULT_CHECKPOINTS_DIR;
  const conversationId = opts.conversationId || opts.conversation_id || null;
  const activeModel = opts.activeModel || opts.model || 'unknown';
  const quotaMetrics = opts.quotaMetrics || opts.quotaData || {};

  try {
    // Phase 1: Metadata Collection (15%)
    report(1, 15, 'Collecting session metadata...');
    await yieldStep();

    const metadata = extractConversationMetadata(conversationId, {
      dbPath: opts.dbPath,
      activeModel,
      quotaMetrics,
      accountEmail: opts.accountEmail || opts.email
    });

    const resolvedId = metadata.conversation_id || 'unknown';

    // Phase 2: Transcript Extraction (35%)
    report(2, 35, 'Extracting conversation transcript...');
    await yieldStep();

    const transcriptMessages = extractTranscriptMessages(resolvedId, 5, {
      brainDir: opts.brainDir,
      transcriptPath: opts.transcriptPath,
      maxChars: opts.maxChars || MAX_MSG_CHARS
    });

    // Phase 3: Artifact Inventory (55%)
    report(3, 55, 'Scanning active artifacts...');
    await yieldStep();

    const activeArtifacts = scanActiveArtifacts(resolvedId, {
      brainDir: opts.brainDir,
      artifactsDir: opts.artifactsDir
    });

    // Phase 4: Handoff Document Generation (75%)
    const handoffMarkdown = generateHandoffMarkdown({
      metadata,
      quotaMetrics: metadata.quota_at_pause,
      artifacts: activeArtifacts,
      transcript: transcriptMessages
    });

    report(4, 75, 'Generating recovery handoff document...', { markdown: handoffMarkdown });
    await yieldStep();

    // Phase 5: Atomic Serialization & Auto-Pruning (90%)
    report(5, 90, 'Serializing checkpoint & pruning history...');
    await yieldStep();

    if (!fs.existsSync(checkpointsDir)) {
      fs.mkdirSync(checkpointsDir, { recursive: true });
    }
    migrateLegacyCheckpoints(checkpointsDir);

    const timestamp = new Date().toISOString();
    const tsFileSafe = timestamp.replace(/[:.]/g, '-');
    const shortId = (resolvedId && resolvedId !== 'unknown') ? resolvedId.slice(0, 8) : 'session';
    const filenameBase = `checkpoint-${tsFileSafe}-${shortId}`;
    const checkpointPath = path.join(checkpointsDir, `${filenameBase}.json`);
    const markdownPath = path.join(checkpointsDir, `${filenameBase}.md`);

    // Structured JSON checkpoint payload
    const checkpointData = {
      version: '1.0.0',
      created_at: timestamp,
      conversation_id: resolvedId,
      title: metadata.title,
      active_model: metadata.active_model,
      account_email: metadata.account_email,
      quota_at_pause: metadata.quota_at_pause,
      artifacts: activeArtifacts,
      transcript: transcriptMessages,
      handoff_document: handoffMarkdown,
      handoff_markdown: handoffMarkdown
    };

    // Compute SHA-256 digest of serialized payload prior to setting integrity_sha256
    const preHashString = JSON.stringify(checkpointData, null, 2);
    const digest = crypto.createHash('sha256').update(preHashString).digest('hex');
    checkpointData.integrity_sha256 = digest;

    // Atomically persist JSON and companion Markdown
    saveCheckpointAtomic(checkpointPath, JSON.stringify(checkpointData, null, 2));
    saveCheckpointAtomic(markdownPath, handoffMarkdown);

    // Auto-prune old checkpoints to retention ceiling
    pruneCheckpoints(checkpointsDir, opts.maxRetention || MAX_CHECKPOINTS);

    // Phase 6: Cryptographic Verification (100%)
    const isIntegrityValid = verifyChecksum(checkpointPath, digest);
    if (!isIntegrityValid) {
      throw new Error(`Cryptographic integrity verification failed for checkpoint: ${checkpointPath}`);
    }

    report(6, 100, 'Verified cryptographic integrity.', {
      digest,
      checkpoint: checkpointData,
      checkpointPath,
      markdownPath
    });

    return {
      success: true,
      checkpointPath,
      markdownPath,
      digest,
      checkpoint: checkpointData
    };
  } catch (err) {
    if (opts.throwOnError) {
      throw err;
    }
    return {
      success: false,
      error: err.message,
      checkpointPath: null,
      markdownPath: null,
      digest: null,
      checkpoint: null
    };
  }
}

module.exports = {
  // Primary exports
  createSnapshot,
  extractConversationMetadata,
  extractTranscriptMessages,
  scanActiveArtifacts,
  generateHandoffMarkdown,
  saveCheckpointAtomic,
  pruneCheckpoints,
  verifyChecksum,

  // Aliases & helper exports
  readConversationTitle,
  extractLastMessages: extractTranscriptMessages,
  listConversationArtifacts: scanActiveArtifacts,
  generateHandoffDocument: generateHandoffMarkdown,
  writeCheckpoint: saveCheckpointAtomic,
  pruneOldCheckpoints: pruneCheckpoints,
  verifyCheckpoint: verifyChecksum,
  listCheckpoints,
  readCheckpointHandoff,
  classifyModel,
  normalizeQuotaMetrics,

  // Constants
  DEFAULT_CHECKPOINTS_DIR,
  CHECKPOINTS_DIR,
  MAX_CHECKPOINTS,
  MAX_MSG_CHARS,
  TRANSCRIPT_CHUNK_SIZE
};
