const { postgresPool } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");

class SubscriptionRepository {
  async listActivePlans() {
    const { rows } = await postgresPool.query(
      `SELECT *
       FROM platform_subscription_plans
       WHERE active = true
       ORDER BY monthly_price ASC, created_at DESC`,
    );
    return rows;
  }

  async getPlanById(planId) {
    const { rows } = await postgresPool.query(
      `SELECT * FROM platform_subscription_plans WHERE id = $1 LIMIT 1`,
      [planId],
    );
    return rows[0] || null;
  }

  async createSubscription({ userId, userRole, planId, billingCycle, amount, currency, metadata = {} }) {
    const subscriptionId = uuidv4();
    const durationDays = billingCycle === "yearly" ? 365 : 30;

    const { rows: subscriptionRows } = await postgresPool.query(
      `INSERT INTO platform_subscriptions (
         id, user_id, user_role, plan_id, billing_cycle, amount, currency, status,
         starts_at, ends_at, next_billing_at, auto_renew, metadata, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,'active',NOW(),NOW() + ($8::TEXT || ' days')::INTERVAL,
         NOW() + ($8::TEXT || ' days')::INTERVAL,true,$9,NOW(),NOW()
       )
       RETURNING *`,
      [subscriptionId, userId, userRole, planId, billingCycle, amount, currency, String(durationDays), metadata],
    );

    await postgresPool.query(
      `INSERT INTO platform_subscription_transactions (
         id, subscription_id, user_id, plan_id, amount, currency, provider,
         transaction_status, transaction_reference, paid_at, metadata, created_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,'captured',$8,NOW(),$9,NOW()
       )`,
      [
        uuidv4(),
        subscriptionId,
        userId,
        planId,
        amount,
        currency,
        "internal",
        `sub_${subscriptionId.slice(0, 8)}`,
        { reason: "plan_purchase", ...metadata },
      ],
    );

    return subscriptionRows[0];
  }

  async listSubscriptionsByUser(userId) {
    const { rows } = await postgresPool.query(
      `SELECT s.*, p.plan_code, p.title AS plan_title, p.feature_flags
       FROM platform_subscriptions s
       INNER JOIN platform_subscription_plans p ON p.id = s.plan_id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC`,
      [userId],
    );
    return rows;
  }

  async findSubscriptionById(subscriptionId) {
    const { rows } = await postgresPool.query(
      `SELECT * FROM platform_subscriptions WHERE id = $1 LIMIT 1`,
      [subscriptionId],
    );
    return rows[0] || null;
  }

  async updateSubscriptionStatus(subscriptionId, status) {
    const patch = {
      active: `status = 'active', auto_renew = true`,
      paused: `status = 'paused', auto_renew = false`,
      cancelled: `status = 'cancelled', auto_renew = false, ends_at = NOW()`,
    }[status];

    const { rows } = await postgresPool.query(
      `UPDATE platform_subscriptions
       SET ${patch}, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [subscriptionId],
    );

    return rows[0] || null;
  }

  async createPlan(payload) {
    const { rows } = await postgresPool.query(
      `INSERT INTO platform_subscription_plans (
         id, plan_code, title, description, target_roles, feature_flags,
         monthly_price, yearly_price, currency, active, metadata, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()
       )
       RETURNING *`,
      [
        uuidv4(),
        payload.planCode,
        payload.title,
        payload.description || null,
        payload.targetRoles || [],
        payload.featureFlags || [],
        payload.monthlyPrice,
        payload.yearlyPrice,
        payload.currency || "INR",
        payload.active !== undefined ? payload.active : true,
        payload.metadata || {},
      ],
    );
    return rows[0];
  }

  async listPlansAdmin({ active = null, limit = 50, offset = 0 } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (active !== null && active !== undefined) {
      clauses.push(`active = $${idx++}`);
      values.push(active);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit, offset);

    const { rows } = await postgresPool.query(
      `SELECT *
       FROM platform_subscription_plans
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${idx++}
       OFFSET $${idx}`,
      values,
    );

    return rows;
  }

  async updatePlan(planId, payload) {
    const { rows } = await postgresPool.query(
      `UPDATE platform_subscription_plans
       SET title = COALESCE($2, title),
           description = COALESCE($3, description),
           target_roles = COALESCE($4, target_roles),
           feature_flags = COALESCE($5, feature_flags),
           monthly_price = COALESCE($6, monthly_price),
           yearly_price = COALESCE($7, yearly_price),
           currency = COALESCE($8, currency),
           active = COALESCE($9, active),
           metadata = COALESCE($10, metadata),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        planId,
        payload.title,
        payload.description,
        payload.targetRoles,
        payload.featureFlags,
        payload.monthlyPrice,
        payload.yearlyPrice,
        payload.currency,
        payload.active,
        payload.metadata,
      ],
    );

    return rows[0] || null;
  }

  async deletePlan(planId) {
    const { rows } = await postgresPool.query(
      `UPDATE platform_subscription_plans
       SET active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [planId],
    );

    return rows[0] || null;
  }

  async listSubscriptionsAdmin({ status = null, userRole = null, limit = 50, offset = 0 } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (status) {
      clauses.push(`s.status = $${idx++}`);
      values.push(status);
    }

    if (userRole) {
      clauses.push(`s.user_role = $${idx++}`);
      values.push(userRole);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit, offset);

    const { rows } = await postgresPool.query(
      `SELECT s.*, p.plan_code, p.title AS plan_title
       FROM platform_subscriptions s
       INNER JOIN platform_subscription_plans p ON p.id = s.plan_id
       ${whereSql}
       ORDER BY s.created_at DESC
       LIMIT $${idx++}
       OFFSET $${idx}`,
      values,
    );

    return rows;
  }

}

module.exports = { SubscriptionRepository };
