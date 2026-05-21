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
    allowedModules: Array.isArray(auth.allowedModules) ? auth.allowedModules : [],
    permissions: Array.isArray(auth.permissions) ? auth.permissions : [],
  };
}

function getCurrentUser(req) {
  if (!req.auth) {
    throw new AppError("Authentication required", 401);
  }

  return getActor(req.auth);
}

module.exports = { getActor, getCurrentUser };
