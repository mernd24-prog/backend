#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const modules = [
  'countries',
  'locations',
  'categories',
  'brands',
  'attributes',
  'options',
  'families',
  'gst',
  'hsn',
  'tax-classes',
  'commissions',
  'platform-fees',
  'badges',
  'tags',
  'collections',
  'sellers',
  'warehouses',
  'products',
  'variants',
  'inventory',
  'customers',
  'orders',
  'reviews',
  'recommendations',
  'analytics',
  'search',
  'notifications',
];

runModules(modules);

function runModules(moduleNames) {
  const reset = process.argv.includes('--reset');
  const stopOnError = process.argv.includes('--stop-on-error');
  const masterSeed = path.resolve(__dirname, '../seed/master-seed.js');
  let failed = 0;

  for (const moduleName of moduleNames) {
    const args = [masterSeed, moduleName];
    if (reset) args.push('--reset');
    if (stopOnError) args.push('--stop-on-error');

    const result = spawnSync(process.execPath, args, {
      stdio: 'inherit',
      env: process.env,
    });

    if (result.status !== 0) {
      failed += 1;
      process.stderr.write(`Commerce seed module failed: ${moduleName}\n`);
      if (stopOnError) break;
    }
  }

  if (failed) {
    process.stderr.write(`Commerce demo seed completed with ${failed} failed module(s).\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('Commerce demo seed completed.\n');
}
