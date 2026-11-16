const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const file = path.resolve(
  __dirname,
  "../src/modules/rbac/services/rbac.service.js",
);
const localRequire = createRequire(file);
// Isolate external persistence at the module boundary. No environment config,
// application credentials, database connections, migrations, or seeds load.
function service(repository, users = {}, auditLog = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(file, "utf8");
  const requireMock = (name) => {
    if (name.endsWith("/repositories/rbac.repository"))
      return { RbacRepository: class {} };
    if (name.endsWith("/user/models/user.model"))
      return {
        UserModel: {
          find: query => ({
            select() { return this; },
            lean: async () => Object.entries(users).filter(([, user]) => user.ownerAdminId === query.ownerAdminId && query.role.$in.includes(user.role)).map(([id, user]) => ({ _id: id, ...user })),
          }),
          findById: (id) => ({
            select() {
              return this;
            },
            lean: async () => users[id] || null,
          }),
        },
      };
    if (name.endsWith("/infrastructure/sequelize/models"))
      return { RbacAuditLog: { findAll: async () => [], ...auditLog }, PermissionTemplate: {} };
    return localRequire(name);
  };
  vm.runInNewContext(
    "(function(require,module,exports){" + source + "\n})",
    {},
  )(requireMock, module, module.exports);
  return new module.exports.RbacService({ rbacRepository: repository });
}

test("module listing reads beyond 1000 stored rows before filtering and paginating", async () => {
  const calls = [];
  const stored = Array.from({ length: 1001 }, (_, i) => ({
    id: `id-${i}`,
    slug: `custom-${i}`,
    name: `Module ${i}`,
    status: "active",
    active: true,
    permissions: [],
  }));
  const api = service({
    listModules: async (query) => {
      calls.push(query);
      return {
        items: stored.slice(query.offset, query.offset + query.limit),
        total: stored.length,
      };
    },
  });
  const result = await api.listModules({
    includeInactive: true,
    q: "custom-1000",
  });
  assert.equal(calls.length, 2);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, "id-1000");
});

test("listing supports panel, visibility, unconfigured status and numeric pagination", async () => {
  const api = service({ listModules: async () => ({ items: [], total: 0 }) });
  const result = await api.listModules({
    includeInactive: true,
    scope: "sidebar",
    panel: "seller",
    sidebar: false,
    status: "unconfigured",
    offset: "0",
    limit: "2",
  });
  assert.ok(result.items.length <= 2);
  assert.ok(
    result.items.every(
      (row) =>
        row.forSeller &&
        row.isVisibleInSidebar === false &&
        row.configured === false,
    ),
  );
});

test("existing hierarchy boundaries remain enforced for access reads", async () => {
  const api = service(
    {},
    {
      child: { role: "sub-admin", ownerAdminId: "admin-a" },
      unrelated: { role: "sub-admin", ownerAdminId: "admin-b" },
      staff: { role: "seller-sub-admin", ownerSellerId: "seller-a" },
    },
  );
  await api.assertCanViewUserAccess(
    { userId: "admin-a", role: "admin" },
    "child",
  );
  await assert.rejects(
    api.assertCanViewUserAccess(
      { userId: "admin-a", role: "admin" },
      "unrelated",
    ),
    (error) => error.statusCode === 403,
  );
  await api.assertCanViewUserAccess(
    { userId: "seller-a", role: "seller" },
    "staff",
  );
  await assert.rejects(
    api.assertCanViewUserAccess(
      { userId: "seller-b", role: "seller" },
      "staff",
    ),
    (error) => error.statusCode === 403,
  );
});

test("reorder rejects a proposed multi-row parent cycle before persistence", async () => {
  let writes = 0;
  const api = service({
    getModuleById: async (id) => ({ id, parentModuleId: null }),
    reorderModules: async () => {
      writes++;
    },
  });
  await assert.rejects(
    api.reorderModules([
      { id: "a", parentModuleId: "b" },
      { id: "b", parentModuleId: "a" },
    ]),
    /cycle/,
  );
  assert.equal(writes, 0);
});

test("module reparenting rejects missing parents and existing ancestor cycles", async () => {
  const records = { a: { parentModuleId: "b" }, b: { parentModuleId: "a" } };
  const api = service({ getModuleById: async (id) => records[id] });
  await assert.rejects(api.assertValidModuleParent("new", "a"), /cycle/);
  await assert.rejects(
    api.assertValidModuleParent("new", "missing"),
    /not found/,
  );
});

test("seller navigation rejects legacy platform grants even when role visibility is misconfigured", async () => {
  const api = service({
    listSidebarModules: async () => [
      {
        id: "rbac-menu",
        slug: "sidebar-rbac",
        moduleKey: "sidebar-rbac",
        metadata: {
          source: "sidebar-seed",
          requiredModule: "rbac",
          allowedRoles: ["seller"],
        },
      },
      {
        id: "products-menu",
        slug: "sidebar-products",
        moduleKey: "sidebar-products",
        metadata: {
          source: "sidebar-seed",
          requiredModule: "products",
          allowedRoles: ["seller"],
        },
      },
    ],
  });
  const rows = await api.listSidebarModules(
    {},
    { role: "seller", permissions: ["rbac:view", "products:view"] },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "products-menu");
});

const permission = (id, slug) => ({
  id,
  slug,
  action: slug.split(":")[1],
  active: true,
  module: { slug: slug.split(":")[0], active: true },
});
const permissionRepo = (overrides = {}) => ({
  getUserDeniedPermissions: async () => [],
  getUserRoleEffectivePermissions: async () => [],
  getUserDirectEffectivePermissions: async () => [],
  getInactiveModuleCodes: async () => [],
  getPermissionsBySlugs: async (slugs) =>
    slugs.map((slug) => permission(slug, slug)),
  ...overrides,
});

test("explicit empty scope removes inherited access but preserves independently scoped direct grants", async () => {
  const api = service(
    permissionRepo({
      getUserRoleEffectivePermissions: async () => [
        permission("role-write", "products:update"),
      ],
      getUserDirectEffectivePermissions: async () => [
        permission("direct-view", "orders:view"),
      ],
    }),
    { target: { role: "sub-admin", allowedModules: [] } },
  );
  const rows = await api.getUserEffectivePermissions("target");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slug, "orders:view");
});

test("legacy absent module scope retains inheritance and implicit view", async () => {
  const api = service(
    permissionRepo({
      getUserRoleEffectivePermissions: async () => [
        permission("write", "products:update"),
      ],
    }),
    { target: { role: "sub-admin" } },
  );
  const rows = await api.getUserEffectivePermissions("target");
  assert.deepEqual(
    new Set(Array.from(rows, (row) => row.slug)),
    new Set(["products:update", "products:view"]),
  );
});

test("view denial suppresses inherited and direct writes, including module aliases", async () => {
  const api = service(
    permissionRepo({
      getUserRoleEffectivePermissions: async () => [
        permission("write", "product:update"),
      ],
      getUserDirectEffectivePermissions: async () => [
        permission("create", "products:create"),
      ],
      getUserDeniedPermissions: async () => [
        permission("deny", "products:view"),
      ],
    }),
    { target: { role: "sub-admin" } },
  );
  assert.equal((await api.getUserEffectivePermissions("target")).length, 0);
});

test("inactive canonical modules cannot be reactivated by alias grants", async () => {
  const api = service(
    permissionRepo({
      getUserDirectEffectivePermissions: async () => [
        permission("alias", "product:view"),
      ],
      getInactiveModuleCodes: async () => ["products"],
    }),
    { target: { role: "sub-admin" } },
  );
  assert.equal((await api.getUserEffectivePermissions("target")).length, 0);
});


test("audit log lists and target filters respect the existing readable hierarchy", async () => {
  const { Op } = localRequire("sequelize");
  let query;
  const api = service({}, {
    child: { role: "sub-admin", ownerAdminId: "admin-a" },
    unrelated: { role: "sub-admin", ownerAdminId: "admin-b" },
  }, { findAndCountAll: async value => { query = value; return { count: 0, rows: [] }; } });
  await api.listAuditLogs({}, { userId: "admin-a", role: "admin" });
  assert.deepEqual(Array.from(query.where.targetUserId[Op.in]), ["admin-a", "child"]);
  await assert.rejects(api.listAuditLogs({ targetUserId: "unrelated" }, { userId: "admin-a", role: "admin" }), error => error.statusCode === 403);
  await api.listAuditLogs({}, { userId: "child", role: "sub-admin" });
  assert.deepEqual(Array.from(query.where.targetUserId[Op.in]), ["child"]);
  await api.listAuditLogs({}, { userId: "root", role: "super-admin" });
  assert.equal(query.where.targetUserId, undefined);
});

test("orphaned permission links cannot authorize a deleted user", async () => {
  const api = service(permissionRepo({ getUserDirectEffectivePermissions: async () => [permission("orphan", "products:view")] }));
  assert.equal((await api.getUserEffectivePermissions("missing")).length, 0);
});

test('audit action choices use recorded actions inside the same readable hierarchy', async () => {
  const { Op } = localRequire('sequelize');
  let countQuery, facetQuery;
  const api = service({}, {}, {
    findAndCountAll: async query => { countQuery = query; return { count: 0, rows: [] }; },
    findAll: async query => { facetQuery = query; return [{ action: 'role_defaults_updated' }]; },
  });
  const result = await api.listAuditLogs({ action: 'revoke' }, { userId: 'staff', role: 'sub-admin' });
  assert.deepEqual(Array.from(result.actions), ['role_defaults_updated']);
  assert.deepEqual(Array.from(facetQuery.where.targetUserId[Op.in]), ['staff']);
  assert.deepEqual(Array.from(countQuery.where.targetUserId[Op.in]), ['staff']);
  assert.equal(facetQuery.where.action, undefined);
  assert.equal(countQuery.where.action, 'revoke');
});

test('audit filters accept recorded action names without accepting unsupported search parameters', () => {
  const { listAuditLogsSchema } = localRequire('../validation/rbac.validation');
  assert.equal(listAuditLogsSchema.query.validate({ action: 'role_defaults_updated' }).error, undefined);
  assert.ok(listAuditLogsSchema.query.validate({ search: 'unsupported' }).error);
});

test("management inventory joins navigation to capabilities without duplicate permission modules", async () => {
  const api = service({ listModules: async ({ scope }) => ({ items: scope === "sidebar" ? [{ id: "nav", slug: "sidebar-products", name: "Sidebar products", moduleType: "page", metadata: { source: "sidebar-seed", requiredModule: "products", displayName: "Products" } }] : [{ id: "products", slug: "products", name: "Products" }], total: 1 }) });
  const result = await api.listModules({ includeInactive: true, includeNavigation: true, q: "products", limit: 1000 });
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].navigationEntries.some(entry => entry.id === "nav"));
});

test("sidebar presentation save preserves routes, actions, role restrictions and grants", async () => {
  const stored = { id: "nav", slug: "sidebar-products", moduleKey: "sidebar-products", name: "Sidebar products", routePath: "/app/products", modulePermissions: ["view", "update"], metadata: { source: "sidebar-seed", requiredModule: "products", allowedRoles: ["admin"] } };
  let saved;
  const api = service({ getModuleById: async () => ({ ...stored, toJSON: () => stored }), updateModule: async (id, payload) => { saved = payload; return { ...stored, ...payload }; } });
  const result = await api.updateModule("nav", { moduleName: "Catalog", order: 4, isVisibleInSidebar: false });
  assert.deepEqual(Object.keys(saved).sort(), ["isVisibleInSidebar", "metadata", "order"]);
  assert.deepEqual(saved.metadata.allowedRoles, ["admin"]);
  assert.equal(result.moduleName, "Catalog");
  assert.equal(result.routePath, "/app/products");
  assert.deepEqual(result.modulePermissions, ["view", "update"]);
});

test("module presentation separates referral features from unrelated marketing and retains embedded tabs", () => {
  const { modulePresentation } = require("../src/shared/auth/admin-module-presentation");
  for (const slug of ["referral", "influencer-management", "referral-rules", "referral-bonus-history", "referral-bonus-progress", "referral-ledger", "referral-codes", "referral-hierarchy"]) {
    const feature = modulePresentation({ slug }, "sub-admin");
    assert.equal(feature.linked, true, slug);
    assert.equal(feature.group, "Referral Commerce / MLM", slug);
    assert.ok(feature.links.every(link => link.path.startsWith("/app/referral-commerce/")));
  }
  for (const slug of ["pricing", "loyalty", "dynamic-pricing", "recommendations", "banners"]) {
    assert.equal(modulePresentation({ slug }, "sub-admin").linked, false, slug);
  }
  assert.equal(modulePresentation({ slug: "notifications" }, "seller").linked, true);
  assert.equal(modulePresentation({ slug: "notifications" }, "sub-admin").linked, false);
});

test("parent-linked sub-admin inherits current parent grants and ignores independent child grants", async () => {
  let parentRows = [permission("parent-write", "products:update")];
  const users = {
    parent: { role: "admin", accountStatus: "active", allowedModules: ["products", "orders"] },
    child: { role: "sub-admin", inheritParentPermissions: true, parentAdminId: "parent", allowedModules: ["fraud"] },
  };
  const api = service(permissionRepo({ getUserDirectEffectivePermissions: async id => id === "parent" ? parentRows : [permission("rogue", "fraud:view")] }), users);
  assert.deepEqual(new Set(Array.from(await api.getUserEffectivePermissions("child"), row => row.slug)), new Set(["products:view", "products:update"]));
  parentRows = [permission("orders-view", "orders:view")];
  assert.deepEqual(Array.from(await api.getUserEffectivePermissions("child"), row => row.slug), ["orders:view"]);
  users.parent.accountStatus = "suspended";
  assert.equal((await api.getUserEffectivePermissions("child")).length, 0);
});
test("parent inheritance fails closed for missing, invalid and self parents", async () => {
  for (const parent of [null, { role: "sub-admin", accountStatus: "active" }, { role: "admin", accountStatus: "active", deletedAt: new Date() }]) {
    const api = service(permissionRepo(), { child: { role: "sub-admin", inheritParentPermissions: true, parentAdminId: "parent" }, parent });
    assert.equal((await api.getUserEffectivePermissions("child")).length, 0);
  }
  const api = service(permissionRepo(), { child: { role: "sub-admin", inheritParentPermissions: true, parentAdminId: "child" } });
  assert.equal((await api.getUserEffectivePermissions("child")).length, 0);
});
test("parent-linked users reject direct grants even from a super-admin", async () => {
  const api = service(permissionRepo(), { child: { role: "sub-admin", inheritParentPermissions: true } });
  await assert.rejects(api.assertCanAssignUserPermissions({ userId: "root", role: "super-admin" }, "child", []), /inherits access/);
});

test("management grouping and page links follow persisted records, including custom modules", () => {
  const { savedModulePresentation } = require("../src/shared/auth/admin-module-presentation");
  const navigation = [
    { id: "group", slug: "sidebar-custom-group", moduleName: "Saved team tools", moduleType: "group" },
    { id: "page", slug: "sidebar-custom-page", moduleName: "Saved page label", moduleType: "page", routePath: "/app/custom-page", parentModuleId: "group", configured: true, panel: "platform", metadata: { requiredModule: "custom-module" } },
  ];
  const result = savedModulePresentation({ slug: "custom-module" }, navigation);
  assert.equal(result.linked, true);
  assert.equal(result.group, "Saved team tools");
  assert.equal(result.links[0].name, "Saved page label");
  assert.equal(savedModulePresentation({ slug: "products" }, []).linked, false);
});
test("saved sidebar role restriction can be changed without rewriting capability permissions", async () => {
  const stored = { id: "nav", slug: "sidebar-products", moduleKey: "sidebar-products", name: "Sidebar products", modulePermissions: ["view"], metadata: { source: "sidebar-seed", requiredModule: "products", allowedRoles: ["super-admin"] } };
  let saved;
  const api = service({ getModuleById: async () => stored, updateModule: async (id, payload) => { saved = payload; return { ...stored, ...payload }; } });
  await api.updateModule("nav", { allowedRoles: ["admin"] });
  assert.deepEqual(Array.from(saved.metadata.allowedRoles), ["admin"]);
  assert.equal(saved.metadata.requiredModule, "products");
  assert.equal(Object.hasOwn(saved, "modulePermissions"), false);
});

test("assigned admin navigation follows saved visibility and role edits without RBAC-management access", async () => {
  const saved = { id: "menu", slug: "sidebar-referral", moduleName: "Saved partner menu", name: "Saved partner menu", moduleType: "page", routePath: "/app/referral-commerce/influencers", active: true, status: "active", isVisibleInSidebar: true, metadata: { source: "sidebar-seed", requiredModule: "influencer-management", allowedRoles: ["super-admin"] } };
  const api = service({
    listSidebarModules: async () => saved.isVisibleInSidebar ? [saved] : [],
    getModuleById: async () => saved,
    updateModule: async (id, payload) => Object.assign(saved, payload),
  });
  const actor = { role: "admin", permissions: ["influencer-management:view"] };
  assert.equal((await api.listSidebarModules({}, actor)).length, 0);
  await api.updateModule("menu", { allowedRoles: ["admin"] });
  const visible = await api.listSidebarModules({}, actor);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].routePath, "/app/referral-commerce/influencers");
  assert.equal((await api.listSidebarModules({}, { role: "admin", permissions: ["orders:view"] })).length, 0);
  await api.updateModule("menu", { isVisibleInSidebar: false });
  assert.equal((await api.listSidebarModules({}, actor)).length, 0);
});
