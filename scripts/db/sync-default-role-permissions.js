#!/usr/bin/env node

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
  getDefaultPermissionSlugsForRole,
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

async function loadRoles(roleSlugs, transaction) {
  const [rows] = await sequelize.query(
    `SELECT id, slug
     FROM roles
     WHERE slug = ANY($1::text[])`,
    {
      bind: [roleSlugs],
      transaction,
    },
  );
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function loadPermissionIds(permissionSlugs, transaction) {
  if (!permissionSlugs.length) return new Map();

  const [rows] = await sequelize.query(
    `SELECT id, slug
     FROM permissions
     WHERE active = true
       AND slug = ANY($1::text[])`,
    {
      bind: [permissionSlugs],
      transaction,
    },
  );
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function syncRolePermissions(roleId, permissionIds, transaction) {
  await sequelize.query(
    `DELETE FROM role_permissions
     WHERE role_id = $1
       AND NOT (permission_id = ANY($2::uuid[]))`,
    {
      bind: [roleId, permissionIds],
      transaction,
    },
  );

  if (!permissionIds.length) return;

  await sequelize.query(
    `WITH desired AS (
       SELECT *
       FROM unnest($2::uuid[], $3::uuid[]) AS item(id, permission_id)
     )
     INSERT INTO role_permissions
       (id, role_id, permission_id, created_at)
     SELECT desired.id, $1::uuid, desired.permission_id, NOW()
     FROM desired
     WHERE NOT EXISTS (
       SELECT 1
       FROM role_permissions rp
       WHERE rp.role_id = $1::uuid
         AND rp.permission_id = desired.permission_id
     )`,
    {
      bind: [
        roleId,
        permissionIds.map(() => uuidv4()),
        permissionIds,
      ],
      transaction,
    },
  );
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

async function syncDefaultRolePermissions() {
  const { dryRun, skipMongo, roles } = parseArgs();
  const unknownRoles = roles.filter((role) => !ROLE_PERMISSION_DEFAULTS[role]);

  if (unknownRoles.length) {
    throw new Error(`Unknown role defaults: ${unknownRoles.join(", ")}`);
  }

  await sequelize.authenticate();
  console.log("Database connected");
  if (dryRun) console.log("Dry run: no database writes will be made");

  const transaction = await sequelize.transaction();
  const summary = [];
  let roleIdBySlug;

  try {
    roleIdBySlug = await loadRoles(roles, transaction);
    const missingRoles = roles.filter((role) => !roleIdBySlug.has(role));
    if (missingRoles.length) {
      throw new Error(
        `Missing roles: ${missingRoles.join(", ")}. Run npm run db:seed:rbac first.`,
      );
    }

    for (const role of roles) {
      const permissionSlugs = getDefaultPermissionSlugsForRole(role);
      const permissionIdBySlug = await loadPermissionIds(permissionSlugs, transaction);
      const missingPermissions = permissionSlugs.filter(
        (slug) => !permissionIdBySlug.has(slug),
      );

      if (missingPermissions.length) {
        throw new Error(
          `Missing permissions for ${role}: ${missingPermissions.slice(0, 10).join(", ")}${
            missingPermissions.length > 10 ? "..." : ""
          }. Run npm run db:seed:rbac first.`,
        );
      }

      const permissionIds = permissionSlugs.map((slug) => permissionIdBySlug.get(slug));
      if (!dryRun) {
        await syncRolePermissions(roleIdBySlug.get(role), permissionIds, transaction);
      }

      summary.push({
        role,
        permissions: permissionIds.length,
      });
    }

    if (dryRun) {
      await transaction.rollback();
    } else {
      await transaction.commit();
    }
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  console.log("\nRole permission defaults:");
  summary.forEach((item) => {
    console.log(`  ${item.role.padEnd(16)} ${item.permissions} permissions`);
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

syncDefaultRolePermissions()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  });
