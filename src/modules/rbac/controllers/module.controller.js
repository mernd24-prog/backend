const { okResponse } = require("../../../shared/http/reply");
const { RbacService } = require("../services/rbac.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

class ModuleController {
  constructor({ rbacService = new RbacService() } = {}) {
    this.rbacService = rbacService;
  }

  listModules = async (req, res) => {
    const result = await this.rbacService.listModules(req.query);
    res.json(okResponse(result.items, { total: result.total }));
  };

  sidebarModules = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.rbacService.listSidebarModules(req.query, actor);
    res.json(okResponse(result));
  };

  permissionManagement = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.rbacService.getPermissionManagementMatrix(
      req.query,
      actor,
    );
    res.json(okResponse(result));
  };

  getModule = async (req, res) => {
    const module = await this.rbacService.getModule(req.params.moduleId);
    res.json(okResponse(module));
  };

  createModule = async (req, res) => {
    const module = await this.rbacService.createModule(req.body);
    res.status(201).json(okResponse(module));
  };

  updateModule = async (req, res) => {
    const module = await this.rbacService.updateModule(
      req.params.moduleId,
      req.body,
    );
    res.json(okResponse(module));
  };

  changeStatus = async (req, res) => {
    const module = await this.rbacService.changeModuleStatus(
      req.params.moduleId,
      req.body.status,
    );
    res.json(okResponse(module));
  };

  reorderModules = async (req, res) => {
    const modules = await this.rbacService.reorderModules(req.body.modules);
    res.json(okResponse(modules));
  };

  deleteModule = async (req, res) => {
    await this.rbacService.deleteModule(req.params.moduleId);
    res.status(204).send();
  };
}

module.exports = { ModuleController };
