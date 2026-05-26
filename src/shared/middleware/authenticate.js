const jwt = require("jsonwebtoken");
const { env } = require("../../config/env");
const { UserModel } = require("../../modules/user/models/user.model");
const { ROLES } = require("../constants/roles");
const { RbacService } = require("../../modules/rbac/services/rbac.service");
const { Role } = require("../../infrastructure/sequelize/models");
const {
  AUTH_ERROR_CODES,
  authError,
  getSessionAuthError,
  getStatusAuthError,
  normalizeAccountStatus,
} = require("../auth/session-state");

const rbacService = new RbacService();
const permissionCache = new Map();
const PERMISSION_CACHE_TTL_MS = Math.max(
  Number(env.rbacPermissionCacheTtlMs ?? 0) || 0,
  0,
);

function isSuperAdminPayload(payload = {}) {
  return payload.isSuperAdmin === true || payload.role === ROLES.SUPER_ADMIN;
}

async function validateAuthUser(payload = {}) {
  if (!payload.sub) {
    throw authError(AUTH_ERROR_CODES.TOKEN_INVALID, 401);
  }

  const user = await UserModel.findById(payload.sub)
    .select("-passwordHash -refreshSessions.tokenHash")
    .lean()
    .catch(() => null);

  if (!user) {
    throw authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
  }

  const statusError = getStatusAuthError(user);
  if (statusError) {
    throw statusError;
  }

  if (payload.role && user.role && payload.role !== user.role) {
    throw authError(AUTH_ERROR_CODES.ROLE_CHANGED, 401);
  }

  const role = await Role.findOne({ where: { slug: user.role } }).catch(() => null);
  if (!role && user.role !== ROLES.BUYER) {
    throw authError(AUTH_ERROR_CODES.ROLE_CHANGED, 401);
  }
  if (role && role.active === false) {
    throw authError(AUTH_ERROR_CODES.ROLE_INACTIVE, 403);
  }

  const sessionError = getSessionAuthError(user, payload);
  if (sessionError) {
    throw sessionError;
  }

  return user;
}

async function hydrateAuthPermissions(payload = {}) {
  const user = await validateAuthUser(payload);

  if (PERMISSION_CACHE_TTL_MS > 0) {
    const cached = permissionCache.get(`${payload.sub}:${user.sessionVersion || 0}:${user.permissionVersion || 0}`);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...payload,
        role: user.role,
        roles: user.role ? [user.role] : [],
        userType: user.role,
        status: user.accountStatus || "active",
        tokenVersion: Number(user.tokenVersion || 0),
        sessionVersion: Number(user.sessionVersion || 0),
        permissionVersion: Number(user.permissionVersion || 0),
        isSuperAdmin: isSuperAdminPayload({ ...payload, role: user.role }),
        permissions: cached.permissions,
        allowedModules: cached.allowedModules,
        user,
      };
    }
  }

  const effectivePermissions = await rbacService.getUserEffectivePermissions(payload.sub);
  const permissions = Array.isArray(effectivePermissions)
    ? effectivePermissions.map((permission) => permission.slug).filter(Boolean)
    : [];
  const allowedModules = Array.from(
    new Set([
      ...(Array.isArray(user.allowedModules) ? user.allowedModules : []),
      ...permissions
        .map((permission) => String(permission || "").split(":")[0])
        .filter(Boolean),
    ]),
  );
  if (PERMISSION_CACHE_TTL_MS > 0) {
    permissionCache.set(`${payload.sub}:${user.sessionVersion || 0}:${user.permissionVersion || 0}`, {
      permissions,
      allowedModules,
      expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
    });
  }

  return {
    ...payload,
    role: user.role,
    roles: user.role ? [user.role] : [],
    userType: user.role,
    status: user.accountStatus || "active",
    tokenVersion: Number(user.tokenVersion || 0),
    sessionVersion: Number(user.sessionVersion || 0),
    permissionVersion: Number(user.permissionVersion || 0),
    isSuperAdmin: user.role === ROLES.SUPER_ADMIN || isSuperAdminPayload(payload),
    allowedModules,
    permissions,
    ownerAdminId: user.ownerAdminId || null,
    ownerSellerId: user.ownerSellerId || null,
    user,
  };
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(authError(AUTH_ERROR_CODES.TOKEN_INVALID, 401));
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const payload = jwt.verify(token, env.jwtAccessSecret);
    req.auth = await hydrateAuthPermissions(payload);
    return next();
  } catch (error) {
    if (error?.statusCode) {
      return next(error);
    }
    return next(
      authError(
        error?.name === "TokenExpiredError"
          ? AUTH_ERROR_CODES.TOKEN_EXPIRED
          : AUTH_ERROR_CODES.TOKEN_INVALID,
        401,
      ),
    );
  }
}

async function authenticatePendingSeller(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(authError(AUTH_ERROR_CODES.TOKEN_INVALID, 401));
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const payload = jwt.verify(token, env.jwtAccessSecret);
    req.auth = payload;

    // Check if this is an onboarding token for a pending seller
    if (!payload.isOnboarding || payload.role !== ROLES.SELLER) {
      return next(authError(AUTH_ERROR_CODES.TOKEN_INVALID, 403));
    }

    // Verify user exists and is still in onboarding state.
    const user = await UserModel.findById(payload.sub);
    if (!user) {
      return next(authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401));
    }
    const status = normalizeAccountStatus(user.accountStatus);
    const statusError = getStatusAuthError(user);
    if (statusError && status !== "pending_approval") {
      return next(statusError);
    }
    const onboardingComplete = user?.sellerProfile?.onboardingStatus === "ready_for_go_live";
    if (onboardingComplete) {
      return next(authError(AUTH_ERROR_CODES.TOKEN_INVALID, 401));
    }

    return next();
  } catch (error) {
    return next(
      authError(
        error?.name === "TokenExpiredError"
          ? AUTH_ERROR_CODES.TOKEN_EXPIRED
          : AUTH_ERROR_CODES.TOKEN_INVALID,
        401,
      ),
    );
  }
}

// Accepts both regular access tokens and onboarding tokens — used for /auth/status
// so sellers in onboarding/rejection flow can fetch their flow state without being
// force-logged-out by the session-version check that regular access tokens carry.
async function authenticateForStatus(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return next(authError(AUTH_ERROR_CODES.TOKEN_INVALID, 401));
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const payload = jwt.verify(token, env.jwtAccessSecret);

    if (payload.isOnboarding === true && payload.role === ROLES.SELLER) {
      const user = await UserModel.findById(payload.sub)
        .select("-passwordHash -refreshSessions.tokenHash")
        .lean()
        .catch(() => null);

      if (!user) {
        return next(authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401));
      }

      const status = normalizeAccountStatus(user.accountStatus);
      const statusError = getStatusAuthError(user);
      if (statusError && status !== "pending_approval") {
        return next(statusError);
      }

      req.auth = { ...payload, sub: String(payload.sub), user };
      return next();
    }

    req.auth = await hydrateAuthPermissions(payload);
    return next();
  } catch (error) {
    if (error?.statusCode) {
      return next(error);
    }
    return next(
      authError(
        error?.name === "TokenExpiredError"
          ? AUTH_ERROR_CODES.TOKEN_EXPIRED
          : AUTH_ERROR_CODES.TOKEN_INVALID,
        401,
      ),
    );
  }
}

module.exports = { authenticate, authenticatePendingSeller, authenticateForStatus };
