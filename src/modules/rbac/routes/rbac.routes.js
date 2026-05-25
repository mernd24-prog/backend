const express = require("express");
const { ModuleController } = require("../controllers/module.controller");
const {
  PermissionController,
} = require("../controllers/permission.controller");
const { RoleController } = require("../controllers/role.controller");
const {
  PermissionAssignmentController,
} = require("../controllers/permission-assignment.controller");
const { authenticate } = require("../../../shared/middleware/authenticate");
const {
  allowRoles,
  allowPermissions,
} = require("../../../shared/middleware/access");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const {
  checkInput,
} = require("../../../shared/middleware/check-input");
const {
  createModuleSchema,
  updateModuleSchema,
  listModulesSchema,
  moduleStatusSchema,
  reorderModulesSchema,
  permissionManagementSchema,
  moduleParamSchema,
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
  userPermissionParamSchema,
  assignRoleSchema,
  removeRoleSchema,
  bulkAssignRolesSchema,
  checkPermissionSchema,
  checkRoleSchema,
} = require("../validation/rbac.validation");
const { ROLES } = require("../../../shared/constants/roles");

const rbacRoutes = express.Router();

const moduleController = new ModuleController();
const permissionController = new PermissionController();
const roleController = new RoleController();
const permissionAssignmentController = new PermissionAssignmentController();

// Authentication required for all RBAC routes.
// Super-admins and admins pass freely; sub-admins are admitted but each
// route still requires the specific rbac:* permission (enforced below).
rbacRoutes.use(authenticate, allowRoles(ROLES.ADMIN, ROLES.SUB_ADMIN));

// MODULES ROUTES
rbacRoutes.get(
  "/permission-management/modules",
  allowPermissions("rbac:view"),
  checkInput(permissionManagementSchema),
  catchErrors(moduleController.permissionManagement),
);

rbacRoutes.get(
  "/modules/sidebar",
  checkInput({ query: listModulesSchema.query }),
  catchErrors(moduleController.sidebarModules),
);

rbacRoutes.post(
  "/modules/reorder",
  allowPermissions("rbac:update"),
  checkInput(reorderModulesSchema),
  catchErrors(moduleController.reorderModules),
);

rbacRoutes.patch(
  "/modules/:moduleId/status",
  allowPermissions("rbac:update"),
  checkInput(moduleStatusSchema),
  catchErrors(moduleController.changeStatus),
);

rbacRoutes.get(
  "/modules",
  allowPermissions("rbac:view"),
  checkInput(listModulesSchema),
  catchErrors(moduleController.listModules),
);

rbacRoutes.get(
  "/modules/:moduleId",
  allowPermissions("rbac:view"),
  checkInput(moduleParamSchema),
  catchErrors(moduleController.getModule),
);

rbacRoutes.post(
  "/modules",
  allowPermissions("rbac:add"),
  checkInput(createModuleSchema),
  catchErrors(moduleController.createModule),
);

rbacRoutes.patch(
  "/modules/:moduleId",
  checkInput({ ...moduleParamSchema, body: updateModuleSchema.body }),
  allowPermissions("rbac:update"),
  catchErrors(moduleController.updateModule),
);

rbacRoutes.delete(
  "/modules/:moduleId",
  checkInput(moduleParamSchema),
  allowPermissions("rbac:delete"),
  catchErrors(moduleController.deleteModule),
);

// PERMISSIONS ROUTES
rbacRoutes.get(
  "/permissions",
  allowPermissions("rbac:view"),
  checkInput(listPermissionsSchema),
  catchErrors(permissionController.listPermissions),
);

rbacRoutes.get(
  "/permissions/:permissionId",
  allowPermissions("rbac:view"),
  checkInput(permissionParamSchema),
  catchErrors(permissionController.getPermission),
);

rbacRoutes.post(
  "/permissions",
  allowPermissions("rbac:add"),
  checkInput(createPermissionSchema),
  catchErrors(permissionController.createPermission),
);

rbacRoutes.patch(
  "/permissions/:permissionId",
  checkInput({
    ...permissionParamSchema,
    body: updatePermissionSchema.body,
  }),
  allowPermissions("rbac:update"),
  catchErrors(permissionController.updatePermission),
);

rbacRoutes.delete(
  "/permissions/:permissionId",
  checkInput(permissionParamSchema),
  allowPermissions("rbac:delete"),
  catchErrors(permissionController.deletePermission),
);

// ROLES ROUTES
rbacRoutes.get(
  "/roles",
  allowPermissions("rbac:view"),
  checkInput(listRolesSchema),
  catchErrors(roleController.listRoles),
);

rbacRoutes.get(
  "/roles/:roleId",
  allowPermissions("rbac:view"),
  checkInput(roleParamSchema),
  catchErrors(roleController.getRole),
);

rbacRoutes.post(
  "/roles",
  allowPermissions("rbac:add"),
  checkInput(createRoleSchema),
  catchErrors(roleController.createRole),
);

rbacRoutes.patch(
  "/roles/:roleId",
  checkInput({ ...roleParamSchema, body: updateRoleSchema.body }),
  allowPermissions("rbac:update"),
  catchErrors(roleController.updateRole),
);

rbacRoutes.delete(
  "/roles/:roleId",
  checkInput(roleParamSchema),
  allowPermissions("rbac:delete"),
  catchErrors(roleController.deleteRole),
);

rbacRoutes.get(
  "/roles/:roleId/permissions",
  allowPermissions("rbac:view"),
  checkInput(roleParamSchema),
  catchErrors(roleController.getRolePermissions),
);

rbacRoutes.post(
  "/roles/:roleId/permissions",
  checkInput({ ...roleParamSchema, body: assignPermissionSchema.body }),
  allowPermissions("rbac:update"),
  catchErrors(roleController.assignPermissionToRole),
);

rbacRoutes.delete(
  "/roles/:roleId/permissions",
  checkInput({ ...roleParamSchema, body: removePermissionSchema.body }),
  allowPermissions("rbac:delete"),
  catchErrors(roleController.removePermissionFromRole),
);

rbacRoutes.post(
  "/roles/:roleId/permissions/bulk",
  checkInput({
    ...roleParamSchema,
    body: bulkAssignPermissionsSchema.body,
  }),
  allowPermissions("rbac:update"),
  catchErrors(roleController.bulkAssignPermissions),
);

// Sync (replace) all permissions for a role at once
rbacRoutes.put(
  "/roles/:roleId/permissions",
  checkInput({ ...roleParamSchema, body: syncPermissionsSchema.body }),
  allowPermissions("rbac:update"),
  catchErrors(roleController.syncPermissions),
);

// USER PERMISSIONS ROUTES
rbacRoutes.get(
  "/users/:userId/permissions",
  checkInput(userPermissionParamSchema),
  allowPermissions("rbac:view"),
  catchErrors(permissionAssignmentController.getUserPermissions),
);

rbacRoutes.get(
  "/users/:userId/permissions/effective",
  checkInput(userPermissionParamSchema),
  allowPermissions("rbac:view"),
  catchErrors(permissionAssignmentController.getUserEffectivePermissions),
);

rbacRoutes.get(
  "/users/:userId/permissions/check",
  checkInput({
    ...userPermissionParamSchema,
    query: checkPermissionSchema.query,
  }),
  allowPermissions("rbac:view"),
  catchErrors(permissionAssignmentController.checkUserPermission),
);

rbacRoutes.post(
  "/users/:userId/permissions",
  checkInput({
    ...userPermissionParamSchema,
    body: assignPermissionSchema.body,
  }),
  allowPermissions("rbac:update"),
  catchErrors(permissionAssignmentController.assignPermissionToUser),
);

rbacRoutes.delete(
  "/users/:userId/permissions",
  checkInput({
    ...userPermissionParamSchema,
    body: removePermissionSchema.body,
  }),
  allowPermissions("rbac:delete"),
  catchErrors(permissionAssignmentController.removePermissionFromUser),
);

rbacRoutes.post(
  "/users/:userId/permissions/bulk",
  checkInput({
    ...userPermissionParamSchema,
    body: bulkAssignPermissionsSchema.body,
  }),
  allowPermissions("rbac:update"),
  catchErrors(permissionAssignmentController.bulkAssignPermissionsToUser),
);

// USER ROLES ROUTES
rbacRoutes.get(
  "/users/:userId/roles",
  checkInput(userPermissionParamSchema),
  allowPermissions("rbac:view"),
  catchErrors(permissionAssignmentController.getUserRoles),
);

rbacRoutes.get(
  "/users/:userId/roles/check",
  checkInput({
    ...userPermissionParamSchema,
    query: checkRoleSchema.query,
  }),
  allowPermissions("rbac:view"),
  catchErrors(permissionAssignmentController.checkUserRole),
);

rbacRoutes.post(
  "/users/:userId/roles",
  checkInput({
    ...userPermissionParamSchema,
    body: assignRoleSchema.body,
  }),
  allowPermissions("rbac:update"),
  catchErrors(permissionAssignmentController.assignRoleToUser),
);

rbacRoutes.delete(
  "/users/:userId/roles",
  checkInput({
    ...userPermissionParamSchema,
    body: removeRoleSchema.body,
  }),
  allowPermissions("rbac:delete"),
  catchErrors(permissionAssignmentController.removeRoleFromUser),
);

rbacRoutes.post(
  "/users/:userId/roles/bulk",
  checkInput({
    ...userPermissionParamSchema,
    body: bulkAssignRolesSchema.body,
  }),
  allowPermissions("rbac:update"),
  catchErrors(permissionAssignmentController.bulkAssignRolesToUser),
);

module.exports = { rbacRoutes };
