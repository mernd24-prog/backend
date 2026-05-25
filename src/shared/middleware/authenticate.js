const jwt = require("jsonwebtoken");
const { env } = require("../../config/env");
const { AppError } = require("../errors/app-error");
const { UserModel } = require("../../modules/user/models/user.model");
const { ROLES } = require("../constants/roles");
const { RbacService } = require("../../modules/rbac/services/rbac.service");

const rbacService = new RbacService();
const permissionCache = new Map();
const PERMISSION_CACHE_TTL_MS = 30 * 1000;

function isSuperAdminPayload(payload = {}) {
  return payload.isSuperAdmin === true || payload.role === ROLES.SUPER_ADMIN;
}

async function hydrateAuthPermissions(payload = {}) {
  if (!payload.sub || isSuperAdminPayload(payload)) {
    return { ...payload, permissions: [] };
  }

  const cached = permissionCache.get(payload.sub);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...payload, permissions: cached.permissions, allowedModules: cached.allowedModules };
  }

  try {
    const effectivePermissions = await rbacService.getUserEffectivePermissions(payload.sub);
    const permissions = Array.isArray(effectivePermissions)
      ? effectivePermissions.map((permission) => permission.slug).filter(Boolean)
      : [];
    const allowedModules = Array.from(
      new Set([
        ...(Array.isArray(payload.allowedModules) ? payload.allowedModules : []),
        ...permissions
          .map((permission) => String(permission || "").split(":")[0])
          .filter(Boolean),
      ]),
    );
    permissionCache.set(payload.sub, {
      permissions,
      allowedModules,
      expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
    });
    return { ...payload, permissions, allowedModules };
  } catch (error) {
    return { ...payload, permissions: [] };
  }
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(new AppError("Authentication required", 401));
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const payload = jwt.verify(token, env.jwtAccessSecret);
    req.auth = await hydrateAuthPermissions(payload);
    return next();
  } catch (error) {
    return next(new AppError("Invalid or expired token", 401));
  }
}

async function authenticatePendingSeller(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(new AppError("Authentication required", 401));
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const payload = jwt.verify(token, env.jwtAccessSecret);
    req.auth = payload;

    // Check if this is an onboarding token for a pending seller
    if (!payload.isOnboarding || payload.role !== ROLES.SELLER) {
      return next(new AppError("Access denied", 403));
    }

    // Verify user exists and is still in onboarding state.
    const user = await UserModel.findById(payload.sub);
    const onboardingComplete = user?.sellerProfile?.onboardingStatus === "ready_for_go_live";
    if (!user || onboardingComplete) {
      return next(new AppError("Access denied", 403));
    }

    return next();
  } catch (error) {
    return next(new AppError("Invalid or expired token", 401));
  }
}

module.exports = { authenticate, authenticatePendingSeller };
