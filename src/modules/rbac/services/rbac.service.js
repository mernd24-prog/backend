const { v4: uuidv4 } = require("uuid");
const { RbacRepository } = require("../repositories/rbac.repository");
const { AppError } = require("../../../shared/errors/app-error");
const { ROLES } = require("../../../shared/constants/roles");
const { UserModel } = require("../../user/models/user.model");
const { cleanModuleName } = require("../../../shared/auth/module-access");
const {
  PERMISSION_ACTIONS,
  SIDEBAR_PERMISSION_ACTIONS,
  modulePermissionAssignmentsWithImplicitView,
  normalizePermissionAction,
  permissionSlug,
} = require("../../../shared/auth/rbac-permissions");
const {
  SESSION_INVALIDATION_REASONS,
  makeSessionInvalidationUpdate,
} = require("../../../shared/auth/session-state");
const { RbacAuditLog, PermissionTemplate } = require("../../../infrastructure/sequelize/models");

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
    const viewModules = Array.isArray(actor.permissions)
      ? actor.permissions
          .map((permission) => String(permission || "").toLowerCase().split(":"))
          .filter((parts) => parts[1] === "view")
          .map((parts) => cleanModuleName(parts[0]))
          .filter(Boolean)
      : [];
    const viewModuleScope = new Set(viewModules);

    if (!isSuperAdmin && !viewModuleScope.size) {
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
      return candidates.some((candidate) => viewModuleScope.has(candidate));
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
      const [effectivePermissions, deniedPermissions] = await Promise.all([
        this.getUserEffectivePermissions(filters.userId),
        this.rbacRepository.getUserDeniedPermissions(filters.userId),
      ]);
      const assignedPermissionIds = new Set(
        (effectivePermissions || []).map((permission) => permission.id).filter(Boolean),
      );
      const deniedPermissionIds = new Set(
        (deniedPermissions || []).map((permission) => permission.id).filter(Boolean),
      );
      matrix.items = matrix.items.map((module) => {
        const permissions = (module.permissions || []).map((permission) => ({
          ...permission,
          denied: deniedPermissionIds.has(permission.id),
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
      matrix.deniedPermissionIds = Array.from(deniedPermissionIds);
    }
    if (filters.scope === "sidebar") {
      const assignedSlugs = new Set(
        matrix.items.flatMap((module) =>
          (module.permissions || [])
            .filter((permission) => permission.assigned)
            .map((permission) => permission.slug),
        ),
      );
      matrix.items = matrix.items
        .filter((module) =>
          module.isVisibleInSidebar !== false &&
          module.routePath &&
          module.metadata?.source === "sidebar-seed",
        )
        .map((module) => this.applySidebarPermissionAssignments(module, assignedSlugs));
      matrix.total = matrix.items.length;
    }
    const permissionCount = matrix.items.reduce(
      (total, module) => total + module.permissions.length,
      0,
    );
    const assignedPermissionCount = matrix.items.reduce(
      (total, module) => total + module.assignedPermissionCount,
      0,
    );

    const actions = filters.scope === "sidebar"
      ? SIDEBAR_PERMISSION_ACTIONS
      : PERMISSION_ACTIONS;

    return {
      role: matrix.role,
      modules: matrix.items,
      totals: {
        modules: matrix.total,
        permissions: permissionCount,
        assignedPermissions: assignedPermissionCount,
      },
      actions,
      assignedPermissionIds: matrix.assignedPermissionIds,
      deniedPermissionIds: matrix.deniedPermissionIds || [],
    };
  }

  applySidebarPermissionAssignments(module = {}, assignedSlugs = new Set()) {
    const requiredModule = cleanModuleName(module.metadata?.requiredModule);
    const permissions = (module.permissions || [])
      .filter((permission) => SIDEBAR_PERMISSION_ACTIONS.includes(permission.action))
      .map((permission) => {
        const equivalentBackendSlug = requiredModule
          ? `${requiredModule}:${permission.action}`
          : "";
        return {
          ...permission,
          assigned: Boolean(permission.assigned || assignedSlugs.has(equivalentBackendSlug)),
        };
      });
    const permissionsByAction = SIDEBAR_PERMISSION_ACTIONS.reduce(
      (lookup, action) => {
        lookup[action] = permissions.find((permission) => permission.action === action) || null;
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
  }

  async expandSidebarPermissionIds(permissionIds = [], options = {}) {
    const includeImplicitView = options.includeImplicitView !== false;
    const ids = Array.from(new Set((permissionIds || []).filter(Boolean)));
    if (!ids.length) return [];

    const permissions = await this.rbacRepository.getPermissionsByIds(ids);
    const impliedSlugs = new Set();

    permissions.forEach((permission) => {
      const plain = typeof permission.toJSON === "function" ? permission.toJSON() : permission;
      const module = plain.module || {};
      const moduleKey = cleanModuleName(module.moduleKey || module.slug);
      const moduleSlug = cleanModuleName(module.slug || module.moduleKey);
      const action = plain.action;
      if (!action) return;

      const requiredModule = cleanModuleName(module.metadata?.requiredModule);
      const isSidebarModule =
        module.metadata?.source === "sidebar-seed" ||
        moduleKey.startsWith("sidebar-");
      const targetModule = isSidebarModule && requiredModule
        ? requiredModule
        : moduleSlug;

      if (!targetModule) return;
      impliedSlugs.add(permissionSlug(targetModule, action));
      if (includeImplicitView && action !== "view") {
        impliedSlugs.add(permissionSlug(targetModule, "view"));
      }
    });

    const impliedPermissionIds =
      await this.rbacRepository.getPermissionIdsBySlugs(Array.from(impliedSlugs));
    return Array.from(new Set([...ids, ...impliedPermissionIds]));
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
    return this.bulkAssignPermissionsToRole(roleId, [permissionId]);
  }

  async removePermissionFromRole(roleId, permissionId) {
    const result = await this.rbacRepository.removePermissionFromRole(roleId, permissionId);
    await this.invalidateUsersForRole(roleId);
    return result;
  }

  async syncRolePermissions(roleId, permissionIds = []) {
    const expandedPermissionIds = await this.expandSidebarPermissionIds(permissionIds);
    const result = await this.rbacRepository.syncRolePermissions(roleId, expandedPermissionIds);
    await this.invalidateUsersForRole(roleId);
    return result;
  }

  async bulkAssignPermissionsToRole(roleId, permissionIds) {
    const expandedPermissionIds = await this.expandSidebarPermissionIds(permissionIds);
    const results = [];
    const errors = [];

    for (const permissionId of expandedPermissionIds) {
      try {
        const result = await this.rbacRepository.assignPermissionToRole(
          roleId,
          permissionId,
        );
        results.push(result);
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 409) {
          continue;
        }
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
    return this.bulkAssignPermissionsToUser(userId, [permissionId], grantedBy, actor);
  }

  async removePermissionFromUser(userId, permissionId, actor = {}) {
    await this.assertCanAssignUserPermissions(actor, userId, []);
    const result = await this.rbacRepository.removePermissionFromUser(userId, permissionId);
    await this.invalidateUserAuthSession(userId);
    return result;
  }

  async bulkAssignPermissionsToUser(userId, permissionIds, grantedBy, actor = {}) {
    const expandedPermissionIds = await this.expandSidebarPermissionIds(permissionIds);
    await this.assertCanAssignUserPermissions(actor, userId, expandedPermissionIds);
    const results = [];
    const errors = [];

    for (const permissionId of expandedPermissionIds) {
      try {
        const result = await this.rbacRepository.assignPermissionToUser(
          userId,
          permissionId,
          grantedBy,
        );
        results.push(result);
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 409) {
          continue;
        }
        errors.push({ permissionId, error: error.message });
      }
    }

    if (results.length) {
      await this.invalidateUserAuthSession(userId);
    }

    return { assigned: results, errors };
  }

  async syncUserPermissions(
    userId,
    permissionIds = [],
    deniedPermissionIds = [],
    grantedBy,
    actor = {},
  ) {
    const expandedPermissionIds = await this.expandSidebarPermissionIds(permissionIds);
    const expandedDeniedPermissionIds = await this.expandSidebarPermissionIds(
      deniedPermissionIds,
      { includeImplicitView: false },
    );
    await this.assertCanAssignUserPermissions(
      actor,
      userId,
      Array.from(new Set([...expandedPermissionIds, ...expandedDeniedPermissionIds])),
    );
    const result = await this.rbacRepository.syncUserPermissions(
      userId,
      expandedPermissionIds,
      expandedDeniedPermissionIds,
      grantedBy,
    );
    await this.invalidateUserAuthSession(userId);
    return result;
  }

  async getUserPermissions(userId) {
    return this.rbacRepository.getUserPermissions(userId);
  }

  async syncUserModulePermissions(userId, modulePermissions, grantedBy, actor = {}) {
    const normalizedModulePermissions = modulePermissionAssignmentsWithImplicitView(
      modulePermissions,
      cleanModuleName,
    );
    const result = await this.rbacRepository.syncUserModulePermissions(
      userId,
      normalizedModulePermissions,
      grantedBy,
    );
    await this.invalidateUserAuthSession(userId);
    if (actor.userId) {
      const user = await UserModel.findById(userId).select("role").lean().catch(() => null);
      this.writeAuditLog({
        actorId: actor.userId,
        actorRole: actor.role,
        targetUserId: userId,
        targetRole: user?.role,
        action: "grant",
        newValue: { modules: normalizedModulePermissions.map((m) => m.module || m) },
        ipAddress: actor.ipAddress,
        requestId: actor.requestId,
      });
    }
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
    if (actor.userId) {
      const role = await this.rbacRepository.getRoleById(roleId).catch(() => null);
      this.writeAuditLog({
        actorId: actor.userId,
        actorRole: actor.role,
        targetUserId: userId,
        action: "role_assign",
        newValue: { roleId, roleSlug: role?.slug },
        ipAddress: actor.ipAddress,
        requestId: actor.requestId,
      });
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
    if (actor.userId) {
      const role = await this.rbacRepository.getRoleById(roleId).catch(() => null);
      this.writeAuditLog({
        actorId: actor.userId,
        actorRole: actor.role,
        targetUserId: userId,
        action: "role_remove",
        oldValue: { roleId, roleSlug: role?.slug },
        ipAddress: actor.ipAddress,
        requestId: actor.requestId,
      });
    }
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

  scopedRoleUsesAssignedModules(role) {
    return [
      ROLES.ADMIN,
      ROLES.SUB_ADMIN,
      ROLES.SELLER_ADMIN,
      ROLES.SELLER_SUB_ADMIN,
    ].includes(role);
  }

  normalizePermissionRow(permission = {}) {
    const plain = typeof permission.toJSON === "function" ? permission.toJSON() : permission;
    const moduleSlug = plain.module?.slug || plain.moduleSlug || plain.slug?.split(":")[0];
    const action = normalizePermissionAction(plain.action || plain.slug?.split(":")[1]);
    const normalizedSlug = permissionSlug(moduleSlug, action);
    return {
      ...plain,
      action,
      slug: normalizedSlug || plain.slug,
      moduleSlug,
      moduleKey: plain.module?.moduleKey || plain.moduleKey,
      moduleName: plain.module?.name || plain.moduleName,
    };
  }

  scopePermissionsForUser(user = {}, permissions = []) {
    if (!user || !this.scopedRoleUsesAssignedModules(user.role)) {
      return permissions;
    }

    const allowedModuleSet = new Set(
      (user.allowedModules || []).map(cleanModuleName).filter(Boolean),
    );
    if (!allowedModuleSet.size) {
      return permissions;
    }

    return permissions.filter((permission) =>
      allowedModuleSet.has(
        cleanModuleName(permission.moduleSlug || permission.slug?.split(":")[0]),
      ),
    );
  }

  async addImplicitViewPermissions(permissions = [], deniedPermissions = []) {
    const byId = new Map();
    const normalizedDeniedPermissions =
      deniedPermissions.map((permission) => this.normalizePermissionRow(permission));
    const deniedIds = new Set(normalizedDeniedPermissions.map((permission) => permission.id).filter(Boolean));
    const deniedSlugs = new Set(normalizedDeniedPermissions.map((permission) => permission.slug).filter(Boolean));
    const missingViewSlugs = new Set();

    permissions.map((permission) => this.normalizePermissionRow(permission)).forEach((permission) => {
      if (!permission.id || deniedIds.has(permission.id) || deniedSlugs.has(permission.slug)) {
        return;
      }
      byId.set(permission.id, permission);
      if (permission.action !== "view") {
        const moduleName = cleanModuleName(permission.moduleSlug || permission.slug?.split(":")[0]);
        const viewSlug = permissionSlug(moduleName, "view");
        if (viewSlug && !deniedSlugs.has(viewSlug)) {
          missingViewSlugs.add(viewSlug);
        }
      }
    });

    if (missingViewSlugs.size) {
      const viewPermissions =
        await this.rbacRepository.getPermissionsBySlugs(Array.from(missingViewSlugs));
      viewPermissions.map((permission) => this.normalizePermissionRow(permission)).forEach((permission) => {
        if (!deniedIds.has(permission.id) && !deniedSlugs.has(permission.slug)) {
          byId.set(permission.id, permission);
        }
      });
    }

    return Array.from(byId.values());
  }

  // GET EFFECTIVE PERMISSIONS
  async getUserEffectivePermissions(userId) {
    const user = await UserModel.findById(userId)
      .select("role allowedModules")
      .lean()
      .catch(() => null);

    if (user?.role === ROLES.SUPER_ADMIN) {
      const permissions = await this.rbacRepository.listAllActivePermissions();
      return Array.from(
        new Map(
          permissions
            .map((permission) => this.normalizePermissionRow(permission))
            .filter((permission) => permission.slug)
            .map((permission) => [permission.slug, permission]),
        ).values(),
      );
    }

    const [
      deniedPermissions,
      rolePermissionRows,
      directPermissionRows,
    ] = await Promise.all([
      this.rbacRepository.getUserDeniedPermissions(userId),
      this.rbacRepository.getUserRoleEffectivePermissions(userId),
      this.rbacRepository.getUserDirectEffectivePermissions(userId),
    ]);
    const normalizedDeniedPermissions =
      deniedPermissions.map((permission) => this.normalizePermissionRow(permission));
    const deniedIds = new Set(normalizedDeniedPermissions.map((permission) => permission.id).filter(Boolean));
    const deniedSlugs = new Set(normalizedDeniedPermissions.map((permission) => permission.slug).filter(Boolean));
    const rolePermissions = this.scopePermissionsForUser(
      user,
      rolePermissionRows.map((permission) => this.normalizePermissionRow(permission)),
    );
    const directPermissions =
      directPermissionRows.map((permission) => this.normalizePermissionRow(permission));
    const byId = new Map();

    [...rolePermissions, ...directPermissions].forEach((permission) => {
      if (!permission.id || deniedIds.has(permission.id) || deniedSlugs.has(permission.slug)) {
        return;
      }
      byId.set(permission.id, permission);
    });

    const withImplicitView = await this.addImplicitViewPermissions(Array.from(byId.values()), deniedPermissions);
    return Array.from(
      new Map(
        withImplicitView
          .map((permission) => this.normalizePermissionRow(permission))
          .filter((permission) => permission.slug)
          .map((permission) => [permission.slug, permission]),
      ).values(),
    );
  }

  async getUserEffectivePermissionSummary(userId) {
    const user = await UserModel.findById(userId)
      .select("email role allowedModules ownerAdminId ownerSellerId")
      .lean();
    if (!user) {
      throw new AppError("User not found", 404);
    }

    const [
      permissions,
      rolePermissionRows,
      directPermissionRows,
      deniedPermissionRows,
    ] = await Promise.all([
      this.getUserEffectivePermissions(userId),
      this.rbacRepository.getUserRoleEffectivePermissions(userId),
      this.rbacRepository.getUserDirectEffectivePermissions(userId),
      this.rbacRepository.getUserDeniedPermissions(userId),
    ]);
    const toUniquePermissionSlugs = (rows = []) =>
      Array.from(
        new Set(
          rows
            .map((permission) => this.normalizePermissionRow(permission))
            .map((permission) => permission.slug)
            .filter(Boolean),
        ),
      );
    const deniedPermissions = toUniquePermissionSlugs(deniedPermissionRows);
    const rolePermissions = this.scopePermissionsForUser(
      user,
      rolePermissionRows.map((permission) => this.normalizePermissionRow(permission)),
    );
    const rolePermissionSlugs = Array.from(
      new Set(rolePermissions.map((permission) => permission.slug).filter(Boolean)),
    );
    const extraUserPermissions = toUniquePermissionSlugs(directPermissionRows);
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
      allowedModules: assignedModules,
      permissions: assignedPermissions,
    };

    const sidebarModules = await this.listSidebarModules({}, actor);

    return {
      role: user.role,
      userType: user.role,
      assignedModules,
      assignedPermissions,
      rolePermissions: rolePermissionSlugs,
      extraUserPermissions,
      deniedPermissions,
      permissionBreakdown: {
        rolePermissions: rolePermissionSlugs,
        extraUserPermissions,
        deniedPermissions,
        effectivePermissions: assignedPermissions,
      },
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

  // AUDIT LOGGING
  writeAuditLog(entry = {}) {
    if (!entry.actorId || !entry.targetUserId || !entry.action) return;
    const record = {
      id: uuidv4(),
      actorId: String(entry.actorId),
      actorRole: entry.actorRole || null,
      targetUserId: String(entry.targetUserId),
      targetRole: entry.targetRole || null,
      action: entry.action,
      moduleSlug: entry.moduleSlug || null,
      permissionSlug: entry.permissionSlug || null,
      oldValue: entry.oldValue || null,
      newValue: entry.newValue || null,
      ipAddress: entry.ipAddress || null,
      userAgent: entry.userAgent || null,
      requestId: entry.requestId || null,
    };
    RbacAuditLog.create(record).catch(() => {});
  }

  async listAuditLogs(filters = {}) {
    const { Op } = require("sequelize");
    const {
      actorId, targetUserId, action, moduleSlug,
      from, to, page = 1, limit = 50,
    } = filters;

    const where = {};
    if (actorId) where.actorId = actorId;
    if (targetUserId) where.targetUserId = targetUserId;
    if (action) where.action = action;
    if (moduleSlug) where.moduleSlug = moduleSlug;
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to) where.created_at[Op.lte] = new Date(to);
    }

    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await RbacAuditLog.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit: Number(limit),
      offset,
    });

    return { items: rows, total: count, page: Number(page), limit: Number(limit) };
  }

  // FORCE LOGOUT
  async forceLogoutUser(userId, actor = {}) {
    if (!userId) throw new AppError("User ID required", 400);
    if (!actor.isSuperAdmin && actor.role !== ROLES.SUPER_ADMIN) {
      await this.assertCanAssignUserPermissions(actor, userId, []);
    }
    const user = await UserModel.findById(userId).select("role email").lean();
    if (!user) throw new AppError("User not found", 404);

    const updated = await this.invalidateUserAuthSession(userId, SESSION_INVALIDATION_REASONS.FORCE_LOGOUT);
    this.writeAuditLog({
      actorId: actor.userId,
      actorRole: actor.role,
      targetUserId: userId,
      targetRole: user.role,
      action: "force_logout",
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
    });
    return { success: true, newSessionVersion: updated?.sessionVersion ?? null };
  }

  // COPY PERMISSIONS
  async copyUserPermissions(targetUserId, sourceUserId, actor = {}, options = {}) {
    const { copyModules = true, copyPermissions = true, mergeMode = "replace" } = options;
    if (!targetUserId || !sourceUserId) throw new AppError("Both targetUserId and sourceUserId required", 400);
    if (String(targetUserId) === String(sourceUserId)) throw new AppError("Source and target cannot be the same user", 400);

    const [source, target] = await Promise.all([
      UserModel.findById(sourceUserId).select("role allowedModules").lean(),
      UserModel.findById(targetUserId).select("role allowedModules").lean(),
    ]);
    if (!source) throw new AppError("Source user not found", 404);
    if (!target) throw new AppError("Target user not found", 404);

    const grantedBy = actor.userId;
    let expandedIds = [];

    if (copyPermissions) {
      const sourcePerms = await this.rbacRepository.getUserDirectEffectivePermissions(sourceUserId);
      const permissionIds = sourcePerms.map((p) => p.id).filter(Boolean);
      if (permissionIds.length) {
        expandedIds = await this.expandSidebarPermissionIds(permissionIds);
      }
    }

    // Validate hierarchy + that actor has all permissions being copied
    if (!actor.isSuperAdmin && actor.role !== ROLES.SUPER_ADMIN) {
      await this.assertCanAssignUserPermissions(actor, targetUserId, expandedIds);
    }

    if (copyModules && source.allowedModules?.length) {
      let srcModules = source.allowedModules;
      // Constrain copied modules to what actor is allowed to assign
      if (!actor.isSuperAdmin && actor.role !== ROLES.SUPER_ADMIN) {
        const actorModuleScope = new Set((actor.allowedModules || []).map(cleanModuleName));
        srcModules = srcModules.filter((m) => actorModuleScope.has(cleanModuleName(m)));
      }
      if (srcModules.length) {
        const newModules = mergeMode === "merge"
          ? Array.from(new Set([...(target.allowedModules || []), ...srcModules]))
          : srcModules;
        await UserModel.findByIdAndUpdate(targetUserId, { allowedModules: newModules });
      }
    }

    if (copyPermissions && expandedIds.length) {
      if (mergeMode === "replace") {
        await this.rbacRepository.syncUserPermissions(targetUserId, expandedIds, [], grantedBy);
      } else {
        for (const pid of expandedIds) {
          await this.rbacRepository.assignPermissionToUser(targetUserId, pid, grantedBy).catch(() => {});
        }
      }
    }

    await this.invalidateUserAuthSession(targetUserId);
    this.writeAuditLog({
      actorId: actor.userId,
      actorRole: actor.role,
      targetUserId,
      targetRole: target.role,
      action: "copy_permissions",
      newValue: { sourceUserId, mergeMode, copyModules, copyPermissions },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });
    return { success: true };
  }

  // PERMISSION TEMPLATES
  async listPermissionTemplates(filters = {}) {
    const where = {};
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.roleScope) where.roleScope = { [require("sequelize").Op.contains]: [filters.roleScope] };
    const rows = await PermissionTemplate.findAll({ where, order: [["name", "ASC"]] });
    return rows;
  }

  async getPermissionTemplate(idOrSlug) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const where = isUuid
      ? { [require("sequelize").Op.or]: [{ id: idOrSlug }, { slug: idOrSlug }] }
      : { slug: idOrSlug };
    const template = await PermissionTemplate.findOne({ where });
    if (!template) throw new AppError("Template not found", 404);
    return template;
  }

  async createPermissionTemplate(data) {
    const existing = await PermissionTemplate.findOne({ where: { slug: data.slug } });
    if (existing) throw new AppError("Template with this slug already exists", 409);
    return PermissionTemplate.create({ id: uuidv4(), ...data });
  }

  async updatePermissionTemplate(idOrSlug, updates) {
    const template = await this.getPermissionTemplate(idOrSlug);
    await template.update(updates);
    return template;
  }

  async applyPermissionTemplate(userId, templateSlug, actor = {}, mergeMode = "replace") {
    const template = await this.getPermissionTemplate(templateSlug);
    if (!template.isActive) throw new AppError("Template is inactive", 400);

    const user = await UserModel.findById(userId).select("role").lean();
    if (!user) throw new AppError("User not found", 404);

    if (template.roleScope?.length && !template.roleScope.includes(user.role)) {
      throw new AppError(`Template '${templateSlug}' is not applicable to role '${user.role}'`, 400);
    }

    const slugs = template.permissionSlugs || [];
    const permissionIds = await this.rbacRepository.getPermissionIdsBySlugs(slugs);
    const expandedIds = await this.expandSidebarPermissionIds(permissionIds);

    // Validate hierarchy + that actor has every permission in the template
    if (!actor.isSuperAdmin && actor.role !== ROLES.SUPER_ADMIN) {
      await this.assertCanAssignUserPermissions(actor, userId, expandedIds);
    }

    if (mergeMode === "replace") {
      await this.rbacRepository.syncUserPermissions(userId, expandedIds, [], actor.userId);
    } else {
      for (const pid of expandedIds) {
        await this.rbacRepository.assignPermissionToUser(userId, pid, actor.userId).catch(() => {});
      }
    }

    await this.invalidateUserAuthSession(userId);
    this.writeAuditLog({
      actorId: actor.userId,
      actorRole: actor.role,
      targetUserId: userId,
      targetRole: user.role,
      action: "template_apply",
      newValue: { templateSlug, mergeMode, permissionCount: expandedIds.length },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });
    return { success: true, applied: expandedIds.length };
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
