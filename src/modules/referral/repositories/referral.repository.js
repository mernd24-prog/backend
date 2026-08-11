const {
  ReferralModel,
  InfluencerAccountModel,
  InfluencerProfileModel,
  InfluencerCodeModel,
  ReferralCodeModel,
  ReferralOrderModel,
  ReferralCommissionLedgerModel,
  InfluencerWalletModel,
  InfluencerPayoutRequestModel,
  ReferralCommissionRuleModel,
  ReferralProductConfigModel,
  ReferralFraudReviewModel,
  InfluencerBonusRuleModel,
  InfluencerBonusAchievementModel,
} = require("../models/referral.model");
const { UserModel } = require("../../user/models/user.model");
const { UserRepository } = require("../../user/repositories/user.repository");

class ReferralRepository {
  constructor({ userRepository = new UserRepository() } = {}) {
    this.userRepository = userRepository;
  }

  async findReferrerByCode(referralCode) {
    return this.userRepository.findByReferralCode(referralCode);
  }

  async createReward(payload) {
    return ReferralModel.create(payload);
  }

  async findByRefereeUserId(refereeUserId) {
    return ReferralModel.findOne({ refereeUserId });
  }

  async listProductConfigs({ q = "", productId = null, active = null, page = 1, limit = 50 } = {}) {
    const filter = {};
    if (productId) filter.productId = String(productId);
    if (active !== null && active !== undefined) filter.active = active;
    if (q) {
      filter.$or = [
        { productId: { $regex: q, $options: "i" } },
        { variantId: { $regex: q, $options: "i" } },
        { "metadata.productTitle": { $regex: q, $options: "i" } },
        { "metadata.variantTitle": { $regex: q, $options: "i" } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ReferralProductConfigModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)),
      ReferralProductConfigModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async getProductConfigById(configId) {
    return ReferralProductConfigModel.findById(configId);
  }

  async listProductConfigsForItems(productIds = []) {
    const ids = Array.from(new Set(productIds.map(String).filter(Boolean)));
    if (!ids.length) return [];
    return ReferralProductConfigModel.find({ productId: { $in: ids } });
  }

  async upsertProductConfig(payload) {
    return ReferralProductConfigModel.findOneAndUpdate(
      { productId: String(payload.productId), variantId: payload.variantId ? String(payload.variantId) : null },
      { $set: payload },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }

  async deleteProductConfig(configId) {
    return ReferralProductConfigModel.findByIdAndDelete(configId);
  }

  async createUser(payload) {
    return UserModel.create(payload);
  }

  async createInfluencerAccount(payload) {
    return InfluencerAccountModel.create(payload);
  }

  async getInfluencerAccountById(accountId, { includeSecrets = false } = {}) {
    const query = InfluencerAccountModel.findById(accountId);
    if (!includeSecrets) query.select("-passwordHash -refreshSessions.tokenHash");
    return query;
  }

  async findInfluencerAccountByEmail(email, { includeSecrets = false } = {}) {
    const query = InfluencerAccountModel.findOne({
      email: String(email || "").trim().toLowerCase(),
    });
    if (!includeSecrets) query.select("-passwordHash -refreshSessions.tokenHash");
    return query;
  }

  async updateInfluencerAccount(accountId, update) {
    return InfluencerAccountModel.findByIdAndUpdate(accountId, update, { new: true });
  }

  async updateInfluencerAccountRefreshSessions(accountId, refreshSessions) {
    return this.updateInfluencerAccount(accountId, { $set: { refreshSessions } });
  }

  async updateInfluencerAccountLastLogin(accountId, lastLoginAt) {
    return this.updateInfluencerAccount(accountId, { $set: { lastLoginAt } });
  }

  async getUserById(userId) {
    return UserModel.findById(userId).select("-passwordHash -refreshSessions.tokenHash");
  }

  async listUsersByIds(userIds = []) {
    const ids = Array.from(new Set(userIds.map(String).filter(Boolean)));
    if (!ids.length) return [];
    return UserModel.find({ _id: { $in: ids } }).select(
      "email phone role profile accountStatus createdAt updatedAt",
    );
  }

  async createInfluencerProfile(payload) {
    return InfluencerProfileModel.create(payload);
  }

  async updateInfluencerProfile(influencerId, payload) {
    return InfluencerProfileModel.findByIdAndUpdate(
      influencerId,
      { $set: payload },
      { new: true },
    );
  }

  async getInfluencerProfileById(influencerId) {
    return InfluencerProfileModel.findById(influencerId);
  }

  async getInfluencerProfileByUserId(userId) {
    return InfluencerProfileModel.findOne({ userId: String(userId) });
  }

  async getInfluencerProfileByAccountId(accountId) {
    return InfluencerProfileModel.findOne({ accountId: String(accountId) });
  }

  async listInfluencerProfiles({
    q = "",
    status = null,
    influencerType = null,
    parentInfluencerId = null,
    canCreateChildren = null,
    page = 1,
    limit = 50,
  } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (influencerType) filter.influencerType = influencerType;
    if (parentInfluencerId) filter.parentInfluencerId = parentInfluencerId;
    if (canCreateChildren !== null && canCreateChildren !== undefined) {
      filter.canCreateChildren = canCreateChildren;
    }

    if (q) {
      const codeRows = await InfluencerCodeModel.find({
        code: { $regex: q, $options: "i" },
      }).select("influencerId");
      const influencerIdsFromCodes = codeRows.map((code) => String(code.influencerId));
      const identityFilter = {
        $or: [
          { email: { $regex: q, $options: "i" } },
          { phone: { $regex: q, $options: "i" } },
          { "profile.firstName": { $regex: q, $options: "i" } },
          { "profile.lastName": { $regex: q, $options: "i" } },
        ],
      };
      const [accounts, users] = await Promise.all([
        InfluencerAccountModel.find(identityFilter).select("_id"),
        UserModel.find(identityFilter).select("_id"),
      ]);
      const accountIds = accounts.map((account) => String(account._id));
      const userIds = users.map((user) => String(user._id));
      const orFilters = [];
      if (accountIds.length) orFilters.push({ accountId: { $in: accountIds } });
      if (userIds.length) orFilters.push({ userId: { $in: userIds } });
      if (influencerIdsFromCodes.length) {
        orFilters.push({ _id: { $in: influencerIdsFromCodes } });
      }
      if (q.match(/^[a-f\d]{24}$/i)) orFilters.push({ _id: q });
      if (orFilters.length) {
        filter.$or = orFilters;
      } else {
        filter.$or = [{ accountId: { $in: accountIds } }, { userId: { $in: userIds } }];
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      InfluencerProfileModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      InfluencerProfileModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  async listAllInfluencerProfiles() {
    return InfluencerProfileModel.find({}).sort({ level: 1, createdAt: 1 });
  }

  async createReferralCode(payload) {
    return ReferralCodeModel.create(payload);
  }

  async getReferralCodeById(codeId) {
    return ReferralCodeModel.findById(codeId);
  }

  async getReferralCodeByCode(code) {
    return ReferralCodeModel.findOne({ code: String(code || "").toUpperCase() });
  }

  async getPrimaryReferralCode(influencerId) {
    return ReferralCodeModel.findOne({ influencerId: String(influencerId) }).sort({
      createdAt: 1,
    });
  }

  async listReferralCodes({
    q = "",
    code = null,
    influencerId = null,
    status = null,
    fromDate = null,
    toDate = null,
    page = 1,
    limit = 50,
  } = {}) {
    const filter = {};
    if (influencerId) filter.influencerId = influencerId;
    if (status) filter.status = status;
    if (code) filter.code = String(code).toUpperCase();
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    if (q) {
      filter.$or = [
        { code: { $regex: q, $options: "i" } },
        { influencerId: { $regex: q, $options: "i" } },
        { userId: { $regex: q, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ReferralCodeModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      ReferralCodeModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  async getOrderIdsForCode({ influencerId = null, code = null } = {}) {
    const filter = {};
    if (influencerId) filter.codeOwnerInfluencerId = String(influencerId);
    if (code) filter.code = String(code).toUpperCase();
    if (!filter.code && !filter.codeOwnerInfluencerId) return [];

    return ReferralOrderModel.distinct("orderId", filter);
  }

  async aggregateCodeStats(influencerId, codes = []) {
    const normalizedCodes = Array.from(
      new Set(codes.map((code) => String(code || "").toUpperCase()).filter(Boolean)),
    );
    if (!normalizedCodes.length) return new Map();

    const orderRows = await ReferralOrderModel.aggregate([
      {
        $match: {
          codeOwnerInfluencerId: String(influencerId),
          code: { $in: normalizedCodes },
        },
      },
      {
        $group: {
          _id: "$code",
          totalOrders: { $sum: 1 },
          totalSalesAmount: { $sum: "$eligibleAmount" },
          customerDiscountAmount: { $sum: "$discountAmount" },
          orderIds: { $addToSet: "$orderId" },
        },
      },
    ]);

    const orderCodeById = new Map();
    orderRows.forEach((row) => {
      (row.orderIds || []).forEach((orderId) => {
        orderCodeById.set(String(orderId), String(row._id));
      });
    });

    const ledgerRows = orderCodeById.size
      ? await ReferralCommissionLedgerModel.aggregate([
          {
            $match: {
              influencerId: String(influencerId),
              orderId: { $in: Array.from(orderCodeById.keys()) },
              commissionType: { $nin: ["reversal", "withdrawal", "coin_expiry"] },
              status: { $ne: "reversed" },
            },
          },
          {
            $group: {
              _id: "$orderId",
              coinsEarned: { $sum: "$amount" },
            },
          },
        ])
      : [];

    const statsByCode = new Map(
      normalizedCodes.map((code) => [
        code,
        {
          totalOrders: 0,
          totalSalesAmount: 0,
          customerDiscountAmount: 0,
          totalCoinsEarned: 0,
        },
      ]),
    );

    orderRows.forEach((row) => {
      statsByCode.set(String(row._id), {
        ...statsByCode.get(String(row._id)),
        totalOrders: Number(row.totalOrders || 0),
        totalSalesAmount: Number(row.totalSalesAmount || 0),
        customerDiscountAmount: Number(row.customerDiscountAmount || 0),
        totalCoinsEarned: 0,
      });
    });

    ledgerRows.forEach((row) => {
      const code = orderCodeById.get(String(row._id));
      if (!code) return;
      const current = statsByCode.get(code) || {};
      current.totalCoinsEarned =
        Number(current.totalCoinsEarned || 0) + Number(row.coinsEarned || 0);
      statsByCode.set(code, current);
    });

    return statsByCode;
  }

  async updateReferralCode(codeId, payload) {
    return ReferralCodeModel.findByIdAndUpdate(
      codeId,
      { $set: payload },
      { new: true },
    );
  }

  async incrementReferralCodeUsage(codeId) {
    return ReferralCodeModel.findByIdAndUpdate(
      codeId,
      { $inc: { usageCount: 1 } },
      { new: true },
    );
  }

  async createReferralOrder(payload) {
    return ReferralOrderModel.create(payload);
  }

  async getReferralOrderByOrderId(orderId) {
    return ReferralOrderModel.findOne({ orderId: String(orderId) });
  }

  async updateReferralOrderByOrderId(orderId, payload) {
    return ReferralOrderModel.findOneAndUpdate(
      { orderId: String(orderId) },
      { $set: payload },
      { new: true },
    );
  }

  async listCommissionLedgerByReferralOrder(referralOrderId) {
    return ReferralCommissionLedgerModel.find({
      referralOrderId: String(referralOrderId),
    });
  }

  async updateCommissionLedgerEntry(entryId, payload) {
    return ReferralCommissionLedgerModel.findByIdAndUpdate(
      entryId,
      { $set: payload },
      { new: true },
    );
  }

  async listMaturedCommissionLedger(influencerId, now = new Date()) {
    const ledgers = await ReferralCommissionLedgerModel.find({
      influencerId: String(influencerId),
      status: { $in: ["pending", "locked"] },
      releaseAt: { $lte: now },
    }).limit(500);
    if (!ledgers.length) return [];
    const completedOrders = await ReferralOrderModel.find({
      _id: { $in: ledgers.map((entry) => entry.referralOrderId) },
      status: "completed",
    }).select("_id");
    const completedIds = new Set(completedOrders.map((order) => String(order._id)));
    return ledgers.filter((entry) => completedIds.has(String(entry.referralOrderId)));
  }

  async claimCommissionAsAvailable(entryId) {
    return ReferralCommissionLedgerModel.findOneAndUpdate(
      { _id: entryId, status: { $in: ["pending", "locked"] } },
      { $set: { status: "available" } },
      { new: true },
    );
  }

  async updateReferralCodesByInfluencer(influencerId, payload) {
    return ReferralCodeModel.updateMany(
      { influencerId: String(influencerId) },
      { $set: payload },
    );
  }

  async ensureWallet(influencerId) {
    return InfluencerWalletModel.findOneAndUpdate(
      { influencerId: String(influencerId) },
      { $setOnInsert: { influencerId: String(influencerId) } },
      { upsert: true, new: true },
    );
  }

  async getWallet(influencerId) {
    return InfluencerWalletModel.findOne({ influencerId: String(influencerId) });
  }

  async updateWallet(influencerId, update) {
    return InfluencerWalletModel.findOneAndUpdate(
      { influencerId: String(influencerId) },
      update,
      { upsert: true, new: true },
    );
  }

  async reserveAvailableWalletBalance(influencerId, amount) {
    return InfluencerWalletModel.findOneAndUpdate(
      {
        influencerId: String(influencerId),
        availableBalance: { $gte: Number(amount) },
      },
      {
        $inc: {
          availableBalance: -Number(amount),
          reservedBalance: Number(amount),
        },
      },
      { new: true },
    );
  }

  async releaseReservedWalletBalance(influencerId, amount) {
    return InfluencerWalletModel.findOneAndUpdate(
      {
        influencerId: String(influencerId),
        reservedBalance: { $gte: Number(amount) },
      },
      {
        $inc: {
          reservedBalance: -Number(amount),
          availableBalance: Number(amount),
        },
      },
      { new: true },
    );
  }

  async settleReservedWalletBalance(influencerId, amount) {
    return InfluencerWalletModel.findOneAndUpdate(
      {
        influencerId: String(influencerId),
        reservedBalance: { $gte: Number(amount) },
      },
      {
        $inc: {
          reservedBalance: -Number(amount),
          paidBalance: Number(amount),
        },
      },
      { new: true },
    );
  }

  async getLedgerOrderIdsForInfluencer({
    influencerId,
    coinStatus = null,
    code = null,
  } = {}) {
    if (!influencerId) return [];

    const filter = {
      influencerId: String(influencerId),
      orderId: { $not: /^bonus:/ },
    };
    if (coinStatus === "locked") {
      filter.status = { $in: ["pending", "locked"] };
    } else if (coinStatus === "available") {
      filter.status = { $in: ["available", "payout_requested", "paid"] };
    } else if (coinStatus === "reversed") {
      filter.$or = [{ status: "reversed" }, { commissionType: "reversal" }];
    }
    if (code) {
      const codeOrderIds = await this.getOrderIdsForCode({ code });
      if (!codeOrderIds.length) return [];
      filter.orderId = { $in: codeOrderIds };
    }

    return ReferralCommissionLedgerModel.distinct("orderId", filter);
  }

  async listReferralOrders({
    q = "",
    status = null,
    coinStatus = null,
    code = null,
    influencerId = null,
    participantInfluencerId = null,
    relationshipScope = "all",
    customerId = null,
    fromDate = null,
    toDate = null,
    page = 1,
    limit = 50,
  } = {}) {
    const filter = {};
    const andFilters = [];
    if (status) filter.status = status;
    if (code) filter.code = String(code).toUpperCase();
    if (influencerId) filter.codeOwnerInfluencerId = influencerId;
    if (participantInfluencerId) {
      const participantId = String(participantInfluencerId);
      const ledgerOrderIds = await this.getLedgerOrderIdsForInfluencer({
        influencerId: participantId,
        coinStatus,
        code,
      });
      if (relationshipScope === "own") {
        filter.codeOwnerInfluencerId = participantId;
        if (coinStatus) filter.orderId = { $in: ledgerOrderIds };
      } else if (relationshipScope === "children") {
        filter.directParentInfluencerId = participantId;
        if (coinStatus) filter.orderId = { $in: ledgerOrderIds };
      } else if (coinStatus) {
        filter.orderId = { $in: ledgerOrderIds };
      } else {
        andFilters.push({
          $or: [
            { codeOwnerInfluencerId: participantId },
            { directParentInfluencerId: participantId },
            { overrideInfluencerId: participantId },
            { orderId: { $in: ledgerOrderIds } },
          ],
        });
      }
    }
    if (customerId) filter.customerId = customerId;
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    if (q) {
      andFilters.push({
        $or: [
          { orderId: { $regex: q, $options: "i" } },
          { customerId: { $regex: q, $options: "i" } },
          { code: { $regex: q, $options: "i" } },
        ],
      });
    }
    if (andFilters.length) {
      filter.$and = andFilters;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ReferralOrderModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      ReferralOrderModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  async listCommissionLedger({
    q = "",
    status = null,
    commissionType = null,
    influencerId = null,
    orderId = null,
    code = null,
    fromDate = null,
    toDate = null,
    page = 1,
    limit = 50,
  } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (commissionType) filter.commissionType = commissionType;
    if (influencerId) filter.influencerId = influencerId;
    if (orderId) filter.orderId = orderId;
    if (code) {
      const codeOrderIds = await this.getOrderIdsForCode({ code });
      filter.orderId = orderId && codeOrderIds.includes(orderId)
        ? orderId
        : { $in: codeOrderIds };
    }
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    if (q) {
      filter.$or = [
        { orderId: { $regex: q, $options: "i" } },
        { influencerId: { $regex: q, $options: "i" } },
        { commissionType: { $regex: q, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ReferralCommissionLedgerModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      ReferralCommissionLedgerModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  async listPayoutRequests({
    q = "",
    status = null,
    influencerId = null,
    fromDate = null,
    toDate = null,
    page = 1,
    limit = 50,
  } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (influencerId) filter.influencerId = influencerId;
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    if (q) {
      filter.$or = [
        { influencerId: { $regex: q, $options: "i" } },
        { payoutMethod: { $regex: q, $options: "i" } },
        { upiId: { $regex: q, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      InfluencerPayoutRequestModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      InfluencerPayoutRequestModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  async aggregatePayoutTotalsByInfluencer({
    influencerId,
    statuses = [],
    fromDate = null,
    toDate = null,
  } = {}) {
    if (!influencerId) return { total: 0, count: 0 };
    const filter = { influencerId: String(influencerId) };
    if (statuses.length) filter.status = { $in: statuses };
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    const [result] = await InfluencerPayoutRequestModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);
    return {
      total: Number(result?.total || 0),
      count: Number(result?.count || 0),
    };
  }

  async aggregateLedgerByOrderForInfluencer({
    influencerId,
    orderIds = [],
  } = {}) {
    const ids = Array.from(new Set(orderIds.map(String).filter(Boolean)));
    if (!influencerId || !ids.length) return new Map();

    const rows = await ReferralCommissionLedgerModel.aggregate([
      {
        $match: {
          influencerId: String(influencerId),
          orderId: { $in: ids },
        },
      },
      {
        $group: {
          _id: "$orderId",
          coinsEarned: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$commissionType", "reversal"] },
                    { $ne: ["$status", "reversed"] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          reversedCoins: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$commissionType", "reversal"] },
                    { $eq: ["$status", "reversed"] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          statuses: { $addToSet: "$status" },
          commissionTypes: { $addToSet: "$commissionType" },
          expectedReleaseDate: { $min: "$releaseAt" },
          entries: { $push: "$$ROOT" },
        },
      },
    ]);

    return new Map(rows.map((row) => [String(row._id), row]));
  }

  async aggregateParticipantEarningsByOrder(orderIds = []) {
    const ids = Array.from(new Set(orderIds.map(String).filter(Boolean)));
    if (!ids.length) return new Map();
    const rows = await ReferralCommissionLedgerModel.aggregate([
      {
        $match: {
          orderId: { $in: ids },
          commissionType: { $in: ["code_owner_base", "direct_parent"] },
          status: { $nin: ["reversed", "expired"] },
        },
      },
      {
        $group: {
          _id: {
            orderId: "$orderId",
            influencerId: "$influencerId",
            commissionType: "$commissionType",
          },
          coins: { $sum: "$amount" },
        },
      },
    ]);
    return new Map(rows.map((row) => [
      `${row._id.orderId}:${row._id.influencerId}:${row._id.commissionType}`,
      Number(row.coins || 0),
    ]));
  }

  async listMobileCoinLedger({
    influencerId,
    q = "",
    status = null,
    commissionType = null,
    transactionType = null,
    orderId = null,
    code = null,
    fromDate = null,
    toDate = null,
    page = 1,
    limit = 50,
  } = {}) {
    if (!influencerId) return { items: [], total: 0 };

    const ledgerFilter = { influencerId: String(influencerId) };
    const payoutFilter = { influencerId: String(influencerId) };
    const withdrawalStatuses = {
      pending: "payout_requested",
      approved: "payout_requested",
      processing: "payout_requested",
      paid: "paid",
      rejected: "reversed",
      failed: "reversed",
    };

    if (status) {
      const mappedLedgerStatus = withdrawalStatuses[status];
      if (mappedLedgerStatus) {
        ledgerFilter.status =
          status === "pending"
            ? { $in: ["pending", mappedLedgerStatus] }
            : mappedLedgerStatus;
        payoutFilter.status = status;
      } else {
        ledgerFilter.status = status;
        const payoutStatuses = Object.entries(withdrawalStatuses)
          .filter(([, mappedStatus]) => mappedStatus === status)
          .map(([payoutStatus]) => payoutStatus);
        if (payoutStatuses.length) payoutFilter.status = { $in: payoutStatuses };
        else payoutFilter.status = "__none__";
      }
    }
    if (commissionType) {
      ledgerFilter.commissionType = commissionType;
      if (commissionType !== "withdrawal") payoutFilter.status = "__none__";
    }
    if (transactionType) {
      if (transactionType === "withdrawal_coins") {
        ledgerFilter.commissionType = "withdrawal";
      } else {
        payoutFilter.status = "__none__";
      }

      if (transactionType === "locked_coins") {
        ledgerFilter.status = { $in: ["pending", "locked"] };
      } else if (transactionType === "released_coins") {
        ledgerFilter.status = "available";
      } else if (transactionType === "reversed_coins") {
        ledgerFilter.$or = [{ status: "reversed" }, { commissionType: "reversal" }];
        payoutFilter.status = { $in: ["rejected", "failed"] };
      } else if (transactionType === "expired_coins") {
        ledgerFilter.$or = [{ status: "expired" }, { commissionType: "coin_expiry" }];
      } else if (transactionType === "debit_coins") {
        ledgerFilter.amount = { $lt: 0 };
      } else if (transactionType === "credit_coins") {
        ledgerFilter.amount = { $gt: 0 };
      } else if (transactionType !== "withdrawal_coins") {
        ledgerFilter.commissionType = "__none__";
      }

      if (
        !["withdrawal_coins", "reversed_coins"].includes(transactionType) &&
        payoutFilter.status !== "__none__"
      ) {
        payoutFilter.status = "__none__";
      }
      if (transactionType === "withdrawal_coins" && !status) {
        delete payoutFilter.status;
      }
    }
    if (orderId) {
      ledgerFilter.orderId = orderId;
      payoutFilter.status = "__none__";
    }
    if (code) {
      const codeOrderIds = await this.getOrderIdsForCode({ code });
      ledgerFilter.orderId = { $in: codeOrderIds };
      payoutFilter.status = "__none__";
    }
    if (fromDate || toDate) {
      ledgerFilter.createdAt = {};
      payoutFilter.createdAt = {};
      if (fromDate) {
        ledgerFilter.createdAt.$gte = new Date(fromDate);
        payoutFilter.createdAt.$gte = new Date(fromDate);
      }
      if (toDate) {
        ledgerFilter.createdAt.$lte = new Date(toDate);
        payoutFilter.createdAt.$lte = new Date(toDate);
      }
    }
    if (q) {
      ledgerFilter.$or = [
        { orderId: { $regex: q, $options: "i" } },
        { commissionType: { $regex: q, $options: "i" } },
      ];
      payoutFilter.$or = [
        { payoutMethod: { $regex: q, $options: "i" } },
        { upiId: { $regex: q, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [result = {}] = await ReferralCommissionLedgerModel.aggregate([
      { $match: ledgerFilter },
      {
        $project: {
          source: { $literal: "coin_ledger" },
          sourceId: { $toString: "$_id" },
          referralOrderId: 1,
          orderId: 1,
          influencerId: 1,
          commissionType: 1,
          amount: 1,
          status: 1,
          releaseAt: 1,
          paidAt: 1,
          reversedAt: 1,
          metadata: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      {
        $unionWith: {
          coll: InfluencerPayoutRequestModel.collection.name,
          pipeline: [
            { $match: payoutFilter },
            {
              $project: {
                source: { $literal: "withdrawal" },
                sourceId: { $toString: "$_id" },
                referralOrderId: { $literal: null },
                orderId: { $literal: null },
                influencerId: 1,
                commissionType: { $literal: "withdrawal" },
                amount: { $multiply: ["$amount", -1] },
                status: {
                  $switch: {
                    branches: [
                      {
                        case: { $in: ["$status", ["pending", "approved", "processing"]] },
                        then: "payout_requested",
                      },
                      { case: { $eq: ["$status", "paid"] }, then: "paid" },
                      { case: { $in: ["$status", ["rejected", "failed"]] }, then: "reversed" },
                    ],
                    default: "$status",
                  },
                },
                releaseAt: { $literal: null },
                paidAt: "$paidAt",
                reversedAt: { $literal: null },
                metadata: {
                  payoutRequestId: { $toString: "$_id" },
                  payoutStatus: "$status",
                  payoutMethod: "$payoutMethod",
                  bankAccountId: "$bankAccountId",
                  upiId: "$upiId",
                },
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
        },
      },
      { $sort: { createdAt: -1, sourceId: -1 } },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: Number(limit) }],
          total: [{ $count: "count" }],
        },
      },
    ]);

    return {
      items: result.items || [],
      total: Number(result.total?.[0]?.count || 0),
    };
  }

  async createPayoutRequest(payload) {
    return InfluencerPayoutRequestModel.create(payload);
  }

  async getPayoutRequestById(payoutId) {
    return InfluencerPayoutRequestModel.findById(payoutId);
  }

  async updatePayoutRequest(payoutId, payload) {
    return InfluencerPayoutRequestModel.findByIdAndUpdate(
      payoutId,
      { $set: payload },
      { new: true },
    );
  }

  async transitionPayoutReservation(payoutId, fromStatus, toStatus) {
    return InfluencerPayoutRequestModel.findOneAndUpdate(
      { _id: payoutId, reservationStatus: fromStatus },
      { $set: { reservationStatus: toStatus } },
      { new: true },
    );
  }

  async getActiveCommissionRule() {
    return ReferralCommissionRuleModel.findOne({ active: true }).sort({
      effectiveFrom: -1,
      createdAt: -1,
    });
  }

  async listCommissionRules({ active = null, limit = 20, page = 1 } = {}) {
    const filter = {};
    if (active !== null && active !== undefined) filter.active = active;
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ReferralCommissionRuleModel.find(filter)
        .sort({ effectiveFrom: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      ReferralCommissionRuleModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async createCommissionRule(payload) {
    if (payload.active !== false) {
      await ReferralCommissionRuleModel.updateMany(
        { active: true },
        { $set: { active: false, effectiveTo: new Date() } },
      );
    }
    return ReferralCommissionRuleModel.create(payload);
  }

  async createCommissionLedger(payload) {
    return ReferralCommissionLedgerModel.create(payload);
  }

  async listActiveBonusRules() {
    return InfluencerBonusRuleModel.find({ status: "active" }).sort({
      createdAt: -1,
    });
  }

  async listBonusRules({
    q = "",
    status = null,
    period = null,
    targetType = null,
    applyTo = null,
    page = 1,
    limit = 50,
  } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (period) filter.period = period;
    if (targetType) filter.targetType = targetType;
    if (applyTo) filter.applyTo = applyTo;
    if (q) {
      filter.$or = [
        { ruleName: { $regex: q, $options: "i" } },
        { targetType: { $regex: q, $options: "i" } },
        { applyTo: { $regex: q, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      InfluencerBonusRuleModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      InfluencerBonusRuleModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async getBonusRuleById(ruleId) {
    return InfluencerBonusRuleModel.findById(ruleId);
  }

  async createBonusRule(payload) {
    return InfluencerBonusRuleModel.create(payload);
  }

  async updateBonusRule(ruleId, payload) {
    return InfluencerBonusRuleModel.findByIdAndUpdate(
      ruleId,
      { $set: payload },
      { new: true },
    );
  }

  async findBonusAchievement(ruleId, influencerId, cycleKey) {
    return InfluencerBonusAchievementModel.findOne({
      ruleId: String(ruleId),
      influencerId: String(influencerId),
      cycleKey: String(cycleKey),
    });
  }

  async createBonusAchievement(payload) {
    return InfluencerBonusAchievementModel.create(payload);
  }

  async updateBonusAchievement(achievementId, payload) {
    return InfluencerBonusAchievementModel.findByIdAndUpdate(
      achievementId,
      { $set: payload },
      { new: true },
    );
  }

  async listBonusAchievements({
    q = "",
    ruleId = null,
    influencerId = null,
    status = null,
    fromDate = null,
    toDate = null,
    page = 1,
    limit = 50,
  } = {}) {
    const filter = {};
    if (ruleId) filter.ruleId = String(ruleId);
    if (influencerId) filter.influencerId = String(influencerId);
    if (status) filter.status = status;
    if (fromDate || toDate) {
      filter.periodStart = {};
      if (fromDate) filter.periodStart.$gte = new Date(fromDate);
      if (toDate) filter.periodStart.$lte = new Date(toDate);
    }
    if (q) {
      filter.$or = [
        { ruleName: { $regex: q, $options: "i" } },
        { influencerId: { $regex: q, $options: "i" } },
        { cycleKey: { $regex: q, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      InfluencerBonusAchievementModel.find(filter)
        .sort({ periodStart: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      InfluencerBonusAchievementModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async aggregateBonusAchievementTotals(filter = {}) {
    const [result] = await InfluencerBonusAchievementModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          achievementCount: { $sum: 1 },
          bonusCoins: { $sum: "$bonusCoins" },
          lockedCoins: {
            $sum: {
              $cond: [{ $eq: ["$status", "locked"] }, "$bonusCoins", 0],
            },
          },
          releasedCoins: {
            $sum: {
              $cond: [{ $eq: ["$status", "released"] }, "$bonusCoins", 0],
            },
          },
        },
      },
    ]);
    return result || {
      achievementCount: 0,
      bonusCoins: 0,
      lockedCoins: 0,
      releasedCoins: 0,
    };
  }

  async aggregateReferralPerformance({
    influencerIds = [],
    code = null,
    fromDate = null,
    toDate = null,
  } = {}) {
    const ids = Array.from(new Set(influencerIds.map(String).filter(Boolean)));
    if (!ids.length) {
      return {
        orderCount: 0,
        orderValue: 0,
        customerCount: 0,
        customers: [],
        orderIds: [],
        orders: [],
      };
    }

    const filter = {
      codeOwnerInfluencerId: { $in: ids },
      status: { $nin: ["cancelled", "refunded", "reversed"] },
    };
    if (code) filter.code = String(code).toUpperCase();
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    const [summary] = await ReferralOrderModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          orderCount: { $sum: 1 },
          orderValue: { $sum: "$eligibleAmount" },
          customers: { $addToSet: "$customerId" },
          orderIds: { $addToSet: "$orderId" },
        },
      },
    ]);
    const orders = await ReferralOrderModel.find(filter).select(
      "orderId status orderStatus paymentStatus eligibleAmount customerId createdAt completedAt",
    );

    return {
      orderCount: Number(summary?.orderCount || 0),
      orderValue: Number(summary?.orderValue || 0),
      customerCount: Array.isArray(summary?.customers) ? summary.customers.length : 0,
      customers: summary?.customers || [],
      orderIds: summary?.orderIds || [],
      orders,
    };
  }

  async aggregateLedgerTotalsByInfluencer({
    influencerId,
    code = null,
    fromDate = null,
    toDate = null,
    includeStatuses = [],
    includeTypes = [],
    excludeTypes = [],
  } = {}) {
    const filter = { influencerId: String(influencerId) };
    if (includeStatuses.length) filter.status = { $in: includeStatuses };
    if (includeTypes.length) filter.commissionType = { $in: includeTypes };
    if (excludeTypes.length) filter.commissionType = { $nin: excludeTypes };
    if (code) {
      const codeOrderIds = await this.getOrderIdsForCode({ code });
      filter.orderId = { $in: codeOrderIds };
    }
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    const [result] = await ReferralCommissionLedgerModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);
    return {
      total: Number(result?.total || 0),
      count: Number(result?.count || 0),
    };
  }

  async aggregateLedgerByDay({
    influencerId,
    code = null,
    fromDate = null,
    toDate = null,
    includeTypes = [],
    excludeTypes = [],
  } = {}) {
    const filter = { influencerId: String(influencerId) };
    if (includeTypes.length) filter.commissionType = { $in: includeTypes };
    if (excludeTypes.length) filter.commissionType = { $nin: excludeTypes };
    if (code) {
      const codeOrderIds = await this.getOrderIdsForCode({ code });
      filter.orderId = { $in: codeOrderIds };
    }
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    return ReferralCommissionLedgerModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { $dateToString: { date: "$createdAt", format: "%Y-%m-%d" } },
          coins: { $sum: "$amount" },
          entries: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: "$_id",
          coins: 1,
          entries: 1,
        },
      },
    ]);
  }

  async listDirectChildren(
    parentInfluencerId,
    { status = null, code = null, page = 1, limit = 50 } = {},
  ) {
    const filter = { parentInfluencerId: String(parentInfluencerId) };
    if (status) filter.status = status;
    if (code) {
      const codeRows = await ReferralCodeModel.find({
        code: String(code).toUpperCase(),
      }).select("influencerId");
      const childInfluencerIds = codeRows.map((row) => String(row.influencerId));
      filter._id = { $in: childInfluencerIds };
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      InfluencerProfileModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      InfluencerProfileModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async listDirectChildIds(parentInfluencerId, { status = null, code = null } = {}) {
    const filter = { parentInfluencerId: String(parentInfluencerId) };
    if (status) filter.status = status;
    if (code) {
      const codeRows = await ReferralCodeModel.find({
        code: String(code).toUpperCase(),
      }).select("influencerId");
      filter._id = { $in: codeRows.map((row) => String(row.influencerId)) };
    }
    const rows = await InfluencerProfileModel.find(filter).select("_id");
    return rows.map((row) => String(row._id));
  }

  async countInfluencers(filter = {}) {
    return InfluencerProfileModel.countDocuments(filter);
  }

  async countCodes(filter = {}) {
    return ReferralCodeModel.countDocuments(filter);
  }

  async aggregateOrderTotals(filter = {}) {
    const [result] = await ReferralOrderModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          orderCount: { $sum: 1 },
          eligibleAmount: { $sum: "$eligibleAmount" },
          discountAmount: { $sum: "$discountAmount" },
        },
      },
    ]);
    return result || { orderCount: 0, eligibleAmount: 0, discountAmount: 0 };
  }

  async aggregateOrderStatusByInfluencer({ influencerId, code = null, fromDate = null, toDate = null } = {}) {
    const filter = { codeOwnerInfluencerId: String(influencerId) };
    if (code) filter.code = String(code).toUpperCase();
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    return ReferralOrderModel.aggregate([
      { $match: filter },
      { $group: { _id: "$status", value: { $sum: 1 }, amount: { $sum: "$eligibleAmount" } } },
      { $project: { _id: 0, status: { $ifNull: ["$_id", "pending"] }, value: 1, amount: 1 } },
      { $sort: { value: -1 } },
    ]);
  }

  async aggregateLedgerTotals(filter = {}) {
    const [result] = await ReferralCommissionLedgerModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          ledgerCount: { $sum: 1 },
          commissionAmount: { $sum: "$amount" },
        },
      },
    ]);
    return result || { ledgerCount: 0, commissionAmount: 0 };
  }

  async aggregateWalletTotals() {
    const [result] = await InfluencerWalletModel.aggregate([
      {
        $group: {
          _id: null,
          pendingBalance: { $sum: "$pendingBalance" },
          availableBalance: { $sum: "$availableBalance" },
          reservedBalance: { $sum: "$reservedBalance" },
          paidBalance: { $sum: "$paidBalance" },
          reversedBalance: { $sum: "$reversedBalance" },
        },
      },
    ]);
    return (
      result || {
        pendingBalance: 0,
        availableBalance: 0,
        reservedBalance: 0,
        paidBalance: 0,
        reversedBalance: 0,
      }
    );
  }

  async listFraudReviews({
    status = null,
    severity = null,
    influencerId = null,
    page = 1,
    limit = 50,
  } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (severity) filter.severity = severity;
    if (influencerId) filter.influencerId = influencerId;

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ReferralFraudReviewModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      ReferralFraudReviewModel.countDocuments(filter),
    ]);

    return { items, total };
  }
}

module.exports = { ReferralRepository };
