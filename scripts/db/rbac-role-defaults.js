const {
  DEFAULT_PLATFORM_MODULES,
  DEFAULT_SELLER_MODULES,
} = require("../../src/shared/auth/module-catalog");
const {
  PERMISSION_ACTIONS,
} = require("../../src/shared/auth/rbac-permissions");

// Shared default policy only. Role/role_permission rows are seeded by
// scripts/db/seed-rbac.js; user role links are repaired by
// scripts/db/repair-rbac-role-assignments.js.
const FULL_PLATFORM_ROLES = ["super-admin", "admin", "sub-admin"];
const FULL_SELLER_ROLES = ["seller", "seller-admin", "seller-sub-admin"];

const ROLE_PERMISSION_DEFAULTS = {
  "super-admin": {
    modules: DEFAULT_PLATFORM_MODULES,
    actions: PERMISSION_ACTIONS,
  },
  admin: {
    modules: DEFAULT_PLATFORM_MODULES,
    actions: PERMISSION_ACTIONS,
  },
  "sub-admin": {
    modules: DEFAULT_PLATFORM_MODULES,
    actions: PERMISSION_ACTIONS,
  },
  seller: {
    modules: DEFAULT_SELLER_MODULES,
    actions: PERMISSION_ACTIONS,
  },
  "seller-admin": {
    modules: DEFAULT_SELLER_MODULES,
    actions: PERMISSION_ACTIONS,
  },
  "seller-sub-admin": {
    modules: DEFAULT_SELLER_MODULES,
    actions: PERMISSION_ACTIONS,
  },
  buyer: {
    modules: [],
    actions: [],
  },
};

function getDefaultPermissionSlugsForRole(roleSlug) {
  const policy = ROLE_PERMISSION_DEFAULTS[roleSlug] || {
    modules: [],
    actions: [],
  };

  return Array.from(
    new Set(
      (policy.modules || []).flatMap((moduleSlug) =>
        (policy.actions || []).map((action) => `${moduleSlug}:${action}`),
      ),
    ),
  );
}

function getDefaultModulesForRole(roleSlug) {
  return Array.from(
    new Set(ROLE_PERMISSION_DEFAULTS[roleSlug]?.modules || []),
  );
}

module.exports = {
  FULL_PLATFORM_ROLES,
  FULL_SELLER_ROLES,
  ROLE_PERMISSION_DEFAULTS,
  getDefaultModulesForRole,
  getDefaultPermissionSlugsForRole,
};
