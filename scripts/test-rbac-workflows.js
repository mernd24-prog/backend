const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { MODULE_CATALOG } = require("../src/shared/auth/module-catalog");
const { SIDEBAR_MODULES } = require("../src/shared/auth/admin-sidebar-catalog");
const { cleanModuleName } = require("../src/shared/auth/module-access");
const {
  canonicalModules,
  modulesForRole,
  supportedActions,
} = require("../src/shared/auth/rbac-module-policy");
const { allowActions } = require("../src/shared/middleware/access");

// Load the real service with deterministic persistence adapters. No databases,
// live accounts or assignments are touched by these workflow tests.
function fixture({ role = "admin", allowedModules = ["referral-rules"] } = {}) {
  const user = { _id: "u", role, allowedModules, ownerAdminId: "owner" };
  const rows = [];
  for (const module of MODULE_CATALOG) {
    for (const action of supportedActions(module.slug))
      rows.push({
        id: `${module.slug}:${action}`,
        slug: `${module.slug}:${action}`,
        action,
        active: true,
        moduleSlug: module.slug,
        moduleId: module.slug,
        module: { ...module, active: true },
      });
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const inherited = new Set(["referral-rules:view", "referral-rules:update"]);
  const assignments = new Map();
  const roles = new Map([
    ["role", { id: "role", slug: role, type: "system", active: true }],
    [
      "custom",
      { id: "custom", slug: "content-ops", type: "custom", active: true },
    ],
    [
      "super",
      { id: "super", slug: "super-admin", type: "system", active: true },
    ],
  ]);
  let invalidations = 0;
  const query = {
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(user);
    },
    then(resolve, reject) {
      return Promise.resolve(user).then(resolve, reject);
    },
    catch(reject) {
      return Promise.resolve(user).catch(reject);
    },
  };
  const UserModel = {
    findById: () => query,
    findByIdAndUpdate: async () => {
      invalidations++;
      return user;
    },
    updateMany: async () => {
      invalidations++;
      return { modifiedCount: 1 };
    },
  };
  const repository = {
    getInactiveModuleCodes: async () => [],
    getPermissionsByIds: async (ids) =>
      ids.map((id) => byId.get(id)).filter(Boolean),
    getPermissionsBySlugs: async (slugs) =>
      rows.filter((row) => slugs.includes(row.slug) && row.active),
    getPermissionIdsBySlugs: async (slugs) =>
      rows
        .filter((row) => slugs.includes(row.slug) && row.active)
        .map((row) => row.id),
    getPermissionById: async (id) => byId.get(id),
    getUserRoleEffectivePermissions: async () =>
      [...inherited].map((id) => byId.get(id)).filter(Boolean),
    getUserDirectEffectivePermissions: async () =>
      [...assignments]
        .filter(([, effect]) => effect === "allow")
        .map(([id]) => byId.get(id)),
    getUserDeniedPermissions: async () =>
      [...assignments]
        .filter(([, effect]) => effect === "deny")
        .map(([id]) => byId.get(id)),
    syncUserPermissions: async (_id, allow, deny) => {
      assignments.clear();
      for (const id of allow) assignments.set(id, "allow");
      for (const id of deny) assignments.set(id, "deny");
      return { permissionIds: allow, deniedPermissionIds: deny };
    },
    getRoleById: async (id) => roles.get(id),
    getRolePermissions: async () =>
      [...inherited].map((id) => ({ permission: byId.get(id) })),
    syncRolePermissions: async (_id, ids) => {
      inherited.clear();
      ids.forEach((id) => inherited.add(id));
      return { synced: true };
    },
    getUserIdsForRole: async () => ["u"],
    listSidebarModules: async () => [
      {
        id: "nav",
        slug: "sidebar-referral-rules",
        moduleKey: "sidebar-referral-rules",
        name: "Rules & Coins",
        metadata: { requiredModule: "referral-rules", allowedRoles: ["admin"] },
      },
    ],
  };
  const filename = path.resolve(
    __dirname,
    "../src/modules/rbac/services/rbac.service.js",
  );
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      console,
      require(name) {
        if (name.endsWith("/rbac.repository"))
          return { RbacRepository: class {} };
        if (name.endsWith("/user.model")) return { UserModel };
        if (name.endsWith("/sequelize/models"))
          return { RbacAuditLog: {}, PermissionTemplate: {} };
        return localRequire(name);
      },
    },
    { filename },
  );
  const service = new module.exports.RbacService({
    rbacRepository: repository,
  });
  service.writeAuditLog = () => {};
  return {
    service,
    repository,
    user,
    rows,
    inherited,
    assignments,
    roles,
    byId,
    invalidations: () => invalidations,
  };
}
const root = { userId: "root", role: "super-admin", isSuperAdmin: true };
const slugs = (permissions) =>
  Array.from(permissions, (row) => row.slug).sort();
const api = (permissions, method = "GET") => {
  let result;
  allowActions("admin_control")(
    {
      method,
      originalUrl: "/api/v1/admin/commerce-settings/marketing-policy/referrals",
      auth: {
        role: "admin",
        allowedModules: ["referral-rules"],
        permissions: slugs(permissions),
      },
    },
    {},
    (error) => {
      result = error || null;
    },
  );
  return result;
};

test("catalog and navigation keys are unique and every navigation dependency exists", () => {
  for (const property of ["slug", "name"])
    assert.equal(
      new Set(MODULE_CATALOG.map((row) => row[property])).size,
      MODULE_CATALOG.length,
    );
  for (const property of ["moduleKey", "moduleSlug"])
    assert.equal(
      new Set(SIDEBAR_MODULES.map((row) => row[property])).size,
      SIDEBAR_MODULES.length,
    );
  const known = new Set(MODULE_CATALOG.map((row) => row.slug));
  for (const row of SIDEBAR_MODULES)
    assert.ok(known.has(row.requiredModule), row.moduleKey);
});

test("assignment module lists are complete, unique and role scoped", () => {
  for (const role of [
    "admin",
    "sub-admin",
    "seller",
    "seller-admin",
    "seller-sub-admin",
  ]) {
    const modules = modulesForRole(role);
    assert.equal(new Set(modules).size, modules.length);
    for (const module of MODULE_CATALOG.filter((row) =>
      role.startsWith("seller") ? row.forSeller : row.forPlatform !== false,
    )) {
      assert.ok(
        modules.includes(cleanModuleName(module.slug)),
        `${role}: ${module.slug}`,
      );
    }
  }
  assert.equal(modulesForRole("buyer").length, 0);
  assert.ok(modulesForRole("admin").includes("referral-hierarchy"));
  assert.ok(!modulesForRole("seller-admin").includes("rbac"));
});

test("canonical permission lists merge aliases, hide navigation and retain assigned state", () => {
  const modules = canonicalModules([
    {
      id: "w",
      slug: "wallets",
      permissions: [{ id: "v", slug: "wallets:view", action: "view" }],
    },
    {
      id: "old",
      slug: "wallet-management",
      permissions: [
        {
          id: "old-v",
          slug: "wallet-management:view",
          action: "view",
          assigned: true,
        },
      ],
    },
    {
      slug: "sidebar-wallets",
      metadata: { source: "sidebar-seed", requiredModule: "wallets" },
      permissions: [],
    },
  ]);
  assert.equal(modules.length, 1);
  assert.equal(modules[0].id, "w");
  assert.equal(modules[0].permissions[0].id, "v");
  assert.equal(modules[0].permissions[0].assigned, true);
});

test("API-only reports list only actions supported by their routers", () => {
  for (const code of [
    "referral-overview",
    "referral-hierarchy",
    "referral-ledger",
    "referral-bonus-progress",
    "referral-bonus-history",
  ]) {
    assert.equal(supportedActions(code).join(","), "view");
  }
  assert.equal(
    supportedActions("ca-analytics").join(","),
    "view,export,import",
  );
});

test("replacing full inherited access with view-only really removes API write access", async () => {
  const f = fixture();
  await f.service.syncUserModulePermissions(
    "u",
    [{ module: "referral-rules", actions: ["view"] }],
    "root",
    root,
  );
  const effective = await f.service.getUserEffectivePermissions("u");
  assert.equal(slugs(effective).join(","), "referral-rules:view");
  assert.equal(api(effective), null);
  assert.equal(api(effective, "PUT")?.statusCode, 403);
  assert.equal(f.assignments.get("referral-rules:update"), "deny");
  assert.ok(f.invalidations() > 0);
});

test("updating and then removing a permission changes effective access and API authorization", async () => {
  const f = fixture();
  await f.service.syncUserPermissions(
    "u",
    ["referral-rules:update"],
    [],
    "root",
    root,
  );
  assert.equal(
    api(await f.service.getUserEffectivePermissions("u"), "PUT"),
    null,
  );
  await f.service.removePermissionFromUser("u", "referral-rules:update", root);
  assert.equal(
    api(await f.service.getUserEffectivePermissions("u"), "PUT")?.statusCode,
    403,
  );
});

test("removing view removes all module actions and inherited rights do not return", async () => {
  const f = fixture();
  await f.service.removePermissionFromUser("u", "referral-rules:view", root);
  assert.equal((await f.service.getUserEffectivePermissions("u")).length, 0);
});

test("empty module replacement revokes all direct/inherited access", async () => {
  const f = fixture();
  await f.service.syncUserModulePermissions("u", [], "root", root);
  assert.equal((await f.service.getUserEffectivePermissions("u")).length, 0);
});

test("an empty delegated module scope never inherits the entire system role", async () => {
  const f = fixture({ allowedModules: [] });
  assert.equal((await f.service.getUserEffectivePermissions("u")).length, 0);
});

test("explicit view denial blocks implicit view and mutation permissions", async () => {
  const f = fixture();
  f.assignments.set("referral-rules:view", "deny");
  assert.equal((await f.service.getUserEffectivePermissions("u")).length, 0);
});

test("unknown, inactive, unsupported and conflicting assignments fail before changes", async () => {
  const f = fixture();
  await assert.rejects(() =>
    f.service.syncUserPermissions("u", ["unknown"], [], "root", root),
  );
  f.byId.get("referral-rules:update").active = false;
  await assert.rejects(() =>
    f.service.syncUserPermissions(
      "u",
      ["referral-rules:update"],
      [],
      "root",
      root,
    ),
  );
  await assert.rejects(() =>
    f.service.syncUserPermissions(
      "u",
      ["referral-rules:view"],
      ["referral-rules:view"],
      "root",
      root,
    ),
  );
  assert.equal(f.assignments.size, 0);
});

test("seller accounts cannot receive platform-only permissions", async () => {
  const f = fixture({ role: "seller-admin" });
  await assert.rejects(
    () => f.service.syncUserPermissions("u", ["rbac:view"], [], "root", root),
    /role scope/,
  );
});

test("delegated admins cannot change system role defaults or manage stronger custom roles", async () => {
  const f = fixture();
  const actor = { userId: "owner", role: "admin" };
  await assert.rejects(
    () => f.service.syncRolePermissions("role", ["referral-rules:view"], actor),
    /system role/,
  );
  await assert.rejects(
    () => f.service.syncRolePermissions("custom", ["rbac:assign"], actor),
    /beyond your own access/,
  );
  await assert.rejects(
    () => f.service.syncRolePermissions("super", [], root),
    /managed by the system/,
  );
});

test("system roles cannot be changed into custom roles or created through the API", async () => {
  const f = fixture();
  await assert.rejects(
    () => f.service.updateRole("role", { type: "custom" }, root),
    /identity/,
  );
  await assert.rejects(
    () =>
      f.service.createRole(
        { name: "Root", slug: "new-root", isSuperAdmin: true },
        root,
      ),
    /System roles/,
  );
});

test("inactive and mismatched system roles cannot be attached to an account", async () => {
  const f = fixture();
  await assert.rejects(
    () => f.service.assertCanAssignUserRole(root, "u", "super"),
    /account type/,
  );
  f.roles.get("custom").active = false;
  await assert.rejects(
    () => f.service.assertCanAssignUserRole(root, "u", "custom"),
    /inactive/,
  );
});

test("sidebar requires effective view permission rather than module scope alone", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.service.listSidebarModules(
        {},
        { role: "admin", allowedModules: ["referral-rules"], permissions: [] },
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await f.service.listSidebarModules(
        {},
        { role: "admin", permissions: ["referral-rules:view"] },
      )
    ).length,
    1,
  );
});

test("an unqualified action name cannot grant arbitrary module access", () => {
  let error;
  allowActions("admin_control")(
    {
      method: "GET",
      originalUrl: "/api/v1/admin/referral/codes",
      auth: {
        role: "admin",
        allowedModules: ["referral-codes"],
        permissions: ["view"],
      },
    },
    {},
    (result) => {
      error = result;
    },
  );
  assert.equal(error?.statusCode, 403);
});

test("every explicit route guard agrees with module scope and parent action checks", () => {
  const { allowRoles } = require("../src/shared/middleware/access");
  const rules = require("../src/shared/auth/route-permission-map.json");
  for (const [method, pattern, module, action] of rules) {
    const originalUrl = `/api/v1${pattern.replace(/:[A-Za-z0-9_]+/g, "test-id")}`;
    let outcome;
    const req = {
      method,
      originalUrl,
      auth: {
        role: "admin",
        allowedModules: [module],
        permissions: [`${module}:${action}`],
      },
    };
    allowRoles("admin", "sub-admin")(req, {}, (error) => {
      outcome = error || null;
    });
    assert.equal(outcome, null, `${method} ${pattern}: ${module}:${action}`);
    req.originalUrl = originalUrl.toUpperCase();
    allowRoles("admin", "sub-admin")(req, {}, error => { outcome = error || null; });
    assert.equal(outcome, null, `case-insensitive route ${pattern}`);
    req.auth.permissions = ["unrelated:view"];
    req.auth.allowedModules = ["unrelated"];
    allowRoles("admin", "sub-admin")(req, {}, (error) => {
      outcome = error || null;
    });
    assert.equal(outcome?.statusCode, 403, `unassigned route ${pattern}`);
  }
});

test("template replace obeys inheritance denials and rejects unknown permissions", async () => {
  const f = fixture();
  f.service.getPermissionTemplate = async () => ({
    isActive: true,
    roleScope: ["admin"],
    permissionSlugs: ["referral-rules:view"],
  });
  await f.service.applyPermissionTemplate("u", "read-only", root, "replace");
  assert.equal(
    api(await f.service.getUserEffectivePermissions("u"), "PUT")?.statusCode,
    403,
  );
  f.service.getPermissionTemplate = async () => ({
    isActive: true,
    permissionSlugs: ["unknown:view"],
  });
  await assert.rejects(
    () => f.service.applyPermissionTemplate("u", "invalid", root),
    /unknown/,
  );
});

test("copying an empty permission set in replace mode clears existing access", async () => {
  const f = fixture();
  const effective = f.service.getUserEffectivePermissions.bind(f.service);
  f.service.getUserEffectivePermissions = async (id) =>
    id === "source" ? [] : effective(id);
  await f.service.copyUserPermissions("u", "source", root, {
    copyModules: false,
    copyPermissions: true,
    mergeMode: "replace",
  });
  assert.equal((await effective("u")).length, 0);
});

test('legacy role-only accounts retain valid inheritance until an explicit module scope is saved', async () => {
  const f = fixture();
  delete f.user.allowedModules;
  const effective = await f.service.getUserEffectivePermissions('u');
  assert.ok(effective.some(row => row.slug === 'referral-rules:update'));
  await f.service.syncUserPermissions('u', [], [], 'root', root);
  assert.equal((await f.service.getUserEffectivePermissions('u')).length, 0);
});
