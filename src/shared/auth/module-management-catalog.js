const { MODULE_CATALOG } = require("./module-catalog");
const { SIDEBAR_MODULES } = require("./admin-sidebar-catalog");
const {
  canonicalModules,
  isNavigationModule,
  moduleCode,
  supportedActions,
} = require("./rbac-module-policy");

const PLATFORM_ROLES = ["super-admin", "admin", "sub-admin"];
const SELLER_ROLES = ["seller", "seller-admin", "seller-sub-admin"];

// Read-only inventory. Missing catalog entries are visible without seeding,
// inventing permission IDs, or changing any user's existing assignments.
function managementCatalog(stored = [], scope = "backend") {
  const navigation = scope === "sidebar";
  const persisted = navigation
    ? stored.filter(isNavigationModule)
    : canonicalModules(stored);
  const bySlug = new Map(
    persisted.map((row) => [row.slug, { ...row, configured: true }]),
  );
  const definitions = navigation
    ? SIDEBAR_MODULES.map((row) => ({
        ...row,
        name: row.moduleName,
        slug: `sidebar-${row.moduleSlug}`,
        moduleKey: `sidebar-${row.moduleKey}`,
        metadata: {
          ...row.metadata,
          source: "sidebar-seed",
          requiredModule: row.requiredModule,
          allowedRoles: row.allowedRoles || PLATFORM_ROLES,
          parentModule: row.parentModule ? `sidebar-${row.parentModule}` : null,
        },
      }))
    : MODULE_CATALOG.map((row) => ({ ...row, slug: moduleCode(row) }));

  for (const definition of definitions) {
    if (bySlug.has(definition.slug)) continue;
    bySlug.set(definition.slug, {
      ...definition,
      id: null,
      moduleSlug: definition.slug,
      moduleKey: definition.moduleKey || definition.slug,
      moduleName: definition.moduleName || definition.name,
      configured: false,
      active: false,
      status: "unconfigured",
      isVisibleInSidebar: navigation && definition.isVisibleInSidebar !== false,
      moduleType: definition.moduleType || "module",
      permissions: [],
      modulePermissions: [],
      assignedPermissionCount: 0,
      metadata: navigation
        ? definition.metadata
        : {
            ...definition,
            forPlatform: definition.forPlatform !== false,
            forSeller: definition.forSeller === true,
          },
    });
  }

  const rows = [...bySlug.values()];
  const byKey = new Map(
    rows.flatMap((row) => [
      [row.slug, row],
      [row.moduleKey, row],
    ]),
  );
  return rows
    .map((row) => {
      const roles = row.metadata?.allowedRoles;
      const definition = MODULE_CATALOG.find(
        (item) => item.slug === moduleCode(row),
      );
      const forPlatform = roles?.length
        ? roles.some((role) => PLATFORM_ROLES.includes(role))
        : (row.metadata?.forPlatform ?? definition?.forPlatform ?? true);
      const forSeller = roles?.length
        ? roles.some((role) => SELLER_ROLES.includes(role))
        : (row.metadata?.forSeller ?? definition?.forSeller ?? false);
      const parent =
        row.parentModule && typeof row.parentModule === "object"
          ? row.parentModule
          : byKey.get(row.metadata?.parentModule || row.parentModule);
      return {
        ...row,
        parentModule: parent
          ? {
              id: parent.id,
              name: parent.moduleName || parent.name,
              moduleName: parent.moduleName || parent.name,
            }
          : null,
        allowedRoles: roles || [],
        forPlatform,
        forSeller,
        panel:
          forPlatform && forSeller
            ? "both"
            : forSeller
              ? "seller"
              : forPlatform
                ? "platform"
                : "none",
        supportedActions:
          row.moduleType === "group" ? [] : supportedActions(moduleCode(row)),
      };
    })
    .sort(
      (a, b) =>
        Number(a.order || 0) - Number(b.order || 0) ||
        String(a.moduleName || a.name).localeCompare(
          String(b.moduleName || b.name),
        ),
    );
}

module.exports = { managementCatalog };
