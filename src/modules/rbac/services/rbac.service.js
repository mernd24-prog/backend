const { RbacRepository } = require("../repositories/rbac.repository");
const { AppError } = require("../../../shared/errors/app-error");

const slugifyModule = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const toRouteCode = (routePath = "") =>
  String(routePath || "")
    .replace(/^\/app\/?/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

class RbacService {
  constructor({ rbacRepository = new RbacRepository() } = {}) {
    this.rbacRepository = rbacRepository;
  }

  // MODULE OPERATIONS
  normalizeModulePayload(moduleData = {}) {
    const moduleName = moduleData.moduleName || moduleData.name;
    const moduleKey = slugifyModule(moduleData.moduleKey || moduleData.key || moduleData.slug || moduleName);
    const moduleSlug = slugifyModule(moduleData.moduleSlug || moduleData.slug || moduleKey);
    const status = moduleData.status || (moduleData.active === false ? "inactive" : "active");
    const metadata = {
      ...(moduleData.metadata || {}),
      ...(Array.isArray(moduleData.allowedRoles)
        ? { allowedRoles: moduleData.allowedRoles }
        : {}),
    };
    const payload = {
      name: moduleName,
      slug: moduleSlug,
      moduleKey,
      description: moduleData.description,
      icon: moduleData.icon,
      routePath: moduleData.routePath,
      parentModuleId: moduleData.parentModuleId || moduleData.parentModule || null,
      moduleType: moduleData.moduleType || "module",
      order: Number(moduleData.order || 0),
      status,
      active: moduleData.active !== undefined ? Boolean(moduleData.active) : status === "active",
      modulePermissions: Array.isArray(moduleData.permissions)
        ? moduleData.permissions
        : Array.isArray(moduleData.modulePermissions)
          ? moduleData.modulePermissions
          : [],
      isVisibleInSidebar: moduleData.isVisibleInSidebar !== false,
      metadata,
    };
    if (!payload.name) throw new AppError("Module name is required", 400);
    if (!payload.moduleKey) throw new AppError("Module key is required", 400);
    if (
      payload.isVisibleInSidebar &&
      payload.moduleType !== "group" &&
      !toRouteCode(payload.routePath)
    ) {
      throw new AppError("Route path is required for sidebar modules", 400);
    }
    return payload;
  }

  serializeModule(module = {}) {
    const plain = typeof module.toJSON === "function" ? module.toJSON() : module;
    return {
      ...plain,
      moduleName: plain.name,
      moduleKey: plain.moduleKey || plain.slug,
      moduleSlug: plain.slug,
      parentModule: plain.parentModule
        ? {
            id: plain.parentModule.id,
            moduleName: plain.parentModule.name,
            moduleKey: plain.parentModule.moduleKey || plain.parentModule.slug,
            moduleSlug: plain.parentModule.slug,
          }
        : null,
      allowedRoles: plain.metadata?.allowedRoles || [],
      permissions: plain.permissions || plain.modulePermissions || [],
    };
  }

  async createModule(moduleData) {
    const payload = this.normalizeModulePayload(moduleData);
    const existingModule = await this.rbacRepository.getModuleBySlug(payload.slug);
    if (existingModule) {
      throw new AppError("Module with this slug already exists", 409);
    }

    if (payload.moduleKey && payload.moduleKey !== payload.slug) {
      const existingByKey = await this.rbacRepository.getModuleBySlug(payload.moduleKey);
      if (existingByKey) throw new AppError("Module with this key already exists", 409);
    }

    return this.serializeModule(await this.rbacRepository.createModule(payload));
  }

  async getModule(id) {
    const module = await this.rbacRepository.getModuleById(id);
    if (!module) {
      throw new AppError("Module not found", 404);
    }
    return this.serializeModule(module);
  }

  async listModules(filters) {
    const result = await this.rbacRepository.listModules(filters);
    return {
      ...result,
      items: result.items.map((item) => this.serializeModule(item)),
    };
  }

  async listSidebarModules() {
    const rows = await this.rbacRepository.listSidebarModules();
    const modules = rows.map((row) => this.serializeModule(row));
    const byId = new Map(modules.map((item) => [item.id, { ...item, children: [] }]));
    const byKey = new Map(modules.map((item) => [item.moduleKey || item.moduleSlug, byId.get(item.id)]));
    const roots = [];

    byId.forEach((item) => {
      const parent = item.parentModuleId
        ? byId.get(item.parentModuleId)
        : byKey.get(item.metadata?.parentModule || item.parentModuleKey);
      if (parent) parent.children.push(item);
      else roots.push(item);
    });

    const sortTree = (items) =>
      items
        .sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || String(left.moduleName).localeCompare(String(right.moduleName)))
        .map((item) => ({ ...item, children: sortTree(item.children || []) }));

    return sortTree(roots);
  }

  async getPermissionManagementMatrix(filters = {}) {
    const matrix =
      await this.rbacRepository.listPermissionManagementModules(filters);
    const permissionCount = matrix.items.reduce(
      (total, module) => total + module.permissions.length,
      0,
    );
    const assignedPermissionCount = matrix.items.reduce(
      (total, module) => total + module.assignedPermissionCount,
      0,
    );

    return {
      role: matrix.role,
      modules: matrix.items,
      totals: {
        modules: matrix.total,
        permissions: permissionCount,
        assignedPermissions: assignedPermissionCount,
      },
      actions: [
        "view",
        "create",
        "add",
        "edit",
        "update",
        "delete",
        "approve",
        "approval",
        "reject",
        "assign",
        "export",
        "import",
        "status_change",
        "status",
        "restore",
        "bulk_action",
        "action",
      ],
      assignedPermissionIds: matrix.assignedPermissionIds,
    };
  }

  async updateModule(id, updates) {
    const module = await this.rbacRepository.getModuleById(id);
    if (!module) {
      throw new AppError("Module not found", 404);
    }

    // Check if slug is being updated and if it's unique
    const payload = this.normalizeModulePayload({ ...module.toJSON(), ...updates });

    if (payload.slug && payload.slug !== module.slug) {
      const existing = await this.rbacRepository.getModuleBySlug(payload.slug);
      if (existing) {
        throw new AppError("Module with this slug already exists", 409);
      }
    }
    if (payload.moduleKey && payload.moduleKey !== module.moduleKey) {
      const existing = await this.rbacRepository.getModuleBySlug(payload.moduleKey);
      if (existing) throw new AppError("Module with this key already exists", 409);
    }

    return this.serializeModule(await this.rbacRepository.updateModule(id, payload));
  }

  async changeModuleStatus(id, status) {
    if (!["active", "inactive", "draft"].includes(status)) {
      throw new AppError("Invalid module status", 400);
    }
    return this.serializeModule(
      await this.rbacRepository.updateModule(id, {
        status,
        active: status === "active",
      }),
    );
  }

  async reorderModules(items = []) {
    const updated = [];
    for (const item of items) {
      if (!item.id) continue;
      updated.push(
        await this.rbacRepository.updateModule(item.id, {
          order: Number(item.order || 0),
          ...(item.parentModuleId !== undefined ? { parentModuleId: item.parentModuleId || null } : {}),
        }),
      );
    }
    return updated.map((item) => this.serializeModule(item));
  }

  async deleteModule(id) {
    return this.rbacRepository.deleteModule(id);
  }

  // PERMISSION OPERATIONS
  async createPermission(permissionData) {
    const module = await this.rbacRepository.getModuleById(
      permissionData.moduleId,
    );
    if (!module) {
      throw new AppError("Module not found", 404);
    }

    const existingPermission = await this.rbacRepository.getPermissionBySlug(
      permissionData.slug,
    );
    if (existingPermission) {
      throw new AppError("Permission with this slug already exists", 409);
    }

    return this.rbacRepository.createPermission(permissionData);
  }

  async getPermission(id) {
    const permission = await this.rbacRepository.getPermissionById(id);
    if (!permission) {
      throw new AppError("Permission not found", 404);
    }
    return permission;
  }

  async listPermissions(filters) {
    return this.rbacRepository.listPermissions(filters);
  }

  async updatePermission(id, updates) {
    const permission = await this.rbacRepository.getPermissionById(id);
    if (!permission) {
      throw new AppError("Permission not found", 404);
    }

    if (updates.slug && updates.slug !== permission.slug) {
      const existing = await this.rbacRepository.getPermissionBySlug(
        updates.slug,
      );
      if (existing) {
        throw new AppError("Permission with this slug already exists", 409);
      }
    }

    return this.rbacRepository.updatePermission(id, updates);
  }

  async deletePermission(id) {
    await this.getPermission(id);
    return this.rbacRepository.deletePermission(id);
  }

  // ROLE OPERATIONS
  async createRole(roleData) {
    const existingRole = await this.rbacRepository.getRoleBySlug(roleData.slug);
    if (existingRole) {
      throw new AppError("Role with this slug already exists", 409);
    }

    return this.rbacRepository.createRole(roleData);
  }

  async getRole(id) {
    const role = await this.rbacRepository.getRoleById(id);
    if (!role) {
      throw new AppError("Role not found", 404);
    }
    return role;
  }

  async listRoles(filters) {
    return this.rbacRepository.listRoles(filters);
  }

  async updateRole(id, updates) {
    const role = await this.rbacRepository.getRoleById(id);
    if (!role) {
      throw new AppError("Role not found", 404);
    }

    if (updates.slug && updates.slug !== role.slug) {
      const existing = await this.rbacRepository.getRoleBySlug(updates.slug);
      if (existing) {
        throw new AppError("Role with this slug already exists", 409);
      }
    }

    return this.rbacRepository.updateRole(id, updates);
  }

  async deleteRole(id) {
    await this.getRole(id);
    return this.rbacRepository.deleteRole(id);
  }

  // ROLE PERMISSION ASSIGNMENT
  async assignPermissionToRole(roleId, permissionId) {
    return this.rbacRepository.assignPermissionToRole(roleId, permissionId);
  }

  async removePermissionFromRole(roleId, permissionId) {
    return this.rbacRepository.removePermissionFromRole(roleId, permissionId);
  }

  async syncRolePermissions(roleId, permissionIds = []) {
    return this.rbacRepository.syncRolePermissions(roleId, permissionIds);
  }

  async bulkAssignPermissionsToRole(roleId, permissionIds) {
    const results = [];
    const errors = [];

    for (const permissionId of permissionIds) {
      try {
        const result = await this.rbacRepository.assignPermissionToRole(
          roleId,
          permissionId,
        );
        results.push(result);
      } catch (error) {
        errors.push({ permissionId, error: error.message });
      }
    }

    return { assigned: results, errors };
  }

  async getRolePermissions(roleId) {
    return this.rbacRepository.getRolePermissions(roleId);
  }

  // USER PERMISSION ASSIGNMENT
  async assignPermissionToUser(userId, permissionId, grantedBy) {
    return this.rbacRepository.assignPermissionToUser(
      userId,
      permissionId,
      grantedBy,
    );
  }

  async removePermissionFromUser(userId, permissionId) {
    return this.rbacRepository.removePermissionFromUser(userId, permissionId);
  }

  async bulkAssignPermissionsToUser(userId, permissionIds, grantedBy) {
    const results = [];
    const errors = [];

    for (const permissionId of permissionIds) {
      try {
        const result = await this.rbacRepository.assignPermissionToUser(
          userId,
          permissionId,
          grantedBy,
        );
        results.push(result);
      } catch (error) {
        errors.push({ permissionId, error: error.message });
      }
    }

    return { assigned: results, errors };
  }

  async getUserPermissions(userId) {
    return this.rbacRepository.getUserPermissions(userId);
  }

  async syncUserModulePermissions(userId, modulePermissions, grantedBy) {
    return this.rbacRepository.syncUserModulePermissions(
      userId,
      modulePermissions,
      grantedBy,
    );
  }

  // USER ROLE ASSIGNMENT
  async assignRoleToUser(userId, roleId, assignedBy) {
    return this.rbacRepository.assignRoleToUser(userId, roleId, assignedBy);
  }

  async assignRoleToUserBySlug(userId, roleSlug, assignedBy, options = {}) {
    const { ignoreMissing = false, ignoreExisting = true } = options;
    const role = await this.rbacRepository.getRoleBySlug(roleSlug);

    if (!role) {
      if (ignoreMissing) {
        return null;
      }
      throw new AppError("Role not found", 404);
    }

    try {
      return await this.assignRoleToUser(userId, role.id, assignedBy);
    } catch (error) {
      if (
        ignoreExisting &&
        error instanceof AppError &&
        error.statusCode === 409
      ) {
        return null;
      }
      throw error;
    }
  }

  async removeRoleFromUser(userId, roleId) {
    return this.rbacRepository.removeRoleFromUser(userId, roleId);
  }

  async bulkAssignRolesToUser(userId, roleIds, assignedBy) {
    const results = [];
    const errors = [];

    for (const roleId of roleIds) {
      try {
        const result = await this.rbacRepository.assignRoleToUser(
          userId,
          roleId,
          assignedBy,
        );
        results.push(result);
      } catch (error) {
        errors.push({ roleId, error: error.message });
      }
    }

    return { assigned: results, errors };
  }

  async getUserRoles(userId) {
    return this.rbacRepository.getUserRoles(userId);
  }

  // GET EFFECTIVE PERMISSIONS
  async getUserEffectivePermissions(userId) {
    return this.rbacRepository.getUserEffectivePermissions(userId);
  }

  async userHasPermission(userId, permissionSlug) {
    const permissions = await this.getUserEffectivePermissions(userId);
    return permissions.some((p) => p.slug === permissionSlug);
  }

  async userHasRole(userId, roleSlug) {
    const roles = await this.rbacRepository.getUserRoles(userId);
    return roles.some((ur) => ur.role && ur.role.slug === roleSlug);
  }

  // SUPER ADMIN OPERATIONS
  async checkSuperAdminExists() {
    return this.rbacRepository.superAdminExists();
  }

  async getSuperAdminByUserId(userId) {
    return this.rbacRepository.getSuperAdminByUserId(userId);
  }

  async listSuperAdmins(filters) {
    return this.rbacRepository.listSuperAdmins(filters);
  }

  async updateSuperAdmin(userId, updates) {
    return this.rbacRepository.updateSuperAdmin(userId, updates);
  }
}

module.exports = { RbacService };
