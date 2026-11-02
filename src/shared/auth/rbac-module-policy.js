const routeActions = require("./route-permission-actions.json");
const { MODULE_CATALOG } = require("./module-catalog");
const { cleanModuleName } = require("./module-access");
const {
  PERMISSION_ACTIONS,
  normalizePermissionAction,
} = require("./rbac-permissions");

const catalog = new Map(MODULE_CATALOG.map((module) => [module.slug, module]));
const isNavigationModule = (module) =>
  module.metadata?.source === "sidebar-seed" ||
  String(module.slug || module.moduleKey || "").startsWith("sidebar-");

function supportedActions(code, declared = PERMISSION_ACTIONS) {
  const allowed = routeActions[cleanModuleName(code)] || declared;
  return PERMISSION_ACTIONS.filter((action) => allowed.includes(action));
}

const moduleCode = (module) =>
  cleanModuleName(
    isNavigationModule(module)
      ? module.metadata?.requiredModule || module.requiredModule || module.slug
      : module.slug || module.moduleSlug || module.moduleKey,
  );

function modulesForRole(role) {
  if (role === "buyer") return [];
  const seller = ["seller", "seller-admin", "seller-sub-admin"].includes(role);
  return Array.from(
    new Set(
      MODULE_CATALOG.filter((module) =>
        seller ? module.forSeller === true : module.forPlatform !== false,
      ).map((module) => cleanModuleName(module.slug)),
    ),
  );
}

// Navigation is a presentation of backend modules, never a second assignment
// namespace. Keep stored rows/IDs intact while exposing one row per capability.
function canonicalModules(
  modules = [],
  { role, includeNavigation = false } = {},
) {
  if (role === "buyer") return [];
  const sellerRole = ["seller", "seller-admin", "seller-sub-admin"].includes(role);
  const allowed = role ? new Set(modulesForRole(role)) : null;
  const groups = new Map();
  for (const module of modules) {
    if (!includeNavigation && isNavigationModule(module)) continue;
    const code = moduleCode(module);
    if (!code || (allowed && catalog.has(code) && !allowed.has(code))) continue;
    const group = groups.get(code) || [];
    group.push(module);
    groups.set(code, group);
  }
  return Array.from(groups, ([code, rows]) => {
    const primary = rows.find((row) => row.slug === code) || rows[0];
    const display = sellerRole
      ? MODULE_CATALOG.find(item => item.slug === code && item.forSeller) || MODULE_CATALOG.find(item => item.forSeller && cleanModuleName(item.slug) === code) || catalog.get(code)
      : catalog.get(code);
    const permissions = new Map();
    for (const row of rows) {
      for (const permission of row.permissions || []) {
        const action = normalizePermissionAction(
          permission.action || permission.slug?.split(":")[1],
        );
        if (
          !supportedActions(code).includes(action) ||
          permission.active === false
        )
          continue;
        const current = permissions.get(action);
        const preferred =
          !current || permission.slug === `${code}:${action}`
            ? permission
            : current;
        permissions.set(action, {
          ...preferred,
          action,
          assigned: Boolean(current?.assigned || permission.assigned),
          denied: Boolean(current?.denied || permission.denied),
        });
      }
    }
    const list = PERMISSION_ACTIONS.map((action) =>
      permissions.get(action),
    ).filter(Boolean);
    return {
      ...primary,
      slug: code,
      moduleSlug: code,
      moduleKey: code,
      name: display?.name || primary.name,
      moduleName: display?.name || primary.moduleName || primary.name,
      metadata: { ...(primary.metadata || {}), ...(display ? {
        tab: display.tab, forPlatform: display.forPlatform !== false, forSeller: display.forSeller === true,
        apiPath: display.apiPath, apiAliases: display.apiAliases || [],
      } : {}) },
      aliases: rows.map((row) => row.slug).filter((slug) => slug !== code),
      permissions: list,
      modulePermissions: list.map((permission) => permission.action),
      permissionsByAction: Object.fromEntries(
        list.map((permission) => [permission.action, permission]),
      ),
      permissionKeys: Object.fromEntries(
        list.map((permission) => [
          permission.action,
          Boolean(permission.assigned),
        ]),
      ),
      assignedPermissionCount: list.filter((permission) => permission.assigned)
        .length,
    };
  });
}
module.exports = {
  supportedActions,
  isNavigationModule,
  moduleCode,
  modulesForRole,
  canonicalModules,
};
