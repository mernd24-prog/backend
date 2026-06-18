const { knex, postgresPool } = require("../../../infrastructure/postgres/postgres-client");
const { v4: uuidv4 } = require("uuid");
const { UserRepository } = require("../../user/repositories/user.repository");
const {
  SESSION_INVALIDATION_REASONS,
  makeSessionInvalidationUpdate,
  mergeMongoUpdates,
  normalizeAccountStatus,
} = require("../../../shared/auth/session-state");

function statusSessionFields(accountStatus) {
  if (accountStatus === undefined || accountStatus === null || accountStatus === "") return {};
  const status = normalizeAccountStatus(accountStatus);
  const now = new Date();
  return {
    ...(status === "active" ? { blockedAt: null, deactivatedAt: null, deletedAt: null } : {}),
    ...(status === "deleted" ? { deletedAt: now, refreshSessions: [] } : {}),
    ...(status === "suspended" || status === "blocked" ? { blockedAt: now, refreshSessions: [] } : {}),
    ...(status === "inactive" || status === "disabled" || status === "deactivated" ? { deactivatedAt: now, refreshSessions: [] } : {}),
  };
}

class SellerRepository {
  constructor({ userRepository = new UserRepository() } = {}) {
    this.userRepository = userRepository;
  }

  async upsertKyc(payload) {
    const id = uuidv4();
    const [record] = await knex("seller_kyc")
      .insert({
        id,
        seller_id: payload.sellerId,
        pan_number: payload.panNumber,
        gst_number: payload.gstNumber || null,
        aadhaar_number: payload.aadhaarNumber || null,
        legal_name: payload.legalName,
        business_type: payload.businessType || null,
        verification_status: payload.verificationStatus,
        documents: JSON.stringify(payload.documents || {}),
        rejection_reason: payload.rejectionReason || null,
        submitted_at: knex.fn.now(),
      })
      .onConflict("seller_id")
      .merge({
        pan_number: payload.panNumber,
        gst_number: payload.gstNumber || null,
        aadhaar_number: payload.aadhaarNumber || null,
        legal_name: payload.legalName,
        business_type: payload.businessType || null,
        verification_status: payload.verificationStatus,
        documents: JSON.stringify(payload.documents || {}),
        rejection_reason: payload.rejectionReason || null,
        submitted_at: knex.fn.now(),
      })
      .returning("*");

    return record;
  }

  async reviewKyc(sellerId, payload) {
    const [record] = await knex("seller_kyc")
      .where("seller_id", sellerId)
      .update({
        verification_status: payload.verificationStatus,
        reviewed_by: payload.reviewedBy,
        rejection_reason: payload.rejectionReason || null,
        reviewed_at: knex.fn.now(),
      })
      .returning("*");

    return record || null;
  }

  async findKycBySellerId(sellerId) {
    const { rows } = await postgresPool.query("SELECT * FROM seller_kyc WHERE seller_id = $1 LIMIT 1", [sellerId]);
    return rows[0] || null;
  }

  async updateSellerProfile(sellerId, payload) {
    return this.userRepository.updateById(sellerId, {
      $set: {
        sellerProfile: payload,
      },
    });
  }

  async updateSellerAccountStatus(sellerId, accountStatus, onboardingStatus = null) {
    return this.userRepository.updateById(
      sellerId,
      mergeMongoUpdates(
        {
          $set: {
            accountStatus,
            ...(onboardingStatus ? { "sellerProfile.onboardingStatus": onboardingStatus } : {}),
            ...statusSessionFields(accountStatus),
          },
        },
        makeSessionInvalidationUpdate(SESSION_INVALIDATION_REASONS.ACCOUNT_STATUS_CHANGED),
      ),
    );
  }

  async updateSellerOnboardingState(sellerId, sellerProfile, accountStatus) {
    return this.userRepository.updateById(
      sellerId,
      mergeMongoUpdates(
        {
          $set: {
            sellerProfile,
            accountStatus,
            ...statusSessionFields(accountStatus),
          },
        },
        makeSessionInvalidationUpdate(SESSION_INVALIDATION_REASONS.ACCOUNT_STATUS_CHANGED),
      ),
    );
  }

  async updateSellerSettings(sellerId, payload) {
    return this.userRepository.updateById(sellerId, {
      $set: {
        sellerSettings: payload,
      },
    });
  }

  async findSellerById(sellerId) {
    return this.userRepository.findById(sellerId);
  }

  async findUserByEmail(email) {
    return this.userRepository.findByEmail(email);
  }

  async createManagedUser(payload) {
    return this.userRepository.create(payload);
  }

  async listSellerSubAdmins(sellerId) {
    const { UserModel } = require("../../user/models/user.model");
    return UserModel.find({
      role: { $in: ["seller-admin", "seller-sub-admin"] },
      ownerSellerId: sellerId,
      accountStatus: { $ne: "deleted" },
    })
      .select("email phone role profile accountStatus allowedModules createdBy createdByRole parentAdminId parentSellerId hierarchyLevel ownerAdminId ownerSellerId createdAt updatedAt lastLoginAt")
      .sort({ createdAt: -1 });
  }

  async findSellerSubAdminById(sellerId, userId) {
    const { UserModel } = require("../../user/models/user.model");
    return UserModel.findOne({
      _id: userId,
      role: { $in: ["seller-admin", "seller-sub-admin"] },
      ownerSellerId: sellerId,
      accountStatus: { $ne: "deleted" },
    }).select("email phone role profile accountStatus allowedModules createdBy createdByRole parentAdminId parentSellerId hierarchyLevel ownerAdminId ownerSellerId createdAt updatedAt lastLoginAt");
  }

  async updateSellerSubAdminModules(sellerId, userId, allowedModules) {
    const { UserModel } = require("../../user/models/user.model");
    return UserModel.findOneAndUpdate(
      {
        _id: userId,
        role: { $in: ["seller-admin", "seller-sub-admin"] },
        ownerSellerId: sellerId,
        accountStatus: { $ne: "deleted" },
      },
      mergeMongoUpdates(
        { $set: { allowedModules } },
        makeSessionInvalidationUpdate(SESSION_INVALIDATION_REASONS.PERMISSIONS_CHANGED),
      ),
      { new: true },
    ).select("email phone role profile accountStatus allowedModules createdBy createdByRole parentAdminId parentSellerId hierarchyLevel ownerAdminId ownerSellerId createdAt updatedAt lastLoginAt");
  }

  async updateSellerSubAdminStatus(sellerId, userId, accountStatus) {
    const { UserModel } = require("../../user/models/user.model");
    return UserModel.findOneAndUpdate(
      {
        _id: userId,
        role: { $in: ["seller-admin", "seller-sub-admin"] },
        ownerSellerId: sellerId,
        accountStatus: { $ne: "deleted" },
      },
      mergeMongoUpdates(
        { $set: { accountStatus, ...statusSessionFields(accountStatus) } },
        makeSessionInvalidationUpdate(SESSION_INVALIDATION_REASONS.ACCOUNT_STATUS_CHANGED),
      ),
      { new: true },
    ).select("email phone role profile accountStatus allowedModules createdBy createdByRole parentAdminId parentSellerId hierarchyLevel ownerAdminId ownerSellerId createdAt updatedAt lastLoginAt");
  }

  async deleteSellerSubAdmin(sellerId, userId) {
    const { UserModel } = require("../../user/models/user.model");
    return UserModel.findOneAndUpdate(
      {
        _id: userId,
        role: { $in: ["seller-admin", "seller-sub-admin"] },
        ownerSellerId: sellerId,
        accountStatus: { $ne: "deleted" },
      },
      {
        ...mergeMongoUpdates(
          {
            $set: {
              accountStatus: "deleted",
              allowedModules: [],
              refreshSessions: [],
              deletedAt: new Date(),
            },
          },
          makeSessionInvalidationUpdate(SESSION_INVALIDATION_REASONS.USER_DELETED),
        ),
      },
      { new: true },
    ).select("email phone role profile accountStatus allowedModules createdBy createdByRole parentAdminId parentSellerId hierarchyLevel ownerAdminId ownerSellerId createdAt updatedAt lastLoginAt");
  }

  async fetchDashboardSummary(sellerId, fromDate, toDate) {
    const { rows } = await postgresPool.query(
      `SELECT
         COUNT(DISTINCT o.id)::INT AS total_orders,
         COALESCE(SUM(oi.quantity), 0)::INT AS units_sold,
         COALESCE(SUM(oi.line_total), 0)::NUMERIC AS gmv,
         COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN oi.line_total ELSE 0 END), 0)::NUMERIC AS delivered_revenue,
         COUNT(DISTINCT CASE WHEN o.status = 'cancelled' THEN o.id END)::INT AS cancelled_orders,
         COUNT(DISTINCT CASE WHEN o.status IN ('returned', 'partially_returned') THEN o.id END)::INT AS returned_orders,
         COALESCE(AVG(oi.line_total), 0)::NUMERIC AS avg_item_value
       FROM order_items oi
       INNER JOIN orders o ON o.id = oi.order_id
       WHERE oi.seller_id = $1
         AND o.created_at BETWEEN $2 AND $3`,
      [sellerId, fromDate, toDate],
    );
    return rows[0];
  }

  async fetchTopProducts(sellerId, fromDate, toDate, limit = 5) {
    const { rows } = await postgresPool.query(
      `SELECT
         oi.product_id,
         COALESCE(SUM(oi.quantity), 0)::INT AS units_sold,
         COALESCE(SUM(oi.line_total), 0)::NUMERIC AS revenue
       FROM order_items oi
       INNER JOIN orders o ON o.id = oi.order_id
       WHERE oi.seller_id = $1
         AND o.created_at BETWEEN $2 AND $3
       GROUP BY oi.product_id
       ORDER BY revenue DESC
       LIMIT $4`,
      [sellerId, fromDate, toDate, limit],
    );
    return rows;
  }

  async fetchRecentOrders(sellerId, limit = 10) {
    const { rows } = await postgresPool.query(
      `SELECT
         o.id,
         o.buyer_id,
         o.status,
         o.currency,
         o.payable_amount,
         o.created_at,
         COALESCE(SUM(oi.line_total), 0)::NUMERIC AS seller_order_total
       FROM orders o
       INNER JOIN order_items oi ON oi.order_id = o.id
       WHERE oi.seller_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT $2`,
      [sellerId, limit],
    );

    return rows;
  }

  getTrackingWhere(sellerId, filters = {}, { includeStatusFilters = true } = {}) {
    const values = [sellerId];
    const clauses = ["oi.seller_id = $1"];
    let index = 2;

    if (includeStatusFilters && filters.status) {
      clauses.push(`o.status = $${index++}`);
      values.push(filters.status);
    }

    if (includeStatusFilters && filters.deliveryStatus) {
      if (filters.deliveryStatus === "not_created") {
        clauses.push("ewb.id IS NULL");
      } else {
        clauses.push(`ewb.status = $${index++}`);
        values.push(filters.deliveryStatus);
      }
    }

    if (filters.fromDate) {
      clauses.push(`o.created_at >= $${index++}`);
      values.push(filters.fromDate);
    }

    if (filters.toDate) {
      clauses.push(`o.created_at <= $${index++}`);
      values.push(filters.toDate);
    }

    return {
      whereSql: `WHERE ${clauses.join(" AND ")}`,
      values,
      nextIndex: index,
    };
  }

  trackingOrderSelectSql() {
    return `SELECT
        o.id AS order_id,
        o.buyer_id,
        o.status AS order_status,
        o.currency,
        o.payable_amount,
        o.total_amount,
        o.created_at,
        o.updated_at,
        COUNT(DISTINCT oi.id)::INT AS items_count,
        COALESCE(SUM(oi.quantity), 0)::INT AS units,
        COALESCE(SUM(oi.line_total), 0)::NUMERIC AS seller_order_total,
        ewb.id AS eway_bill_id,
        ewb.e_way_bill_number,
        ewb.status AS delivery_status,
        ewb.transporter_name,
        ewb.vehicle_number,
        ewb.updated_at AS delivery_updated_at`;
  }

  trackingOrderFromSql() {
    return `FROM orders o
      INNER JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN LATERAL (
        SELECT *
        FROM e_way_bill_details ewb_inner
        WHERE ewb_inner.order_id = o.id
        ORDER BY ewb_inner.created_at DESC
        LIMIT 1
      ) ewb ON true`;
  }

  trackingOrderGroupSql() {
    return `GROUP BY
        o.id,
        ewb.id,
        ewb.e_way_bill_number,
        ewb.status,
        ewb.transporter_name,
        ewb.vehicle_number,
        ewb.updated_at`;
  }

  async fetchSellerTrackingOrders(sellerId, filters = {}) {
    const limit = Number(filters.limit || 20);
    const offset = Number(filters.offset || 0);
    const { whereSql, values, nextIndex } = this.getTrackingWhere(sellerId, filters);
    values.push(limit, offset);

    const { rows } = await postgresPool.query(
      `${this.trackingOrderSelectSql()}
       ${this.trackingOrderFromSql()}
       ${whereSql}
       ${this.trackingOrderGroupSql()}
       ORDER BY o.created_at DESC
       LIMIT $${nextIndex}
       OFFSET $${nextIndex + 1}`,
      values,
    );

    return rows;
  }

  async fetchSellerTrackingSummary(sellerId, filters = {}) {
    const { whereSql, values } = this.getTrackingWhere(sellerId, filters, {
      includeStatusFilters: false,
    });

    const [orderStatusResult, deliveryStatusResult] = await Promise.all([
      postgresPool.query(
        `SELECT o.status, COUNT(DISTINCT o.id)::INT AS total
         ${this.trackingOrderFromSql()}
         ${whereSql}
         GROUP BY o.status
         ORDER BY o.status ASC`,
        values,
      ),
      postgresPool.query(
        `SELECT COALESCE(ewb.status, 'not_created') AS status, COUNT(DISTINCT o.id)::INT AS total
         ${this.trackingOrderFromSql()}
         ${whereSql}
         GROUP BY COALESCE(ewb.status, 'not_created')
         ORDER BY status ASC`,
        values,
      ),
    ]);

    return {
      orderStatuses: orderStatusResult.rows,
      deliveryStatuses: deliveryStatusResult.rows,
    };
  }

  async fetchSellerTrackingOrderDetail(sellerId, orderId) {
    const { rows } = await postgresPool.query(
      `${this.trackingOrderSelectSql()}
       ${this.trackingOrderFromSql()}
       WHERE o.id = $1 AND oi.seller_id = $2
       ${this.trackingOrderGroupSql()}
       LIMIT 1`,
      [orderId, sellerId],
    );

    if (!rows[0]) {
      return null;
    }

    const items = await knex("order_items")
      .where({ order_id: orderId, seller_id: sellerId })
      .orderBy("id", "asc");

    return {
      order: rows[0],
      items,
    };
  }
}

module.exports = { SellerRepository };
