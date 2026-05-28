const Joi = require("joi");

const permissionActions = [
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

const createModuleSchema = {
  body: Joi.object({
    name: Joi.string().min(2).max(128),
    moduleName: Joi.string().min(2).max(128),
    slug: Joi.string().min(2).max(128),
    moduleSlug: Joi.string().min(2).max(128),
    moduleKey: Joi.string().min(2).max(128),
    description: Joi.string().max(1000),
    icon: Joi.string().max(128),
    routePath: Joi.string().max(256).allow("", null),
    parentModule: Joi.string().allow("", null),
    parentModuleId: Joi.string().uuid().allow("", null),
    moduleType: Joi.string().valid("group", "module", "page", "action").default("module"),
    order: Joi.number().integer().default(0),
    status: Joi.string().valid("active", "inactive", "draft").default("active"),
    allowedRoles: Joi.array().items(Joi.string().trim().min(2).max(64)).default([]),
    permissions: Joi.array().items(Joi.string()).default([]),
    modulePermissions: Joi.array().items(Joi.string()).default([]),
    isVisibleInSidebar: Joi.boolean().default(true),
    active: Joi.boolean().default(true),
    metadata: Joi.object().default({}),
  }).or("name", "moduleName").or("slug", "moduleSlug", "moduleKey", "name", "moduleName"),
};

const updateModuleSchema = {
  body: Joi.object({
    name: Joi.string().min(2).max(128),
    moduleName: Joi.string().min(2).max(128),
    slug: Joi.string().min(2).max(128),
    moduleSlug: Joi.string().min(2).max(128),
    moduleKey: Joi.string().min(2).max(128),
    description: Joi.string().max(1000),
    icon: Joi.string().max(128),
    routePath: Joi.string().max(256).allow("", null),
    parentModule: Joi.string().allow("", null),
    parentModuleId: Joi.string().uuid().allow("", null),
    moduleType: Joi.string().valid("group", "module", "page", "action"),
    order: Joi.number().integer(),
    status: Joi.string().valid("active", "inactive", "draft"),
    allowedRoles: Joi.array().items(Joi.string().trim().min(2).max(64)),
    permissions: Joi.array().items(Joi.string()),
    modulePermissions: Joi.array().items(Joi.string()),
    isVisibleInSidebar: Joi.boolean(),
    active: Joi.boolean().allow(null),
    includeInactive: Joi.boolean().default(false),
    metadata: Joi.object(),
  }).min(1),
};

const listModulesSchema = {
  query: Joi.object({
    active: Joi.boolean(),
    includeInactive: Joi.boolean().default(false),
    status: Joi.string().valid("active", "inactive", "draft"),
    q: Joi.string().allow(""),
    sidebar: Joi.boolean(),
    parentModuleId: Joi.string().uuid().allow("", null),
    limit: Joi.number().integer().min(1).max(1000).default(100),
    offset: Joi.number().integer().min(0).default(0),
  }),
};

const permissionManagementSchema = {
  query: Joi.object({
    roleId: Joi.string().uuid(),
    roleSlug: Joi.string().trim().min(2).max(128),
    userId: Joi.string().trim(),
    active: Joi.boolean().default(true),
    scope: Joi.string().valid("all", "sidebar").default("all"),
  }).oxor("roleId", "roleSlug", "userId"),
};

const moduleParamSchema = {
  params: Joi.object({
    moduleId: Joi.string().uuid().required(),
  }),
};

const moduleStatusSchema = {
  body: Joi.object({
    status: Joi.string().valid("active", "inactive", "draft").required(),
  }).required(),
  params: moduleParamSchema.params,
};

const reorderModulesSchema = {
  body: Joi.object({
    modules: Joi.array().items(Joi.object({
      id: Joi.string().uuid().required(),
      order: Joi.number().integer().required(),
      parentModuleId: Joi.string().uuid().allow("", null),
    })).required(),
  }).required(),
};

const createPermissionSchema = {
  body: Joi.object({
    moduleId: Joi.string().uuid().required(),
    name: Joi.string().min(3).max(128).required(),
    slug: Joi.string().min(3).max(128).required(),
    description: Joi.string().max(1000),
    action: Joi.string()
      .valid(...permissionActions)
      .default("view"),
    active: Joi.boolean().default(true),
    metadata: Joi.object().default({}),
  }),
};

const updatePermissionSchema = {
  body: Joi.object({
    name: Joi.string().min(3).max(128),
    slug: Joi.string().min(3).max(128),
    description: Joi.string().max(1000),
    action: Joi.string().valid(...permissionActions),
    active: Joi.boolean(),
    metadata: Joi.object(),
  }).min(1),
};

const listPermissionsSchema = {
  query: Joi.object({
    moduleId: Joi.string().uuid(),
    active: Joi.boolean(),
    limit: Joi.number().integer().min(1).max(1000).default(100),
    offset: Joi.number().integer().min(0).default(0),
  }),
};

const permissionParamSchema = {
  params: Joi.object({
    permissionId: Joi.string().uuid().required(),
  }),
};

const createRoleSchema = {
  body: Joi.object({
    name: Joi.string().min(3).max(128).required(),
    slug: Joi.string().min(3).max(128).required(),
    description: Joi.string().max(1000),
    type: Joi.string().valid("system", "custom").default("custom"),
    isSuperAdmin: Joi.boolean().default(false),
    active: Joi.boolean().default(true),
    metadata: Joi.object().default({}),
  }),
};

const updateRoleSchema = {
  body: Joi.object({
    name: Joi.string().min(3).max(128),
    slug: Joi.string().min(3).max(128),
    description: Joi.string().max(1000),
    type: Joi.string().valid("system", "custom"),
    active: Joi.boolean(),
    metadata: Joi.object(),
  }).min(1),
};

const listRolesSchema = {
  query: Joi.object({
    active: Joi.boolean(),
    limit: Joi.number().integer().min(1).max(1000).default(100),
    offset: Joi.number().integer().min(0).default(0),
  }),
};

const roleParamSchema = {
  params: Joi.object({
    roleId: Joi.string().uuid().required(),
  }),
};

const assignPermissionSchema = {
  body: Joi.object({
    permissionId: Joi.string().uuid().required(),
  }),
};

const removePermissionSchema = {
  body: Joi.object({
    permissionId: Joi.string().uuid().required(),
  }),
};

const bulkAssignPermissionsSchema = {
  body: Joi.object({
    permissionIds: Joi.array().items(Joi.string().uuid()).required().min(1),
  }),
};

const syncPermissionsSchema = {
  body: Joi.object({
    permissionIds: Joi.array().items(Joi.string().uuid()).required(),
  }),
};

const syncUserPermissionsSchema = {
  body: Joi.object({
    permissionIds: Joi.array().items(Joi.string().uuid()).default([]),
    deniedPermissionIds: Joi.array().items(Joi.string().uuid()).default([]),
  }),
};

const userPermissionParamSchema = {
  params: Joi.object({
    userId: Joi.string().required(),
  }),
};

const assignRoleSchema = {
  body: Joi.object({
    roleId: Joi.string().uuid().required(),
  }),
};

const removeRoleSchema = {
  body: Joi.object({
    roleId: Joi.string().uuid().required(),
  }),
};

const bulkAssignRolesSchema = {
  body: Joi.object({
    roleIds: Joi.array().items(Joi.string().uuid()).required().min(1),
  }),
};

const checkPermissionSchema = {
  query: Joi.object({
    permissionSlug: Joi.string().required(),
  }),
};

const checkRoleSchema = {
  query: Joi.object({
    roleSlug: Joi.string().required(),
  }),
};

const copyFromSchema = {
  body: Joi.object({
    sourceUserId: Joi.string().required(),
    copyModules: Joi.boolean().default(true),
    copyPermissions: Joi.boolean().default(true),
    mergeMode: Joi.string().valid("replace", "merge").default("replace"),
  }),
};

const applyTemplateSchema = {
  body: Joi.object({
    templateSlug: Joi.string().required(),
    mergeMode: Joi.string().valid("replace", "merge").default("replace"),
  }),
};

const listAuditLogsSchema = {
  query: Joi.object({
    actorId: Joi.string(),
    targetUserId: Joi.string(),
    action: Joi.string().valid("grant", "revoke", "role_assign", "role_remove", "module_add", "module_remove", "template_apply", "force_logout", "copy_permissions"),
    moduleSlug: Joi.string(),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(50),
  }),
};

const templateParamSchema = {
  params: Joi.object({
    templateId: Joi.string().required(),
  }),
};

const createTemplateSchema = {
  body: Joi.object({
    slug: Joi.string().min(2).max(128).required(),
    name: Joi.string().min(2).max(128).required(),
    description: Joi.string().max(1000),
    roleScope: Joi.array().items(Joi.string()).default([]),
    permissionSlugs: Joi.array().items(Joi.string()).required(),
    isActive: Joi.boolean().default(true),
    metadata: Joi.object().default({}),
  }),
};

const updateTemplateSchema = {
  body: Joi.object({
    name: Joi.string().min(2).max(128),
    description: Joi.string().max(1000),
    roleScope: Joi.array().items(Joi.string()),
    permissionSlugs: Joi.array().items(Joi.string()),
    isActive: Joi.boolean(),
    metadata: Joi.object(),
  }).min(1),
};

module.exports = {
  createModuleSchema,
  updateModuleSchema,
  listModulesSchema,
  permissionManagementSchema,
  moduleParamSchema,
  moduleStatusSchema,
  reorderModulesSchema,
  createPermissionSchema,
  updatePermissionSchema,
  listPermissionsSchema,
  permissionParamSchema,
  createRoleSchema,
  updateRoleSchema,
  listRolesSchema,
  roleParamSchema,
  assignPermissionSchema,
  removePermissionSchema,
  bulkAssignPermissionsSchema,
  syncPermissionsSchema,
  syncUserPermissionsSchema,
  userPermissionParamSchema,
  assignRoleSchema,
  removeRoleSchema,
  bulkAssignRolesSchema,
  checkPermissionSchema,
  checkRoleSchema,
  copyFromSchema,
  applyTemplateSchema,
  listAuditLogsSchema,
  templateParamSchema,
  createTemplateSchema,
  updateTemplateSchema,
};
