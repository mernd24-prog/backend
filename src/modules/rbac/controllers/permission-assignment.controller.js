const { okResponse } = require("../../../shared/http/reply");
const { RbacService } = require("../services/rbac.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

const getActorMeta = (req) => ({
  ...getCurrentUser(req),
  ipAddress: req.ip || req.headers["x-forwarded-for"],
  userAgent: req.headers["user-agent"],
  requestId: req.headers["x-request-id"],
});

class PermissionAssignmentController {
  constructor({ rbacService = new RbacService() } = {}) {
    this.rbacService = rbacService;
  }

  // USER PERMISSIONS
  getUserPermissions = async (req, res) => {
    const { userId } = req.params;
    const actor = getCurrentUser(req);
    const permissions = await this.rbacService.getUserPermissions(userId, actor);
    res.json(okResponse(permissions));
  };

  assignPermissionToUser = async (req, res) => {
    const { userId } = req.params;
    const { permissionId } = req.body;
    const grantedBy = req.auth?.sub;
    const actor = getCurrentUser(req);

    const result = await this.rbacService.assignPermissionToUser(
      userId,
      permissionId,
      grantedBy,
      actor,
    );
    res.status(201).json(okResponse(result));
  };

  removePermissionFromUser = async (req, res) => {
    const { userId } = req.params;
    const { permissionId } = req.body;
    const actor = getCurrentUser(req);

    const result = await this.rbacService.removePermissionFromUser(
      userId,
      permissionId,
      actor,
    );
    res.json(okResponse(result));
  };

  bulkAssignPermissionsToUser = async (req, res) => {
    const { userId } = req.params;
    const { permissionIds } = req.body;
    const grantedBy = req.auth?.sub;
    const actor = getCurrentUser(req);

    const result = await this.rbacService.bulkAssignPermissionsToUser(
      userId,
      permissionIds,
      grantedBy,
      actor,
    );
    res.json(okResponse(result));
  };

  syncUserPermissions = async (req, res) => {
    const { userId } = req.params;
    const { permissionIds = [], deniedPermissionIds = [] } = req.body;
    const grantedBy = req.auth?.sub;
    const actor = getCurrentUser(req);

    const result = await this.rbacService.syncUserPermissions(
      userId,
      permissionIds,
      deniedPermissionIds,
      grantedBy,
      actor,
    );
    res.json(okResponse(result));
  };

  getUserEffectivePermissions = async (req, res) => {
    const { userId } = req.params;
    const actor = getCurrentUser(req);
    const permissions =
      await this.rbacService.getUserEffectivePermissionSummary(userId, actor);
    res.json(okResponse(permissions));
  };

  // USER ROLES
  getUserRoles = async (req, res) => {
    const { userId } = req.params;
    const actor = getCurrentUser(req);
    const roles = await this.rbacService.getUserRoles(userId, actor);
    res.json(okResponse(roles));
  };

  assignRoleToUser = async (req, res) => {
    const { userId } = req.params;
    const { roleId } = req.body;
    const assignedBy = req.auth?.sub;
    const actor = getCurrentUser(req);

    const result = await this.rbacService.assignRoleToUser(
      userId,
      roleId,
      assignedBy,
      actor,
    );
    res.status(201).json(okResponse(result));
  };

  removeRoleFromUser = async (req, res) => {
    const { userId } = req.params;
    const { roleId } = req.body;
    const actor = getCurrentUser(req);

    const result = await this.rbacService.removeRoleFromUser(userId, roleId, actor);
    res.json(okResponse(result));
  };

  bulkAssignRolesToUser = async (req, res) => {
    const { userId } = req.params;
    const { roleIds } = req.body;
    const assignedBy = req.auth?.sub;
    const actor = getCurrentUser(req);

    const result = await this.rbacService.bulkAssignRolesToUser(
      userId,
      roleIds,
      assignedBy,
      actor,
    );
    res.json(okResponse(result));
  };

  // FORCE LOGOUT
  forceLogoutUser = async (req, res) => {
    const { userId } = req.params;
    const actor = getActorMeta(req);
    const result = await this.rbacService.forceLogoutUser(userId, actor);
    res.json(okResponse(result));
  };

  // COPY PERMISSIONS
  copyUserPermissions = async (req, res) => {
    const { userId } = req.params;
    const { sourceUserId, copyModules = true, copyPermissions = true, mergeMode = "replace" } = req.body;
    const actor = getActorMeta(req);
    const result = await this.rbacService.copyUserPermissions(userId, sourceUserId, actor, { copyModules, copyPermissions, mergeMode });
    res.json(okResponse(result));
  };

  // APPLY TEMPLATE
  applyPermissionTemplate = async (req, res) => {
    const { userId } = req.params;
    const { templateSlug, mergeMode = "replace" } = req.body;
    const actor = getActorMeta(req);
    const result = await this.rbacService.applyPermissionTemplate(userId, templateSlug, actor, mergeMode);
    res.json(okResponse(result));
  };

  // AUDIT LOGS
  listAuditLogs = async (req, res) => {
    const result = await this.rbacService.listAuditLogs(req.query);
    res.json(okResponse(result));
  };

  // PERMISSION TEMPLATES CRUD
  listPermissionTemplates = async (req, res) => {
    const result = await this.rbacService.listPermissionTemplates(req.query);
    res.json(okResponse(result));
  };

  getPermissionTemplate = async (req, res) => {
    const result = await this.rbacService.getPermissionTemplate(req.params.templateId);
    res.json(okResponse(result));
  };

  createPermissionTemplate = async (req, res) => {
    const result = await this.rbacService.createPermissionTemplate(req.body);
    res.status(201).json(okResponse(result));
  };

  updatePermissionTemplate = async (req, res) => {
    const result = await this.rbacService.updatePermissionTemplate(req.params.templateId, req.body);
    res.json(okResponse(result));
  };

  // CHECK PERMISSIONS
  checkUserPermission = async (req, res) => {
    const { userId } = req.params;
    const { permissionSlug } = req.query;
    const actor = getCurrentUser(req);

    const hasPermission = await this.rbacService.userHasPermission(
      userId,
      permissionSlug,
      actor,
    );
    res.json(okResponse({ hasPermission }));
  };

  checkUserRole = async (req, res) => {
    const { userId } = req.params;
    const { roleSlug } = req.query;
    const actor = getCurrentUser(req);

    const hasRole = await this.rbacService.userHasRole(userId, roleSlug, actor);
    res.json(okResponse({ hasRole }));
  };
}

module.exports = { PermissionAssignmentController };
