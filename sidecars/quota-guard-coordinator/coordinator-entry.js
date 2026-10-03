#!/usr/bin/env node
'use strict';

/**
 * Antigravity Quota Guard — Sidecar Coordinator Entry
 * Started by Antigravity as a managed sidecar process.
 * Starts the GlobalCoordinator via the V2.2 runtime.
 */

const path = require('path');
const { getRuntime } = require('../../bin/v2-runtime.js');

const runtime = getRuntime();

runtime.startCoordinator().then((coord) => {
  process.stderr.write(`[Sidecar] Coordinator started. Socket: ${coord.socketPath}\n`);
  // Stay alive until SIGTERM or SIGINT
  process.on('SIGTERM', () => {
    coord.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  });
  process.on('SIGINT', () => {
    coord.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}).catch((err) => {
  process.stderr.write(`[Sidecar] Coordinator failed to start: ${err.message}\n`);
  process.exit(1);
});
