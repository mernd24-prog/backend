"use strict";

module.exports = {
  id: "048-outbox-recovery",
  async up({ queryInterface, Sequelize, transaction }) {
    const columns = await queryInterface.describeTable("outbox_events", { transaction });
    if (!columns.attempt_count) await queryInterface.addColumn("outbox_events", "attempt_count", { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }, { transaction });
    if (!columns.next_attempt_at) await queryInterface.addColumn("outbox_events", "next_attempt_at", { type: Sequelize.DATE, allowNull: true }, { transaction });
    if (!columns.processing_started_at) await queryInterface.addColumn("outbox_events", "processing_started_at", { type: Sequelize.DATE, allowNull: true }, { transaction });
    await queryInterface.addIndex("outbox_events", ["status", "next_attempt_at", "occurred_at"], { name: "idx_outbox_recovery", transaction }).catch(() => {});
  },
  async down({ queryInterface, transaction }) {
    await queryInterface.removeIndex("outbox_events", "idx_outbox_recovery", { transaction }).catch(() => {});
    for (const column of ["processing_started_at", "next_attempt_at", "attempt_count"]) {
      await queryInterface.removeColumn("outbox_events", column, { transaction }).catch(() => {});
    }
  },
};
