const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/shared/logger/logger.js'), 'utf8');
function run(nodeEnv, setting, installed) {
  let transports = 0;
  const pino = () => ({ warn() {} });
  pino.transport = options => { transports++; assert.equal(options.target, '/test/pino-pretty.js'); return {}; };
  const mockRequire = name => name === 'pino' ? pino : { env: { nodeEnv, appName: 'test' } };
  mockRequire.resolve = () => {
    if (installed) return '/test/pino-pretty.js';
    const error = new Error('Not installed'); error.code = 'MODULE_NOT_FOUND'; throw error;
  };
  const context = { require: mockRequire, process: { env: { LOG_PRETTY: setting } }, module: { exports: {} } };
  vm.runInNewContext(source, context);
  assert.ok(context.module.exports.logger);
  return transports;
}
assert.equal(run('development', '', false), 0);
assert.equal(run('production', 'true', false), 0);
assert.equal(run('development', 'false', true), 0);
assert.equal(run('production', '', true), 0);
assert.equal(run('development', '', true), 1);
console.log('Logger startup checks passed: optional dependency absent, explicit disable, production JSON, development pretty.');
