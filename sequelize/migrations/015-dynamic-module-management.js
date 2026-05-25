module.exports = {
  id: "015-dynamic-module-management",
  async up({ queryInterface, Sequelize, transaction }) {
    const table = await queryInterface.describeTable("modules");

    const addColumn = async (name, definition) => {
      if (!table[name]) {
        await queryInterface.addColumn("modules", name, definition, { transaction });
      }
    };

    await addColumn("module_key", {
      type: Sequelize.STRING(128),
      allowNull: true,
      unique: true,
    });
    await addColumn("route_path", {
      type: Sequelize.STRING(256),
      allowNull: true,
    });
    await addColumn("parent_module_id", {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: "modules", key: "id" },
      onDelete: "SET NULL",
    });
    await addColumn("module_type", {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: "module",
    });
    await addColumn("status", {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: "active",
    });
    await addColumn("module_permissions", {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
    await addColumn("is_visible_in_sidebar", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    await queryInterface.sequelize.query(
      `UPDATE modules
       SET module_key = COALESCE(module_key, slug),
           status = CASE WHEN active = true THEN 'active' ELSE 'inactive' END,
           module_type = COALESCE(module_type, 'module'),
           is_visible_in_sidebar = COALESCE(is_visible_in_sidebar, true)
       WHERE module_key IS NULL OR status IS NULL`,
      { transaction },
    );

    await queryInterface.addIndex("modules", ["module_key"], {
      name: "modules_module_key_unique",
      unique: true,
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("modules", ["parent_module_id", "is_visible_in_sidebar"], {
      name: "modules_parent_sidebar_idx",
      transaction,
    }).catch(() => {});
    await queryInterface.addIndex("modules", ["status", "is_visible_in_sidebar"], {
      name: "modules_status_sidebar_idx",
      transaction,
    }).catch(() => {});
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.removeColumn("modules", "is_visible_in_sidebar", { transaction }).catch(() => {});
    await queryInterface.removeColumn("modules", "module_permissions", { transaction }).catch(() => {});
    await queryInterface.removeColumn("modules", "status", { transaction }).catch(() => {});
    await queryInterface.removeColumn("modules", "module_type", { transaction }).catch(() => {});
    await queryInterface.removeColumn("modules", "parent_module_id", { transaction }).catch(() => {});
    await queryInterface.removeColumn("modules", "route_path", { transaction }).catch(() => {});
    await queryInterface.removeColumn("modules", "module_key", { transaction }).catch(() => {});
  },
};
