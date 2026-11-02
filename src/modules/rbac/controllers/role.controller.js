const { getCurrentUser } = require("../../../shared/auth/current-user");
const { okResponse } = require("../../../shared/http/reply");
const { RbacService } = require("../services/rbac.service");

class RoleController {
  constructor({ rbacService = new RbacService() } = {}) {
    this.rbacService = rbacService;
  }

  listRoles = async (req, res) => {
    const result = await this.rbacService.listRoles(req.query);
    res.json(okResponse(result.items, { total: result.total }));
  };

  getRole = async (req, res) => {
    const role = await this.rbacService.getRole(req.params.roleId);
    res.json(okResponse(role));
  };

  createRole = async (req, res) => {
    const role = await this.rbacService.createRole(req.body, getCurrentUser(req));
    res.status(201).json(okResponse(role));
  };

  updateRole = async (req, res) => {
    const role = await this.rbacService.updateRole(req.params.roleId, req.body, getCurrentUser(req));
    res.json(okResponse(role));
  };

  deleteRole = async (req, res) => {
    const result = await this.rbacService.deleteRole(req.params.roleId, getCurrentUser(req));
    res.json(okResponse(result));
  };

  getRolePermissions = async (req, res) => {
    const permissions = await this.rbacService.getRolePermissions(req.params.roleId);
    res.json(okResponse(permissions));
  };

  assignPermissionToRole = async (req, res) => {
    const { roleId } = req.params;
    const { permissionId } = req.body;

    const result = await this.rbacService.assignPermissionToRole(roleId, permissionId, getCurrentUser(req));
    res.status(201).json(okResponse(result));
  };

  removePermissionFromRole = async (req, res) => {
    const { roleId } = req.params;
    const { permissionId } = req.body;

    const result = await this.rbacService.removePermissionFromRole(roleId, permissionId, getCurrentUser(req));
    res.json(okResponse(result));
  };

  bulkAssignPermissions = async (req, res) => {
    const { roleId } = req.params;
    const { permissionIds } = req.body;

    const result = await this.rbacService.bulkAssignPermissionsToRole(roleId, permissionIds, getCurrentUser(req));
    res.json(okResponse(result));
  };

  syncPermissions = async (req, res) => {
    const { roleId } = req.params;
    const { permissionIds } = req.body;
    const result = await this.rbacService.syncRolePermissions(roleId, Array.isArray(permissionIds) ? permissionIds : [], getCurrentUser(req));
    res.json(okResponse(result));
  };
}

module.exports = { RoleController };
