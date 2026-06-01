const { knex } = require("../../../infrastructure/postgres/postgres-client");

const COD_METHOD = "cod";

class PaymentMethodConfigRepository {
  async ensureTable() {
    await knex.schema.createTableIfNotExists("payment_method_configs", (table) => {
      table.string("method", 64).primary();
      table.boolean("enabled").notNullable().defaultTo(true);
      table.decimal("charge_amount", 12, 2).notNullable().defaultTo(0);
      table.decimal("min_order_amount", 12, 2).nullable();
      table.decimal("max_order_amount", 12, 2).nullable();
      table.string("currency", 8).notNullable().defaultTo("INR");
      table.jsonb("metadata").notNullable().defaultTo({});
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  async getMethodConfig(method) {
    await this.ensureTable();
    const [config] = await knex("payment_method_configs").where("method", method).limit(1);
    return config || null;
  }

  async getCodConfig() {
    const config = await this.getMethodConfig(COD_METHOD);
    return config || {
      method: COD_METHOD,
      enabled: true,
      charge_amount: 0,
      min_order_amount: null,
      max_order_amount: null,
      currency: "INR",
      metadata: {},
    };
  }

  async upsertCodConfig(payload = {}) {
    await this.ensureTable();
    const row = {
      method: COD_METHOD,
      enabled: payload.enabled !== undefined ? Boolean(payload.enabled) : true,
      charge_amount: Number(payload.chargeAmount ?? payload.charge_amount ?? 0),
      min_order_amount: payload.minOrderAmount ?? payload.min_order_amount ?? null,
      max_order_amount: payload.maxOrderAmount ?? payload.max_order_amount ?? null,
      currency: payload.currency || "INR",
      metadata: payload.metadata || {},
      updated_at: knex.fn.now(),
    };

    const [config] = await knex("payment_method_configs")
      .insert(row)
      .onConflict("method")
      .merge(row)
      .returning("*");

    return config;
  }
}

module.exports = {
  COD_METHOD,
  PaymentMethodConfigRepository,
};
