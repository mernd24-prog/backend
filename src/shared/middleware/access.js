const { AppError } = require("../errors/app-error");
const { canDo } = require("../auth/access-rules");
const { ROLES } = require("../constants/roles");
const {
  usesModuleAccess,
  getRequestModule,
  cleanModuleName,
} = require("../auth/module-access");

function getUserRoles(req) {
  const roles = [];
  if (req.auth?.role) roles.push(req.auth.role);
  if (Array.isArray(req.auth?.roles)) roles.push(...req.auth.roles);
  return Array.from(new Set(roles));
}

function isSuperAdmin(req) {
  if (req.auth?.isSuperAdmin === true) {
    return true;
  }
  return getUserRoles(req).includes(ROLES.SUPER_ADMIN);
}

function isPlatformAdminRole(role) {
  return role === ROLES.SUPER_ADMIN;
}

// Full (owner) seller bypasses permission checks on seller-scoped slugs.
function isOwnerSellerBypass(userRoles, permissionSlugs) {
  const isOwnerSeller = userRoles.includes(ROLES.SELLER);
  return isOwnerSeller && permissionSlugs.every((slug) => slug.startsWith("sellers:"));
}

function extractModuleSlugFromPermission(permissionSlug = "") {
  const value = String(permissionSlug || "").trim().toLowerCase();
  if (!value.includes(":")) return "";
  return cleanModuleName(value.split(":")[0]);
}

function getAuthorizedModuleScope(auth = {}) {
  const allowedModules = Array.isArray(auth.allowedModules)
    ? auth.allowedModules.map(cleanModuleName).filter(Boolean)
    : [];
  const permissionModules = Array.isArray(auth.permissions)
    ? auth.permissions
        .map(extractModuleSlugFromPermission)
        .filter(Boolean)
    : [];
  return new Set([...allowedModules, ...permissionModules]);
}

const PERMISSION_ACTION_ALIASES = {
  create: ["add"],
  add: ["create"],
  edit: ["update"],
  update: ["edit"],
  approve: ["approval"],
  approval: ["approve"],
  status: ["status_change", "action"],
  status_change: ["status", "action"],
  manage: ["status", "action"],
  action: ["status", "status_change", "manage"],
};

const METHOD_ACTIONS = {
  GET: "view",
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

function inferRequestAction(req) {
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.originalUrl || req.path || "").toLowerCase();

  if (path.includes("/approve") || path.includes("/approval")) return "approve";
  if (path.includes("/reject")) return "reject";
  if (path.includes("/access/sub-admins") && path.includes("/modules")) {
    return method === "GET" ? "view" : "assign";
  }
  if (path.includes("/assign") || path.includes("/permissions") || path.includes("/roles")) {
    return method === "GET" ? "view" : "assign";
  }
  if (path.includes("/status") || path.includes("/moderate") || path.includes("/review")) {
    return method === "GET" ? "view" : "status_change";
  }
  if (path.includes("/bulk")) return method === "GET" ? "view" : "bulk_action";
  if (path.includes("/import")) return "import";
  if (path.includes("/export")) return "export";

  return METHOD_ACTIONS[method] || "view";
}

function buildPermissionCandidates(permissionSlug = "") {
  const value = String(permissionSlug || "").trim().toLowerCase();
  if (!value.includes(":")) {
    return [value].filter(Boolean);
  }
  const [moduleSlug, actionSlug] = value.split(":");
  const aliases = PERMISSION_ACTION_ALIASES[actionSlug] || [];
  const actionCandidates = Array.from(new Set([actionSlug, ...aliases]));
  return Array.from(
    new Set([
      value,
      ...actionCandidates,
      ...actionCandidates.map((action) => `${moduleSlug}:${action}`),
    ]),
  );
}

function hasGrantedPermission(auth = {}, moduleName, action = "view") {
  if (auth.isSuperAdmin || auth.role === ROLES.SUPER_ADMIN) return true;

  const normalizedModule = cleanModuleName(moduleName);
  const permissionSlug = `${normalizedModule}:${action}`;
  const permissionCandidates = buildPermissionCandidates(permissionSlug);
  const grantedPermissions = Array.isArray(auth.permissions)
    ? auth.permissions
    : [];

  return permissionCandidates.some((candidate) =>
    grantedPermissions.includes(candidate),
  );
}

function enforceModuleScope(req) {
  if (!usesModuleAccess(req.auth)) {
    return null;
  }

  const requestModule = getRequestModule(req);
  if (!requestModule) {
    return null;
  }

  const allowedModules = getAuthorizedModuleScope(req.auth);
  const normalizedRequestModule = cleanModuleName(requestModule);

  if (!allowedModules.size) {
    return new AppError("Forbidden: no modules assigned", 403);
  }

  if (!allowedModules.has(normalizedRequestModule)) {
    return new AppError(
      `Forbidden: module access denied for ${requestModule}`,
      403,
    );
  }

  return null;
}

function enforceRequestPermission(req) {
  if (!usesModuleAccess(req.auth)) {
    return null;
  }

  const requestModule = getRequestModule(req);
  if (!requestModule) {
    return null;
  }

  const requestAction = inferRequestAction(req);
  if (hasGrantedPermission(req.auth, requestModule, requestAction)) {
    return null;
  }

  return new AppError(
    `Forbidden: permission denied for ${cleanModuleName(requestModule)}:${requestAction}`,
    403,
  );
}

function flattenRoles(roles = []) {
  return roles.flatMap((role) => (Array.isArray(role) ? role : [role]));
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return next(new AppError("Authentication required", 401));
    }

    if (isSuperAdmin(req)) {
      return next();
    }

    const scopeError = enforceModuleScope(req);
    if (scopeError) {
      return next(scopeError);
    }

    const userRoles = getUserRoles(req);
    const allowedRoles = flattenRoles(roles);
    const allowed = allowedRoles.some((role) => userRoles.includes(role));
    const superAdminOnly =
      allowedRoles.length === 1 && allowedRoles[0] === ROLES.SUPER_ADMIN;
    if (!allowed && superAdminOnly) {
      return next(new AppError("Forbidden", 403));
    }

    const permissionError = enforceRequestPermission(req);
    if (permissionError && allowed) {
      return next(permissionError);
    }
    if (!allowed && permissionError) {
      return next(permissionError);
    }
    if (!allowed && !usesModuleAccess(req.auth)) {
      return next(new AppError("Forbidden", 403));
    }
    if (!allowed && !getRequestModule(req)) {
      return next(new AppError("Forbidden", 403));
    }

    return next();
  };
}

function allowActions(...actions) {
  return (req, res, next) => {
    if (!req.auth) {
      return next(new AppError("Authentication required", 401));
    }

    if (isSuperAdmin(req)) {
      return next();
    }

    const scopeError = enforceModuleScope(req);
    if (scopeError) {
      return next(scopeError);
    }

    const userRoles = getUserRoles(req);
    if (usesModuleAccess(req.auth)) {
      const requestModule = getRequestModule(req);
      const requestAction = inferRequestAction(req);
      const allowed = requestModule
        ? hasGrantedPermission(req.auth, requestModule, requestAction)
        : actions.every((action) =>
            Array.isArray(req.auth.permissions) &&
            req.auth.permissions.includes(action),
          );

      if (!allowed) {
        return next(
          new AppError(
            requestModule
              ? `Forbidden: permission denied for ${cleanModuleName(requestModule)}:${requestAction}`
              : "Forbidden",
            403,
          ),
        );
      }

      return next();
    }

    const allowed = actions.every((action) => {
      if (
        Array.isArray(req.auth.permissions) &&
        req.auth.permissions.includes(action)
      ) {
        return true;
      }
      return userRoles.some((role) => canDo(role, action));
    });

    if (!allowed) {
      return next(new AppError("Forbidden", 403));
    }

    return next();
  };
}

function allowPermissions(...permissionSlugs) {
  return (req, res, next) => {
    if (!req.auth) {
      return next(new AppError("Authentication required", 401));
    }

    if (isSuperAdmin(req)) {
      return next();
    }

    const userRoles = getUserRoles(req);

    // Owner sellers bypass permission checks for seller-scoped permissions.
    if (isOwnerSellerBypass(userRoles, permissionSlugs)) {
      return next();
    }

    const scopeError = enforceModuleScope(req);
    if (scopeError) {
      return next(scopeError);
    }

    const grantedPermissions = Array.isArray(req.auth.permissions)
      ? req.auth.permissions
      : [];
    const allowed = permissionSlugs.every((permission) => {
      const permissionCandidates = buildPermissionCandidates(permission);
      if (permissionCandidates.some((candidate) => grantedPermissions.includes(candidate))) {
        return true;
      }
      if (
        permission.startsWith("rbac:") &&
        permissionCandidates
          .map((candidate) => candidate.replace(/^rbac:/, ""))
          .some((candidate) => grantedPermissions.includes(candidate))
      ) {
        return true;
      }
      return userRoles.some(
        (role) => isPlatformAdminRole(role) && canDo(role, permission),
      );
    });

    if (!allowed) {
      return next(new AppError("Forbidden", 403));
    }

    return next();
  };
}

module.exports = { allowRoles, allowActions, allowPermissions };
