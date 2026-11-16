const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../src/modules/admin/services/admin.service.js');
const localRequire = createRequire(file);
function fixture() {
  const module = { exports: {} };
  const safe = ['/shared/errors/', '/shared/constants/', '/shared/auth/', '/shared/domain/'];
  const requireMock = name => {
    if (name.endsWith('/shared/tools/hash')) return { hashText: async () => 'hashed' };
    if (safe.some(part => name.includes(part))) return localRequire(name);
    return {};
  };
  vm.runInNewContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', {})(requireMock, module, module.exports);
  const api = Object.create(module.exports.AdminService.prototype);
  const created = [], grants = [], roles = [];
  api.adminRepository = { findUserByEmail: async () => null, createManagedUser: async payload => { created.push(payload); return { ...payload, id: 'new-user' }; }, updateUserById: async () => {} };
  api.rbacService = { assignRoleToUserBySlug: async (...args) => roles.push(args), syncUserModulePermissions: async (...args) => grants.push(args) };
  return { api, created, grants, roles };
}
const actor = { role: 'super-admin', isSuperAdmin: true, userId: 'owner' };
const payload = { email: 'new@example.test', password: 'password123', profile: { firstName: 'New' }, allowedModules: [], modulePermissions: [] };
test('admin can be created unassigned without synthesizing module grants', async () => {
  const { api, created, grants, roles } = fixture();
  await api.createAdmin(payload, actor);
  assert.equal(created[0].allowedModules.length, 0);
  assert.equal(grants.length, 0);
  assert.equal(roles[0][1], 'admin');
});
test('sub-admin creation supports a separate later permission assignment', async () => {
  const { api, created, grants } = fixture();
  await api.createPlatformSubAdmin({ ...payload, role: 'sub-admin' }, actor);
  assert.equal(created[0].allowedModules.length, 0);
  assert.equal(grants[0][1].length, 0);
  assert.equal(created[0].createdBy, 'owner');
  assert.equal(created[0].ownerAdminId, null);
});
test('seller creation continues to require a valid module scope', async () => {
  const { api, created } = fixture();
  await assert.rejects(api.createPlatformSubAdmin({ ...payload, role: 'seller' }, actor), /At least one valid module/);
  assert.equal(created.length, 0);
});
test('unassigned creation still enforces actor hierarchy', async () => {
  const { api, created } = fixture();
  await assert.rejects(api.createPlatformSubAdmin({ ...payload, role: 'sub-admin' }, { role: 'seller', userId: 'seller' }), /Forbidden|not allowed|cannot/i);
  assert.equal(created.length, 0);
});

test('permission display metadata hides unlinked legacy choices without dropping assigned rows', async () => {
  const { api } = fixture();
  api.adminRepository.getUserById = async () => ({ id: 'target', role: 'sub-admin', allowedModules: ['pricing', 'referral-bonus-history'] });
  api.rbacService.getPermissionManagementMatrix = async () => ({ modules: [
    { slug: 'pricing', name: 'Pricing', permissions: [{ id: 'legacy-view', action: 'view', assigned: true }] },
    { slug: 'referral-bonus-history', name: 'Referral Bonus History', permissions: [{ id: 'history-view', action: 'view', assigned: true }] },
  ], actions: ['view'] });
  const result = await api.listAccessModules({ userId: 'target', includePermissions: true }, actor);
  const legacy = result.modules.find(module => module.slug === 'pricing');
  assert.equal(legacy.presentation.linked, false);
  assert.equal(legacy.permissions[0].assigned, true);
  const history = result.modules.find(module => module.slug === 'referral-bonus-history');
  assert.equal(history.presentation.group, 'Referral Commerce / MLM');
  assert.equal(history.permissions[0].assigned, true);
});

test('selected parent supplies child modules without copying independent grants', async () => {
  const { api, created, grants } = fixture();
  api.adminRepository.getUserById = async id => id === 'parent' ? { id, role: 'admin', accountStatus: 'active' } : null;
  api.rbacService.getUserEffectivePermissions = async () => [{ slug: 'products:view' }, { slug: 'products:update' }];
  await api.createPlatformSubAdmin({ ...payload, parentAdminId: 'parent', role: 'sub-admin', allowedModules: ['orders'] }, actor);
  assert.equal(created[0].parentAdminId, 'parent');
  assert.equal(created[0].ownerAdminId, 'parent');
  assert.equal(created[0].inheritParentPermissions, true);
  assert.deepEqual(Array.from(created[0].allowedModules), ['products']);
  assert.equal(grants.length, 0);
});
test('parent validation rejects non-admins and cross-admin selection before account creation', async () => {
  const { api, created } = fixture();
  api.adminRepository.getUserById = async () => ({ id: 'parent', role: 'seller', accountStatus: 'active' });
  await assert.rejects(api.createPlatformSubAdmin({ ...payload, parentAdminId: 'parent' }, actor), /active admin/);
  await assert.rejects(api.createPlatformSubAdmin({ ...payload, parentAdminId: 'other' }, { role: 'admin', userId: 'owner' }), /another admin/);
  assert.equal(created.length, 0);
});
test('password changes require an admin role even for an actor with profile access', async () => {
  const { api } = fixture();
  api.adminRepository.getUserById = async () => ({ id: 'target', role: 'sub-admin' });
  api.assertActorCanSeeUser = () => {};
  await assert.rejects(api.updateUser('target', { password: 'new-password' }, { role: 'sub-admin' }), /Only an admin/);
  let saved;
  api.adminRepository.updateUserById = async (id, body) => { saved = body; return { role: 'sub-admin' }; };
  await api.updateUser('target', { password: 'new-password' }, actor);
  assert.equal(saved.password, 'new-password');
});
test('deleting a managed account uses deleted status and prevents self-deletion', async () => {
  const { api } = fixture();
  api.adminRepository.getUserById = async () => ({ id: 'target', role: 'sub-admin' });
  api.assertActorCanSeeUser = () => {};
  let saved;
  api.adminRepository.updateUserById = async (id, body) => { saved = body; return { role: 'sub-admin' }; };
  await api.deactivateUser('target', {}, actor);
  assert.equal(saved.accountStatus, 'deleted');
  await assert.rejects(api.deactivateUser('owner', {}, actor), /Forbidden/);
});
test('admin-created sub-admin automatically uses that admin as parent', async () => {
  const { api, created, grants } = fixture();
  api.adminRepository.getUserById = async id => ({ id, role: 'admin', accountStatus: 'active' });
  api.rbacService.getUserEffectivePermissions = async () => [{ slug: 'products:view' }];
  api.getActorAssignablePermissionMap = async () => new Map([['rbac', new Set(['create'])]]);
  await api.createPlatformSubAdmin({ ...payload, role: 'sub-admin' }, { role: 'admin', userId: 'owner' });
  assert.equal(created[0].parentAdminId, 'owner');
  assert.equal(created[0].inheritParentPermissions, true);
  assert.equal(grants.length, 0);
});

function repositoryFixture(hash = async () => 'new-hash') {
  const repoFile = path.resolve(__dirname, '../src/modules/admin/repositories/admin.repository.js');
  const repoRequire = createRequire(repoFile);
  const module = { exports: {} };
  const writes = [];
  const requireMock = name => {
    if (name.endsWith('/shared/tools/hash')) return { hashText: hash };
    if (name.endsWith('/shared/auth/session-state')) return repoRequire(name);
    if (name.endsWith('/user/models/user.model')) return { UserModel: { findByIdAndUpdate: (id, update) => { writes.push({ id, update }); return { select: async () => ({ id }) }; } } };
    return {};
  };
  vm.runInNewContext('(function(require,module,exports){' + fs.readFileSync(repoFile, 'utf8') + '\n})', {})(requireMock, module, module.exports);
  return { repo: new module.exports.AdminRepository(), writes };
}
test('password change hashes the password and invalidates all old sessions', async () => {
  const { repo, writes } = repositoryFixture();
  await repo.updateUserById('target', { password: 'newpassword123' });
  assert.equal(writes[0].update.$set.passwordHash, 'new-hash');
  assert.equal(writes[0].update.$set.sessionInvalidationReason, 'PASSWORD_CHANGED');
  assert.equal(writes[0].update.$inc.sessionVersion, 1);
  assert.equal(writes[0].update.$set.refreshSessions.length, 0);
  assert.ok(writes[0].update.$set.passwordChangedAt);
});
test('hashing failure aborts password change instead of reporting success', async () => {
  const { repo, writes } = repositoryFixture(async () => { throw new Error('hash unavailable'); });
  await assert.rejects(repo.updateUserById('target', { password: 'newpassword123' }), /hash unavailable/);
  assert.equal(writes.length, 0);
});
test('deleted account is marked and sessions are invalidated', async () => {
  const { repo, writes } = repositoryFixture();
  await repo.updateUserById('target', { accountStatus: 'deleted' });
  assert.ok(writes[0].update.$set.deletedAt);
  assert.equal(writes[0].update.$set.accountStatus, 'deleted');
  assert.equal(writes[0].update.$inc.sessionVersion, 1);
  assert.equal(writes[0].update.$set.refreshSessions.length, 0);
});
