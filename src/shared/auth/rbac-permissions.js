const PERMISSION_EFFECTS = {
  ALLOW: "allow",
  DENY: "deny",
};

const PERMISSION_ACTIONS = [
  "view",
  "create",
  "update",
  "delete",
  "approve",
  "reject",
  "assign",
  "export",
  "import",
  "status_change",
  "restore",
  "bulk_action",
];

const SIDEBAR_PERMISSION_ACTIONS = [
  "view",
  "create",
  "update",
  "delete",
  "status_change",
  "approve",
  "reject",
  "assign",
  "export",
  "import",
];

const ACTION_ALIASES = {
  add: "create",
  edit: "update",
  status: "status_change",
  approval: "approve",
  action: "status_change",
  review: "approve",
  manage: "status_change",
};

function normalizePermissionAction(action = "") {
  const value = String(action || "").trim().toLowerCase();
  return ACTION_ALIASES[value] || value;
}

function normalizePermissionEffect(effect = PERMISSION_EFFECTS.ALLOW) {
  return String(effect || PERMISSION_EFFECTS.ALLOW).trim().toLowerCase() === PERMISSION_EFFECTS.DENY
    ? PERMISSION_EFFECTS.DENY
    : PERMISSION_EFFECTS.ALLOW;
}

function isDeniedPermission(permission = {}) {
  return normalizePermissionEffect(permission.metadata?.effect) === PERMISSION_EFFECTS.DENY;
}

function permissionSlug(module, action = "view") {
  const moduleSlug = String(module || "").trim().toLowerCase();
  const actionSlug = normalizePermissionAction(action);
  return moduleSlug && actionSlug ? `${moduleSlug}:${actionSlug}` : "";
}

function splitPermissionSlug(slug = "") {
  const value = String(slug || "").trim().toLowerCase();
  const separatorIndex = value.indexOf(":");
  if (separatorIndex === -1) return { module: value, action: "" };
  return {
    module: value.slice(0, separatorIndex),
    action: value.slice(separatorIndex + 1),
  };
}

function actionsWithImplicitView(actions = []) {
  const normalizedActions = Array.from(
    new Set(
      (actions || [])
        .map(normalizePermissionAction)
        .filter((action) => PERMISSION_ACTIONS.includes(action)),
    ),
  );
  if (normalizedActions.length && !normalizedActions.includes("view")) {
    normalizedActions.unshift("view");
  }
  return normalizedActions;
}

function modulePermissionAssignmentsWithImplicitView(modulePermissions = [], cleanModuleName = (value) => value) {
  return (modulePermissions || [])
    .map((item) => {
      const moduleName = cleanModuleName(item.module || item.slug);
      const actions = actionsWithImplicitView(item.actions || []);
      if (!moduleName || !actions.length) return null;
      return { module: moduleName, actions };
    })
    .filter(Boolean);
}

function permissionSlugsWithImplicitView(slugs = [], cleanModuleName = (value) => value) {
  const result = new Set();
  (slugs || []).forEach((slug) => {
    const { module, action } = splitPermissionSlug(slug);
    const moduleName = cleanModuleName(module);
    if (!moduleName || !action) return;
    if (action !== "view") result.add(permissionSlug(moduleName, "view"));
    result.add(permissionSlug(moduleName, action));
  });
  return Array.from(result);
}

module.exports = {
  ACTION_ALIASES,
  PERMISSION_ACTIONS,
  PERMISSION_EFFECTS,
  SIDEBAR_PERMISSION_ACTIONS,
  actionsWithImplicitView,
  isDeniedPermission,
  modulePermissionAssignmentsWithImplicitView,
  normalizePermissionAction,
  normalizePermissionEffect,
  permissionSlug,
  permissionSlugsWithImplicitView,
  splitPermissionSlug,
};
