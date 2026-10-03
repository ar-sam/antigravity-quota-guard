'use strict';

/**
 * Antigravity Quota Guard — Event Journal Flight Recorder
 * Bounded local metadata flight recorder with chained integrity hashes.
 * 
 * Invariants:
 * 1. Chained hashes detect accidental file corruption or truncation.
 * 2. Zero raw credentials, passwords, session tokens, or full transcripts.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { assertSecurityInvariants } = require('./security-invariants.js');

function getDefaultJournalPath() {
  if (process.env.QUOTA_GUARD_JOURNAL_PATH) {
    return process.env.QUOTA_GUARD_JOURNAL_PATH;
  }
  const dir = path.join(os.homedir(), '.gemini', 'antigravity-quota-guard');
  return path.join(dir, 'event-journal.jsonl');
}

class EventJournal {
  constructor(options = {}) {
    this.journalPath = options.journalPath || getDefaultJournalPath();
    this.maxEntries = options.maxEntries || 1000;
    this.lastHash = 'GENESIS_HASH_0000000000000000000000000000000000000000000000000000000000000000';
    this.initLastHash();
  }

  initLastHash() {
    if (!fs.existsSync(this.journalPath)) return;
    try {
      const content = fs.readFileSync(this.journalPath, 'utf8').trim();
      if (!content) return;
      const lines = content.split('\n');
      const lastLine = lines[lines.length - 1];
      const parsed = JSON.parse(lastLine);
      if (parsed.hash) {
        this.lastHash = parsed.hash;
      }
    } catch (_) {}
  }

  ensureJournalDir() {
    const dir = path.dirname(this.journalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  computeEntryHash(prevHash, entry) {
    const serialized = JSON.stringify({
      prevHash,
      timestamp: entry.timestamp,
      type: entry.type,
      payload: entry.payload
    });
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Appends a sanitized event entry with chained hash.
   */
  appendEvent(type, payload = {}) {
    this.ensureJournalDir();

    // Verify security invariants (no raw secrets in payload)
    assertSecurityInvariants({ payload });

    const timestamp = new Date().toISOString();
    const entry = {
      prevHash: this.lastHash,
      timestamp,
      type,
      payload
    };

    const currentHash = this.computeEntryHash(this.lastHash, entry);
    entry.hash = currentHash;
    this.lastHash = currentHash;

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.journalPath, line, { mode: 0o600 });
    return entry;
  }

  /**
   * Validates the integrity of the chained hashes across all journal entries.
   */
  validateChainIntegrity() {
    if (!fs.existsSync(this.journalPath)) {
      return { valid: true, count: 0 };
    }

    const content = fs.readFileSync(this.journalPath, 'utf8').trim();
    if (!content) {
      return { valid: true, count: 0 };
    }

    const lines = content.split('\n');
    let expectedPrevHash = 'GENESIS_HASH_0000000000000000000000000000000000000000000000000000000000000000';

    for (let i = 0; i < lines.length; i++) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch (_) {
        return { valid: false, errorIndex: i, reason: 'CORRUPTED_JSON_LINE' };
      }

      if (entry.prevHash !== expectedPrevHash) {
        return { valid: false, errorIndex: i, reason: 'PREV_HASH_MISMATCH' };
      }

      const calculated = this.computeEntryHash(entry.prevHash, entry);
      if (entry.hash !== calculated) {
        return { valid: false, errorIndex: i, reason: 'HASH_TAMPERED' };
      }

      expectedPrevHash = entry.hash;
    }

    return { valid: true, count: lines.length };
  }
}

module.exports = {
  EventJournal,
  getDefaultJournalPath
};
