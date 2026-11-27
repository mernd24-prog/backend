const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../src/shared/middleware/authenticate.js');
const realRequire = createRequire(file);
function fixture({ roleError, userError, role = { active: true }, user = { role: 'admin', accountStatus: 'active' }, payload = { sub: 'admin-id', role: 'admin' } } = {}) {
  const module = { exports: {} };
  const mockedRequire = name => {
    if (name === 'jsonwebtoken') return { verify: () => payload };
    if (name.endsWith('/config/env')) return { env: {} };
    if (name.endsWith('/user/models/user.model')) return { UserModel: { findById: () => ({ select() { return this; }, lean: async () => { if (userError) throw userError; return user; } }) } };
    if (name.endsWith('/referral/models/referral.model')) return {};
    if (name.endsWith('/services/rbac.service')) return { RbacService: class { async getUserEffectivePermissions() { return []; } } };
    if (name.endsWith('/sequelize/models')) return { Role: { findOne: async () => { if (roleError) throw roleError; return role; } } };
    if (name.endsWith('/seller-organization.repository')) return { SellerOrganizationRepository: class {} };
    return realRequire(name);
  };
  vm.runInNewContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', {})(mockedRequire, module, module.exports);
  return async () => {
    const req = { headers: { authorization: 'Bearer valid-token' }, originalUrl: '/api/v1/orders' };
    let result;
    await module.exports.authenticate(req, { setHeader() {} }, error => { result = error; });
    return { error: result, auth: req.auth };
  };
}
for (const field of ['roleError', 'userError']) {
  test(`${field}: database outage denies request with 503 instead of invalidating login`, async () => {
    const cause = new Error('database unavailable');
    const { error, auth } = await fixture({ [field]: cause })();
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, 'AUTH_SERVICE_UNAVAILABLE');
    assert.equal(error.cause, cause);
    assert.equal(auth, undefined);
  });
}
test('actual role mismatch still forces reauthentication', async () => {
  const { error } = await fixture({ user: { role: 'sub-admin', accountStatus: 'active' } })();
  assert.equal(error.code, 'ROLE_CHANGED');
  assert.equal(error.statusCode, 401);
});
test('missing role still denies authentication', async () => {
  const { error } = await fixture({ role: null })();
  assert.equal(error.code, 'ROLE_CHANGED');
});
test('inactive role still denies authentication', async () => {
  const { error } = await fixture({ role: { active: false } })();
  assert.equal(error.code, 'ROLE_INACTIVE');
});
test('healthy account remains authenticated', async () => {
  const { error, auth } = await fixture()();
  assert.equal(error, undefined);
  assert.equal(auth.role, 'admin');
});
