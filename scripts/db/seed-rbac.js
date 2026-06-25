#!/usr/bin/env node
/**
 * Canonical RBAC seed script — idempotent, safe to re-run at any time.
 *
 * This is the only script that seeds roles and role_permissions. Use
 * repair-rbac-role-assignments.js only to backfill user_roles rows for users
 * created outside the normal RBAC-aware creation flow.
 */

const { v4: uuidv4 } = require("uuid");
const { sequelize } = require("../../src/infrastructure/sequelize/sequelize-client");
const {
  MODULE_CATALOG,
  DEFAULT_SELLER_MODULES,
} = require("../../src/shared/auth/module-catalog");
const {
  SIDEBAR_MODULES,
} = require("../../src/shared/auth/admin-sidebar-catalog");
const {
  getDefaultPermissionSlugsForRole,
} = require("./rbac-role-defaults");
const {
  PERMISSION_ACTIONS,
  SIDEBAR_PERMISSION_ACTIONS,
} = require("../../src/shared/auth/rbac-permissions");

const ACTION_LABELS = {
  view: "View",
  create: "Create",
  update: "Update",
  delete: "Delete",
  approve: "Approve",
  reject: "Reject",
  assign: "Assign",
  export: "Export",
  import: "Import",
  status_change: "Status Change",
  restore: "Restore",
  bulk_action: "Bulk Action",
  adjust: "Adjust",
};

function formatActionLabel(action) {
  return String(action || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function makeActionList(actions) {
  return actions.map((key) => ({
    key,
    label: ACTION_LABELS[key] || formatActionLabel(key),
  }));
}

const CANONICAL_ACTIONS = makeActionList(PERMISSION_ACTIONS);
const SIDEBAR_ACTIONS = makeActionList(SIDEBAR_PERMISSION_ACTIONS);

const LEGACY_ACTION_KEYS = [
  "add",
  "edit",
  "approval",
  "status",
  "action",
  "review",
  "manage",
];

const LEGACY_MODULE_SLUGS = [
  "product",
  "user",
  "order",
  "seller",
  "settings",
  "locations",
];

const NON_SYSTEM_ROLE_SLUGS = ["moderator", "product-manager"];

function makePlatformModuleList() {
  return MODULE_CATALOG.map((module, index) => ({
    id: uuidv4(),
    name: module.name,
    slug: module.slug,
    moduleKey: module.slug,
    description: module.description || null,
    icon: module.icon || "grid",
    routePath: module.routePath || null,
    parentModule: null,
    parentModuleId: null,
    moduleType: "module",
    status: "active",
    actions: CANONICAL_ACTIONS,
    isVisibleInSidebar: false,
    order: Math.round(Number(module.order || index + 1) * 10),
    metadata: {
      tab: module.tab,
      forPlatform: module.forPlatform !== false,
      forSeller: module.forSeller === true,
      apiPath: module.apiPath || null,
      apiAliases: module.apiAliases || [],
    },
  }));
}

function makeSidebarModuleList() {
  return SIDEBAR_MODULES.map((module) => ({
    id: uuidv4(),
    name: module.moduleName,
    slug: `sidebar-${module.moduleSlug}`,
    moduleKey: `sidebar-${module.moduleKey}`,
    description: `${module.moduleName} sidebar page`,
    icon: module.icon || "MdViewModule",
    routePath: module.routePath || null,
    parentModule: module.parentModule ? `sidebar-${module.parentModule}` : null,
    parentModuleId: null,
    moduleType: module.moduleType || "page",
    status: module.status || "active",
    actions: SIDEBAR_ACTIONS,
    isVisibleInSidebar: module.isVisibleInSidebar !== false,
    order: Number(module.order || 0),
    metadata: {
      ...(module.metadata || {}),
      requiredModule: module.requiredModule || module.moduleKey,
      routeKey: module.moduleKey,
      tab: module.tab || null,
      allowedRoles: module.allowedRoles || ["super-admin", "admin", "sub-admin"],
      source: "sidebar-seed",
    },
  }));
}

function validateSeedCatalog() {
  const catalogSlugs = new Set(MODULE_CATALOG.map((module) => module.slug));
  const sidebarKeys = new Set(SIDEBAR_MODULES.map((module) => module.moduleKey));
  const missingRequiredModules = SIDEBAR_MODULES
    .filter((module) => module.requiredModule && !catalogSlugs.has(module.requiredModule))
    .map((module) => `${module.moduleKey}->${module.requiredModule}`);
  const missingParents = SIDEBAR_MODULES
    .filter((module) => module.parentModule && !sidebarKeys.has(module.parentModule))
    .map((module) => `${module.moduleKey}->${module.parentModule}`);

  if (missingRequiredModules.length || missingParents.length) {
    throw new Error(
      [
        "RBAC seed catalog mismatch:",
        missingRequiredModules.length
          ? `missing backend modules: ${missingRequiredModules.join(", ")}`
          : null,
        missingParents.length
          ? `missing sidebar parents: ${missingParents.join(", ")}`
          : null,
      ].filter(Boolean).join(" "),
    );
  }
}

function serializeModuleForDb(module) {
  return {
    ...module,
    metadata: JSON.stringify(module.metadata || {}),
    modulePermissions: JSON.stringify((module.actions || []).map((a) => a.key)),
  };
}

function makePermissionList(modules) {
  return modules.flatMap((module) =>
    (module.actions || []).map((action) => ({
      moduleId: module.id,
      name: `${action.label} ${module.name}`,
      slug: `${module.slug}:${action.key}`,
      action: action.key,
    })),
  );
}

function slugsFor(moduleSlug, actions = CANONICAL_ACTIONS) {
  return actions.map(
    (action) =>
      `${moduleSlug}:${typeof action === "string" ? action : action.key}`,
  );
}

function slugsForModules(moduleSlugs, actions = CANONICAL_ACTIONS) {
  return moduleSlugs.flatMap((slug) => slugsFor(slug, actions));
}

async function upsertModule(module, transaction) {
  // Sidebar modules use prefixed slugs, but the modules table also has a unique
  // name constraint. Prefer slug/key and fall back to name so partial seeds can
  // repair old rows instead of failing on a duplicate display name.
  const isSidebarModule = module.slug?.startsWith("sidebar-");

  const lookupSql = isSidebarModule
    ? `SELECT id FROM modules
       WHERE slug = :slug
          OR module_key = :moduleKey
          OR name = :name
       ORDER BY CASE
         WHEN slug = :slug OR module_key = :moduleKey THEN 0
         ELSE 1
       END
       LIMIT 1`
    : `SELECT id FROM modules
       WHERE slug = :slug
          OR module_key = :moduleKey
          OR name = :name
       ORDER BY CASE
         WHEN slug = :slug OR module_key = :moduleKey THEN 0
         ELSE 1
       END
       LIMIT 1`;

  const [existing] = await sequelize.query(lookupSql, {
    replacements: {
      slug: module.slug,
      moduleKey: module.moduleKey,
      name: module.name,
      source: module.metadata?.source || "",
    },
    transaction,
  });

  const dbRow = serializeModuleForDb(module);
  const active = module.status === "active";

  if (existing.length > 0) {
    module.id = existing[0].id;

    await sequelize.query(
      `UPDATE modules
       SET name = :name,
           slug = :slug,
           module_key = :moduleKey,
           description = :description,
           icon = :icon,
           route_path = :routePath,
           parent_module_id = :parentModuleId,
           module_type = :moduleType,
           "order" = :order,
           status = :status,
           active = :active,
           module_permissions = CAST(:modulePermissions AS jsonb),
           is_visible_in_sidebar = :isVisibleInSidebar,
           metadata = CAST(:metadata AS jsonb),
           updated_at = NOW()
       WHERE id = :id`,
      {
        replacements: {
          ...dbRow,
          id: module.id,
          active,
        },
        transaction,
      },
    );
  } else {
    await sequelize.query(
      `INSERT INTO modules
         (id, name, slug, module_key, description, icon, route_path, parent_module_id,
          module_type, "order", status, active, module_permissions, is_visible_in_sidebar,
          metadata, created_at, updated_at)
       VALUES
         (:id, :name, :slug, :moduleKey, :description, :icon, :routePath, :parentModuleId,
          :moduleType, :order, :status, :active, CAST(:modulePermissions AS jsonb), :isVisibleInSidebar,
          CAST(:metadata AS jsonb), NOW(), NOW())`,
      {
        replacements: {
          ...dbRow,
          active,
        },
        transaction,
      },
    );
  }
}

async function upsertPermissions(permissions, transaction) {
  const payload = JSON.stringify(
    permissions.map((perm) => ({
      module_id: perm.moduleId,
      name: perm.name,
      slug: perm.slug,
      action: perm.action,
    })),
  );

  const [updatedRows] = await sequelize.query(
    `WITH input AS (
       SELECT *
       FROM jsonb_to_recordset(CAST(:payload AS jsonb))
         AS item(module_id uuid, name text, slug text, action text)
     )
     UPDATE permissions p
     SET module_id = input.module_id,
         name = input.name,
         action = input.action,
         active = true,
         updated_at = NOW()
     FROM input
     WHERE p.slug = input.slug
     RETURNING p.slug, p.id`,
    {
      replacements: { payload },
      transaction,
    },
  );

  const permissionBySlug = {};
  for (const row of updatedRows) {
    permissionBySlug[row.slug] = row.id;
  }

  const existingSlugs = new Set(updatedRows.map((row) => row.slug));
  const inserts = permissions
    .filter((perm) => !existingSlugs.has(perm.slug))
    .map((perm) => ({
      id: uuidv4(),
      module_id: perm.moduleId,
      name: perm.name,
      slug: perm.slug,
      action: perm.action,
    }));

  if (inserts.length > 0) {
    const [insertedRows] = await sequelize.query(
      `WITH input AS (
         SELECT *
         FROM jsonb_to_recordset(CAST(:payload AS jsonb))
           AS item(id uuid, module_id uuid, name text, slug text, action text)
       )
       INSERT INTO permissions
         (id, module_id, name, slug, action, active, created_at, updated_at)
       SELECT id, module_id, name, slug, action, true, NOW(), NOW()
       FROM input
       RETURNING slug, id`,
      {
        replacements: { payload: JSON.stringify(inserts) },
        transaction,
      },
    );

    for (const row of insertedRows) {
      permissionBySlug[row.slug] = row.id;
    }
  }

  return permissionBySlug;
}

async function upsertRole(role, transaction) {
  const [existing] = await sequelize.query(
    `SELECT id FROM roles WHERE slug = :slug LIMIT 1`,
    {
      replacements: { slug: role.slug },
      transaction,
    },
  );

  let roleId = role.id;

  if (existing.length > 0) {
    roleId = existing[0].id;

    await sequelize.query(
      `UPDATE roles
       SET name = :name,
           description = :description,
           type = :type,
           is_super_admin = :isSuperAdmin,
           active = true,
           updated_at = NOW()
       WHERE id = :roleId`,
      {
        replacements: {
          roleId,
          ...role,
        },
        transaction,
      },
    );
  } else {
    await sequelize.query(
      `INSERT INTO roles
         (id, name, slug, description, type, is_super_admin, active, created_at, updated_at)
       VALUES
         (:id, :name, :slug, :description, :type, :isSuperAdmin, true, NOW(), NOW())`,
      {
        replacements: {
          id: roleId,
          ...role,
        },
        transaction,
      },
    );
  }

  return roleId;
}

async function syncRolePermissions(roleId, desiredPermissionIds, transaction) {
  if (desiredPermissionIds.length > 0) {
    await sequelize.query(
      `DELETE FROM role_permissions
       WHERE role_id = $1
         AND NOT (permission_id = ANY($2::uuid[]))`,
      {
        bind: [roleId, desiredPermissionIds],
        transaction,
      },
    );

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
          desiredPermissionIds.map(() => uuidv4()),
          desiredPermissionIds,
        ],
        transaction,
      },
    );
  } else {
    await sequelize.query(
      `DELETE FROM role_permissions WHERE role_id = :roleId`,
      {
        replacements: { roleId },
        transaction,
      },
    );
  }
}

async function seedRbac() {
  const transaction = await sequelize.transaction();

  try {
    await sequelize.authenticate();
    console.log("✓ Database connected\n");
    validateSeedCatalog();

    const platformModules = makePlatformModuleList();
    const sidebarModules = makeSidebarModuleList();

    const allModules = [...platformModules, ...sidebarModules].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name),
    );

    for (const module of allModules) {
      await upsertModule(module, transaction);
    }

    const [moduleRows] = await sequelize.query(
      `SELECT id, module_key
       FROM modules
       WHERE module_key = ANY($1::text[])`,
      {
        bind: [allModules.map((m) => m.moduleKey)],
        transaction,
      },
    );

    const idByKey = new Map(moduleRows.map((row) => [row.module_key, row.id]));

    allModules.forEach((m) => {
      if (idByKey.has(m.moduleKey)) {
        m.id = idByKey.get(m.moduleKey);
      }
    });

    for (const module of allModules) {
      if (!module.parentModule) continue;

      const parentId = idByKey.get(module.parentModule);
      const moduleId = idByKey.get(module.moduleKey);

      if (!parentId || !moduleId) continue;

      await sequelize.query(
        `UPDATE modules
         SET parent_module_id = :parentId,
             updated_at = NOW()
         WHERE id = :moduleId`,
        {
          replacements: {
            parentId,
            moduleId,
          },
          transaction,
        },
      );
    }

    console.log(`✓ Upserted ${platformModules.length} platform modules`);
    console.log(`✓ Upserted ${sidebarModules.length} sidebar modules`);

    await sequelize.query(
      `UPDATE modules
       SET active = false,
           status = 'inactive',
           is_visible_in_sidebar = false,
           updated_at = NOW()
       WHERE metadata->>'source' = 'sidebar-seed'
         AND module_key <> ALL($1::text[])`,
      {
        bind: [sidebarModules.map((m) => m.moduleKey)],
        transaction,
      },
    );

    await sequelize.query(
      `UPDATE modules
       SET active = false,
           status = 'inactive',
           updated_at = NOW()
       WHERE slug = ANY($1::text[])`,
      {
        bind: [LEGACY_MODULE_SLUGS],
        transaction,
      },
    );

    const permissions = makePermissionList(allModules);
    const permissionBySlug = await upsertPermissions(permissions, transaction);

    console.log(`✓ Upserted ${permissions.length} permissions`);

    await sequelize.query(
      `UPDATE permissions
       SET active = false,
           updated_at = NOW()
       WHERE module_id = ANY($1::uuid[])
         AND slug <> ALL($2::text[])`,
      {
        bind: [
          allModules.map((m) => m.id),
          permissions.map((p) => p.slug),
        ],
        transaction,
      },
    );

    await sequelize.query(
      `UPDATE permissions
       SET active = false,
           updated_at = NOW()
       WHERE action = ANY($1::text[])`,
      {
        bind: [LEGACY_ACTION_KEYS],
        transaction,
      },
    );

    await sequelize.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT id FROM permissions WHERE active = false
       )`,
      { transaction },
    );

    await sequelize.query(
      `UPDATE permissions p
       SET active = false,
           updated_at = NOW()
       FROM modules m
       WHERE m.id = p.module_id
         AND m.slug = ANY($1::text[])`,
      {
        bind: [LEGACY_MODULE_SLUGS],
        transaction,
      },
    );

    const rolePermissionSlugs = {
      "super-admin": getDefaultPermissionSlugsForRole("super-admin"),
      admin: getDefaultPermissionSlugsForRole("admin"),
      "sub-admin": getDefaultPermissionSlugsForRole("sub-admin"),
      seller: getDefaultPermissionSlugsForRole("seller"),
      "seller-admin": getDefaultPermissionSlugsForRole("seller-admin"),
      "seller-sub-admin": getDefaultPermissionSlugsForRole("seller-sub-admin"),
      buyer: getDefaultPermissionSlugsForRole("buyer"),
    };

    const SYSTEM_ROLES = [
      {
        id: uuidv4(),
        name: "Super Admin",
        slug: "super-admin",
        description: "Full platform access; bypasses all permission checks in code",
        type: "system",
        isSuperAdmin: true,
        permissionSlugs: rolePermissionSlugs["super-admin"],
      },
      {
        id: uuidv4(),
        name: "Admin",
        slug: "admin",
        description:
          "Platform admin with role-based platform access; permissions remain editable from RBAC",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: rolePermissionSlugs.admin,
      },
      {
        id: uuidv4(),
        name: "Sub Admin",
        slug: "sub-admin",
        description: "Scoped platform admin with role-based platform access; permissions remain editable from RBAC",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: rolePermissionSlugs["sub-admin"],
      },
      {
        id: uuidv4(),
        name: "Seller",
        slug: "seller",
        description:
          "Seller owner with full seller-panel access on all seller modules",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: rolePermissionSlugs.seller,
      },
      {
        id: uuidv4(),
        name: "Seller Admin",
        slug: "seller-admin",
        description:
          "Seller-side admin with role-based seller-panel access; permissions remain editable from RBAC",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: rolePermissionSlugs["seller-admin"],
      },
      {
        id: uuidv4(),
        name: "Seller Sub Admin",
        slug: "seller-sub-admin",
        description: "Scoped seller-panel admin with role-based seller-panel access; permissions remain editable from RBAC",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: rolePermissionSlugs["seller-sub-admin"],
      },
      {
        id: uuidv4(),
        name: "Buyer",
        slug: "buyer",
        description: "Customer account; not part of the RBAC module system",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: [],
      },
    ];

    for (const role of SYSTEM_ROLES) {
      const roleId = await upsertRole(role, transaction);

      const desiredIds = role.permissionSlugs
        .map((slug) => permissionBySlug[slug])
        .filter(Boolean);

      await syncRolePermissions(roleId, desiredIds, transaction);
    }

    console.log(`✓ Upserted ${SYSTEM_ROLES.length} system roles`);
    SYSTEM_ROLES.forEach((role) => {
      console.log(`  ${role.slug.padEnd(16)} → ${role.permissionSlugs.length} permissions`);
    });

    await sequelize.query(
      `UPDATE roles
       SET active = false,
           updated_at = NOW()
       WHERE slug = ANY($1::text[])`,
      {
        bind: [NON_SYSTEM_ROLE_SLUGS],
        transaction,
      },
    );

    await sequelize.query(
      `DELETE FROM role_permissions
       WHERE role_id IN (
         SELECT id FROM roles WHERE active = false
       )`,
      { transaction },
    );

    // STEP 13 — seed permission templates
    const PERMISSION_TEMPLATES = [
      {
        slug: "read-only-platform",
        name: "Read-Only Platform",
        description: "View all platform modules, no write access",
        roleScope: ["admin", "sub-admin"],
        permissionSlugs: platformModules.map((m) => `${m.slug}:view`),
      },
      {
        slug: "catalog-manager",
        name: "Catalog Manager",
        description: "Full catalog control — products, categories, brands, options",
        roleScope: ["sub-admin"],
        permissionSlugs: slugsForModules(
          ["products", "categories", "sub_categories", "sub_sub_categories", "brands", "option_masters", "option_values"],
          CANONICAL_ACTIONS.filter((a) => !["restore", "bulk_action"].includes(a.key)),
        ),
      },
      {
        slug: "order-fulfillment",
        name: "Order Fulfillment",
        description: "Process and manage orders and returns",
        roleScope: ["sub-admin"],
        permissionSlugs: [
          ...slugsFor("orders", [{ key: "view" }, { key: "update" }, { key: "status_change" }, { key: "export" }]),
          ...slugsFor("returns", [{ key: "view" }, { key: "update" }, { key: "approve" }, { key: "reject" }, { key: "status_change" }]),
        ],
      },
      {
        slug: "finance-auditor",
        name: "Finance Auditor",
        description: "Read-only access to all financial data with export",
        roleScope: ["sub-admin"],
        permissionSlugs: [
          ...slugsFor("payments", [{ key: "view" }, { key: "export" }]),
          ...slugsFor("wallets", [{ key: "view" }, { key: "export" }]),
          ...slugsFor("orders", [{ key: "view" }, { key: "export" }]),
          ...slugsFor("tax", [{ key: "view" }]),
        ],
      },
      {
        slug: "user-moderator",
        name: "User Moderator",
        description: "Manage users, buyers, and content reviews",
        roleScope: ["sub-admin"],
        permissionSlugs: [
          ...slugsFor("users", [{ key: "view" }, { key: "update" }, { key: "status_change" }, { key: "export" }]),
          ...slugsFor("reviews", [{ key: "view" }, { key: "approve" }, { key: "reject" }, { key: "delete" }]),
        ],
      },
      {
        slug: "seller-onboarding",
        name: "Seller Onboarding",
        description: "Review and approve seller KYC and bank verification",
        roleScope: ["sub-admin"],
        permissionSlugs: [
          ...slugsFor("sellers", [{ key: "view" }, { key: "approve" }, { key: "reject" }, { key: "status_change" }]),
          ...slugsFor("seller_kyc", [{ key: "view" }, { key: "approve" }, { key: "reject" }, { key: "update" }]),
          ...slugsFor("seller_bank", [{ key: "view" }, { key: "approve" }, { key: "reject" }, { key: "update" }]),
        ],
      },
      {
        slug: "content-editor",
        name: "Content Editor",
        description: "Manage banners, CMS pages, and notifications",
        roleScope: ["sub-admin"],
        permissionSlugs: [
          ...slugsFor("banners", CANONICAL_ACTIONS.filter((a) => !["restore", "bulk_action"].includes(a.key))),
          ...slugsFor("cms_pages", CANONICAL_ACTIONS.filter((a) => !["restore", "bulk_action"].includes(a.key))),
          ...slugsFor("cms", [{ key: "view" }, { key: "create" }, { key: "update" }, { key: "delete" }]),
          ...slugsFor("notifications", [{ key: "view" }, { key: "create" }, { key: "update" }, { key: "export" }]),
        ],
      },
      {
        slug: "seller-full-access",
        name: "Seller Full Access",
        description: "Full access to all seller modules",
        roleScope: ["seller"],
        permissionSlugs: slugsForModules(DEFAULT_SELLER_MODULES, CANONICAL_ACTIONS),
      },
      {
        slug: "seller-read-only",
        name: "Seller Read-Only",
        description: "View-only access across all seller modules",
        roleScope: ["seller", "seller-admin"],
        permissionSlugs: DEFAULT_SELLER_MODULES.map((m) => `${m}:view`),
      },
      {
        slug: "seller-catalog-ops",
        name: "Seller Catalog Ops",
        description: "Manage seller's product catalog, inventory, pricing, and coupons",
        roleScope: ["seller-admin"],
        permissionSlugs: slugsForModules(
          ["products", "inventory", "pricing", "coupons"],
          CANONICAL_ACTIONS.filter((a) => !["restore", "bulk_action"].includes(a.key)),
        ),
      },
    ];

    for (const tmpl of PERMISSION_TEMPLATES) {
      const validSlugs = tmpl.permissionSlugs.filter((s) => permissionBySlug[s]);
      await sequelize.query(
        `INSERT INTO permission_templates
           (id, slug, name, description, role_scope, permission_slugs, is_active, metadata, created_at, updated_at)
         VALUES
           (:id, :slug, :name, :description, :roleScope, :permissionSlugs, true, '{}', NOW(), NOW())
         ON CONFLICT (slug) DO UPDATE
           SET name             = EXCLUDED.name,
               description      = EXCLUDED.description,
               role_scope        = EXCLUDED.role_scope,
               permission_slugs  = EXCLUDED.permission_slugs,
               is_active         = true,
               updated_at        = NOW()`,
        {
          replacements: {
            id: uuidv4(),
            slug: tmpl.slug,
            name: tmpl.name,
            description: tmpl.description || null,
            roleScope: `{${tmpl.roleScope.join(",")}}`,
            permissionSlugs: JSON.stringify(validSlugs),
          },
          transaction,
        },
      );
    }

    console.log(`✓ Upserted ${PERMISSION_TEMPLATES.length} permission templates`);

    await transaction.commit();

    console.log("\n✅ RBAC seeding completed successfully!\n");

    console.log("Platform modules seeded:");
    platformModules.forEach((m) =>
      console.log(`  [platform]  ${m.slug.padEnd(30)} ${m.name}`),
    );

    console.log("\nSidebar modules seeded:");
    sidebarModules.forEach((m) =>
      console.log(`  [sidebar]   ${m.slug.padEnd(42)} ${m.name}`),
    );

    console.log("\nSystem roles seeded:");
    SYSTEM_ROLES.forEach((r) =>
      console.log(
        `  ${r.slug.padEnd(20)} permissions: ${r.permissionSlugs.length}`,
      ),
    );

    console.log(
      `\nLegacy action aliases deactivated : ${LEGACY_ACTION_KEYS.join(", ")}`,
    );
    console.log(
      `Legacy module slugs deactivated   : ${LEGACY_MODULE_SLUGS.join(", ")}`,
    );
    console.log(
      `Non-system roles deactivated      : ${NON_SYSTEM_ROLE_SLUGS.join(", ")}`,
    );

    process.exit(0);
  } catch (error) {
    await transaction.rollback();

    console.error("\n❌ Error seeding RBAC:", error.message);
    console.error(error);

    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

seedRbac();
