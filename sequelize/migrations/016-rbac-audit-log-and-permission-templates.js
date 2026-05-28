module.exports = {
  id: "016-rbac-audit-log-and-permission-templates",

  async up({ queryInterface, Sequelize, transaction }) {
    const now = Sequelize.fn("NOW");

    // ── rbac_audit_logs ──────────────────────────────────────────────────────
    const tables = await queryInterface.showAllTables();

    if (!tables.includes("rbac_audit_logs")) {
      await queryInterface.createTable(
        "rbac_audit_logs",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          actor_id: { type: Sequelize.STRING(64), allowNull: false },
          actor_role: { type: Sequelize.STRING(64), allowNull: true },
          target_user_id: { type: Sequelize.STRING(64), allowNull: false },
          target_role: { type: Sequelize.STRING(64), allowNull: true },
          action: { type: Sequelize.STRING(64), allowNull: false },
          module_slug: { type: Sequelize.STRING(128), allowNull: true },
          permission_slug: { type: Sequelize.STRING(256), allowNull: true },
          old_value: { type: Sequelize.JSONB, allowNull: true },
          new_value: { type: Sequelize.JSONB, allowNull: true },
          ip_address: { type: Sequelize.STRING(64), allowNull: true },
          user_agent: { type: Sequelize.TEXT, allowNull: true },
          request_id: { type: Sequelize.STRING(64), allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );

      await queryInterface.addIndex("rbac_audit_logs", ["target_user_id", "created_at"], {
        name: "idx_rbac_audit_logs_target_user_created",
        transaction,
      });
      await queryInterface.addIndex("rbac_audit_logs", ["actor_id", "created_at"], {
        name: "idx_rbac_audit_logs_actor_created",
        transaction,
      });
      await queryInterface.addIndex("rbac_audit_logs", ["action", "created_at"], {
        name: "idx_rbac_audit_logs_action_created",
        transaction,
      });
      await queryInterface.addIndex("rbac_audit_logs", ["module_slug"], {
        name: "idx_rbac_audit_logs_module_slug",
        transaction,
      });
    }

    // ── permission_templates ─────────────────────────────────────────────────
    if (!tables.includes("permission_templates")) {
      await queryInterface.createTable(
        "permission_templates",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          slug: { type: Sequelize.STRING(128), allowNull: false, unique: true },
          name: { type: Sequelize.STRING(128), allowNull: false },
          description: { type: Sequelize.TEXT, allowNull: true },
          role_scope: {
            type: Sequelize.ARRAY(Sequelize.STRING),
            allowNull: false,
            defaultValue: [],
          },
          permission_slugs: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: [],
          },
          is_active: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          metadata: {
            type: Sequelize.JSONB,
            allowNull: false,
            defaultValue: {},
          },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: now },
        },
        { transaction },
      );

      await queryInterface.addIndex("permission_templates", ["is_active"], {
        name: "idx_permission_templates_active",
        transaction,
      });
    }
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("permission_templates", { transaction });
    await queryInterface.dropTable("rbac_audit_logs", { transaction });
  },
};
