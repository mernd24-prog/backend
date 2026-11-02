// Real PostgreSQL integration tests. This harness connects ONLY to the isolated
// Unix socket created for RBAC tests, never to the application's configured DB.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { randomUUID } = require("node:crypto");
const { Sequelize } = require("sequelize");
const socket = "/tmp/ecommerce-rbac-test-pg";
const schema = `rbac_test_${process.pid}`;
const sequelize = new Sequelize("postgres", process.env.USER || "user", null, {
  dialect: "postgres",
  host: socket,
  port: 55439,
  logging: false,
  dialectOptions: { options: `-c search_path=${schema}` },
  define: { schema },
});
function load(relative, replacements) {
  const filename = path.resolve(__dirname, relative);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      console,
      process,
      require(name) {
        for (const [suffix, value] of replacements)
          if (name.endsWith(suffix)) return value;
        return localRequire(name);
      },
    },
    { filename },
  );
  return module.exports;
}
const models = load("../src/infrastructure/sequelize/models/index.js", [
  ["/sequelize-client", { sequelize }],
]);
const repositoryClass = load(
  "../src/modules/rbac/repositories/rbac.repository.js",
  [
    ["/sequelize/models", models],
    ["/sequelize-client", { sequelize }],
  ],
).RbacRepository;
const repository = new repositoryClass();
const users = new Map();
const UserModel = {
  findById(id) {
    const user = users.get(id);
    return {
      select() {
        return this;
      },
      lean: async () => user,
      then: (resolve, reject) => Promise.resolve(user).then(resolve, reject),
    };
  },
  async findByIdAndUpdate(id, update) {
    const user = users.get(id);
    if (update.allowedModules) user.allowedModules = update.allowedModules;
    return user;
  },
  async updateMany() {
    return { modifiedCount: 1 };
  },
};
const serviceClass = load("../src/modules/rbac/services/rbac.service.js", [
  ["/rbac.repository", { RbacRepository: repositoryClass }],
  ["/user.model", { UserModel }],
  ["/sequelize/models", models],
]).RbacService;
const service = new serviceClass({ rbacRepository: repository });
service.writeAuditLog = () => {};
const seed = load("db/seed-rbac.js", [
  ["/sequelize-client", { sequelize }],
  ["/mongo-client", { connectMongo: async () => {}, mongoose: {} }],
  ["/user.model", { UserModel }],
]);
const root = { userId: "root", role: "super-admin", isSuperAdmin: true };
let user, role, view, update;
before(async () => {
  await sequelize.authenticate();
  await sequelize.query(`CREATE SCHEMA "${schema}"`);
  await sequelize.sync();
  await sequelize.query(
    `ALTER TABLE "${schema}".role_permissions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW()`,
  );
  await sequelize.query(
    `CREATE UNIQUE INDEX ON "${schema}".permissions (slug)`,
  );
  user = {
    _id: "test-user",
    role: "admin",
    allowedModules: ["referral-rules"],
  };
  users.set(user._id, user);
  const module = await models.Module.create({
    id: randomUUID(),
    name: "Referral Rules",
    slug: "referral-rules",
    moduleKey: "referral-rules",
    modulePermissions: ["view", "update"],
    isVisibleInSidebar: false,
  });
  view = await models.Permission.create({
    id: randomUUID(),
    moduleId: module.id,
    name: "View Referral Rules",
    slug: "referral-rules:view",
    action: "view",
  });
  update = await models.Permission.create({
    id: randomUUID(),
    moduleId: module.id,
    name: "Update Referral Rules",
    slug: "referral-rules:update",
    action: "update",
  });
  role = await models.Role.create({
    id: randomUUID(),
    name: "Admin",
    slug: "admin",
    type: "system",
  });
  await repository.assignRoleToUser(user._id, role.id, "root");
  await repository.syncRolePermissions(role.id, [view.id, update.id]);
});
after(async () => {
  await sequelize.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await sequelize.close();
});

test("PostgreSQL: replace inherited writes with view-only, then clear all access", async () => {
  await service.syncUserModulePermissions(
    user._id,
    [{ module: "referral-rules", actions: ["view"] }],
    "root",
    root,
  );
  let permissions = await service.getUserEffectivePermissions(user._id);
  assert.equal(
    permissions.map((row) => row.slug).join(","),
    "referral-rules:view",
  );
  const denied = await repository.getUserDeniedPermissions(user._id);
  assert.ok(denied.some((row) => row.slug === "referral-rules:update"));
  await service.syncUserModulePermissions(user._id, [], "root", root);
  assert.equal((await service.getUserEffectivePermissions(user._id)).length, 0);
});

test("PostgreSQL: module counts and role counts are distinct despite permission joins", async () => {
  const modules = await repository.listModules({ includeInactive: true });
  assert.equal(modules.total, 1);
  const roles = await repository.listRoles();
  assert.equal(roles.total, 1);
});

test("PostgreSQL: inactive roles and inactive modules cannot authorize requests", async () => {
  await repository.syncUserPermissions(user._id, [], []);
  await role.update({ active: false });
  assert.equal((await service.getUserEffectivePermissions(user._id)).length, 0);
  await role.update({ active: true });
  const module = await models.Module.findByPk(view.moduleId);
  await module.update({ active: false });
  assert.equal((await service.getUserEffectivePermissions(user._id)).length, 0);
  await module.update({ active: true });
});

test("PostgreSQL: new module actions create actual permission rows atomically", async () => {
  const result = await service.createModule({
    name: "Test Operations",
    slug: "test-operations",
    moduleKey: "test-operations",
    isVisibleInSidebar: false,
    permissions: ["create"],
  });
  const module = await repository.getModuleById(result.id);
  assert.equal(
    module.permissions
      .map((row) => row.action)
      .sort()
      .join(","),
    "create,view",
  );
  await service.updateModule(result.id, { permissions: ["view"] });
  const permissions = await models.Permission.findAll({
    where: { moduleId: result.id, active: true },
  });
  assert.equal(permissions.map((row) => row.action).join(","), "view");
});

test("PostgreSQL: catalog seed preserves existing role activity and customized defaults", async () => {
  await repository.syncRolePermissions(role.id, [view.id]);
  await role.update({ active: false });
  await sequelize.transaction(async (transaction) => {
    const result = await seed.upsertRole(
      {
        id: randomUUID(),
        name: "Admin",
        slug: "admin",
        description: "Updated label",
        type: "system",
        isSuperAdmin: false,
      },
      transaction,
    );
    assert.equal(result.created, false);
    assert.equal(result.roleId, role.id);
  });
  await role.reload();
  assert.equal(role.active, false);
  assert.equal((await repository.getRolePermissions(role.id)).length, 1);
  await role.update({ active: true });
});

test("PostgreSQL: alias migration preserves grants and explicit deny takes priority", async () => {
  const module = await models.Module.create({
    id: randomUUID(),
    name: "Legacy Referral Rules",
    slug: "sidebar-referral-rules",
    moduleKey: "sidebar-referral-rules",
    metadata: { source: "sidebar-seed", requiredModule: "referral-rules" },
  });
  const legacy = await models.Permission.create({
    id: randomUUID(),
    moduleId: module.id,
    name: "Legacy View",
    slug: "sidebar-referral-rules:view",
    action: "view",
  });
  await repository.assignPermissionToRole(role.id, legacy.id);
  await repository.syncUserPermissions(user._id, [view.id], [legacy.id]);
  await sequelize.transaction((transaction) =>
    seed.migrateEquivalentAssignments(
      { "referral-rules:view": view.id },
      transaction,
    ),
  );
  const direct = await repository.getUserPermissions(user._id);
  assert.ok(
    direct.some(
      (row) => row.permissionId === view.id && row.metadata.effect === "deny",
    ),
  );
  assert.equal((await service.getUserEffectivePermissions(user._id)).length, 0);
});

test("PostgreSQL: disabled canonical modules cannot be re-enabled through alias grants", async () => {
  await repository.syncUserPermissions(user._id, [], []);
  const module = await models.Module.findByPk(view.moduleId);
  await module.update({ active: false });
  assert.equal((await service.getUserEffectivePermissions(user._id)).length, 0);
  await module.update({ active: true });
});

test("HTTP workflow: assign, update, deny writes, reject invalid IDs, remove all access", async (t) => {
  const express = require("express");
  const {
    allowPermissions,
    allowRoles,
    allowActions,
  } = require("../src/shared/middleware/access");
  const { checkInput } = require("../src/shared/middleware/check-input");
  const { catchErrors } = require("../src/shared/middleware/catch-errors");
  const validation = require("../src/modules/rbac/validation/rbac.validation");
  const controllerClass = load(
    "../src/modules/rbac/controllers/permission-assignment.controller.js",
    [["/rbac.service", { RbacService: serviceClass }]],
  ).PermissionAssignmentController;
  const controller = new controllerClass({ rbacService: service });
  const app = express();
  app.use(express.json());
  app.use(
    catchErrors(async (req, _res, next) => {
      req.auth =
        req.headers["x-test-root"] === "1"
          ? {
              sub: "root",
              role: "super-admin",
              isSuperAdmin: true,
              permissions: [],
            }
          : {
              sub: user._id,
              role: user.role,
              allowedModules: user.allowedModules,
              permissions: (
                await service.getUserEffectivePermissions(user._id)
              ).map((row) => row.slug),
            };
      next();
    }),
  );
  app.put(
    "/api/v1/rbac/users/:userId/permissions",
    allowRoles("admin", "sub-admin"),
    allowPermissions("rbac:assign"),
    checkInput({
      ...validation.userPermissionParamSchema,
      body: validation.syncUserPermissionsSchema.body,
    }),
    catchErrors(controller.syncUserPermissions),
  );
  const target = "/api/v1/admin/commerce-settings/marketing-policy/referrals";
  app.get(
    target,
    allowRoles("admin", "sub-admin"),
    allowActions("admin_control"),
    (_req, res) => res.json({ success: true }),
  );
  app.put(
    target,
    allowRoles("admin", "sub-admin"),
    allowActions("admin_control"),
    (_req, res) => res.json({ success: true }),
  );
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ message: error.message }),
  );
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const assign = (ids) =>
    fetch(`${url}/api/v1/rbac/users/${user._id}/permissions`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-root": "1" },
      body: JSON.stringify({ permissionIds: ids }),
    });
  assert.equal((await assign([view.id, update.id])).status, 200);
  assert.equal((await fetch(url + target, { method: "PUT" })).status, 200);
  assert.equal((await assign([view.id])).status, 200);
  assert.equal((await fetch(url + target)).status, 200);
  assert.equal((await fetch(url + target, { method: "PUT" })).status, 403);
  assert.equal((await assign([randomUUID()])).status, 400);
  assert.equal((await fetch(url + target)).status, 200);
  assert.equal((await assign([])).status, 200);
  assert.equal((await fetch(url + target)).status, 403);
});

test("PostgreSQL: full catalog reconciles with no duplicate assignment entries", async () => {
  seed.validateSeedCatalog();
  const platform = seed.makePlatformModuleList();
  const navigation = seed.makeSidebarModuleList();
  await sequelize.transaction(async (transaction) => {
    for (const module of [...platform, ...navigation])
      await seed.upsertModule(module, transaction);
    await seed.upsertPermissions(
      seed.makePermissionList([...platform, ...navigation]),
      transaction,
    );
  });
  const matrix = await service.getPermissionManagementMatrix({
    roleSlug: "admin",
  });
  assert.equal(
    new Set(matrix.modules.map((module) => module.slug)).size,
    matrix.modules.length,
  );
  assert.ok(
    matrix.modules.some((module) => module.slug === "referral-hierarchy"),
  );
  assert.ok(
    !matrix.modules.some((module) => module.slug.startsWith("sidebar-")),
  );
  assert.equal(
    matrix.modules
      .find((module) => module.slug === "referral-hierarchy")
      .permissions.map((permission) => permission.action)
      .join(","),
    "view",
  );
  const userMatrix = await service.getPermissionManagementMatrix({
    userId: user._id,
  });
  assert.equal(
    userMatrix.modules
      .flatMap((module) => module.permissions)
      .filter((permission) => permission.assigned).length,
    0,
  );
  await role.reload();
  assert.equal(role.active, true);
  assert.equal((await repository.getRolePermissions(role.id)).length, 2);
});

test('PostgreSQL: custom role creation, inheritance, override, removal and deletion', async () => {
  const custom = await service.createRole({ name: 'Referral Operators', slug: 'referral-operators', type: 'custom' }, root);
  await service.syncRolePermissions(custom.id, [view.id, update.id], root);
  const target = { _id: 'role-workflow-user', role: 'admin', allowedModules: ['referral-rules'] };
  users.set(target._id, target);
  await service.assignRoleToUser(target._id, custom.id, 'root', root);
  let effective = await service.getUserEffectivePermissions(target._id);
  assert.ok(effective.some(permission => permission.slug === 'referral-rules:update'));
  await service.syncUserModulePermissions(target._id, [{ module: 'referral-rules', actions: ['view'] }], 'root', root);
  effective = await service.getUserEffectivePermissions(target._id);
  assert.equal(effective.map(permission => permission.slug).join(','), 'referral-rules:view');
  await service.removeRoleFromUser(target._id, custom.id, root);
  await service.syncUserPermissions(target._id, [], [], 'root', root);
  assert.equal((await service.getUserEffectivePermissions(target._id)).length, 0);
  await service.deleteRole(custom.id, root);
  assert.equal(await repository.getRoleById(custom.id), null);
});

test('PostgreSQL: template reconciliation keeps customized fields and canonicalizes valid legacy permissions', async () => {
  const template = await models.PermissionTemplate.create({ id: randomUUID(), slug: 'custom-read-only', name: 'Custom Read Only', description: 'Keep my description', roleScope: ['admin'], permissionSlugs: ['sidebar-referral-rules:view', 'referral-rules:view', 'nonexistent:view'] });
  await sequelize.transaction(transaction => seed.migrateTemplatePermissionSlugs(transaction));
  await template.reload();
  assert.equal(template.permissionSlugs.join(','), 'referral-rules:view');
  assert.equal(template.name, 'Custom Read Only');
  assert.equal(template.description, 'Keep my description');
  assert.equal(template.roleScope.join(','), 'admin');
});
