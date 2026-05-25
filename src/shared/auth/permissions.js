const PERMISSION_ACTIONS = [
  "view",
  "create",
  "add",
  "edit",
  "update",
  "delete",
  "approve",
  "approval",
  "reject",
  "assign",
  "export",
  "import",
  "status_change",
  "status",
  "restore",
  "bulk_action",
  "action",
];

const normalizeAction = (action = "") => {
  const value = String(action || "").trim().toLowerCase();
  if (value === "review") return "approval";
  if (value === "manage") return "status";
  return value;
};

const makePermission = (module, action = "view") =>
  `${String(module || "").trim().toLowerCase()}:${normalizeAction(action)}`;

const hasPermission = (actor = {}, module, action = "view") => {
  if (actor.isSuperAdmin || actor.role === "super-admin") return true;

  const normalizedModule = String(module || "").trim().toLowerCase();
  const normalizedAction = normalizeAction(action);
  const allowedModules = Array.isArray(actor.allowedModules)
    ? actor.allowedModules.map((item) => String(item || "").trim().toLowerCase())
    : [];
  const permissions = Array.isArray(actor.permissions) ? actor.permissions : [];

  if (!allowedModules.includes(normalizedModule)) return false;

  const candidates = [
    makePermission(normalizedModule, normalizedAction),
    normalizedAction,
  ];

  return candidates.some((permission) => permissions.includes(permission));
};

module.exports = {
  PERMISSION_ACTIONS,
  normalizeAction,
  makePermission,
  hasPermission,
};
