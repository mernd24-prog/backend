const { knex } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");

class WalletRepository {
  async ensureWalletWithClient(client, userId) {
    const [wallet] = await client("wallets")
      .insert({ id: uuidv4(), user_id: userId, available_balance: 0, locked_balance: 0 })
      .onConflict("user_id")
      .merge({ user_id: userId })
      .returning("*");
    return wallet;
  }

  async ensureWallet(userId) {
    const [wallet] = await knex("wallets")
      .insert({ id: uuidv4(), user_id: userId, available_balance: 0, locked_balance: 0 })
      .onConflict("user_id")
      .merge({ user_id: userId })
      .returning("*");
    return wallet;
  }

  async findWalletByUserId(userId) {
    const [wallet] = await knex("wallets").where("user_id", userId).limit(1);
    return wallet || null;
  }

  async creditWallet(userId, amount, meta) {
    const trx = await knex.transaction();

    try {
      await this.ensureWalletWithClient(trx, userId);
      await trx("wallets").where("user_id", userId).forUpdate().first();
      if (meta.referenceType && meta.referenceId) {
        const existing = await trx("wallet_transactions")
          .where({
            user_id: userId,
            type: "credit",
            status: "completed",
            reference_type: meta.referenceType,
            reference_id: meta.referenceId,
          })
          .first();
        if (existing) {
          const [wallet] = await trx("wallets").where("user_id", userId).limit(1);
          await trx.commit();
          return wallet;
        }
      }
      await trx("wallets").where("user_id", userId).increment("available_balance", amount);
      await trx("wallet_transactions").insert({
        id: uuidv4(),
        user_id: userId,
        type: "credit",
        status: "completed",
        amount,
        reference_type: meta.referenceType,
        reference_id: meta.referenceId || null,
        metadata: JSON.stringify(meta.metadata || {}),
      });

      const [wallet] = await trx("wallets").where("user_id", userId).limit(1);
      await trx.commit();
      return wallet;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async holdWalletAmount(userId, amount, referenceId, metadata = {}) {
    const trx = await knex.transaction();

    try {
      await this.ensureWalletWithClient(trx, userId);
      const [wallet] = await trx("wallets")
        .where("user_id", userId)
        .andWhere("available_balance", ">=", amount)
        .update({
          available_balance: knex.raw("available_balance - ?", [amount]),
          locked_balance: knex.raw("locked_balance + ?", [amount]),
        })
        .returning("*");

      if (!wallet) {
        throw new Error("Insufficient wallet balance");
      }

      await trx("wallet_transactions").insert({
        id: uuidv4(),
        user_id: userId,
        type: "debit",
        status: "held",
        amount,
        reference_type: "order",
        reference_id: referenceId,
        metadata: JSON.stringify(metadata),
      });
      await trx.commit();
      return wallet;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async captureHeldAmount(userId, referenceId) {
    const trx = await knex.transaction();

    try {
      const [heldTx] = await trx("wallet_transactions")
        .where({ user_id: userId, reference_id: referenceId, status: "held" })
        .orderBy("created_at", "desc")
        .limit(1);

      if (!heldTx) {
        await trx.commit();
        return null;
      }

      await trx("wallets").where("user_id", userId).decrement("locked_balance", heldTx.amount);
      await trx("wallet_transactions").where("id", heldTx.id).update({ status: "completed" });
      await trx.commit();
      return heldTx;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async releaseHeldAmount(userId, referenceId) {
    const trx = await knex.transaction();

    try {
      const [heldTx] = await trx("wallet_transactions")
        .where({ user_id: userId, reference_id: referenceId, status: "held" })
        .orderBy("created_at", "desc")
        .limit(1);

      if (!heldTx) {
        await trx.commit();
        return null;
      }

      await trx("wallets")
        .where("user_id", userId)
        .update({
          locked_balance: knex.raw("locked_balance - ?", [heldTx.amount]),
          available_balance: knex.raw("available_balance + ?", [heldTx.amount]),
        });
      await trx("wallet_transactions").where("id", heldTx.id).update({ status: "released" });
      await trx.commit();
      return heldTx;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async releaseHeldAmountPartial(userId, referenceId, amount, cancellationId, metadata = {}) {
    const trx = await knex.transaction();
    try {
      const heldTx = await trx("wallet_transactions")
        .where({ user_id: userId, reference_id: referenceId, status: "held" })
        .orderBy("created_at", "desc")
        .first()
        .forUpdate();
      if (!heldTx) {
        await trx.commit();
        return null;
      }
      const releaseAmount = Math.min(Number(amount || 0), Number(heldTx.amount || 0));
      if (releaseAmount <= 0) {
        await trx.commit();
        return null;
      }
      const existing = await trx("wallet_transactions")
        .where({
          user_id: userId,
          type: "credit",
          status: "released",
          reference_type: "order_cancellation",
          reference_id: cancellationId,
        })
        .first();
      if (existing) {
        await trx.commit();
        return existing;
      }

      await trx("wallets").where("user_id", userId).update({
        locked_balance: knex.raw("locked_balance - ?", [releaseAmount]),
        available_balance: knex.raw("available_balance + ?", [releaseAmount]),
      });
      const remaining = Number(heldTx.amount || 0) - releaseAmount;
      await trx("wallet_transactions").where("id", heldTx.id).update({
        amount: remaining,
        status: remaining > 0 ? "held" : "released",
        metadata: knex.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify({ partialReleaseCancellationId: cancellationId })]),
      });
      const [transaction] = await trx("wallet_transactions").insert({
        id: uuidv4(),
        user_id: userId,
        type: "credit",
        status: "released",
        amount: releaseAmount,
        reference_type: "order_cancellation",
        reference_id: cancellationId,
        metadata: JSON.stringify({ ...metadata, originalReferenceId: referenceId }),
      }).returning("*");
      await trx.commit();
      return transaction;
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async listTransactions(userId) {
    return knex("wallet_transactions").where("user_id", userId).orderBy("created_at", "desc");
  }

  applyTransactionFilters(query, filters = {}) {
    const {
      userId = null,
      type = null,
      status = null,
      referenceType = null,
      referenceId = null,
      fromDate = null,
      toDate = null,
      search = null,
    } = filters;

    if (userId) query.where("wallet_transactions.user_id", userId);
    if (type) query.where("wallet_transactions.type", type);
    if (status) query.where("wallet_transactions.status", status);
    if (referenceType) query.where("wallet_transactions.reference_type", referenceType);
    if (referenceId) query.where("wallet_transactions.reference_id", referenceId);
    if (fromDate) query.where("wallet_transactions.created_at", ">=", fromDate);
    if (toDate) query.where("wallet_transactions.created_at", "<=", toDate);
    if (search) {
      const term = `%${String(search).trim()}%`;
      query.where((builder) => {
        builder
          .whereILike("wallet_transactions.user_id", term)
          .orWhereILike("wallet_transactions.reference_type", term)
          .orWhereILike("wallet_transactions.reference_id", term)
          .orWhereRaw("wallet_transactions.id::text ILIKE ?", [term])
          .orWhereRaw("COALESCE(wallet_transactions.metadata, '{}'::jsonb)::text ILIKE ?", [term]);
      });
    }
  }

  async listAllTransactions(filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
    const offset = Math.max(Number(filters.offset || 0), 0);
    const buildBase = () => {
      const query = knex("wallet_transactions");
      this.applyTransactionFilters(query, filters);
      return query;
    };

    const [items, countRows, summary] = await Promise.all([
      buildBase()
        .leftJoin("wallets", "wallets.user_id", "wallet_transactions.user_id")
        .select(
          "wallet_transactions.*",
          "wallets.available_balance",
          "wallets.locked_balance",
        )
        .orderBy("wallet_transactions.created_at", "desc")
        .limit(limit)
        .offset(offset),
      buildBase().count({ total: "*" }),
      buildBase()
        .select(
          knex.raw("COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS credit_amount"),
          knex.raw("COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) AS debit_amount"),
          knex.raw("COALESCE(SUM(CASE WHEN status = 'held' THEN amount ELSE 0 END), 0) AS held_amount"),
        )
        .first(),
    ]);

    return {
      items,
      total: Number(countRows?.[0]?.total || 0),
      limit,
      offset,
      summary: {
        creditAmount: Number(summary?.credit_amount || 0),
        debitAmount: Number(summary?.debit_amount || 0),
        heldAmount: Number(summary?.held_amount || 0),
      },
    };
  }
}

module.exports = { WalletRepository };
