const { AppError } = require("../errors/app-error");

function getActor(auth = {}) {
  return {
    userId: auth.sub || null,
    email: auth.email || null,
    role: auth.role || "guest",
    roles: Array.isArray(auth.roles) ? auth.roles : [],
    isSuperAdmin: auth.isSuperAdmin === true || auth.role === "super-admin",
    ownerAdminId: auth.ownerAdminId || null,
    ownerSellerId: auth.ownerSellerId || null,
    organizationId: auth.selectedOrganizationId || null,
    allowedModules: Array.isArray(auth.allowedModules) ? auth.allowedModules : [],
    permissions: Array.isArray(auth.permissions) ? auth.permissions : [],
    authScope: auth.authScope || null,
    issuedAt: auth.iat ? new Date(Number(auth.iat) * 1000) : null,
    expiresAt: auth.exp ? new Date(Number(auth.exp) * 1000) : null,
  };
}

function getCurrentUser(req) {
  if (!req.auth) {
    throw new AppError("Authentication required", 401);
  }

  return getActor(req.auth);
}

module.exports = { getActor, getCurrentUser };
