'use strict';

/**
 * Phase 0 Gate Test: Official Plugin Package Layout & Manifest Conformance
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

describe('Phase 0: Official Plugin Package Layout & Conformance', () => {

  it('0.1 plugin.json exists, is valid JSON, conforms to official schema', () => {
    const pluginPath = path.join(ROOT_DIR, 'plugin.json');
    assert.ok(fs.existsSync(pluginPath), 'plugin.json must exist at package root');
    const content = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
    // Official schema: only $schema, name, description (additionalProperties: false)
    assert.strictEqual(content.name, 'antigravity-quota-guard', 'plugin.json must have correct name');
    assert.ok(typeof content.description === 'string', 'plugin.json must have description');
    // Fields NOT allowed in official schema:
    assert.strictEqual(content.version, undefined, 'version must NOT be in plugin.json (not in official schema)');
    assert.strictEqual(content.capabilities, undefined, 'capabilities must NOT be in plugin.json (not in official schema)');
    assert.strictEqual(content.hooks, undefined, 'hooks must NOT be inlined in plugin.json');
    assert.strictEqual(content.mcpServers, undefined, 'mcpServers must NOT be inlined in plugin.json');
  });

  it('0.2 hooks.json defines the 4 official hooks (PreInvocation, PostInvocation, PreToolUse, Stop)', () => {
    const hooksPath = path.join(ROOT_DIR, 'hooks.json');
    assert.ok(fs.existsSync(hooksPath), 'hooks.json must exist at package root');
    const content = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    // Official format: top-level group name -> { PreInvocation, PostInvocation, PreToolUse, Stop }
    const groups = Object.values(content);
    assert.ok(groups.length > 0, 'hooks.json must have at least one hook group');
    const group = groups[0];
    assert.ok(group.PreInvocation, 'hooks.json group must include PreInvocation');
    assert.ok(group.PostInvocation, 'hooks.json group must include PostInvocation');
    assert.ok(group.PreToolUse, 'hooks.json group must include PreToolUse');
    assert.ok(group.Stop, 'hooks.json group must include Stop');
    // All flat handlers must be command-based
    const flatHandlers = [...(group.PreInvocation || []), ...(group.PostInvocation || []), ...(group.Stop || [])];
    assert.ok(flatHandlers.every(h => h.type === 'command'), 'All hook handlers must use type: "command"');
  });

  it('0.3 mcp_config.json defines read-only quota_guard server', () => {
    const mcpPath = path.join(ROOT_DIR, 'mcp_config.json');
    assert.ok(fs.existsSync(mcpPath), 'mcp_config.json must exist at package root');
    const content = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(content.mcpServers && content.mcpServers.quota_guard);
    assert.strictEqual(content.mcpServers.quota_guard.command, 'node');
    assert.ok(content.mcpServers.quota_guard.args.includes('mcp/read-only-server.js'));
  });

  it('0.4 skills/recovery-skill/SKILL.md exists with valid YAML frontmatter', () => {
    const skillPath = path.join(ROOT_DIR, 'skills', 'recovery-skill', 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), 'SKILL.md must exist in skills/recovery-skill');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.ok(content.startsWith('---'));
    assert.ok(content.includes('name: quota-guard-recovery'));
  });

  it('0.5 sidecars manifest defines coordinator daemon lifecycle (official schema)', () => {
    const sidecarPath = path.join(ROOT_DIR, 'sidecars', 'quota-guard-coordinator', 'sidecar.json');
    assert.ok(fs.existsSync(sidecarPath), 'sidecar.json must exist');
    const content = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    // Official Antigravity sidecar.json schema: command/args/restart_policy (snake_case)
    // Name is derived from directory — NOT a field in the JSON itself
    assert.ok(typeof content.command === 'string', 'sidecar.json must have "command" field');
    assert.ok(Array.isArray(content.args), 'sidecar.json must have "args" array');
    // No docker-style fields
    assert.strictEqual(content.entrypoint, undefined, 'No "entrypoint" field (invalid in official schema)');
    assert.strictEqual(content.name, undefined, 'No "name" field (derived from directory)');
    assert.strictEqual(content.ipc, undefined, 'No "ipc" field (not in official schema)');
    if (content.restart_policy) {
      assert.ok(['always', 'on-failure', 'never'].includes(content.restart_policy),
        'restart_policy must be valid');
    }
  });

  it('0.6 All required package directories exist', () => {
    const requiredDirs = [
      'core', 'auth', 'providers', 'mcp', 'skills', 'sidecars',
      'tools', 'platform', 'ui', 'installer', 'integrations', 'docs'
    ];
    for (const d of requiredDirs) {
      assert.ok(fs.existsSync(path.join(ROOT_DIR, d)), `Directory ${d} must exist`);
    }
  });

});
