'use strict';

/**
 * Phase 5 Gate Test: Durable Snapshot Engine & Flight Recorder
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { readLastLinesBufferSafe, SnapshotEngine } = require('../core/snapshot-engine.js');
const { EventJournal } = require('../core/event-journal.js');

describe('Phase 5: Durable Snapshot Engine & Flight Recorder', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-phase5-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('5.1 Byte-Level Unicode & Persian Slicing', () => {
    it('Accurately reads lines without corrupting Persian characters or emojis across chunk splits', () => {
      const logFile = path.join(tmpDir, 'transcript.jsonl');

      // Create a large multi-line JSONL file with Persian text and complex emojis
      const messages = [
        { source: 'USER', content: 'سلام دنیا! این یک پیام آزمایشی به زبان فارسی است.' },
        { source: 'MODEL', content: 'درود! متن فارسی با موفقیت پردازش شد. 🛡️⚡💎' },
        { source: 'USER', content: 'کاراکترهای ترکیبی: پـژوهـش و حروف صدادار ً ٌ ٍ' },
        { source: 'MODEL', content: 'پیام نهایی با ایموجی‌های پرچم 🇮🇷 و نشانگرهای امنیتی.' }
      ];

      const lines = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
      fs.writeFileSync(logFile, lines, 'utf8');

      const extracted = readLastLinesBufferSafe(logFile, 3, 2000);
      assert.strictEqual(extracted.length, 3);
      assert.ok(extracted[0].content.includes('درود! متن فارسی'));
      assert.ok(extracted[0].content.includes('🛡️⚡💎'));
      assert.ok(extracted[1].content.includes('پـژوهـش'));
      assert.ok(extracted[2].content.includes('پرچم 🇮🇷'));
    });
  });

  describe('5.2 Snapshot Engine & Atomic fsync Durability', () => {
    it('Creates checkpoint JSON and MD companion with permissions 0600', async () => {
      const engine = new SnapshotEngine({
        checkpointsDir: path.join(tmpDir, 'checkpoints'),
        retentionCount: 5
      });

      const res = await engine.createCheckpoint({
        conversationId: 'convo-test-1',
        modelName: 'gemini-1.5-pro',
        quotaHealth: {
          gemini: { fiveHour: 11, weekly: 70 }
        }
      });

      assert.strictEqual(res.success, true);
      assert.ok(fs.existsSync(res.jsonPath));
      assert.ok(fs.existsSync(res.mdPath));
      assert.ok(fs.existsSync(res.companionMdPath));

      const statJson = fs.statSync(res.jsonPath);
      assert.strictEqual(statJson.mode & 0o777, 0o600);
      const statMd = fs.statSync(res.mdPath);
      assert.strictEqual(statMd.mode & 0o777, 0o600);

      // Verify companion markdown contents
      const mdContent = fs.readFileSync(res.companionMdPath, 'utf8');
      assert.ok(mdContent.includes('# Quota Guard Recovery Checkpoint'));
      assert.ok(mdContent.includes('Effective Quota: 11%'));
      assert.ok(mdContent.includes('[Connected Account (Protected)]'));
    });

    it('Enforces single-flight mutex: rejects concurrent create requests', async () => {
      const engine = new SnapshotEngine({
        checkpointsDir: path.join(tmpDir, 'checkpoints')
      });

      // Simulate lock held
      engine.isCreating = true;
      const res = await engine.createCheckpoint({ conversationId: 'c2' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reason, 'CONCURRENT_SNAPSHOT_IN_PROGRESS');
      engine.isCreating = false;
    });

    it('Auto-prunes checkpoints exceeding retention limit', async () => {
      const chkDir = path.join(tmpDir, 'checkpoints');
      const engine = new SnapshotEngine({
        checkpointsDir: chkDir,
        retentionCount: 3
      });

      // Create 5 checkpoints
      for (let i = 1; i <= 5; i++) {
        await engine.createCheckpoint({ conversationId: `c-${i}` });
        // small delay to ensure distinct mtimes
        await new Promise(r => setTimeout(r, 10));
      }

      const files = fs.readdirSync(chkDir).filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'));
      assert.strictEqual(files.length, 3, 'Must prune older checkpoints to maintain retention limit of 3');
    });
  });

  describe('5.3 Event Journal Flight Recorder with Chained Hashes', () => {
    it('Records events with valid cryptographic chained hashes', () => {
      const journalPath = path.join(tmpDir, 'event-journal.jsonl');
      const journal = new EventJournal({ journalPath });

      journal.appendEvent('QUOTA_OBSERVED', { effectiveQuota: 75, source: 'cli' });
      journal.appendEvent('STATE_TRANSITION', { from: 'SAFE', to: 'WARN' });
      journal.appendEvent('CHECKPOINT_CREATED', { checkpointId: 'chk-1' });

      const check = journal.validateChainIntegrity();
      assert.strictEqual(check.valid, true);
      assert.strictEqual(check.count, 3);
    });

    it('Detects file tampering or corrupt lines in the journal', () => {
      const journalPath = path.join(tmpDir, 'event-journal.jsonl');
      const journal = new EventJournal({ journalPath });

      journal.appendEvent('EVENT_1', { data: 1 });
      journal.appendEvent('EVENT_2', { data: 2 });
      journal.appendEvent('EVENT_3', { data: 3 });

      // Tamper with middle line
      const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n');
      const middleObj = JSON.parse(lines[1]);
      middleObj.payload.data = 999; // Tampered data without updating hash
      lines[1] = JSON.stringify(middleObj);
      fs.writeFileSync(journalPath, lines.join('\n') + '\n', 'utf8');

      const check = journal.validateChainIntegrity();
      assert.strictEqual(check.valid, false, 'Must detect tampering in chained hash');
      assert.strictEqual(check.reason, 'HASH_TAMPERED');
    });
  });

});
