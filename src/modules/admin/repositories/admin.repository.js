const { postgresPool } = require("../../../infrastructure/postgres/postgres-client");
const { UserModel } = require("../../user/models/user.model");
const { ProductModel } = require("../../product/models/product.model");
const { v4: uuidv4 } = require("uuid");
const { randomBytes } = require("crypto");
const { hashText } = require("../../../shared/tools/hash");
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

function invalidationReasonForUserPayload(payload = {}) {
  if (payload.role) return SESSION_INVALIDATION_REASONS.ROLE_CHANGED;
  if (Object.prototype.hasOwnProperty.call(payload, "allowedModules")) {
    return SESSION_INVALIDATION_REASONS.PERMISSIONS_CHANGED;
  }
  if (payload.accountStatus || payload.status) {
    return SESSION_INVALIDATION_REASONS.ACCOUNT_STATUS_CHANGED;
  }
  return null;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCreatedAtRange({ dateFrom, dateTo, createdFrom, createdTo } = {}) {
  const from = dateFrom || createdFrom;
  const to = dateTo || createdTo;
  const createdAt = {};

  if (from) {
    const start = new Date(from);
    if (!Number.isNaN(start.getTime())) {
      start.setHours(0, 0, 0, 0);
      createdAt.$gte = start;
    }
  }
  if (to) {
    const end = new Date(to);
    if (!Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      createdAt.$lte = end;
    }
  }

  return Object.keys(createdAt).length ? createdAt : null;
}

class AdminRepository {
  money(value) {
    return Number(value || 0);
  }

  async safePostgresQuery(sql, values = [], fallbackRows = []) {
    try {
      const result = await postgresPool.query(sql, values);
      return result.rows || fallbackRows;
    } catch {
      return fallbackRows;
    }
  }

  normalizeTrend(current, previous) {
    const currentValue = this.money(current);
    const previousValue = this.money(previous);
    if (!previousValue) return currentValue ? 100 : 0;
    return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(1));
  }

  async getUsersByIds(userIds = []) {
    const ids = [...new Set(userIds.map(String).filter(Boolean))];
    if (!ids.length) return new Map();

    const users = await UserModel.find({ _id: { $in: ids } })
      .select("email profile sellerProfile")
      .lean();

    return new Map(
      users.map((user) => [
        String(user._id),
        user.profile?.name ||
          [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ") ||
          user.sellerProfile?.displayName ||
          user.email ||
          String(user._id),
      ]),
    );
  }

  async getOverviewStats() {
    const [
      totalUsers,
      totalSellers,
      totalProducts,
      pendingProducts,
      ordersRows,
      paymentsRows,
      statusRows,
      recentOrdersRows,
      topProductRows,
      performanceRows,
      trendRows,
      payoutRows,
    ] = await Promise.all([
      UserModel.countDocuments({}),
      UserModel.countDocuments({ role: "seller" }),
      ProductModel.countDocuments({}),
      ProductModel.countDocuments({ status: "pending_approval" }),
      this.safePostgresQuery(
        `SELECT
           COUNT(*)::INT AS total_orders,
           COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::INT AS orders_today,
           COUNT(*) FILTER (WHERE LOWER(status) IN ('returned', 'return_requested', 'return_approved', 'refunded', 'partially_refunded'))::INT AS returned_orders,
           COALESCE(SUM(COALESCE(payable_amount, total_amount, 0)), 0)::NUMERIC AS gmv,
           COALESCE(SUM(COALESCE(platform_fee_amount, 0)), 0)::NUMERIC AS total_platform_fees,
           COALESCE(SUM(oi.units_sold), 0)::INT AS units_sold
         FROM orders o
         LEFT JOIN (
           SELECT order_id, SUM(quantity)::INT AS units_sold
           FROM order_items
           GROUP BY order_id
         ) oi ON oi.order_id = o.id`,
      ),
      this.safePostgresQuery(
        `SELECT
           COUNT(*)::INT AS total_payments,
           COALESCE(SUM(amount), 0)::NUMERIC AS total_collected
         FROM payments
         WHERE status = 'captured'`,
      ),
      this.safePostgresQuery(
        `SELECT
           LOWER(COALESCE(NULLIF(status, ''), 'pending')) AS status,
           COUNT(*)::INT AS count
         FROM orders
         GROUP BY LOWER(COALESCE(NULLIF(status, ''), 'pending'))
         ORDER BY count DESC`,
      ),
      this.safePostgresQuery(
        `SELECT
           id,
           order_number,
           buyer_id,
           status,
           payment_status,
           currency,
           COALESCE(payable_amount, total_amount, 0)::NUMERIC AS total,
           created_at
         FROM orders
         ORDER BY created_at DESC
         LIMIT 10`,
      ),
      this.safePostgresQuery(
        `SELECT
           product_id,
           COALESCE(MAX(NULLIF(product_title, '')), MAX(NULLIF(product_sku, '')), product_id) AS name,
           SUM(quantity)::INT AS units_sold,
           COALESCE(SUM(line_total), 0)::NUMERIC AS revenue
         FROM order_items
         GROUP BY product_id
         ORDER BY revenue DESC, units_sold DESC
         LIMIT 10`,
      ),
      this.safePostgresQuery(
        `SELECT
           TO_CHAR(day_bucket, 'Dy') AS label,
           COALESCE(order_count, 0)::INT AS value,
           COALESCE(revenue, 0)::NUMERIC AS revenue
         FROM (
           SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::DATE AS day_bucket
         ) days
         LEFT JOIN (
           SELECT
             created_at::DATE AS order_day,
             COUNT(*)::INT AS order_count,
             SUM(COALESCE(payable_amount, total_amount, 0)) AS revenue
           FROM orders
           WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
           GROUP BY created_at::DATE
         ) orders_by_day ON orders_by_day.order_day = days.day_bucket
         ORDER BY day_bucket`,
      ),
      this.safePostgresQuery(
        `SELECT
           COUNT(*) FILTER (
             WHERE created_at >= date_trunc('month', CURRENT_DATE)
           )::INT AS current_orders,
           COUNT(*) FILTER (
             WHERE created_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
               AND created_at < date_trunc('month', CURRENT_DATE)
           )::INT AS previous_orders,
           COALESCE(SUM(COALESCE(payable_amount, total_amount, 0)) FILTER (
             WHERE created_at >= date_trunc('month', CURRENT_DATE)
           ), 0)::NUMERIC AS current_gmv,
           COALESCE(SUM(COALESCE(payable_amount, total_amount, 0)) FILTER (
             WHERE created_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
               AND created_at < date_trunc('month', CURRENT_DATE)
           ), 0)::NUMERIC AS previous_gmv,
           COUNT(*) FILTER (
             WHERE LOWER(status) IN ('returned', 'return_requested', 'return_approved', 'refunded', 'partially_refunded')
               AND created_at >= date_trunc('month', CURRENT_DATE)
           )::INT AS current_returned_orders,
           COUNT(*) FILTER (
             WHERE LOWER(status) IN ('returned', 'return_requested', 'return_approved', 'refunded', 'partially_refunded')
               AND created_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
               AND created_at < date_trunc('month', CURRENT_DATE)
           )::INT AS previous_returned_orders
         FROM orders`,
      ),
      this.safePostgresQuery(
        `SELECT
           COALESCE(SUM(net_amount), 0)::NUMERIC AS pending_amount,
           COUNT(*)::INT AS pending_count
         FROM seller_payouts
         WHERE status IN ('pending', 'on_hold', 'processing')`,
      ),
    ]);

    const orders = ordersRows[0] || {};
    const payments = paymentsRows[0] || {};
    const trends = trendRows[0] || {};
    const payouts = payoutRows[0] || {};
    const buyerNames = await this.getUsersByIds(recentOrdersRows.map((order) => order.buyer_id));
    const recentOrders = recentOrdersRows.map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      buyerId: order.buyer_id,
      customerName: buyerNames.get(String(order.buyer_id)) || order.buyer_id,
      status: order.status,
      paymentStatus: order.payment_status,
      total: this.money(order.total),
      currency: order.currency || "INR",
      createdAt: order.created_at,
    }));
    const orderStatus = statusRows.map((row) => ({
      name: row.status,
      label: String(row.status || "pending").replace(/_/g, " "),
      value: Number(row.count || 0),
    }));

    return {
      users: {
        totalUsers,
        totalSellers,
      },
      catalog: {
        totalProducts,
        pendingProducts,
      },
      commerce: {
        totalOrders: Number(orders.total_orders || 0),
        ordersToday: Number(orders.orders_today || 0),
        returnedOrders: Number(orders.returned_orders || 0),
        unitsSold: Number(orders.units_sold || 0),
        gmv: this.money(orders.gmv),
        totalPlatformFees: this.money(orders.total_platform_fees),
      },
      payments: {
        totalPayments: Number(payments.total_payments || 0),
        totalCollected: this.money(payments.total_collected),
      },
      payouts: {
        pendingAmount: this.money(payouts.pending_amount),
        pendingCount: Number(payouts.pending_count || 0),
      },
      trends: {
        totalOrders: this.normalizeTrend(trends.current_orders, trends.previous_orders),
        gmv: this.normalizeTrend(trends.current_gmv, trends.previous_gmv),
        returnedOrders: this.normalizeTrend(
          trends.current_returned_orders,
          trends.previous_returned_orders,
        ),
      },
      orderPerformance: performanceRows.map((row) => ({
        label: row.label,
        value: Number(row.value || 0),
        revenue: this.money(row.revenue),
      })),
      orderStatus,
      statusBreakdown: orderStatus,
      topProducts: topProductRows.map((row) => ({
        productId: row.product_id,
        name: row.name,
        unitsSold: Number(row.units_sold || 0),
        revenue: this.money(row.revenue),
      })),
      recentOrders,
    };
  }

  async listVendors({ q = "", status = null, onboardingStatus = null, limit = 50, page = 1, ownerAdminId = null, ownerSellerId = null, parentAdminId = null, parentSellerId = null } = {}) {
    const filter = { role: "seller" };
    if (status) {
      filter.accountStatus = status;
    }
    if (onboardingStatus) {
      filter["sellerProfile.onboardingStatus"] = onboardingStatus;
    }
    if (q) {
      filter.$or = [
        { email: { $regex: q, $options: "i" } },
        { "sellerProfile.displayName": { $regex: q, $options: "i" } },
        { "sellerProfile.legalBusinessName": { $regex: q, $options: "i" } },
      ];
    }
    if (ownerAdminId) filter.ownerAdminId = ownerAdminId;
    if (ownerSellerId) filter.ownerSellerId = ownerSellerId;
    if (parentAdminId) filter.parentAdminId = parentAdminId;
    if (parentSellerId) filter.parentSellerId = parentSellerId;

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      UserModel.find(filter)
        .select("email phone role accountStatus profile sellerProfile allowedModules createdBy createdByRole parentAdminId parentSellerId hierarchyLevel ownerAdminId ownerSellerId createdAt updatedAt lastLoginAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      UserModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  async listUsers({ q = "", role = null, roles = null, accountStatus = null, status = null, emailVerified = null, page = 1, limit = 50, ownerAdminId = null, ownerSellerId = null, parentAdminId = null, parentSellerId = null, createdBy = null } = {}) {
    const filter = {};
    if (Array.isArray(roles) && roles.length) {
      filter.role = { $in: roles };
    } else if (role) {
      filter.role = role;
    }
    if (accountStatus || status) {
      filter.accountStatus = accountStatus || status;
    }
    if (emailVerified !== null && emailVerified !== undefined) {
      filter.emailVerified = emailVerified === true || emailVerified === "true";
    }
    if (q) {
      filter.$or = [
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { "profile.firstName": { $regex: q, $options: "i" } },
        { "profile.lastName": { $regex: q, $options: "i" } },
      ];
    }
    if (ownerAdminId) filter.ownerAdminId = ownerAdminId;
    if (ownerSellerId) filter.ownerSellerId = ownerSellerId;
    if (parentAdminId) filter.parentAdminId = parentAdminId;
    if (parentSellerId) filter.parentSellerId = parentSellerId;
    if (createdBy) filter.createdBy = createdBy;

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      UserModel.find(filter)
        .select("email phone role accountStatus emailVerified profile sellerProfile allowedModules createdBy createdByRole parentAdminId parentSellerId hierarchyLevel ownerAdminId ownerSellerId createdAt updatedAt lastLoginAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      UserModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  async getUserById(userId) {
    return UserModel.findById(userId).select("-passwordHash -refreshSessions.tokenHash");
  }

  async findSellerKycBySellerIds(sellerIds = []) {
    const normalizedIds = sellerIds.map(String).filter(Boolean);
    if (!normalizedIds.length) {
      return [];
    }

    const { rows } = await postgresPool.query(
      `SELECT
         seller_id,
         verification_status,
         rejection_reason,
         submitted_at,
         reviewed_at,
         reviewed_by,
         legal_name,
         business_type,
         pan_number,
         gst_number,
         aadhaar_number,
         documents
       FROM seller_kyc
       WHERE seller_id = ANY($1::text[])`,
      [normalizedIds],
    );
    return rows;
  }

  async getSellerKycById(sellerId) {
    const { rows } = await postgresPool.query(
      `SELECT * FROM seller_kyc WHERE seller_id = $1 LIMIT 1`,
      [String(sellerId)],
    );
    return rows[0] || null;
  }

  async updateUserById(userId, payload) {
    const invalidationReason = invalidationReasonForUserPayload(payload);
    const update = {
      $set: {
        ...(payload.accountStatus ? { accountStatus: payload.accountStatus } : {}),
        ...(payload.role ? { role: payload.role } : {}),
        ...(payload.phone !== undefined ? { phone: payload.phone } : {}),
        ...(payload.profile ? { profile: payload.profile } : {}),
        ...(payload.sellerProfile ? { sellerProfile: payload.sellerProfile } : {}),
        ...(payload.allowedModules ? { allowedModules: payload.allowedModules } : {}),
        ...(payload.createdBy !== undefined ? { createdBy: payload.createdBy } : {}),
        ...(payload.createdByRole !== undefined ? { createdByRole: payload.createdByRole } : {}),
        ...(payload.parentAdminId !== undefined ? { parentAdminId: payload.parentAdminId } : {}),
        ...(payload.parentSellerId !== undefined ? { parentSellerId: payload.parentSellerId } : {}),
        ...(payload.hierarchyLevel !== undefined ? { hierarchyLevel: payload.hierarchyLevel } : {}),
        ...(payload.ownerAdminId !== undefined ? { ownerAdminId: payload.ownerAdminId } : {}),
        ...(payload.ownerSellerId !== undefined ? { ownerSellerId: payload.ownerSellerId } : {}),
        ...statusSessionFields(payload.accountStatus),
      },
    };
    return UserModel.findByIdAndUpdate(
      userId,
      invalidationReason
        ? mergeMongoUpdates(update, makeSessionInvalidationUpdate(invalidationReason))
        : update,
      {
      new: true,
      },
    ).select("-passwordHash -refreshSessions.tokenHash");
  }

  async deactivateUserById(userId, reason = null) {
    return UserModel.findByIdAndUpdate(
      userId,
      mergeMongoUpdates(
        {
          $set: {
            accountStatus: "suspended",
            deactivatedAt: new Date(),
            blockedAt: new Date(),
            deactivationReason: reason || null,
            refreshSessions: [],
          },
        },
        makeSessionInvalidationUpdate(SESSION_INVALIDATION_REASONS.ACCOUNT_STATUS_CHANGED),
      ),
      { new: true },
    ).select("-passwordHash -refreshSessions.tokenHash");
  }

  async updateVendorStatus(sellerId, payload) {
    const accountStatus = payload.accountStatus;
    return UserModel.findByIdAndUpdate(
      sellerId,
      mergeMongoUpdates(
        {
          $set: {
            accountStatus,
            ...(payload.onboardingStatus
              ? { "sellerProfile.onboardingStatus": payload.onboardingStatus }
              : {}),
            ...statusSessionFields(accountStatus),
          },
        },
        makeSessionInvalidationUpdate(SESSION_INVALIDATION_REASONS.ACCOUNT_STATUS_CHANGED),
      ),
      { new: true },
    ).select("-passwordHash -refreshSessions.tokenHash");
  }

  async reviewSellerKycByAdmin(sellerId, payload) {
    const { rows } = await postgresPool.query(
      `UPDATE seller_kyc
       SET verification_status = $2,
           rejection_reason = $3,
           reviewed_by = $4,
           reviewed_at = NOW()
       WHERE seller_id = $1
       RETURNING *`,
      [sellerId, payload.kycStatus, payload.rejectionReason || null, payload.reviewedBy || null],
    );
    return rows[0] || null;
  }

  async listProductsForModeration({
    status = "pending_approval",
    category = null,
    q = "",
    keyWord = "",
    search = "",
    sellerId = null,
    productType = null,
    dateFrom = null,
    dateTo = null,
    createdFrom = null,
    createdTo = null,
    limit = 50,
    page = 1,
    sortBy = "createdAt",
    sortDir = "desc",
  } = {}) {
    const filter = status === "change_pending"
      ? { revisionStatus: "change_pending" }
      : { status };
    if (category) {
      filter.category = category;
    }
    if (sellerId) filter.sellerId = sellerId;
    if (productType) filter.productType = productType;

    const searchTerm = q || keyWord || search;
    if (searchTerm) {
      const regex = new RegExp(escapeRegExp(searchTerm), "i");
      filter.$or = [
        { title: regex },
        { description: regex },
        { sku: regex },
        { brand: regex },
        { tags: regex },
      ];
    }

    const createdAt = buildCreatedAtRange({ dateFrom, dateTo, createdFrom, createdTo });
    if (createdAt) filter.createdAt = createdAt;

    const direction = sortDir === "asc" ? 1 : -1;
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      title: { title: direction },
      sku: { sku: direction },
      stock: { stock: direction },
      createdAt: { createdAt: direction },
      updatedAt: { updatedAt: direction },
    };
    const sort = sortMap[sortBy] || { createdAt: -1 };
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ProductModel.find(filter).sort(sort).skip(skip).limit(Number(limit)),
      ProductModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async listOrders({
    status = null,
    paymentStatus = null,
    deliveryStatus = null,
    sellerId = null,
    buyerId = null,
    search = null,
    fromDate = null,
    toDate = null,
    limit = 50,
    offset = 0,
  } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (status) {
      clauses.push(`orders.status = $${idx++}`);
      values.push(status);
    }
    if (paymentStatus) {
      clauses.push(`orders.payment_status = $${idx++}`);
      values.push(paymentStatus);
    }
    if (deliveryStatus) {
      clauses.push(`orders.delivery_status = $${idx++}`);
      values.push(deliveryStatus);
    }
    if (buyerId) {
      clauses.push(`orders.buyer_id = $${idx++}`);
      values.push(buyerId);
    }
    if (sellerId) {
      clauses.push(`EXISTS (
        SELECT 1
        FROM order_items oi
        WHERE oi.order_id = orders.id
          AND oi.seller_id = $${idx++}
      )`);
      values.push(sellerId);
    }
    if (search) {
      clauses.push(`(orders.order_number ILIKE $${idx} OR orders.id::text ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx += 1;
    }
    if (fromDate) {
      clauses.push(`orders.created_at >= $${idx++}`);
      values.push(fromDate);
    }
    if (toDate) {
      clauses.push(`orders.created_at <= $${idx++}`);
      values.push(toDate);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const pagingValues = [...values, limit, offset];

    const [listResult, countResult] = await Promise.all([
      postgresPool.query(
      `SELECT *
       FROM orders
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${idx++}
       OFFSET $${idx}`,
        pagingValues,
      ),
      postgresPool.query(
        `SELECT COUNT(*)::INT AS total
         FROM orders
         ${whereSql}`,
        values,
      ),
    ]);
    return {
      list: listResult.rows,
      total: Number(countResult.rows[0]?.total || 0),
    };
  }

  async listPayments({ status = null, provider = null, fromDate = null, toDate = null, limit = 50, offset = 0 } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (status) {
      clauses.push(`status = $${idx++}`);
      values.push(status);
    }
    if (provider) {
      clauses.push(`provider = $${idx++}`);
      values.push(provider);
    }
    if (fromDate) {
      clauses.push(`created_at >= $${idx++}`);
      values.push(fromDate);
    }
    if (toDate) {
      clauses.push(`created_at <= $${idx++}`);
      values.push(toDate);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit, offset);

    const { rows } = await postgresPool.query(
      `SELECT *
       FROM payments
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${idx++}
       OFFSET $${idx}`,
      values,
    );
    return rows;
  }

  async createPayout(payload) {
    const { rows } = await postgresPool.query(
      `INSERT INTO vendor_payouts (
        id, seller_id, period_start, period_end, gross_amount, commission_amount,
        processing_fee_amount, tax_withheld_amount, net_payout_amount, currency, status,
        scheduled_at, metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      )
      RETURNING *`,
      [
        uuidv4(),
        payload.sellerId,
        payload.periodStart,
        payload.periodEnd,
        payload.grossAmount,
        payload.commissionAmount || 0,
        payload.processingFeeAmount || 0,
        payload.taxWithheldAmount || 0,
        payload.netPayoutAmount,
        payload.currency || "INR",
        payload.status || "scheduled",
        payload.scheduledAt || new Date(),
        payload.metadata || {},
      ],
    );
    return rows[0];
  }

  async listPayouts({ sellerId = null, status = null, fromDate = null, toDate = null, limit = 50, offset = 0 } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (sellerId) {
      clauses.push(`seller_id = $${idx++}`);
      values.push(sellerId);
    }
    if (status) {
      clauses.push(`status = $${idx++}`);
      values.push(status);
    }
    if (fromDate) {
      clauses.push(`created_at >= $${idx++}`);
      values.push(fromDate);
    }
    if (toDate) {
      clauses.push(`created_at <= $${idx++}`);
      values.push(toDate);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit, offset);

    const { rows } = await postgresPool.query(
      `SELECT *
       FROM vendor_payouts
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${idx++}
       OFFSET $${idx}`,
      values,
    );
    return rows;
  }

  async createApiKey({ ownerId, keyName, scopes = [], expiresAt = null }) {
    const rawKey = `mkp_${randomBytes(24).toString("hex")}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = await hashText(rawKey);

    const { rows } = await postgresPool.query(
      `INSERT INTO api_keys (
        id, owner_id, key_name, key_prefix, key_hash, scopes, status, expires_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()
      )
      RETURNING id, owner_id, key_name, key_prefix, scopes, status, expires_at, created_at`,
      [uuidv4(), ownerId, keyName, keyPrefix, keyHash, scopes, "active", expiresAt],
    );

    return { record: rows[0], rawKey };
  }

  async listApiKeys({ ownerId = null, status = null, limit = 50, offset = 0 } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (ownerId) {
      clauses.push(`owner_id = $${idx++}`);
      values.push(ownerId);
    }
    if (status) {
      clauses.push(`status = $${idx++}`);
      values.push(status);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit, offset);

    const { rows } = await postgresPool.query(
      `SELECT id, owner_id, key_name, key_prefix, scopes, status, expires_at, last_used_at, created_at
       FROM api_keys
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${idx++}
       OFFSET $${idx}`,
      values,
    );
    return rows;
  }

  async createWebhookSubscription({ ownerId, endpointUrl, secret, eventTypes = [], retryPolicy = {} }) {
    const secretHash = await hashText(secret);
    const { rows } = await postgresPool.query(
      `INSERT INTO webhook_subscriptions (
        id, owner_id, endpoint_url, secret_hash, event_types, status, retry_policy, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,NOW(),NOW()
      )
      RETURNING id, owner_id, endpoint_url, event_types, status, retry_policy, created_at`,
      [uuidv4(), ownerId, endpointUrl, secretHash, eventTypes, "active", retryPolicy],
    );
    return rows[0];
  }

  async listWebhookSubscriptions({ ownerId = null, status = null, limit = 50, offset = 0 } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (ownerId) {
      clauses.push(`owner_id = $${idx++}`);
      values.push(ownerId);
    }
    if (status) {
      clauses.push(`status = $${idx++}`);
      values.push(status);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit, offset);

    const { rows } = await postgresPool.query(
      `SELECT id, owner_id, endpoint_url, event_types, status, retry_policy, last_delivery_at, created_at
       FROM webhook_subscriptions
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${idx++}
       OFFSET $${idx}`,
      values,
    );

    return rows;
  }

  async createManagedUser(payload) {
    return UserModel.create(payload);
  }

  async findUserByEmail(email) {
    return UserModel.findOne({ email });
  }

  async listSubAdmins({
    ownerAdminId = null,
    ownerSellerId = null,
    roles = ["sub-admin"],
    q = "",
    status = null,
    page = 1,
    limit = 100,
  } = {}) {
    const filter = { role: { $in: roles } };
    if (ownerAdminId) {
      filter.ownerAdminId = ownerAdminId;
    }
    if (ownerSellerId) {
      filter.ownerSellerId = ownerSellerId;
    }
    if (status) filter.accountStatus = status;
    if (q) {
      filter.$or = [
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { "profile.firstName": { $regex: q, $options: "i" } },
        { "profile.lastName": { $regex: q, $options: "i" } },
        { role: { $regex: q, $options: "i" } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      UserModel.find(filter)
        .select("email phone role profile accountStatus allowedModules createdBy createdByRole parentAdminId parentSellerId hierarchyLevel ownerAdminId ownerSellerId createdAt updatedAt lastLoginAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      UserModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async updateSubAdminModules(userId, ownerAdminId, allowedModules, roles = ["sub-admin"], ownerSellerId = null) {
    const filter = { _id: userId, role: { $in: roles } };
    if (ownerAdminId) {
      filter.ownerAdminId = ownerAdminId;
    }
    if (ownerSellerId) {
      filter.ownerSellerId = ownerSellerId;
    }

    return UserModel.findOneAndUpdate(
      filter,
      mergeMongoUpdates(
        { $set: { allowedModules } },
        makeSessionInvalidationUpdate(SESSION_INVALIDATION_REASONS.PERMISSIONS_CHANGED),
      ),
      { new: true },
    ).select("email phone role profile accountStatus allowedModules createdBy createdByRole parentAdminId parentSellerId hierarchyLevel ownerAdminId ownerSellerId createdAt updatedAt lastLoginAt");
  }

  async upsertFeatureFlag({ flagKey, description, enabled, rolloutPercentage, targetRules, actorId }) {
    const { rows } = await postgresPool.query(
      `INSERT INTO feature_flag_rollouts (
        id, flag_key, description, enabled, rollout_percentage, target_rules, created_by, updated_by, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()
      )
      ON CONFLICT (flag_key) DO UPDATE SET
        description = EXCLUDED.description,
        enabled = EXCLUDED.enabled,
        rollout_percentage = EXCLUDED.rollout_percentage,
        target_rules = EXCLUDED.target_rules,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING *`,
      [uuidv4(), flagKey, description || null, enabled, rolloutPercentage, targetRules || {}, actorId, actorId],
    );

    await postgresPool.query(
      `INSERT INTO config_change_history (
        id, config_key, previous_value, new_value, changed_by, reason, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,NOW()
      )`,
      [
        uuidv4(),
        `feature_flag:${flagKey}`,
        null,
        {
          enabled,
          rolloutPercentage,
          targetRules: targetRules || {},
        },
        actorId,
        "feature_flag_update",
      ],
    );

    return rows[0];
  }

  async listFeatureFlags({ enabled = null, limit = 100, offset = 0 } = {}) {
    const values = [];
    let whereSql = "";
    if (enabled !== null && enabled !== undefined) {
      values.push(enabled);
      whereSql = `WHERE enabled = $1`;
    }
    values.push(limit, offset);
    const limIdx = values.length - 1;
    const offIdx = values.length;

    const { rows } = await postgresPool.query(
      `SELECT *
       FROM feature_flag_rollouts
       ${whereSql}
       ORDER BY updated_at DESC
       LIMIT $${limIdx}
       OFFSET $${offIdx}`,
      values,
    );
    return rows;
  }

  async getRealtimeAnalytics({ hours = 24 } = {}) {
    const windowHours = Number(hours) > 0 ? Number(hours) : 24;
    const [ordersResult, paymentsResult, userResult] = await Promise.all([
      postgresPool.query(
        `SELECT
           COUNT(*)::INT AS order_count,
           COALESCE(SUM(total_amount), 0)::NUMERIC AS gmv
         FROM orders
         WHERE created_at >= NOW() - ($1::TEXT || ' hours')::INTERVAL`,
        [String(windowHours)],
      ),
      postgresPool.query(
        `SELECT
           COUNT(*)::INT AS payment_count,
           COALESCE(SUM(amount), 0)::NUMERIC AS amount_collected
         FROM payments
         WHERE status = 'captured'
           AND created_at >= NOW() - ($1::TEXT || ' hours')::INTERVAL`,
        [String(windowHours)],
      ),
      UserModel.countDocuments({
        createdAt: { $gte: new Date(Date.now() - windowHours * 60 * 60 * 1000) },
      }),
    ]);

    return {
      windowHours,
      orders: {
        count: Number(ordersResult.rows[0]?.order_count || 0),
        gmv: Number(ordersResult.rows[0]?.gmv || 0),
      },
      payments: {
        count: Number(paymentsResult.rows[0]?.payment_count || 0),
        collectedAmount: Number(paymentsResult.rows[0]?.amount_collected || 0),
      },
      users: {
        newRegistrations: Number(userResult || 0),
      },
    };
  }

  async getReturnsAnalytics({ fromDate = null, toDate = null } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (fromDate) {
      clauses.push(`requested_at >= $${idx++}`);
      values.push(fromDate);
    }
    if (toDate) {
      clauses.push(`requested_at <= $${idx++}`);
      values.push(toDate);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [summaryResult, reasonResult] = await Promise.all([
      postgresPool.query(
        `SELECT
          COUNT(*)::INT AS total_requests,
          COUNT(*) FILTER (WHERE status = 'requested')::INT AS requested,
          COUNT(*) FILTER (WHERE status = 'approved')::INT AS approved,
          COUNT(*) FILTER (WHERE status = 'rejected')::INT AS rejected,
          COALESCE(SUM(refund_amount), 0)::NUMERIC AS refund_amount
         FROM return_requests
         ${whereSql}`,
        values,
      ),
      postgresPool.query(
        `SELECT reason_code, COUNT(*)::INT AS count
         FROM return_requests
         ${whereSql}
         GROUP BY reason_code
         ORDER BY count DESC`,
        values,
      ),
    ]);

    return {
      summary: {
        totalRequests: Number(summaryResult.rows[0]?.total_requests || 0),
        requested: Number(summaryResult.rows[0]?.requested || 0),
        approved: Number(summaryResult.rows[0]?.approved || 0),
        rejected: Number(summaryResult.rows[0]?.rejected || 0),
        refundAmount: Number(summaryResult.rows[0]?.refund_amount || 0),
      },
      reasons: reasonResult.rows.map((row) => ({
        reasonCode: row.reason_code,
        count: Number(row.count || 0),
      })),
    };
  }

  async listChargebacks({ status = null, fromDate = null, toDate = null, limit = 50, offset = 0 } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (status) {
      clauses.push(`representment_status = $${idx++}`);
      values.push(status);
    }
    if (fromDate) {
      clauses.push(`opened_at >= $${idx++}`);
      values.push(fromDate);
    }
    if (toDate) {
      clauses.push(`opened_at <= $${idx++}`);
      values.push(toDate);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit, offset);
    const countValues = values.slice(0, values.length - 2);

    const [rowsResult, totalResult] = await Promise.all([
      postgresPool.query(
        `SELECT *
         FROM chargebacks
         ${whereSql}
         ORDER BY opened_at DESC
         LIMIT $${idx++}
         OFFSET $${idx}`,
        values,
      ),
      postgresPool.query(`SELECT COUNT(*)::INT AS total FROM chargebacks ${whereSql}`, countValues),
    ]);

    return { items: rowsResult.rows, total: Number(totalResult.rows[0]?.total || 0) };
  }

  async listDeadLetterEvents({ status = null, eventType = null, limit = 50, offset = 0 } = {}) {
    const values = [];
    const clauses = [];
    let idx = 1;

    if (status) {
      clauses.push(`status = $${idx++}`);
      values.push(status);
    }
    if (eventType) {
      clauses.push(`event_type = $${idx++}`);
      values.push(eventType);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(limit, offset);
    const countValues = values.slice(0, values.length - 2);

    const [rowsResult, totalResult] = await Promise.all([
      postgresPool.query(
        `SELECT *
         FROM dead_letter_events
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT $${idx++}
         OFFSET $${idx}`,
        values,
      ),
      postgresPool.query(`SELECT COUNT(*)::INT AS total FROM dead_letter_events ${whereSql}`, countValues),
    ]);

    return { items: rowsResult.rows, total: Number(totalResult.rows[0]?.total || 0) };
  }

  async retryDeadLetterEvent(eventId) {
    const existing = await postgresPool.query("SELECT * FROM dead_letter_events WHERE id = $1 LIMIT 1", [eventId]);
    if (!existing.rows[0]) {
      return null;
    }
    const event = existing.rows[0];

    await postgresPool.query(
      `INSERT INTO outbox_events (
        id, event_name, aggregate_id, version, payload, occurred_at, status
      ) VALUES (
        $1,$2,$3,$4,$5,NOW(),'pending'
      )`,
      [uuidv4(), event.event_type, event.aggregate_id, 1, event.payload || {}],
    );

    const { rows } = await postgresPool.query(
      `UPDATE dead_letter_events
       SET status = 'retry_scheduled',
           retry_count = retry_count + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [eventId],
    );

    return rows[0];
  }

  async discardDeadLetterEvent(eventId, reason = null) {
    const { rows } = await postgresPool.query(
      `UPDATE dead_letter_events
       SET status = 'discarded',
           updated_at = NOW(),
           last_error = COALESCE($2, last_error)
       WHERE id = $1
       RETURNING *`,
      [eventId, reason],
    );
    return rows[0] || null;
  }
}

module.exports = { AdminRepository };
