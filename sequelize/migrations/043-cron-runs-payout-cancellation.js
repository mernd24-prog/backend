"use strict";

module.exports = {
  id: "043-cron-runs-payout-cancellation",

  async up({ queryInterface, Sequelize, transaction }) {
    // Check if table exists
    const hasTable = await queryInterface.sequelize
      .query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cron_job_runs');",
        { transaction },
      )
      .then((result) => result[0]?.[0]?.exists || false);

    if (!hasTable) {
      await queryInterface.createTable(
        "cron_job_runs",
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
          job_name: { type: Sequelize.STRING(96), allowNull: false },
          status: { type: Sequelize.STRING(24), allowNull: false },
          started_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
          completed_at: { type: Sequelize.DATE, allowNull: true },
          duration_ms: { type: Sequelize.INTEGER, allowNull: true },
          result: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          error: { type: Sequelize.TEXT, allowNull: true },
          instance_id: { type: Sequelize.STRING(160), allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
        },
        { transaction },
      );

      // Add indexes
      await queryInterface.addIndex("cron_job_runs", ["job_name", "started_at"], {
        name: "idx_cron_job_runs_name_started",
        transaction,
      });
      await queryInterface.addIndex("cron_job_runs", ["status", "started_at"], {
        name: "idx_cron_job_runs_status_started",
        transaction,
      });
    }
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("cron_job_runs", { transaction }).catch(() => {});
  },
};
