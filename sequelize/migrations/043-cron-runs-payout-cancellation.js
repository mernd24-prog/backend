"use strict";

module.exports = {
  id: "043-cron-runs-payout-cancellation",

  async up({ queryInterface, transaction }) {
    const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
    await q(`
      CREATE TABLE IF NOT EXISTS cron_job_runs (
        id UUID PRIMARY KEY,
        job_name VARCHAR(96) NOT NULL,
        status VARCHAR(24) NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        duration_ms INTEGER,
        result JSONB NOT NULL DEFAULT '{}'::jsonb,
        error TEXT,
        instance_id VARCHAR(160),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cron_job_runs_name_started
      ON cron_job_runs(job_name, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cron_job_runs_status_started
      ON cron_job_runs(status, started_at DESC);
    `);
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.dropTable("cron_job_runs", { transaction }).catch(() => {});
  },
};
