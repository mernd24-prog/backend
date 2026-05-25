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

function enforceModuleScope(req) {
  if (!usesModuleAccess(req.auth)) {
    return null;
  }

  const requestModule = getRequestModule(req);
  if (!requestModule) {
    return null;
  }

    const allowedModules = Array.isArray(req.auth?.allowedModules)
    ? req.auth.allowedModules.map(cleanModuleName)
    : [];

  if (!allowedModules.length) {
    return new AppError("Forbidden: no modules assigned", 403);
  }

  if (!allowedModules.includes(cleanModuleName(requestModule))) {
    return new AppError(
      `Forbidden: module access denied for ${requestModule}`,
      403,
    );
  }

  return null;
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
    if (!allowed) {
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
      if (grantedPermissions.includes(permission)) {
        return true;
      }
      const legacyRbacPermission = permission.startsWith("rbac:")
        ? permission.replace(/^rbac:/, "")
        : null;
      if (
        legacyRbacPermission &&
        grantedPermissions.includes(legacyRbacPermission)
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
