const { RbacRepository } = require("../repositories/rbac.repository");
const { AppError } = require("../../../shared/errors/app-error");
const { ROLES } = require("../../../shared/constants/roles");
const { UserModel } = require("../../user/models/user.model");
const { cleanModuleName, DEFAULT_SELLER_MODULES } = require("../../../shared/auth/module-access");
const {
  SESSION_INVALIDATION_REASONS,
  makeSessionInvalidationUpdate,
} = require("../../../shared/auth/session-state");

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

  async invalidateUserAuthSession(userId, reason = SESSION_INVALIDATION_REASONS.PERMISSIONS_CHANGED) {
    if (!userId) return null;
    return UserModel.findByIdAndUpdate(
      userId,
      makeSessionInvalidationUpdate(reason),
      { new: true },
    ).catch(() => null);
  }

  async invalidateUsersForRole(roleId, reason = SESSION_INVALIDATION_REASONS.PERMISSIONS_CHANGED) {
    const userIds = await this.rbacRepository.getUserIdsForRole(roleId).catch(() => []);
    if (!userIds.length) return { invalidated: 0 };
    await UserModel.updateMany(
      { _id: { $in: userIds } },
      makeSessionInvalidationUpdate(reason),
    );
    return { invalidated: userIds.length };
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

  async listSidebarModules(filters = {}, actor = {}) {
    const isSuperAdmin = actor.isSuperAdmin || actor.role === "super-admin";
    const allowedModules = Array.isArray(actor.allowedModules)
      ? actor.allowedModules.map(cleanModuleName).filter(Boolean)
      : [];
    const permissionModules = Array.isArray(actor.permissions)
      ? actor.permissions
          .map((permission) => String(permission || "").toLowerCase().split(":")[0])
          .map(cleanModuleName)
          .filter(Boolean)
      : [];
    const moduleScope = new Set([...allowedModules, ...permissionModules]);

    if (!isSuperAdmin && !moduleScope.size) {
      return [];
    }
    const rows = await this.rbacRepository.listSidebarModules(filters);
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

    const moduleAllowed = (item = {}) => {
      if (isSuperAdmin) return true;
      const candidates = [
        item.metadata?.requiredModule,
        item.requiredModule,
        item.moduleKey,
        item.moduleSlug,
        item.slug,
      ]
        .map(cleanModuleName)
        .filter(Boolean);
      return candidates.some((candidate) => moduleScope.has(candidate));
    };

    const filterTree = (items = []) =>
      items
        .map((item) => {
          const children = filterTree(item.children || []);
          if (!moduleAllowed(item) && !children.length) {
            return null;
          }
          return { ...item, children };
        })
        .filter(Boolean);

    const sortTree = (items) =>
      items
        .sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || String(left.moduleName).localeCompare(String(right.moduleName)))
        .map((item) => ({ ...item, children: sortTree(item.children || []) }));

    return sortTree(filterTree(roots));
  }

  async getPermissionManagementMatrix(filters = {}) {
    const matrix =
      await this.rbacRepository.listPermissionManagementModules(filters);
    if (filters.userId) {
      const effectivePermissions = await this.getUserEffectivePermissions(filters.userId);
      const assignedPermissionIds = new Set(
        (effectivePermissions || []).map((permission) => permission.id).filter(Boolean),
      );
      matrix.items = matrix.items.map((module) => {
        const permissions = (module.permissions || []).map((permission) => ({
          ...permission,
          assigned: assignedPermissionIds.has(permission.id),
        }));
        const permissionsByAction = Object.keys(module.permissionsByAction || {}).reduce(
          (lookup, action) => {
            lookup[action] =
              permissions.find((permission) => permission.action === action) || null;
            return lookup;
          },
          {},
        );
        const permissionKeys = Object.keys(permissionsByAction).reduce(
          (lookup, action) => {
            lookup[action] = Boolean(permissionsByAction[action]?.assigned);
            return lookup;
          },
          {},
        );
        return {
          ...module,
          permissions,
          permissionsByAction,
          permissionKeys,
          assignedPermissionCount: permissions.filter((permission) => permission.assigned).length,
        };
      });
      matrix.assignedPermissionIds = Array.from(assignedPermissionIds);
    }
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

    const result = await this.rbacRepository.updateRole(id, updates);
    if (
      Object.prototype.hasOwnProperty.call(updates, "active") ||
      Object.prototype.hasOwnProperty.call(updates, "slug")
    ) {
      await this.invalidateUsersForRole(id, SESSION_INVALIDATION_REASONS.ROLE_CHANGED);
    }
    return result;
  }

  async deleteRole(id) {
    await this.getRole(id);
    await this.invalidateUsersForRole(id, SESSION_INVALIDATION_REASONS.ROLE_CHANGED);
    return this.rbacRepository.deleteRole(id);
  }

  // ROLE PERMISSION ASSIGNMENT
  async assignPermissionToRole(roleId, permissionId) {
    const result = await this.rbacRepository.assignPermissionToRole(roleId, permissionId);
    await this.invalidateUsersForRole(roleId);
    return result;
  }

  async removePermissionFromRole(roleId, permissionId) {
    const result = await this.rbacRepository.removePermissionFromRole(roleId, permissionId);
    await this.invalidateUsersForRole(roleId);
    return result;
  }

  async syncRolePermissions(roleId, permissionIds = []) {
    const result = await this.rbacRepository.syncRolePermissions(roleId, permissionIds);
    await this.invalidateUsersForRole(roleId);
    return result;
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

    if (results.length) {
      await this.invalidateUsersForRole(roleId);
    }

    return { assigned: results, errors };
  }

  async getRolePermissions(roleId) {
    return this.rbacRepository.getRolePermissions(roleId);
  }

  // USER PERMISSION ASSIGNMENT
  async assertCanAssignUserPermissions(actor = {}, targetUserId, permissionIds = []) {
    if (!actor.userId) return;
    if (actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) return;

    const target = await UserModel.findById(targetUserId).select("role ownerAdminId ownerSellerId");
    if (!target) throw new AppError("User not found", 404);

    const role = actor.role;
    const targetRole = target.role;
    const validAdminTarget =
      role === ROLES.ADMIN &&
      [ROLES.SUB_ADMIN, ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(targetRole) &&
      String(target.ownerAdminId || "") === String(actor.ownerAdminId || actor.userId);
    const validSellerTarget =
      [ROLES.SELLER, ROLES.SELLER_ADMIN].includes(role) &&
      [ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(targetRole) &&
      String(target.ownerSellerId || "") === String(actor.ownerSellerId || actor.userId);

    if (!validAdminTarget && !validSellerTarget) {
      throw new AppError("Forbidden: user is outside your assignable hierarchy", 403);
    }

    const actorPermissions = await this.getUserEffectivePermissions(actor.userId);
    const actorPermissionIds = new Set(actorPermissions.map((permission) => permission.id).filter(Boolean));
    const denied = permissionIds.filter((permissionId) => !actorPermissionIds.has(permissionId));
    if (denied.length) {
      throw new AppError("Forbidden: cannot assign permissions you do not have", 403);
    }
  }

  async assignPermissionToUser(userId, permissionId, grantedBy, actor = {}) {
    await this.assertCanAssignUserPermissions(actor, userId, [permissionId]);
    const result = await this.rbacRepository.assignPermissionToUser(
      userId,
      permissionId,
      grantedBy,
    );
    await this.invalidateUserAuthSession(userId);
    return result;
  }

  async removePermissionFromUser(userId, permissionId, actor = {}) {
    await this.assertCanAssignUserPermissions(actor, userId, []);
    const result = await this.rbacRepository.removePermissionFromUser(userId, permissionId);
    await this.invalidateUserAuthSession(userId);
    return result;
  }

  async bulkAssignPermissionsToUser(userId, permissionIds, grantedBy, actor = {}) {
    await this.assertCanAssignUserPermissions(actor, userId, permissionIds);
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

    if (results.length) {
      await this.invalidateUserAuthSession(userId);
    }

    return { assigned: results, errors };
  }

  async getUserPermissions(userId) {
    return this.rbacRepository.getUserPermissions(userId);
  }

  async syncUserModulePermissions(userId, modulePermissions, grantedBy) {
    const result = await this.rbacRepository.syncUserModulePermissions(
      userId,
      modulePermissions,
      grantedBy,
    );
    await this.invalidateUserAuthSession(userId);
    return result;
  }

  // USER ROLE ASSIGNMENT
  async assertCanAssignUserRole(actor = {}, userId, roleId) {
    if (!actor.userId) return;
    if (actor.isSuperAdmin || actor.role === ROLES.SUPER_ADMIN) return;
    const role = await this.rbacRepository.getRoleById(roleId).catch(() => null);
    const target = await UserModel.findById(userId).select("role ownerAdminId ownerSellerId");
    const roleSlug = role?.slug;
    if (!target || !roleSlug || roleSlug !== target.role) {
      throw new AppError("Forbidden: cannot assign mismatched or higher-level role", 403);
    }
    await this.assertCanAssignUserPermissions(actor, userId, []);
  }

  async assignRoleToUser(userId, roleId, assignedBy, actor = {}, options = {}) {
    await this.assertCanAssignUserRole(actor, userId, roleId);
    const result = await this.rbacRepository.assignRoleToUser(userId, roleId, assignedBy);
    if (!options.skipSessionInvalidation) {
      await this.invalidateUserAuthSession(userId, SESSION_INVALIDATION_REASONS.ROLE_CHANGED);
    }
    return result;
  }

  async assignRoleToUserBySlug(userId, roleSlug, assignedBy, options = {}) {
    const { ignoreMissing = false, ignoreExisting = true, skipSessionInvalidation = false } = options;
    const role = await this.rbacRepository.getRoleBySlug(roleSlug);

    if (!role) {
      if (ignoreMissing) {
        return null;
      }
      throw new AppError("Role not found", 404);
    }

    try {
      return await this.assignRoleToUser(userId, role.id, assignedBy, {}, { skipSessionInvalidation });
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

  async removeRoleFromUser(userId, roleId, actor = {}) {
    await this.assertCanAssignUserRole(actor, userId, roleId);
    const result = await this.rbacRepository.removeRoleFromUser(userId, roleId);
    await this.invalidateUserAuthSession(userId, SESSION_INVALIDATION_REASONS.ROLE_CHANGED);
    return result;
  }

  async bulkAssignRolesToUser(userId, roleIds, assignedBy, actor = {}) {
    const results = [];
    const errors = [];

    for (const roleId of roleIds) {
      try {
        await this.assertCanAssignUserRole(actor, userId, roleId);
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

    if (results.length) {
      await this.invalidateUserAuthSession(userId, SESSION_INVALIDATION_REASONS.ROLE_CHANGED);
    }

    return { assigned: results, errors };
  }

  async getUserRoles(userId) {
    return this.rbacRepository.getUserRoles(userId);
  }

  // GET EFFECTIVE PERMISSIONS
  async getUserEffectivePermissions(userId) {
    const user = await UserModel.findById(userId)
      .select("role allowedModules")
      .lean()
      .catch(() => null);

    if (user?.role === ROLES.SUPER_ADMIN) {
      const permissions = await this.rbacRepository.listAllActivePermissions();
      return permissions.map((permission) => {
        const plain = typeof permission.toJSON === "function" ? permission.toJSON() : permission;
        return {
          ...plain,
          moduleSlug: plain.module?.slug || plain.moduleSlug,
          moduleKey: plain.module?.moduleKey || plain.moduleKey,
          moduleName: plain.module?.name || plain.moduleName,
        };
      });
    }

    const scopedDirectRoles = new Set([
      ROLES.ADMIN,
      ROLES.SUB_ADMIN,
      ROLES.SELLER_ADMIN,
      ROLES.SELLER_SUB_ADMIN,
    ]);

    if (user && scopedDirectRoles.has(user.role)) {
      const allowedModuleSet = new Set(
        (user.allowedModules || []).map(cleanModuleName).filter(Boolean),
      );

      const rolePermissions = await this.rbacRepository.getUserEffectivePermissions(userId);
      if (rolePermissions.length) {
        if (!allowedModuleSet.size) {
          return rolePermissions;
        }
        const scopedRolePermissions = rolePermissions.filter((permission) =>
          allowedModuleSet.has(cleanModuleName(permission.moduleSlug || permission.slug?.split(":")[0])),
        );
        if (scopedRolePermissions.length) {
          return scopedRolePermissions;
        }
      }

      const directPermissions =
        await this.rbacRepository.getUserDirectEffectivePermissions(userId);
      if (directPermissions.length) {
        return allowedModuleSet.size
          ? directPermissions.filter((permission) =>
              allowedModuleSet.has(cleanModuleName(permission.moduleSlug || permission.slug?.split(":")[0])),
            )
          : directPermissions;
      }

      if (!allowedModuleSet.size) {
        return [];
      }

      const allPermissions = await this.rbacRepository.listAllActivePermissions();
      return allPermissions
        .map((permission) => {
          const plain = typeof permission.toJSON === "function" ? permission.toJSON() : permission;
          return {
            ...plain,
            moduleSlug: plain.module?.slug || plain.moduleSlug,
            moduleKey: plain.module?.moduleKey || plain.moduleKey,
            moduleName: plain.module?.name || plain.moduleName,
          };
        })
        .filter((permission) =>
          allowedModuleSet.has(cleanModuleName(permission.moduleSlug || permission.slug?.split(":")[0])),
        );
    }

    return this.rbacRepository.getUserEffectivePermissions(userId);
  }

  async getUserEffectivePermissionSummary(userId) {
    const user = await UserModel.findById(userId)
      .select("email role allowedModules ownerAdminId ownerSellerId")
      .lean();
    if (!user) {
      throw new AppError("User not found", 404);
    }

    const permissions = await this.getUserEffectivePermissions(userId);
    const assignedPermissions = permissions.map((permission) => permission.slug).filter(Boolean);
    const assignedModules = Array.from(
      new Set(
        assignedPermissions
          .map((permission) => cleanModuleName(permission.split(":")[0]))
          .filter(Boolean),
      ),
    );
    const permissionsByAction = assignedPermissions.reduce((lookup, permission) => {
      const [moduleSlug, action] = String(permission).split(":");
      const normalizedModule = cleanModuleName(moduleSlug);
      if (!normalizedModule || !action) return lookup;
      if (!lookup[normalizedModule]) lookup[normalizedModule] = {};
      lookup[normalizedModule][action] = true;
      return lookup;
    }, {});
    const actor = {
      userId: String(user._id || user.id),
      role: user.role,
      roles: user.role ? [user.role] : [],
      isSuperAdmin: user.role === ROLES.SUPER_ADMIN,
      ownerAdminId: user.ownerAdminId || null,
      ownerSellerId: user.ownerSellerId || null,
      allowedModules: assignedModules.length
        ? assignedModules
        : (user.allowedModules || []).map(cleanModuleName).filter(Boolean),
      permissions: assignedPermissions,
    };

    if (user.role === ROLES.SELLER && !actor.allowedModules.length) {
      actor.allowedModules = DEFAULT_SELLER_MODULES;
    }

    const sidebarModules = await this.listSidebarModules({}, actor);

    return {
      role: user.role,
      userType: user.role,
      assignedModules,
      assignedPermissions,
      permissionsByAction,
      sidebarModules,
      effectivePermissions: assignedPermissions,
    };
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
