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

const ACTION_EQUIVALENTS = {
  create: ["add"],
  update: ["edit"],
  approve: ["approval", "review"],
  status_change: ["status", "action", "manage"],
};

const normalizeAction = (action = "") => {
  const value = String(action || "").trim().toLowerCase();
  const aliases = {
    add: "create",
    edit: "update",
    status: "status_change",
    approval: "approve",
    action: "status_change",
    review: "approve",
    manage: "status_change",
  };
  return aliases[value] || value;
};

const makePermission = (module, action = "view") =>
  `${String(module || "").trim().toLowerCase()}:${normalizeAction(action)}`;

const buildPermissionCandidates = (module, action = "view") => {
  const normalizedModule = String(module || "").trim().toLowerCase();
  const normalizedAction = normalizeAction(action);
  const aliases = ACTION_EQUIVALENTS[normalizedAction] || [];
  const actionCandidates = Array.from(new Set([normalizedAction, ...aliases]));
  return Array.from(
    new Set([
      normalizedAction,
      ...actionCandidates,
      ...actionCandidates.map((candidate) => makePermission(normalizedModule, candidate)),
    ]),
  );
};

const toPermissionModule = (permissionSlug = "") => {
  const value = String(permissionSlug || "").trim().toLowerCase();
  if (!value.includes(":")) return "";
  return value.split(":")[0];
};

const hasPermission = (actor = {}, module, action = "view") => {
  if (actor.isSuperAdmin || actor.role === "super-admin") return true;

  const normalizedModule = String(module || "").trim().toLowerCase();
  const normalizedAction = normalizeAction(action);
  const allowedModules = Array.isArray(actor.allowedModules)
    ? actor.allowedModules.map((item) => String(item || "").trim().toLowerCase())
    : [];
  const permissions = Array.isArray(actor.permissions) ? actor.permissions : [];
  const scopedModulesFromPermissions = permissions
    .map(toPermissionModule)
    .filter(Boolean);
  const moduleScope = new Set([...allowedModules, ...scopedModulesFromPermissions]);

  if (!moduleScope.has(normalizedModule)) return false;
  const candidates = buildPermissionCandidates(normalizedModule, normalizedAction);
  return candidates.some((permission) => permissions.includes(permission));
};

module.exports = {
  PERMISSION_ACTIONS,
  normalizeAction,
  makePermission,
  hasPermission,
};
