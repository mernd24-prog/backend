const { v4: uuidv4 } = require("uuid");
const {
  sequelize,
} = require("../../src/infrastructure/sequelize/sequelize-client");
const {
  MODULE_CATALOG,
} = require("../../src/shared/auth/module-catalog");
const {
  SIDEBAR_MODULES,
} = require("../../src/shared/auth/admin-sidebar-catalog");

const STANDARD_PERMISSION_ACTIONS = [
  { key: "view", label: "View" },
  { key: "create", label: "Create" },
  { key: "add", label: "Add" },
  { key: "edit", label: "Edit" },
  { key: "update", label: "Update" },
  { key: "delete", label: "Delete" },
  { key: "approve", label: "Approve" },
  { key: "approval", label: "Approval" },
  { key: "reject", label: "Reject" },
  { key: "assign", label: "Assign" },
  { key: "export", label: "Export" },
  { key: "import", label: "Import" },
  { key: "status_change", label: "Status Change" },
  { key: "status", label: "Status" },
  { key: "restore", label: "Restore" },
  { key: "bulk_action", label: "Bulk Action" },
  { key: "action", label: "Action" },
];

const LEGACY_MODULE_SLUGS = ["product", "user", "order", "seller", "settings"];

function makeModuleList() {
  const platformModules = MODULE_CATALOG.map((module, index) => ({
    id: uuidv4(),
    name: module.name,
    slug: module.slug,
    moduleKey: module.slug,
    description: module.description,
    icon: module.icon || "grid",
    routePath: module.routePath || null,
    parentModule: null,
    parentModuleId: null,
    moduleType: "module",
    status: "active",
    modulePermissions: STANDARD_PERMISSION_ACTIONS.map((action) => action.key),
    isVisibleInSidebar: false,
    order: Math.round(Number(module.order || index + 1) * 10),
    metadata: {
      ...(module.metadata || {}),
      tab: module.tab,
      forPlatform: module.forPlatform !== false,
      forSeller: module.forSeller === true,
      apiPath: module.apiPath,
      apiAliases: module.apiAliases || [],
      contentTypes: module.contentTypes || [],
      examples: module.examples || [],
      allowedRoles: module.allowedRoles || ["super-admin", "admin", "sub-admin"],
    },
  }));

  const sidebarModules = SIDEBAR_MODULES.map((module) => ({
    id: uuidv4(),
    name: module.moduleName,
    slug: `sidebar-${module.moduleSlug}`,
    moduleKey: `sidebar-${module.moduleKey}`,
    description: module.description || `${module.moduleName} admin module`,
    icon: module.icon || "MdViewModule",
    routePath: module.routePath || null,
    parentModule: module.parentModule ? `sidebar-${module.parentModule}` : null,
    parentModuleId: null,
    moduleType: module.moduleType || "page",
    status: module.status || "active",
    modulePermissions: module.permissions || ["view"],
    isVisibleInSidebar: module.isVisibleInSidebar !== false,
    order: Number(module.order || 0),
    metadata: {
      requiredModule: module.requiredModule || module.moduleKey,
      routeKey: module.moduleKey,
      tab: module.tab || null,
      allowedRoles: module.allowedRoles || ["super-admin", "admin", "sub-admin"],
      source: "sidebar-seed",
    },
  }));

  return [...platformModules, ...sidebarModules]
    .sort(
      (left, right) =>
        left.order - right.order || left.name.localeCompare(right.name),
    );
}

function moduleDbReplacements(module) {
  return {
    ...module,
    metadata: JSON.stringify(module.metadata || {}),
    modulePermissions: JSON.stringify(module.modulePermissions || []),
  };
}

function makePermissionList(modules) {
  return modules.flatMap((module) =>
    STANDARD_PERMISSION_ACTIONS.map((action) => ({
      moduleId: module.id,
      name: `${action.label} ${module.name}`,
      slug: `${module.slug}:${action.key}`,
      action: action.key,
    })),
  );
}

function permissionSlugsFor(moduleSlug, actions = STANDARD_PERMISSION_ACTIONS) {
  return actions.map((action) => {
    const actionKey = typeof action === "string" ? action : action.key;
    return `${moduleSlug}:${actionKey}`;
  });
}

function permissionSlugsForModules(
  moduleSlugs,
  actions = STANDARD_PERMISSION_ACTIONS,
) {
  return moduleSlugs.flatMap((moduleSlug) =>
    permissionSlugsFor(moduleSlug, actions),
  );
}

async function seedRbac() {
  const transaction = await sequelize.transaction();

  try {
    await sequelize.authenticate();
    console.log("✓ Database connected\n");

    const modules = makeModuleList();

    // Insert or update modules without parent ids first.
    for (const module of modules) {
      const [existingModules] = await sequelize.query(
        `SELECT id FROM modules
         WHERE slug = :slug OR name = :name OR module_key = :moduleKey
         LIMIT 1`,
        {
          replacements: { slug: module.slug, name: module.name, moduleKey: module.moduleKey },
          transaction,
        },
      );

      if (existingModules.length > 0) {
        module.id = existingModules[0].id;
        await sequelize.query(
          `UPDATE modules
           SET name = :name,
               slug = :slug,
               module_key = :moduleKey,
               description = :description,
               icon = :icon,
               route_path = :routePath,
               module_type = :moduleType,
               "order" = :order,
               status = :status,
               module_permissions = CAST(:modulePermissions AS jsonb),
               is_visible_in_sidebar = :isVisibleInSidebar,
               metadata = CAST(:metadata AS jsonb),
               active = :active,
               updated_at = NOW()
           WHERE id = :id`,
          {
            replacements: moduleDbReplacements({ ...module, active: module.status === "active" }),
            transaction,
          },
        );
      } else {
        await sequelize.query(
          `INSERT INTO modules (id, name, slug, module_key, description, icon, route_path, parent_module_id, module_type, "order", status, module_permissions, is_visible_in_sidebar, metadata, active, created_at, updated_at)
           VALUES (:id, :name, :slug, :moduleKey, :description, :icon, :routePath, :parentModuleId, :moduleType, :order, :status, CAST(:modulePermissions AS jsonb), :isVisibleInSidebar, CAST(:metadata AS jsonb), :active, NOW(), NOW())`,
          {
            replacements: moduleDbReplacements({ ...module, active: module.status === "active" }),
            transaction,
          },
        );
      }
    }

    const [moduleRows] = await sequelize.query(
      `SELECT id, module_key FROM modules WHERE module_key = ANY($1::text[])`,
      { bind: [modules.map((module) => module.moduleKey)], transaction },
    );
    const idsByKey = new Map(moduleRows.map((row) => [row.module_key, row.id]));
    modules.forEach((module) => {
      if (idsByKey.has(module.moduleKey)) module.id = idsByKey.get(module.moduleKey);
    });
    for (const module of modules) {
      if (!module.parentModule) continue;
      const parentId = idsByKey.get(module.parentModule);
      const moduleId = idsByKey.get(module.moduleKey);
      if (!parentId || !moduleId) continue;
      await sequelize.query(
        `UPDATE modules SET parent_module_id = :parentId, updated_at = NOW() WHERE id = :moduleId`,
        { replacements: { parentId, moduleId }, transaction },
      );
      module.parentModuleId = parentId;
      module.id = moduleId;
    }

    await sequelize.query(
      `UPDATE modules
       SET active = false,
           status = 'inactive',
           is_visible_in_sidebar = false,
           updated_at = NOW()
       WHERE metadata->>'source' = 'sidebar-seed'
         AND module_key <> ALL($1::text[])`,
      {
        bind: [modules.map((module) => module.moduleKey)],
        transaction,
      },
    );

    console.log(`✓ Created ${modules.length} modules`);

    const permissions = makePermissionList(modules);

    // Insert permissions
    const permissionIds = {};
    for (const perm of permissions) {
      const [existingPermissions] = await sequelize.query(
        `SELECT id FROM permissions WHERE slug = :slug LIMIT 1`,
        {
          replacements: { slug: perm.slug },
          transaction,
        },
      );

      if (existingPermissions.length > 0) {
        const id = existingPermissions[0].id;
        permissionIds[perm.slug] = id;
        await sequelize.query(
          `UPDATE permissions
           SET module_id = :moduleId,
               name = :name,
               action = :action,
               active = true,
               updated_at = NOW()
           WHERE id = :id`,
          {
            replacements: { id, ...perm },
            transaction,
          },
        );
      } else {
        const id = uuidv4();
        permissionIds[perm.slug] = id;

        await sequelize.query(
          `INSERT INTO permissions (id, module_id, name, slug, action, active, created_at, updated_at)
           VALUES (:id, :moduleId, :name, :slug, :action, true, NOW(), NOW())`,
          {
            replacements: { id, ...perm },
            transaction,
          },
        );
      }
    }

    console.log(`✓ Created ${permissions.length} permissions`);

    await sequelize.query(
      `UPDATE permissions
       SET active = false,
           updated_at = NOW()
       WHERE module_id = ANY($1::uuid[])
         AND slug <> ALL($2::text[])`,
      {
        bind: [
          modules.map((module) => module.id),
          permissions.map((permission) => permission.slug),
        ],
        transaction,
      },
    );

    await sequelize.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT id
         FROM permissions
         WHERE module_id = ANY($1::uuid[])
           AND active = false
       )`,
      {
        bind: [modules.map((module) => module.id)],
        transaction,
      },
    );

    await sequelize.query(
      `UPDATE permissions
       SET active = false,
           updated_at = NOW()
       WHERE module_id IN (
         SELECT id
         FROM modules
         WHERE slug = ANY($1::text[])
       )`,
      {
        bind: [LEGACY_MODULE_SLUGS],
        transaction,
      },
    );

    await sequelize.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT p.id
         FROM permissions p
         INNER JOIN modules m ON m.id = p.module_id
         WHERE m.slug = ANY($1::text[])
       )`,
      {
        bind: [LEGACY_MODULE_SLUGS],
        transaction,
      },
    );

    await sequelize.query(
      `UPDATE modules
       SET active = false,
           updated_at = NOW()
       WHERE slug = ANY($1::text[])`,
      {
        bind: [LEGACY_MODULE_SLUGS],
        transaction,
      },
    );

    // Create default roles and assign permissions
    const allModuleSlugs = modules.map((module) => module.slug);
    const moderatorModules = ["products", "users", "orders", "sellers", "admin"];
    const sellerModuleSlugs = MODULE_CATALOG.filter(
      (module) => module.forSeller === true,
    ).map((module) => module.slug);

    const rolesToCreate = [
      {
        id: uuidv4(),
        name: "Super Admin",
        slug: "super-admin",
        description: "Super Administrator with full access",
        type: "system",
        isSuperAdmin: true,
        permissionSlugs: Object.keys(permissionIds), // All permissions
      },
      {
        id: uuidv4(),
        name: "Admin",
        slug: "admin",
        description: "Administrator with broad access",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: permissionSlugsForModules(allModuleSlugs),
      },
      {
        id: uuidv4(),
        name: "Sub Admin",
        slug: "sub-admin",
        description: "Scoped platform admin; permissions are assigned per user",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: [],
      },
      {
        id: uuidv4(),
        name: "Seller",
        slug: "seller",
        description: "Seller owner with full seller-panel access",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: permissionSlugsForModules(sellerModuleSlugs),
      },
      {
        id: uuidv4(),
        name: "Seller Admin",
        slug: "seller-admin",
        description: "Seller-side admin with assignable seller-panel permissions",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: [],
      },
      {
        id: uuidv4(),
        name: "Seller Sub Admin",
        slug: "seller-sub-admin",
        description: "Scoped seller-panel admin; permissions are assigned per user",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: [],
      },
      {
        id: uuidv4(),
        name: "Moderator",
        slug: "moderator",
        description: "Content and user moderator",
        type: "system",
        isSuperAdmin: false,
        permissionSlugs: permissionSlugsForModules(moderatorModules, [
          "edit",
          "update",
          "view",
        ]),
      },
      {
        id: uuidv4(),
        name: "Product Manager",
        slug: "product-manager",
        description: "Manages product catalog",
        type: "custom",
        isSuperAdmin: false,
        permissionSlugs: permissionSlugsFor("products"),
      },
    ];

    for (const role of rolesToCreate) {
      const {
        id,
        name,
        slug,
        description,
        type,
        isSuperAdmin,
        permissionSlugs,
      } = role;

      let roleId = id;

      // Check if role already exists
      const [existingRoles] = await sequelize.query(
        `SELECT id
     FROM roles
     WHERE slug = :slug
     LIMIT 1`,
        {
          replacements: { slug },
          transaction,
        },
      );

      if (existingRoles.length === 0) {
        // Create new role
        await sequelize.query(
          `INSERT INTO roles (
          id,
          name,
          slug,
          description,
          type,
          is_super_admin,
          active,
          created_at,
          updated_at
       )
       VALUES (
          :id,
          :name,
          :slug,
          :description,
          :type,
          :isSuperAdmin,
          true,
          NOW(),
          NOW()
       )`,
          {
            replacements: {
              id,
              name,
              slug,
              description,
              type,
              isSuperAdmin,
            },
            transaction,
          },
        );
      } else {
        // Use existing role ID
        roleId = existingRoles[0].id;
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
              name,
              description,
              type,
              isSuperAdmin,
            },
            transaction,
          },
        );
      }

      const desiredPermissionIds = permissionSlugs
        .map((permSlug) => permissionIds[permSlug])
        .filter(Boolean);

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
      } else {
        await sequelize.query(
          `DELETE FROM role_permissions
           WHERE role_id = :roleId`,
          {
            replacements: { roleId },
            transaction,
          },
        );
      }

      // Assign permissions
      for (const permSlug of permissionSlugs) {
        const permId = permissionIds[permSlug];

        if (permId) {
          const [existingRolePermissions] = await sequelize.query(
            `SELECT id
         FROM role_permissions
         WHERE role_id = :roleId AND permission_id = :permissionId
         LIMIT 1`,
            {
              replacements: {
                roleId: roleId,
                permissionId: permId,
              },
              transaction,
            },
          );

          if (existingRolePermissions.length === 0) {
            await sequelize.query(
              `INSERT INTO role_permissions (
            id,
            role_id,
            permission_id,
            created_at
         )
         VALUES (
            :id,
            :roleId,
            :permissionId,
            NOW()
         )`,
              {
                replacements: {
                  id: uuidv4(),
                  roleId: roleId,
                  permissionId: permId,
                },
                transaction,
              },
            );
          }
        }
      }
    }

    console.log(`✓ Created ${rolesToCreate.length} default roles\n`);

    await transaction.commit();

    console.log("✅ RBAC seeding completed successfully!\n");
    console.log("Modules created:");
    modules.forEach((m) => console.log(`  - ${m.name} (${m.slug})`));
    console.log(
      `\nRoles created:\n  - Super Admin\n  - Admin\n  - Sub Admin\n  - Seller\n  - Seller Admin\n  - Seller Sub Admin\n  - Moderator\n  - Product Manager\n`,
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
