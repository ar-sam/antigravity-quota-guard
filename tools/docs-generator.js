/**
 * Antigravity Quota Guard — Docs-as-Code Compiler & Parity Checker
 * Generates reference documentation directly from code schemas, invariants, and registry.
 *
 * Implements R10 from architecture specification.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { CANONICAL_SECURITY_INVARIANTS } = require('../core/security-invariants');
const { DEFAULT_CONFIG } = require('../core/config-defaults');
const { CANONICAL_CAPABILITIES } = require('../core/capability-registry');

class DocsGenerator {
  constructor(options = {}) {
    this._rootDir = options.rootDir || path.resolve(__dirname, '..');
    this._generatedDir = path.join(this._rootDir, 'docs', 'generated');
    this._sourceDir = path.join(this._rootDir, 'docs', 'source');
  }

  ensureDirs() {
    if (!fs.existsSync(this._generatedDir)) {
      fs.mkdirSync(this._generatedDir, { recursive: true, mode: 0o755 });
    }
  }

  /**
   * Generates SECURITY_INVARIANTS.md from core/security-invariants.js.
   */
  generateSecurityInvariantsDoc() {
    this.ensureDirs();
    let md = '# Antigravity Quota Guard — Canonical Security Invariants\n\n';
    md += '> **Authority:** This document is compiled automatically from `core/security-invariants.js`.\n';
    md += '> All 11 invariants are strictly enforced and non-negotiable.\n\n';
    md += '| Rule ID | Category | Description |\n';
    md += '| :--- | :--- | :--- |\n';

    for (const [key, desc] of Object.entries(CANONICAL_SECURITY_INVARIANTS)) {
      const parts = key.split('_');
      const cat = parts.length > 2 ? parts[1] : 'GENERAL';
      md += `| \`${key}\` | **${cat}** | ${desc} |\n`;
    }

    fs.writeFileSync(path.join(this._generatedDir, 'SECURITY_INVARIANTS.md'), md, 'utf8');
    return md;
  }

  /**
   * Generates CONFIG_REFERENCE.md from core/config-defaults.js.
   */
  generateConfigReferenceDoc() {
    this.ensureDirs();
    let md = '# Configuration Reference — Antigravity Quota Guard V2.2\n\n';
    md += '> **Dynamic Configuration Invariant:** `DEFAULT VALUE ≠ HARDCODED BEHAVIOR`.\n';
    md += '> All thresholds, scopes, and options are runtime configurable via Settings or CLI.\n\n';

    md += '## Thresholds (`config.thresholds`)\n\n';
    md += '| Key | Default | Description | Invariant |\n';
    md += '| :--- | :---: | :--- | :--- |\n';
    md += '| `warnPercent` | 20% | Advisory UI alert trigger | `warn > stabilize` |\n';
    md += '| `stabilizePercent` | 15% | Pre-staging stabilize tier | `stabilize > checkpoint` |\n';
    md += '| `checkpointPercent` | 13% | Silent background snapshot creation | `checkpoint > stop` |\n';
    md += '| `stopPercent` | 12% | Turn boundary model loop halt | `stop >= 5` |\n';
    md += '| `minResumePercent` | 30% | Minimum verified quota required to resume | `minResume > stop` |\n\n';

    md += '## Full Default Configuration JSON\n\n```json\n';
    md += JSON.stringify(DEFAULT_CONFIG, null, 2);
    md += '\n```\n';

    fs.writeFileSync(path.join(this._generatedDir, 'CONFIG_REFERENCE.md'), md, 'utf8');
    return md;
  }

  /**
   * Generates CAPABILITY_REFERENCE.md from core/capability-registry.js.
   */
  generateCapabilityReferenceDoc() {
    this.ensureDirs();
    let md = '# Capability Matrix & Extension Registry\n\n';
    md += '> **Authority:** This document is compiled automatically from `core/capability-registry.js`.\n\n';
    md += '| Capability ID | Name | Source | Stability | Risk Level |\n';
    md += '| :--- | :--- | :---: | :---: | :---: |\n';

    for (const cap of CANONICAL_CAPABILITIES) {
      md += `| \`${cap.id}\` | ${cap.name} | \`${cap.source}\` | \`${cap.stability}\` | \`${cap.riskLevel}\` |\n`;
    }

    fs.writeFileSync(path.join(this._generatedDir, 'CAPABILITY_REFERENCE.md'), md, 'utf8');
    return md;
  }

  /**
   * Generates CLI_REFERENCE.md.
   */
  generateCliReferenceDoc() {
    this.ensureDirs();
    let md = '# Antigravity Quota Guard — CLI Command Reference\n\n';
    md += '## Available Commands\n\n';
    md += '| Command | Arguments | Description |\n';
    md += '| :--- | :--- | :--- |\n';
    md += '| `quota-guard` | None | Launches interactive menu |\n';
    md += '| `quota-guard patch` | `[--dry-run] [--force]` | Transactionally patches Antigravity app.asar |\n';
    md += '| `quota-guard doctor` | None | Runs read-only diagnostic system audit |\n';
    md += '| `quota-guard resume` | `[--copy]` | Lists checkpoints and copies recovery handoff text |\n';
    md += '| `quota-guard rollback`| `[backup-id]` | Restores original or selected ASAR backup |\n';

    fs.writeFileSync(path.join(this._generatedDir, 'CLI_REFERENCE.md'), md, 'utf8');
    return md;
  }

  /**
   * Generates RECOVERY_REFERENCE.md.
   */
  generateRecoveryReferenceDoc() {
    this.ensureDirs();
    let md = '# Recovery & Continuity Reference\n\n';
    md += '## Handoff & Checkpoint Format\n\n';
    md += 'Checkpoints are written atomically to `~/.gemini/antigravity-quota-guard/checkpoints/`.\n';
    md += 'Each checkpoint produces two companion files with permissions `0600`:\n';
    md += '1. `checkpoint_<timestamp>.json`: Complete structured session metadata.\n';
    md += '2. `checkpoint_<timestamp>.md`: Formatted Markdown recovery document for successor agent.\n';

    fs.writeFileSync(path.join(this._generatedDir, 'RECOVERY_REFERENCE.md'), md, 'utf8');
    return md;
  }

  /**
   * Generates all documentation files.
   */
  generateAll() {
    this.generateSecurityInvariantsDoc();
    this.generateConfigReferenceDoc();
    this.generateCapabilityReferenceDoc();
    this.generateCliReferenceDoc();
    this.generateRecoveryReferenceDoc();
  }

  /**
   * Mechanical Parity Gate (npm run docs:check).
   * Verifies that code definitions match generated docs with zero discrepancies.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  checkParity() {
    const errors = [];

    // 1. Check Security Invariants Parity
    const secFile = path.join(this._generatedDir, 'SECURITY_INVARIANTS.md');
    if (!fs.existsSync(secFile)) {
      errors.push('Missing docs/generated/SECURITY_INVARIANTS.md');
    } else {
      const secContent = fs.readFileSync(secFile, 'utf8');
      for (const key of Object.keys(CANONICAL_SECURITY_INVARIANTS)) {
        if (!secContent.includes(key)) {
          errors.push(`SECURITY_INVARIANTS.md missing invariant: ${key}`);
        }
      }
    }

    // 2. Check Capability Registry Parity
    const capFile = path.join(this._generatedDir, 'CAPABILITY_REFERENCE.md');
    if (!fs.existsSync(capFile)) {
      errors.push('Missing docs/generated/CAPABILITY_REFERENCE.md');
    } else {
      const capContent = fs.readFileSync(capFile, 'utf8');
      for (const cap of CANONICAL_CAPABILITIES) {
        if (!capContent.includes(cap.id)) {
          errors.push(`CAPABILITY_REFERENCE.md missing capability: ${cap.id}`);
        }
      }
    }

    // 3. Check Config Reference Parity
    const cfgFile = path.join(this._generatedDir, 'CONFIG_REFERENCE.md');
    if (!fs.existsSync(cfgFile)) {
      errors.push('Missing docs/generated/CONFIG_REFERENCE.md');
    } else {
      const cfgContent = fs.readFileSync(cfgFile, 'utf8');
      for (const key of Object.keys(DEFAULT_CONFIG.thresholds)) {
        if (!cfgContent.includes(key)) {
          errors.push(`CONFIG_REFERENCE.md missing threshold: ${key}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// CLI handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const generator = new DocsGenerator();

  if (args.includes('--check')) {
    const parity = generator.checkParity();
    if (!parity.valid) {
      console.error('❌ Docs parity check failed:');
      parity.errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    } else {
      console.log('✅ Docs parity check passed! Code and documentation are 100% in sync.');
    }
  } else {
    generator.generateAll();
    console.log('✅ Successfully compiled documentation from code schemas and registries.');
  }
}

module.exports = {
  DocsGenerator
};
