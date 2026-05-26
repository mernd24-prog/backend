const { v4: uuidv4 } = require("uuid");
const { Op } = require("sequelize");
const {
  Module,
  Permission,
  Role,
  RolePermission,
  UserPermission,
  UserRole,
  SuperAdmin,
} = require("../../../infrastructure/sequelize/models");
const { AppError } = require("../../../shared/errors/app-error");
const {
  sequelize,
} = require("../../../infrastructure/sequelize/sequelize-client");

const PERMISSION_ACTIONS = [
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
];
const PERMISSION_ACTION_ORDER = PERMISSION_ACTIONS.reduce(
  (lookup, action, index) => {
    lookup[action] = index;
    return lookup;
  },
  {},
);

class RbacRepository {
  // MODULES
  async createModule(moduleData) {
    const id = uuidv4();
    return Module.create({
      id,
      ...moduleData,
    });
  }

  async getModuleById(id) {
    return Module.findByPk(id, {
      include: [{ association: "permissions", separate: true }],
    });
  }

  async getModuleBySlug(slug) {
    return Module.findOne({
      where: { [Op.or]: [{ slug }, { moduleKey: slug }] },
      include: [{ association: "permissions" }],
    });
  }

  async listModules(filters = {}) {
    const { active = true, includeInactive = false, limit = 100, offset = 0, q, status, sidebar, parentModuleId } = filters;
    const where = includeInactive || active === null ? {} : { active };
    if (status) where.status = status;
    if (sidebar !== undefined) where.isVisibleInSidebar = sidebar;
    if (parentModuleId !== undefined) where.parentModuleId = parentModuleId || null;
    if (q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { slug: { [Op.iLike]: `%${q}%` } },
        { moduleKey: { [Op.iLike]: `%${q}%` } },
      ];
    }

    const { count, rows } = await Module.findAndCountAll({
      where,
      include: [{ association: "permissions" }, { association: "parentModule" }],
      limit,
      offset,
      order: [["order", "ASC"], ["name", "ASC"]],
    });

    return { items: rows, total: count };
  }

  async listSidebarModules(filters = {}) {
    const where = {
      active: true,
      status: "active",
      isVisibleInSidebar: true,
    };
    return Module.findAll({
      where,
      include: [{ association: "parentModule" }],
      order: [["order", "ASC"], ["name", "ASC"]],
    });
  }

  async listPermissionManagementModules(filters = {}) {
    const { roleId, roleSlug, userId, active = true } = filters;
    const moduleWhere = active !== null ? { active } : {};
    const permissionWhere = active !== null ? { active } : {};
    let role = null;
    let assignedPermissionIds = new Set();

    if (userId) {
      const effectivePermissions = await this.getUserEffectivePermissions(userId);
      assignedPermissionIds = new Set(
        (effectivePermissions || []).map((permission) => permission.id).filter(Boolean),
      );
    } else if (roleId || roleSlug) {
      role = await Role.findOne({
        where: roleId ? { id: roleId } : { slug: roleSlug },
        include: [
          {
            association: "rolePermissions",
            include: [{ association: "permission" }],
          },
        ],
      });

      if (!role) {
        throw new AppError("Role not found", 404);
      }

      assignedPermissionIds = new Set(
        (role.rolePermissions || [])
          .map(
            (rolePermission) =>
              rolePermission.permissionId || rolePermission.permission?.id,
          )
          .filter(Boolean),
      );
    }

    const modules = await Module.findAll({
      where: moduleWhere,
      include: [
        {
          association: "permissions",
          where: permissionWhere,
          required: false,
        },
      ],
      order: [["order", "ASC"]],
    });

    const items = modules.map((module) => {
      const plainModule = module.toJSON();
      const permissions = (plainModule.permissions || [])
        .sort((left, right) => {
          const actionCompare =
            (PERMISSION_ACTION_ORDER[left.action] ?? Number.MAX_SAFE_INTEGER) -
            (PERMISSION_ACTION_ORDER[right.action] ?? Number.MAX_SAFE_INTEGER);
          return (
            actionCompare ||
            String(left.name || "").localeCompare(String(right.name || ""))
          );
        })
        .map((permission) => ({
          id: permission.id,
          moduleId: permission.moduleId,
          name: permission.name,
          slug: permission.slug,
          description: permission.description,
          action: permission.action,
          active: permission.active,
          assigned: assignedPermissionIds.has(permission.id),
        }));
      const permissionsByAction = PERMISSION_ACTIONS.reduce((lookup, action) => {
        lookup[action] =
          permissions.find((permission) => permission.action === action) || null;
        return lookup;
      }, {});
      const permissionKeys = PERMISSION_ACTIONS.reduce((lookup, action) => {
        lookup[action] = Boolean(permissionsByAction[action]?.assigned);
        return lookup;
      }, {});

      return {
        id: plainModule.id,
        name: plainModule.name,
        slug: plainModule.slug,
        moduleKey: plainModule.moduleKey,
        moduleName: plainModule.name,
        moduleSlug: plainModule.slug,
        routePath: plainModule.routePath,
        parentModuleId: plainModule.parentModuleId,
        moduleType: plainModule.moduleType,
        status: plainModule.status,
        modulePermissions: plainModule.modulePermissions || [],
        isVisibleInSidebar: plainModule.isVisibleInSidebar,
        description: plainModule.description,
        icon: plainModule.icon,
        order: plainModule.order,
        active: plainModule.active,
        metadata: plainModule.metadata || {},
        permissions,
        permissionsByAction,
        permissionKeys,
        assignedPermissionCount: permissions.filter(
          (permission) => permission.assigned,
        ).length,
      };
    });

    return {
      role: role
        ? {
            id: role.id,
            name: role.name,
            slug: role.slug,
            description: role.description,
            type: role.type,
            isSuperAdmin: role.isSuperAdmin,
            active: role.active,
          }
        : null,
      items,
      total: items.length,
      assignedPermissionIds: Array.from(assignedPermissionIds),
    };
  }

  async updateModule(id, updates) {
    const module = await Module.findByPk(id);
    if (!module) {
      throw new AppError("Module not found", 404);
    }
    return module.update(updates);
  }

  async deleteModule(id) {
    const module = await Module.findByPk(id);
    if (!module) {
      throw new AppError("Module not found", 404);
    }
    return module.destroy();
  }

  // PERMISSIONS
  async createPermission(permissionData) {
    const id = uuidv4();
    return Permission.create({
      id,
      ...permissionData,
    });
  }

  async getPermissionById(id) {
    return Permission.findByPk(id, {
      include: [{ association: "module" }],
    });
  }

  async getPermissionBySlug(slug) {
    return Permission.findOne({
      where: { slug },
      include: [{ association: "module" }],
    });
  }

  async listPermissions(filters = {}) {
    const { moduleId, active = true, limit = 100, offset = 0 } = filters;
    const where = {};

    if (moduleId) where.moduleId = moduleId;
    if (active !== null) where.active = active;

    const { count, rows } = await Permission.findAndCountAll({
      where,
      include: [{ association: "module" }],
      limit,
      offset,
    });

    return { items: rows, total: count };
  }

  async updatePermission(id, updates) {
    const permission = await Permission.findByPk(id);
    if (!permission) {
      throw new AppError("Permission not found", 404);
    }
    return permission.update(updates);
  }

  async deletePermission(id) {
    const permission = await Permission.findByPk(id);
    if (!permission) {
      throw new AppError("Permission not found", 404);
    }
    await RolePermission.destroy({ where: { permissionId: id } });
    await UserPermission.destroy({ where: { permissionId: id } });
    await permission.destroy();
    return { deleted: true };
  }

  // ROLES
  async createRole(roleData) {
    const id = uuidv4();
    return Role.create({
      id,
      ...roleData,
    });
  }

  async getRoleById(id) {
    return Role.findByPk(id, {
      include: [
        {
          association: "rolePermissions",
          include: [{ association: "permission" }],
          separate: true,
        },
      ],
    });
  }

  async getRoleBySlug(slug) {
    return Role.findOne({
      where: { slug },
      include: [
        {
          association: "rolePermissions",
          include: [{ association: "permission" }],
          separate: true,
        },
      ],
    });
  }

  async listRoles(filters = {}) {
    const { active = true, limit = 100, offset = 0 } = filters;
    const where = active !== null ? { active } : {};

    const { count, rows } = await Role.findAndCountAll({
      where,
      include: [
        {
          association: "rolePermissions",
          include: [{ association: "permission" }],
        },
      ],
      limit,
      offset,
    });

    return { items: rows, total: count };
  }

  async updateRole(id, updates) {
    const role = await Role.findByPk(id);
    if (!role) {
      throw new AppError("Role not found", 404);
    }
    return role.update(updates);
  }

  async deleteRole(id) {
    const role = await Role.findByPk(id);
    if (!role) {
      throw new AppError("Role not found", 404);
    }
    await RolePermission.destroy({ where: { roleId: id } });
    await UserRole.destroy({ where: { roleId: id } });
    await role.destroy();
    return { deleted: true };
  }

  // ROLE PERMISSIONS
  async assignPermissionToRole(roleId, permissionId) {
    const role = await Role.findByPk(roleId);
    if (!role) throw new AppError("Role not found", 404);

    const permission = await Permission.findByPk(permissionId);
    if (!permission) throw new AppError("Permission not found", 404);

    const existing = await RolePermission.findOne({
      where: { roleId, permissionId },
    });

    if (existing) {
      throw new AppError("Permission already assigned to role", 409);
    }

    return RolePermission.create({
      id: uuidv4(),
      roleId,
      permissionId,
    });
  }

  async removePermissionFromRole(roleId, permissionId) {
    const result = await RolePermission.destroy({
      where: { roleId, permissionId },
    });

    if (result === 0) {
      throw new AppError("Role-Permission association not found", 404);
    }

    return { deleted: true };
  }

  async syncRolePermissions(roleId, permissionIds = []) {
    const role = await Role.findByPk(roleId);
    if (!role) throw new AppError("Role not found", 404);

    return sequelize.transaction(async (transaction) => {
      if (permissionIds.length > 0) {
        await RolePermission.destroy({
          where: { roleId, permissionId: { [Op.notIn]: permissionIds } },
          transaction,
        });
        const existing = await RolePermission.findAll({
          where: { roleId },
          attributes: ["permissionId"],
          transaction,
        });
        const existingSet = new Set(existing.map((rp) => rp.permissionId));
        const toAdd = permissionIds.filter((id) => !existingSet.has(id));
        if (toAdd.length) {
          await RolePermission.bulkCreate(
            toAdd.map((permissionId) => ({ id: uuidv4(), roleId, permissionId })),
            { transaction, ignoreDuplicates: true },
          );
        }
      } else {
        await RolePermission.destroy({ where: { roleId }, transaction });
      }
      return { synced: true, permissionCount: permissionIds.length };
    });
  }

  async getRolePermissions(roleId) {
    const role = await Role.findByPk(roleId);
    if (!role) throw new AppError("Role not found", 404);

    return RolePermission.findAll({
      where: { roleId },
      include: [
        { association: "permission", include: [{ association: "module" }] },
      ],
    });
  }

  // USER PERMISSIONS
  async assignPermissionToUser(userId, permissionId, grantedBy) {
    const permission = await Permission.findByPk(permissionId);
    if (!permission) throw new AppError("Permission not found", 404);

    const existing = await UserPermission.findOne({
      where: { userId, permissionId, revokedAt: null },
    });

    if (existing) {
      throw new AppError("Permission already assigned to user", 409);
    }

    return UserPermission.create({
      id: uuidv4(),
      userId,
      permissionId,
      grantedBy,
      grantedAt: new Date(),
    });
  }

  async removePermissionFromUser(userId, permissionId) {
    const userPermission = await UserPermission.findOne({
      where: { userId, permissionId, revokedAt: null },
    });

    if (!userPermission) {
      throw new AppError("User-Permission association not found", 404);
    }

    return userPermission.update({ revokedAt: new Date() });
  }

  async getUserPermissions(userId) {
    return UserPermission.findAll({
      where: { userId, revokedAt: null },
      include: [
        { association: "permission", include: [{ association: "module" }] },
      ],
    });
  }

  async syncUserModulePermissions(userId, modulePermissions = [], grantedBy) {
    const moduleSlugs = Array.from(
      new Set(
        modulePermissions
          .map((item) => String(item.module || item.slug || "").trim())
          .map((item) => item.toLowerCase())
          .filter(Boolean),
      ),
    );

    if (!moduleSlugs.length) {
      return { permissionIds: [], assigned: 0, revoked: 0 };
    }

    return sequelize.transaction(async (transaction) => {
      const modules = await Module.findAll({
        where: {
          slug: { [Op.in]: moduleSlugs },
          ...(moduleSlugs.length ? { active: true } : {}),
        },
        transaction,
      });
      const moduleIds = modules.map((module) => module.id);
      const moduleById = new Map(
        modules.map((module) => [String(module.id), module.slug]),
      );
      const desiredActionsByModule = new Map(
        modulePermissions.map((item) => [
          String(item.module || item.slug || "").trim().toLowerCase(),
          new Set((item.actions || []).map(String)),
        ]),
      );
      const desiredActions = Array.from(
        new Set(
          modulePermissions.flatMap((item) =>
            (item.actions || []).map(String),
          ),
        ),
      );

      const desiredPermissions = desiredActions.length
        ? await Permission.findAll({
            where: {
              moduleId: { [Op.in]: moduleIds },
              action: { [Op.in]: desiredActions },
              active: true,
            },
            transaction,
          })
        : [];

      const desiredPermissionIds = new Set(
        desiredPermissions
          .filter((permission) => {
            const moduleSlug = moduleById.get(String(permission.moduleId));
            return desiredActionsByModule
              .get(moduleSlug)
              ?.has(permission.action);
          })
          .map((permission) => permission.id),
      );

      const currentAssignments = await UserPermission.findAll({
        where: { userId, revokedAt: null },
        include: [
          {
            association: "permission",
            required: true,
          },
        ],
        transaction,
      });

      let revoked = 0;
      const currentPermissionIds = new Set();
      for (const assignment of currentAssignments) {
        currentPermissionIds.add(assignment.permissionId);
        if (!desiredPermissionIds.has(assignment.permissionId)) {
          await assignment.update({ revokedAt: new Date() }, { transaction });
          revoked += 1;
        }
      }

      let assigned = 0;
      for (const permissionId of desiredPermissionIds) {
        if (currentPermissionIds.has(permissionId)) {
          continue;
        }

        await UserPermission.create(
          {
            id: uuidv4(),
            userId,
            permissionId,
            grantedBy,
            grantedAt: new Date(),
          },
          { transaction },
        );
        assigned += 1;
      }

      return {
        permissionIds: Array.from(desiredPermissionIds),
        assigned,
        revoked,
      };
    });
  }

  // USER ROLES
  async assignRoleToUser(userId, roleId, assignedBy) {
    const role = await Role.findByPk(roleId);
    if (!role) throw new AppError("Role not found", 404);

    const existing = await UserRole.findOne({
      where: { userId, roleId, revokedAt: null },
    });

    if (existing) {
      throw new AppError("Role already assigned to user", 409);
    }

    return UserRole.create({
      id: uuidv4(),
      userId,
      roleId,
      assignedBy,
      assignedAt: new Date(),
    });
  }

  async removeRoleFromUser(userId, roleId) {
    const userRole = await UserRole.findOne({
      where: { userId, roleId, revokedAt: null },
    });

    if (!userRole) {
      throw new AppError("User-Role association not found", 404);
    }

    return userRole.update({ revokedAt: new Date() });
  }

  async getUserRoles(userId) {
    return UserRole.findAll({
      where: { userId, revokedAt: null },
      include: [
        {
          association: "role",
          include: [
            {
              association: "rolePermissions",
              include: [{ association: "permission" }],
            },
          ],
        },
      ],
    });
  }

  async getUserIdsForRole(roleId) {
    const rows = await UserRole.findAll({
      where: { roleId, revokedAt: null },
      attributes: ["userId"],
      raw: true,
    });
    return rows.map((row) => row.userId).filter(Boolean);
  }

  async getUserEffectivePermissions(userId) {
    const query = `
      SELECT DISTINCT
        p.*,
        m.slug AS "moduleSlug",
        m.module_key AS "moduleKey",
        m.name AS "moduleName"
      FROM permissions p
      INNER JOIN modules m ON m.id = p.module_id
      LEFT JOIN role_permissions rp ON p.id = rp.permission_id
      LEFT JOIN user_roles ur ON rp.role_id = ur.role_id
      LEFT JOIN user_permissions up ON p.id = up.permission_id
      WHERE (
        (ur.user_id = :userId AND ur.revoked_at IS NULL)
        OR (up.user_id = :userId AND up.revoked_at IS NULL)
      )
      AND p.active = true
      ORDER BY p.id
    `;

    return sequelize.query(query, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT,
      raw: true,
    });
  }

  async getUserDirectEffectivePermissions(userId) {
    const query = `
      SELECT DISTINCT
        p.*,
        m.slug AS "moduleSlug",
        m.module_key AS "moduleKey",
        m.name AS "moduleName"
      FROM permissions p
      INNER JOIN modules m ON m.id = p.module_id
      INNER JOIN user_permissions up ON p.id = up.permission_id
      WHERE up.user_id = :userId
        AND up.revoked_at IS NULL
        AND p.active = true
      ORDER BY p.id
    `;

    return sequelize.query(query, {
      replacements: { userId },
      type: sequelize.QueryTypes.SELECT,
      raw: true,
    });
  }

  async listAllActivePermissions() {
    return Permission.findAll({
      where: { active: true },
      include: [{ association: "module" }],
      order: [["slug", "ASC"]],
    });
  }

  // SUPER ADMIN
  async createSuperAdmin(superAdminData) {
    const id = uuidv4();
    return SuperAdmin.create({
      id,
      ...superAdminData,
    });
  }

  async getSuperAdminByUserId(userId) {
    return SuperAdmin.findOne({
      where: { userId },
    });
  }

  async getSuperAdminByEmail(email) {
    return SuperAdmin.findOne({
      where: { email },
    });
  }

  async listSuperAdmins(filters = {}) {
    const { isActive = true, limit = 100, offset = 0 } = filters;
    const where = isActive !== null ? { isActive } : {};

    const { count, rows } = await SuperAdmin.findAndCountAll({
      where,
      limit,
      offset,
    });

    return { items: rows, total: count };
  }

  async updateSuperAdmin(userId, updates) {
    const superAdmin = await SuperAdmin.findOne({
      where: { userId },
    });

    if (!superAdmin) {
      throw new AppError("Super admin not found", 404);
    }

    return superAdmin.update(updates);
  }

  async superAdminExists() {
    const count = await SuperAdmin.count();
    return count > 0;
  }
}

module.exports = { RbacRepository };
