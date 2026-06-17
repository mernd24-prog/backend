#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const qaModules = [
  'sellers',
  'products',
  'customers',
  'inventory',
  'orders',
  'analytics',
  'notifications',
  'search',
];

const masterSeed = path.resolve(__dirname, '../seed/master-seed.js');
const reset = process.argv.includes('--reset');
let failed = 0;

for (const moduleName of qaModules) {
  const args = [masterSeed, moduleName];
  if (reset) args.push('--reset');

  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`QA seed module failed: ${moduleName}\n`);
  }
}

if (failed) {
  process.stderr.write(`Commerce QA seed completed with ${failed} failed module(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Commerce QA seed completed.\n');
}
