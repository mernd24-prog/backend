const { AppError } = require("../errors/app-error");

const AUTH_ERROR_CODES = {
  USER_NOT_FOUND: "USER_NOT_FOUND",
  USER_DELETED: "USER_DELETED",
  USER_INACTIVE: "USER_INACTIVE",
  USER_BLOCKED: "USER_BLOCKED",
  ROLE_CHANGED: "ROLE_CHANGED",
  ROLE_INACTIVE: "ROLE_INACTIVE",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID: "TOKEN_INVALID",
  SESSION_INVALID: "SESSION_INVALID",
  PERMISSION_REMOVED: "PERMISSION_REMOVED",
  FORCE_LOGOUT: "FORCE_LOGOUT",
};

const AUTH_ERROR_MESSAGES = {
  [AUTH_ERROR_CODES.USER_NOT_FOUND]:
    "Your account no longer exists. Please contact administrator.",
  [AUTH_ERROR_CODES.USER_DELETED]:
    "Your account has been removed. Please contact administrator.",
  [AUTH_ERROR_CODES.USER_INACTIVE]:
    "Your account has been deactivated. Please contact administrator.",
  [AUTH_ERROR_CODES.USER_BLOCKED]:
    "Your account has been blocked. Please contact support.",
  [AUTH_ERROR_CODES.ROLE_CHANGED]:
    "Your role was changed. Please login again.",
  [AUTH_ERROR_CODES.ROLE_INACTIVE]:
    "Your role is no longer active. Please contact administrator.",
  [AUTH_ERROR_CODES.TOKEN_EXPIRED]:
    "Your session has expired. Please login again.",
  [AUTH_ERROR_CODES.TOKEN_INVALID]:
    "Invalid session. Please login again.",
  [AUTH_ERROR_CODES.SESSION_INVALID]:
    "Your session is no longer valid. Please login again.",
  [AUTH_ERROR_CODES.PERMISSION_REMOVED]:
    "Your permissions were updated. Please login again.",
  [AUTH_ERROR_CODES.FORCE_LOGOUT]:
    "Please login again to continue.",
};

const SESSION_INVALIDATION_REASONS = {
  ACCOUNT_STATUS_CHANGED: "ACCOUNT_STATUS_CHANGED",
  ROLE_CHANGED: "ROLE_CHANGED",
  PERMISSIONS_CHANGED: "PERMISSIONS_CHANGED",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  USER_DELETED: "USER_DELETED",
  FORCE_LOGOUT: "FORCE_LOGOUT",
};

const INACTIVE_STATUSES = new Set([
  "inactive",
  "disabled",
  "deactivated",
  // "pending_approval",
]);

const BLOCKED_STATUSES = new Set([
  "blocked",
  "suspended",
  "rejected",
]);

const DELETED_STATUSES = new Set([
  "deleted",
  "removed",
]);

function authError(code, statusCode = 401, details = null) {
  return new AppError(
    AUTH_ERROR_MESSAGES[code] || AUTH_ERROR_MESSAGES[AUTH_ERROR_CODES.TOKEN_INVALID],
    statusCode,
    details,
    code,
  );
}

function normalizeAccountStatus(status = "active") {
  return String(status || "active").trim().toLowerCase();
}

function getStatusAuthError(user = {}) {
  if (!user) {
    return authError(AUTH_ERROR_CODES.USER_NOT_FOUND, 401);
  }

  const status = normalizeAccountStatus(user.accountStatus);
  if (user.deletedAt || DELETED_STATUSES.has(status)) {
    return authError(AUTH_ERROR_CODES.USER_DELETED, 401);
  }
  if (user.blockedAt || BLOCKED_STATUSES.has(status)) {
    return authError(AUTH_ERROR_CODES.USER_BLOCKED, 403);
  }
  if (INACTIVE_STATUSES.has(status)) {
    return authError(AUTH_ERROR_CODES.USER_INACTIVE, 403);
  }
  return null;
}

function getSessionReasonCode(reason) {
  switch (reason) {
    case SESSION_INVALIDATION_REASONS.PERMISSIONS_CHANGED:
      return AUTH_ERROR_CODES.PERMISSION_REMOVED;
    case SESSION_INVALIDATION_REASONS.ROLE_CHANGED:
      return AUTH_ERROR_CODES.ROLE_CHANGED;
    case SESSION_INVALIDATION_REASONS.USER_DELETED:
      return AUTH_ERROR_CODES.USER_DELETED;
    case SESSION_INVALIDATION_REASONS.FORCE_LOGOUT:
      return AUTH_ERROR_CODES.FORCE_LOGOUT;
    default:
      return AUTH_ERROR_CODES.SESSION_INVALID;
  }
}

function toVersion(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function tokenIssuedBefore(payload = {}, dateValue) {
  if (!dateValue || !payload.iat) {
    return false;
  }
  const issuedAtMs = Number(payload.iat) * 1000;
  const changedAtMs = new Date(dateValue).getTime();
  return Number.isFinite(issuedAtMs) &&
    Number.isFinite(changedAtMs) &&
    issuedAtMs < changedAtMs - 1000;
}

function getSessionAuthError(user = {}, payload = {}) {
  const userTokenVersion = toVersion(user.tokenVersion);
  const payloadTokenVersion = toVersion(payload.tokenVersion);
  const userSessionVersion = toVersion(user.sessionVersion);
  const payloadSessionVersion = toVersion(payload.sessionVersion);

  if (
    userTokenVersion !== payloadTokenVersion ||
    userSessionVersion !== payloadSessionVersion
  ) {
    return authError(getSessionReasonCode(user.sessionInvalidationReason), 401);
  }

  if (
    tokenIssuedBefore(payload, user.forceLogoutAt) ||
    tokenIssuedBefore(payload, user.passwordChangedAt)
  ) {
    return authError(getSessionReasonCode(user.sessionInvalidationReason), 401);
  }

  return null;
}

function makeSessionInvalidationUpdate(reason) {
  const now = new Date();
  const update = {
    $inc: {
      tokenVersion: 1,
      sessionVersion: 1,
    },
    $set: {
      forceLogoutAt: now,
      sessionInvalidationReason: reason,
    },
  };
  if (reason === SESSION_INVALIDATION_REASONS.PERMISSIONS_CHANGED) {
    update.$inc.permissionVersion = 1;
  }
  return update;
}

function mergeMongoUpdates(...updates) {
  return updates.reduce((merged, update = {}) => {
    Object.entries(update).forEach(([operator, values]) => {
      if (!values || typeof values !== "object") return;
      merged[operator] = {
        ...(merged[operator] || {}),
        ...values,
      };
    });
    return merged;
  }, {});
}

module.exports = {
  AUTH_ERROR_CODES,
  AUTH_ERROR_MESSAGES,
  SESSION_INVALIDATION_REASONS,
  authError,
  getStatusAuthError,
  getSessionAuthError,
  makeSessionInvalidationUpdate,
  mergeMongoUpdates,
  normalizeAccountStatus,
};
