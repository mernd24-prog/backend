#!/usr/bin/env node
/**
 * RBAC role assignment repair script.
 *
 * This does not seed roles or role_permissions. It only backfills user_roles
 * rows for Mongo users whose `role` field already points at a seeded RBAC role,
 * then invalidates affected sessions so permissions rehydrate.
 */

const { v4: uuidv4 } = require("uuid");
const {
  connectMongo,
  mongoose,
} = require("../../src/infrastructure/mongo/mongo-client");
const {
  sequelize,
} = require("../../src/infrastructure/sequelize/sequelize-client");
const { UserModel } = require("../../src/modules/user/models/user.model");
const {
  SESSION_INVALIDATION_REASONS,
  makeSessionInvalidationUpdate,
} = require("../../src/shared/auth/session-state");
const {
  ROLE_PERMISSION_DEFAULTS,
  getDefaultModulesForRole,
} = require("./rbac-role-defaults");

const SCOPED_ROLE_SLUGS = new Set([
  "admin",
  "sub-admin",
  "seller-admin",
  "seller-sub-admin",
]);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const roleArg = args.find((arg) => arg.startsWith("--roles="));
  const roles = roleArg
    ? roleArg
        .slice("--roles=".length)
        .split(",")
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean)
    : Object.keys(ROLE_PERMISSION_DEFAULTS);

  return {
    dryRun: args.includes("--dry-run"),
    skipMongo: args.includes("--skip-mongo"),
    roles,
  };
};

async function loadRoles(roleSlugs) {
  const [rows] = await sequelize.query(
    `SELECT id, slug
     FROM roles
     WHERE slug = ANY($1::text[])`,
    { bind: [roleSlugs] },
  );
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function backfillUserRoleRows(roleIdBySlug, roleSlugs, dryRun) {
  await connectMongo();

  const users = await UserModel.find({ role: { $in: roleSlugs } })
    .select("_id role allowedModules")
    .lean();

  if (!users.length) {
    return { users: 0, roleRowsAdded: 0, modulesBackfilled: 0, invalidated: 0 };
  }

  const userIds = users.map((user) => String(user._id));
  const [existingRows] = await sequelize.query(
    `SELECT user_id, role_id
     FROM user_roles
     WHERE revoked_at IS NULL
       AND user_id = ANY($1::text[])`,
    { bind: [userIds] },
  );
  const existing = new Set(
    existingRows.map((row) => `${row.user_id}:${row.role_id}`),
  );

  const roleRowsToAdd = users
    .map((user) => {
      const roleId = roleIdBySlug.get(user.role);
      if (!roleId) return null;
      const key = `${String(user._id)}:${roleId}`;
      if (existing.has(key)) return null;
      return {
        id: uuidv4(),
        userId: String(user._id),
        roleId,
      };
    })
    .filter(Boolean);

  const usersNeedingDefaultModules = users.filter((user) => {
    if (!SCOPED_ROLE_SLUGS.has(user.role)) return false;
    return !Array.isArray(user.allowedModules) || user.allowedModules.length === 0;
  });

  if (!dryRun && roleRowsToAdd.length) {
    await sequelize.query(
      `WITH desired AS (
         SELECT *
         FROM unnest($1::uuid[], $2::text[], $3::uuid[]) AS item(id, user_id, role_id)
       )
       INSERT INTO user_roles
         (id, user_id, role_id, assigned_at)
       SELECT desired.id, desired.user_id, desired.role_id, NOW()
       FROM desired
       WHERE NOT EXISTS (
         SELECT 1
         FROM user_roles ur
         WHERE ur.user_id = desired.user_id
           AND ur.role_id = desired.role_id
           AND ur.revoked_at IS NULL
       )`,
      {
        bind: [
          roleRowsToAdd.map((row) => row.id),
          roleRowsToAdd.map((row) => row.userId),
          roleRowsToAdd.map((row) => row.roleId),
        ],
      },
    );
  }

  if (!dryRun) {
    for (const user of usersNeedingDefaultModules) {
      await UserModel.updateOne(
        { _id: user._id },
        { $set: { allowedModules: getDefaultModulesForRole(user.role) } },
      );
    }

    await UserModel.updateMany(
      { _id: { $in: users.map((user) => user._id) } },
      makeSessionInvalidationUpdate(
        SESSION_INVALIDATION_REASONS.PERMISSIONS_CHANGED,
      ),
    );
  }

  return {
    users: users.length,
    roleRowsAdded: roleRowsToAdd.length,
    modulesBackfilled: usersNeedingDefaultModules.length,
    invalidated: dryRun ? 0 : users.length,
  };
}

async function repairRbacRoleAssignments() {
  const { dryRun, skipMongo, roles } = parseArgs();
  const unknownRoles = roles.filter((role) => !ROLE_PERMISSION_DEFAULTS[role]);

  if (unknownRoles.length) {
    throw new Error(`Unknown role defaults: ${unknownRoles.join(", ")}`);
  }

  await sequelize.authenticate();
  console.log("Database connected");
  if (dryRun) console.log("Dry run: no database writes will be made");

  const roleIdBySlug = await loadRoles(roles);
  const missingRoles = roles.filter((role) => !roleIdBySlug.has(role));
  if (missingRoles.length) {
    throw new Error(
      `Missing roles: ${missingRoles.join(", ")}. Run npm run db:seed:rbac first.`,
    );
  }

  console.log("\nRBAC role assignment repair:");
  roles.forEach((role) => {
    console.log(`  ${role.padEnd(16)} role exists`);
  });

  if (!skipMongo) {
    const backfillSummary = await backfillUserRoleRows(roleIdBySlug, roles, dryRun);
    console.log("\nUser role backfill:");
    console.log(`  users scanned        ${backfillSummary.users}`);
    console.log(`  user_roles added     ${backfillSummary.roleRowsAdded}`);
    console.log(`  modules backfilled   ${backfillSummary.modulesBackfilled}`);
    console.log(`  sessions invalidated ${backfillSummary.invalidated}`);
  }

  console.log("\nDone.");
}

repairRbacRoleAssignments()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  });
