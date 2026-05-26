const { okResponse } = require("../../../shared/http/reply");
const { RbacService } = require("../services/rbac.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

class PermissionAssignmentController {
  constructor({ rbacService = new RbacService() } = {}) {
    this.rbacService = rbacService;
  }

  // USER PERMISSIONS
  getUserPermissions = async (req, res) => {
    const { userId } = req.params;
    const permissions = await this.rbacService.getUserPermissions(userId);
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

  getUserEffectivePermissions = async (req, res) => {
    const { userId } = req.params;
    const permissions =
      await this.rbacService.getUserEffectivePermissionSummary(userId);
    res.json(okResponse(permissions));
  };

  // USER ROLES
  getUserRoles = async (req, res) => {
    const { userId } = req.params;
    const roles = await this.rbacService.getUserRoles(userId);
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

  // CHECK PERMISSIONS
  checkUserPermission = async (req, res) => {
    const { userId } = req.params;
    const { permissionSlug } = req.query;

    const hasPermission = await this.rbacService.userHasPermission(
      userId,
      permissionSlug,
    );
    res.json(okResponse({ hasPermission }));
  };

  checkUserRole = async (req, res) => {
    const { userId } = req.params;
    const { roleSlug } = req.query;

    const hasRole = await this.rbacService.userHasRole(userId, roleSlug);
    res.json(okResponse({ hasRole }));
  };
}

module.exports = { PermissionAssignmentController };
