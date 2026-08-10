const { env } = require("../../../config/env");
const { randomBytes } = require("crypto");
const { AppError } = require("../../../shared/errors/app-error");
const { hashText } = require("../../../shared/tools/hash");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { ReferralRepository } = require("../repositories/referral.repository");
const { WalletService } = require("../../wallet/services/wallet.service");

class ReferralService {
  constructor({
    referralRepository = new ReferralRepository(),
    walletService = new WalletService(),
  } = {}) {
    this.referralRepository = referralRepository;
    this.walletService = walletService;
  }

  async getReferrerByCode(referralCode) {
    if (!referralCode) {
      return null;
    }

    const referrer = await this.referralRepository.findReferrerByCode(referralCode);
    if (!referrer) {
      throw new AppError("Invalid referral code", 400);
    }

    return referrer;
  }

  async rewardReferral(referralCode, refereeUser) {
    if (!referralCode) {
      return null;
    }

    const existingReferral = await this.referralRepository.findByRefereeUserId(refereeUser.id);
    if (existingReferral) {
      return existingReferral;
    }

    const referrer = await this.getReferrerByCode(referralCode);

    if (String(referrer.id) === String(refereeUser.id)) {
      throw new AppError("You cannot refer yourself", 400);
    }

    await this.walletService.credit(referrer.id, env.commerce.referralReferrerBonus, {
      referenceType: "referral",
      referenceId: refereeUser.id,
      metadata: { role: "referrer" },
    });
    await this.walletService.credit(refereeUser.id, env.commerce.referralRefereeBonus, {
      referenceType: "referral",
      referenceId: referrer.id,
      metadata: { role: "referee" },
    });

    const referral = await this.referralRepository.createReward({
      referrerUserId: referrer.id,
      refereeUserId: refereeUser.id,
      referralCode,
      referrerRewardAmount: env.commerce.referralReferrerBonus,
      refereeRewardAmount: env.commerce.referralRefereeBonus,
    });

    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.REFERRAL_REWARDED_V1,
        {
          referrerUserId: referrer.id,
          refereeUserId: refereeUser.id,
          referralCode,
        },
        { source: "referral-module", aggregateId: refereeUser.id },
      ),
    );

    return referral;
  }

  toPlainObject(value = {}) {
    if (!value) return {};
    if (typeof value.toObject === "function") {
      return value.toObject({ depopulate: true });
    }
    return { ...value };
  }

  getRecordId(value = {}) {
    return String(value._id || value.id || "");
  }

  normalizeCode(code) {
    return String(code || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "");
  }

  async makeUniqueCode(seed = "REF") {
    const cleanSeed = this.normalizeCode(seed).replace(/[_-]/g, "").slice(0, 8) || "REF";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = `${cleanSeed}${randomBytes(3).toString("hex").toUpperCase()}`;
      const existingCode = await this.referralRepository.getReferralCodeByCode(code);
      const existingUser = await this.referralRepository.findReferrerByCode(code);
      if (!existingCode && !existingUser) return code;
    }
    return `REF${Date.now().toString(36).toUpperCase()}${randomBytes(2)
      .toString("hex")
      .toUpperCase()}`;
  }

  makeInfluencerSnapshot(profile) {
    const plain = this.toPlainObject(profile);
    const influencerId = this.getRecordId(plain);
    return {
      influencerId,
      influencerType: plain.influencerType,
      parentInfluencerId: plain.parentInfluencerId || null,
      rootInfluencerId: plain.rootInfluencerId || null,
      originalParentInfluencerId: plain.originalParentInfluencerId || null,
      level: plain.level,
      path: plain.path || [],
      status: plain.status,
      canCreateChildren: Boolean(plain.canCreateChildren),
      promotedAt: plain.promotedAt || null,
      onboardingStatus: plain.onboardingStatus || "approved",
      kycStatus: plain.kycStatus || "pending",
      payoutProfileStatus: plain.payoutProfileStatus || "pending",
    };
  }

  async enrichInfluencer(profile) {
    const plainProfile = this.toPlainObject(profile);
    const influencerId = this.getRecordId(plainProfile);
    const [account, legacyUser, primaryCode, wallet] = await Promise.all([
      plainProfile.accountId
        ? this.referralRepository.getInfluencerAccountById(plainProfile.accountId)
        : null,
      plainProfile.userId ? this.referralRepository.getUserById(plainProfile.userId) : null,
      this.referralRepository.getPrimaryReferralCode(influencerId),
      this.referralRepository.ensureWallet(influencerId),
    ]);
    const identity = account || legacyUser;

    return {
      ...plainProfile,
      id: influencerId,
      account: account ? this.toPlainObject(account) : null,
      user: this.toPlainObject(identity),
      legacyUser: legacyUser ? this.toPlainObject(legacyUser) : null,
      primaryCode: primaryCode ? this.toPlainObject(primaryCode) : null,
      wallet: wallet ? this.toPlainObject(wallet) : null,
    };
  }

  async getInfluencerOrThrow(influencerId) {
    const influencer = await this.referralRepository.getInfluencerProfileById(
      influencerId,
    );
    if (!influencer) {
      throw new AppError("Influencer not found", 404);
    }
    return influencer;
  }

  async ensureInfluencerUser(payload = {}) {
    if (payload.userId) {
      const existingUser = await this.referralRepository.getUserById(payload.userId);
      if (!existingUser) {
        throw new AppError("User not found", 404);
      }
      const existingProfile =
        await this.referralRepository.getInfluencerProfileByUserId(payload.userId);
      if (existingProfile) {
        throw new AppError("User is already an influencer", 409);
      }
      if (["admin", "sub-admin", "super-admin", "seller", "seller-sub-admin"].includes(existingUser.role)) {
        throw new AppError("Influencers must be normal customer users", 400);
      }
      return { account: null, user: existingUser, temporaryPassword: null, legacyUser: true };
    }

    const email = String(payload.email || "").trim().toLowerCase();
    if (!email) {
      throw new AppError("Email is required for a new influencer user", 400);
    }
    const existingAccount = await this.referralRepository.findInfluencerAccountByEmail(email);
    if (existingAccount) {
      const existingProfile = await this.referralRepository.getInfluencerProfileByAccountId(
        this.getRecordId(existingAccount),
      );
      if (existingProfile) {
        throw new AppError("Influencer account already exists for this email", 409);
      }

      // Recover an account left behind when profile creation previously failed.
      const recoveryPassword =
        payload.password || `Influencer@${randomBytes(4).toString("hex")}1`;
      const account = await this.referralRepository.updateInfluencerAccount(
        this.getRecordId(existingAccount),
        {
          $set: {
            phone: payload.phone || existingAccount.phone || null,
            passwordHash: await hashText(recoveryPassword),
            profile: {
              ...(this.toPlainObject(existingAccount).profile || {}),
              firstName:
                payload.firstName || payload.profile?.firstName ||
                existingAccount.profile?.firstName || "Influencer",
              lastName:
                payload.lastName || payload.profile?.lastName ||
                existingAccount.profile?.lastName || "",
            },
          },
        },
      );
      return {
        account,
        user: null,
        temporaryPassword: payload.password ? null : recoveryPassword,
        legacyUser: false,
        recovered: true,
      };
    }

    const temporaryPassword =
      payload.password || `Influencer@${randomBytes(4).toString("hex")}1`;
    const account = await this.referralRepository.createInfluencerAccount({
      email,
      phone: payload.phone || null,
      passwordHash: await hashText(temporaryPassword),
      profile: {
        firstName: payload.firstName || payload.profile?.firstName || "Influencer",
        lastName: payload.lastName || payload.profile?.lastName || "",
      },
      accountStatus: payload.accountStatus || "active",
      createdBy: payload.createdBy || null,
    });

    return {
      account,
      user: null,
      temporaryPassword: payload.password ? null : temporaryPassword,
      legacyUser: false,
    };
  }

  async ensureDefaultCode(profile, actor, payload = {}) {
    const influencerId = this.getRecordId(profile);
    const existing = await this.referralRepository.getPrimaryReferralCode(influencerId);
    if (existing) return existing;

    const account = profile.accountId
      ? await this.referralRepository.getInfluencerAccountById(profile.accountId)
      : null;
    const user = !account && profile.userId
      ? await this.referralRepository.getUserById(profile.userId)
      : null;
    const identity = account || user;
    const code = payload.code
      ? this.normalizeCode(payload.code)
      : await this.makeUniqueCode(
          `${identity?.profile?.firstName || identity?.email || "REF"}${profile.level || 1}`,
        );
    const existingCustomerSignupCode =
      await this.referralRepository.findReferrerByCode(code);
    if (existingCustomerSignupCode) {
      throw new AppError("Influencer code conflicts with a customer signup referral code", 409);
    }

    const influencerCode = await this.referralRepository.createReferralCode({
      influencerId,
      accountId: profile.accountId || null,
      userId: profile.userId || null,
      code,
      status: payload.codeStatus || "active",
      startsAt: payload.startsAt || null,
      expiresAt: payload.expiresAt || null,
      usageLimit: payload.usageLimit || null,
      createdBy: actor?.userId || null,
    });
    return influencerCode;
  }

  async listInfluencers(query = {}) {
    const result = await this.referralRepository.listInfluencerProfiles({
      ...query,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
      canCreateChildren:
        query.canCreateChildren === undefined
          ? null
          : String(query.canCreateChildren).toLowerCase() === "true",
    });

    return {
      items: await Promise.all(result.items.map((item) => this.enrichInfluencer(item))),
      total: result.total,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    };
  }

  async createParentInfluencer(payload = {}, actor = {}) {
    const { account, user, temporaryPassword } = await this.ensureInfluencerUser({
      ...payload,
      createdBy: actor?.userId || null,
    });
    const created = await this.referralRepository.createInfluencerProfile({
      ...(account
        ? { accountId: this.getRecordId(account) }
        : { userId: this.getRecordId(user) }),
      influencerType: "parent",
      level: 1,
      path: [],
      status: payload.status || "active",
      canCreateChildren: payload.canCreateChildren ?? true,
      onboardingStatus: payload.onboardingStatus || "approved",
      kycStatus: payload.kycStatus || "pending",
      payoutProfileStatus: payload.payoutProfileStatus || "pending",
      yearlySalesAmount: Number(payload.yearlySalesAmount || 0),
      createdBy: actor?.userId || null,
      metadata: payload.metadata || {},
    });
    const influencerId = this.getRecordId(created);
    const profile = await this.referralRepository.updateInfluencerProfile(
      influencerId,
      {
        rootInfluencerId: influencerId,
        path: [influencerId],
      },
    );

    await this.referralRepository.ensureWallet(influencerId);
    await this.ensureDefaultCode(profile, actor, payload);

    return {
      ...(await this.enrichInfluencer(profile)),
      temporaryPassword,
    };
  }

  async createChildInfluencer(parentId, payload = {}, actor = {}) {
    const parent = await this.getInfluencerOrThrow(parentId);
    if (parent.status !== "active") {
      throw new AppError("Parent influencer must be active", 400);
    }
    if (!parent.canCreateChildren) {
      throw new AppError("Parent influencer cannot create children", 400);
    }

    const { account, user, temporaryPassword } = await this.ensureInfluencerUser({
      ...payload,
      createdBy: actor?.userId || null,
    });
    const parentIdString = this.getRecordId(parent);
    const rootInfluencerId = parent.rootInfluencerId || parentIdString;
    const parentPath = Array.isArray(parent.path) && parent.path.length
      ? parent.path.map(String)
      : [parentIdString];

    const created = await this.referralRepository.createInfluencerProfile({
      ...(account
        ? { accountId: this.getRecordId(account) }
        : { userId: this.getRecordId(user) }),
      influencerType: "child",
      parentInfluencerId: parentIdString,
      rootInfluencerId,
      originalParentInfluencerId: parent.originalParentInfluencerId || null,
      level: Number(parent.level || 1) + 1,
      path: parentPath,
      status: payload.status || "active",
      canCreateChildren: payload.canCreateChildren ?? false,
      onboardingStatus: payload.onboardingStatus || "approved",
      kycStatus: payload.kycStatus || "pending",
      payoutProfileStatus: payload.payoutProfileStatus || "pending",
      yearlySalesAmount: Number(payload.yearlySalesAmount || 0),
      createdBy: actor?.userId || null,
      metadata: payload.metadata || {},
    });
    const childId = this.getRecordId(created);
    const profile = await this.referralRepository.updateInfluencerProfile(childId, {
      path: [...parentPath, childId],
    });

    await this.referralRepository.ensureWallet(childId);
    await this.ensureDefaultCode(profile, actor, payload);

    return {
      ...(await this.enrichInfluencer(profile)),
      temporaryPassword,
    };
  }

  async createMyChildInfluencer(actor = {}, payload = {}) {
    const parent = await this.getInfluencerProfileByActorId(actor.userId);
    if (!parent) throw new AppError("Influencer profile not found", 404);
    if (parent.influencerType !== "parent" || parent.canCreateChildren !== true) {
      throw new AppError("You do not have permission to create brand associates", 403);
    }
    return this.createChildInfluencer(this.getRecordId(parent), {
      ...payload,
      status: "active",
      canCreateChildren: false,
      onboardingStatus: "approved",
    }, actor);
  }

  async updateInfluencerStatus(influencerId, payload = {}) {
    const influencer = await this.getInfluencerOrThrow(influencerId);
    const profile = await this.referralRepository.updateInfluencerProfile(
      this.getRecordId(influencer),
      {
        status: payload.status,
        ...(payload.reason ? { "metadata.statusReason": payload.reason } : {}),
      },
    );

    if (["suspended", "rejected"].includes(payload.status)) {
      await this.referralRepository.updateReferralCodesByInfluencer(
        this.getRecordId(profile),
        { status: "suspended" },
      );
    }

    return this.enrichInfluencer(profile);
  }

  async promoteInfluencer(influencerId, payload = {}) {
    const influencer = await this.getInfluencerOrThrow(influencerId);
    const parentId = influencer.parentInfluencerId || null;
    const profile = await this.referralRepository.updateInfluencerProfile(
      this.getRecordId(influencer),
      {
        influencerType: "parent",
        canCreateChildren: payload.canCreateChildren ?? true,
        originalParentInfluencerId:
          influencer.originalParentInfluencerId || parentId,
        promotedAt: payload.promotedAt || new Date(),
        status: "active",
        ...(payload.note ? { "metadata.promotionNote": payload.note } : {}),
      },
    );

    await this.ensureDefaultCode(profile, {}, payload);
    return this.enrichInfluencer(profile);
  }

  async listReferralCodes(query = {}) {
    const result = await this.referralRepository.listReferralCodes({
      ...query,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    return {
      items: result.items.map((item) => this.toPlainObject(item)),
      total: result.total,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    };
  }

  async createReferralCode(payload = {}, actor = {}) {
    const influencer = await this.getInfluencerOrThrow(payload.influencerId);
    if (influencer.status !== "active") {
      throw new AppError("Influencer must be active before creating a code", 400);
    }

    const code = payload.code
      ? this.normalizeCode(payload.code)
      : await this.makeUniqueCode(payload.influencerId);
    if (!code) throw new AppError("Influencer code is required", 400);

    const existing = await this.referralRepository.getReferralCodeByCode(code);
    if (existing) {
      throw new AppError("Influencer code already exists", 409);
    }
    const existingCustomerSignupCode =
      await this.referralRepository.findReferrerByCode(code);
    if (existingCustomerSignupCode) {
      throw new AppError("Influencer code conflicts with a customer signup referral code", 409);
    }

    const influencerCode = await this.referralRepository.createReferralCode({
      influencerId: this.getRecordId(influencer),
      accountId: influencer.accountId || null,
      userId: influencer.userId || null,
      code,
      status: payload.status || "active",
      startsAt: payload.startsAt || null,
      expiresAt: payload.expiresAt || null,
      usageLimit: payload.usageLimit || null,
      createdBy: actor?.userId || null,
      metadata: payload.metadata || {},
    });
    return influencerCode;
  }

  async updateReferralCode(codeId, payload = {}) {
    const existing = await this.referralRepository.getReferralCodeById(codeId);
    if (!existing) {
      throw new AppError("Influencer code not found", 404);
    }

    const update = { ...payload };
    delete update.codeId;
    if (update.code) {
      update.code = this.normalizeCode(update.code);
      const duplicate = await this.referralRepository.getReferralCodeByCode(
        update.code,
      );
      if (duplicate && this.getRecordId(duplicate) !== this.getRecordId(existing)) {
        throw new AppError("Influencer code already exists", 409);
      }
      const duplicateCustomerSignupCode = await this.referralRepository.findReferrerByCode(
        update.code,
      );
      if (duplicateCustomerSignupCode) {
        throw new AppError("Influencer code conflicts with a customer signup referral code", 409);
      }
    }

    const updated = await this.referralRepository.updateReferralCode(codeId, update);
    return updated;
  }

  calculateReferralPool(rule = {}, eligibleAmount = 0) {
    const amount = Math.max(0, Number(eligibleAmount || 0));
    const uncappedPool = rule.distributionType === "fixed_amount"
      ? Number(rule.referralPoolAmount || 0)
      : (amount * Number(rule.referralPoolPercent || 0)) / 100;
    const maximumPool = Number(rule.maximumReferralPoolAmount || 0);
    const cappedPool = maximumPool > 0
      ? Math.min(uncappedPool, maximumPool)
      : uncappedPool;
    return Number(Math.min(Math.max(cappedPool, 0), amount).toFixed(2));
  }

  validateDistributionShares(shares = {}) {
    const total = Number(shares.customer || 0) + Number(shares.codeOwner || 0) + Number(shares.parent || 0);
    if (Math.abs(total - 100) > 0.001) {
      throw new AppError("Customer, code owner, and parent distribution must total 100%", 400);
    }
  }

  normalizeProductConfigPayload(payload = {}, actor = {}) {
    const shares = {
      customer: payload.customerSharePercent,
      codeOwner: payload.codeOwnerSharePercent,
      parent: payload.parentSharePercent,
    };
    const suppliedShares = Object.values(shares).some((value) => value !== undefined && value !== null);
    if (suppliedShares) this.validateDistributionShares(shares);
    if (payload.startsAt && payload.endsAt && new Date(payload.startsAt) >= new Date(payload.endsAt)) {
      throw new AppError("Product distribution end date must be after its start date", 400);
    }
    return {
      ...payload,
      productId: String(payload.productId),
      variantId: payload.variantId ? String(payload.variantId) : null,
      maximumPoolAmount: Number(payload.maximumPoolAmount || 0),
      active: payload.active !== false,
      fundedBy: payload.fundedBy || "platform",
      updatedBy: actor.userId || null,
      metadata: payload.metadata || {},
    };
  }

  async listProductDistributionConfigs(query = {}) {
    const result = await this.referralRepository.listProductConfigs({
      ...query,
      active: query.active === undefined ? null : String(query.active) === "true",
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    return { ...result, page: Number(query.page || 1), limit: Number(query.limit || 50) };
  }

  async upsertProductDistributionConfig(payload = {}, actor = {}) {
    const normalized = this.normalizeProductConfigPayload(payload, actor);
    const existing = await this.referralRepository.listProductConfigs({
      productId: normalized.productId,
      page: 1,
      limit: 500,
    });
    const exact = existing.items.find(
      (item) => String(item.variantId || "") === String(normalized.variantId || ""),
    );
    return this.referralRepository.upsertProductConfig({
      ...normalized,
      createdBy: exact?.createdBy || actor.userId || null,
    });
  }

  async deleteProductDistributionConfig(configId) {
    const deleted = await this.referralRepository.deleteProductConfig(configId);
    if (!deleted) throw new AppError("Referral product configuration not found", 404);
    return deleted;
  }

  isProductConfigEffective(config = {}, now = new Date()) {
    if (config.startsAt && new Date(config.startsAt) > now) return false;
    if (config.endsAt && new Date(config.endsAt) < now) return false;
    return true;
  }

  calculateProductPool(config = {}, item = {}, fallbackRule = {}) {
    const quantity = Math.max(Number(item.quantity || 1), 1);
    const lineAmount = Math.max(Number(item.lineTotal || 0), 0);
    if (config && config.active === false) return 0;
    if (!config) return this.calculateReferralPool(fallbackRule, lineAmount);
    const raw = config.poolType === "percentage"
      ? (lineAmount * Number(config.poolValue || 0)) / 100
      : Number(config.poolValue || 0) * quantity;
    const cap = Number(config.maximumPoolAmount || 0) * quantity;
    return Number(Math.min(Math.max(cap > 0 ? Math.min(raw, cap) : raw, 0), lineAmount).toFixed(2));
  }

  async calculateProductDistribution(items = [], rule = {}) {
    const configs = await this.referralRepository.listProductConfigsForItems(
      items.map((item) => item.productId),
    );
    const now = new Date();
    const snapshots = items.map((item) => {
      const candidates = configs.filter((config) => String(config.productId) === String(item.productId));
      const variantConfig = candidates.find(
        (config) => config.variantId && String(config.variantId) === String(item.variantId || ""),
      );
      const productConfig = candidates.find((config) => !config.variantId);
      const selected = variantConfig || productConfig || null;
      const effective = selected && this.isProductConfigEffective(selected, now) ? selected : null;
      const poolAmount = selected && !effective ? 0 : this.calculateProductPool(effective, item, rule);
      const shares = {
        customer: effective?.customerSharePercent ?? rule.customerSharePercent,
        codeOwner: effective?.codeOwnerSharePercent ?? rule.childSharePercent,
        parent: effective?.parentSharePercent ?? rule.parentSharePercent,
      };
      this.validateDistributionShares(shares);
      return {
        productId: String(item.productId),
        variantId: item.variantId ? String(item.variantId) : null,
        quantity: Number(item.quantity || 1),
        eligibleAmount: Number(item.lineTotal || 0),
        configId: effective ? this.getRecordId(effective) : null,
        source: effective ? (variantConfig ? "variant" : "product") : selected ? "disabled_or_outside_window" : "global",
        poolType: effective?.poolType || rule.distributionType,
        poolValue: Number(effective?.poolValue ?? (rule.distributionType === "fixed_amount" ? rule.referralPoolAmount : rule.referralPoolPercent) ?? 0),
        poolAmount,
        fundedBy: effective?.fundedBy || "platform",
        customerSharePercent: Number(shares.customer || 0),
        codeOwnerSharePercent: Number(shares.codeOwner || 0),
        parentSharePercent: Number(shares.parent || 0),
        customerAmount: Number((poolAmount * Number(shares.customer || 0) / 100).toFixed(2)),
        codeOwnerAmount: Number((poolAmount * Number(shares.codeOwner || 0) / 100).toFixed(2)),
        parentAmount: Number((poolAmount * Number(shares.parent || 0) / 100).toFixed(2)),
      };
    });
    const sum = (key) => Number(snapshots.reduce((total, item) => total + Number(item[key] || 0), 0).toFixed(2));
    return {
      items: snapshots,
      referralPoolAmount: sum("poolAmount"),
      customerDiscountAmount: sum("customerAmount"),
      codeOwnerAmount: sum("codeOwnerAmount"),
      parentAmount: sum("parentAmount"),
    };
  }

  async resolveInfluencerCodeForCheckout(codeValue, eligibleAmount, customerId = null, items = []) {
    const code = await this.referralRepository.getReferralCodeByCode(
      this.normalizeCode(codeValue),
    );
    if (!code) return null;

    const now = new Date();
    if (code.status !== "active") {
      throw new AppError("Influencer code is not active", 400);
    }
    if (code.startsAt && new Date(code.startsAt) > now) {
      throw new AppError("Influencer code is not active yet", 400);
    }
    if (code.expiresAt && new Date(code.expiresAt) < now) {
      throw new AppError("Influencer code has expired", 400);
    }
    if (code.usageLimit && Number(code.usageCount || 0) >= Number(code.usageLimit)) {
      throw new AppError("Influencer code usage limit reached", 400);
    }
    if (customerId && code.userId && String(code.userId) === String(customerId)) {
      throw new AppError("You cannot use your own influencer code", 400);
    }

    const influencer = await this.getInfluencerOrThrow(code.influencerId);
    if (influencer.status !== "active") {
      throw new AppError("Influencer code is not active", 400);
    }

    const rule = await this.referralRepository.getActiveCommissionRule();
    if (!rule) throw new AppError("Referral commerce is not configured", 400);
    if (
      (rule.effectiveFrom && new Date(rule.effectiveFrom) > now) ||
      (rule.effectiveTo && new Date(rule.effectiveTo) < now)
    ) {
      throw new AppError("Referral commerce is not currently active", 400);
    }
    if (Number(eligibleAmount || 0) < Number(rule.minOrderAmount || 0)) {
      throw new AppError("Order does not meet the influencer code minimum amount", 400);
    }

    const distribution = await this.calculateProductDistribution(items, rule);
    const referralPoolAmount = items.length
      ? distribution.referralPoolAmount
      : this.calculateReferralPool(rule, eligibleAmount);
    const customerDiscountAmount = items.length
      ? distribution.customerDiscountAmount
      : Number(((referralPoolAmount * Number(rule.customerSharePercent || 0)) / 100).toFixed(2));
    return {
      codeId: this.getRecordId(code),
      code: code.code,
      influencerId: this.getRecordId(influencer),
      influencerAccountId: influencer.accountId ? String(influencer.accountId) : null,
      influencerUserId: influencer.userId ? String(influencer.userId) : null,
      parentInfluencerId: influencer.parentInfluencerId || null,
      overrideInfluencerId: influencer.originalParentInfluencerId || null,
      eligibleAmount: Number(Number(eligibleAmount || 0).toFixed(2)),
      referralPoolAmount,
      customerDiscountAmount,
      codeOwnerAmount: items.length ? distribution.codeOwnerAmount : null,
      parentAmount: items.length ? distribution.parentAmount : null,
      itemDistributions: distribution.items,
      rule: this.toPlainObject(rule),
    };
  }

  async recordInfluencerReferralOrder(payload = {}) {
    const existing = await this.referralRepository.getReferralOrderByOrderId(payload.orderId);
    if (existing) return existing;

    const context = payload.referralContext;
    if (!context?.codeId) return null;
    const rule = context.rule || {};
    const referralOrder = await this.referralRepository.createReferralOrder({
      orderId: String(payload.orderId),
      customerId: String(payload.customerId),
      influencerCodeId: context.codeId,
      referralCodeId: context.codeId,
      code: context.code,
      codeOwnerInfluencerId: context.influencerId,
      directParentInfluencerId: context.parentInfluencerId || null,
      overrideInfluencerId: context.overrideInfluencerId || null,
      eligibleAmount: Number(context.eligibleAmount || 0),
      discountAmount: Number(context.customerDiscountAmount || 0),
      status: "pending",
      orderStatus: payload.orderStatus || "pending_payment",
      paymentStatus: payload.paymentStatus || "initiated",
      metadata: {
        referralPoolAmount: Number(context.referralPoolAmount || 0),
        undistributedParentAmount: context.parentInfluencerId
          ? 0
          : Number(context.parentAmount || 0),
        missingParentPolicy: context.parentInfluencerId
          ? "allocated_to_parent"
          : "retain_by_funding_source",
        itemDistributions: Array.isArray(context.itemDistributions)
          ? context.itemDistributions
          : [],
        commissionRuleId: this.getRecordId(rule),
        ruleSnapshot: rule,
      },
    });

    const referralOrderId = this.getRecordId(referralOrder);
    const coinValue = Math.max(Number(rule.coinValue || 1), 0.000001);
    const releaseAt = this.addDays(new Date(), Number(rule.releaseDelayDays || 0));
    const allocations = [
      {
        influencerId: context.influencerId,
        commissionType: "code_owner_base",
        sharePercent: Number(rule.childSharePercent || 0),
        shareAmount: context.codeOwnerAmount,
      },
      {
        influencerId: context.parentInfluencerId,
        commissionType: "direct_parent",
        sharePercent: Number(rule.parentSharePercent || 0),
        shareAmount: context.parentAmount,
      },
    ].filter((allocation) => allocation.influencerId && allocation.sharePercent > 0);

    for (const allocation of allocations) {
      const shareAmount = allocation.shareAmount === null || allocation.shareAmount === undefined
        ? (Number(context.referralPoolAmount || 0) * allocation.sharePercent) / 100
        : Number(allocation.shareAmount || 0);
      const coins = Number((shareAmount / coinValue).toFixed(2));
      if (coins <= 0) continue;
      await this.referralRepository.createCommissionLedger({
        referralOrderId,
        orderId: String(payload.orderId),
        influencerId: String(allocation.influencerId),
        commissionType: allocation.commissionType,
        basisAmount: Number(context.eligibleAmount || 0),
        percent: allocation.sharePercent,
        amount: coins,
        status: "locked",
        releaseAt,
        metadata: {
          code: context.code,
          referralPoolAmount: Number(context.referralPoolAmount || 0),
          shareAmount: Number(shareAmount.toFixed(2)),
          coinValue,
        },
      });
      await this.referralRepository.updateWallet(allocation.influencerId, {
        $inc: { pendingBalance: coins },
      });
    }

    await this.referralRepository.incrementReferralCodeUsage(context.codeId);
    return referralOrder;
  }

  async syncInfluencerReferralOrderStatus(orderId, orderStatus, paymentStatus = null) {
    const referralOrder = await this.referralRepository.getReferralOrderByOrderId(orderId);
    if (!referralOrder) return null;

    const cancelled = ["cancelled", "payment_failed", "returned"].includes(orderStatus);
    const completed = ["delivered", "fulfilled"].includes(orderStatus);
    const nextReferralStatus = cancelled
      ? (orderStatus === "returned" ? "refunded" : "cancelled")
      : completed ? "completed" : referralOrder.status;
    const ledgers = await this.referralRepository.listCommissionLedgerByReferralOrder(
      this.getRecordId(referralOrder),
    );

    for (const ledger of ledgers) {
      if (cancelled && !["reversed", "expired"].includes(ledger.status)) {
        const balanceField = ledger.status === "paid"
          ? "paidBalance"
          : ["available", "payout_requested"].includes(ledger.status)
            ? "availableBalance"
            : "pendingBalance";
        await this.referralRepository.updateWallet(ledger.influencerId, {
          $inc: {
            [balanceField]: -Number(ledger.amount || 0),
            reversedBalance: Number(ledger.amount || 0),
          },
        });
        await this.referralRepository.updateCommissionLedgerEntry(this.getRecordId(ledger), {
          status: "reversed",
          reversedAt: new Date(),
        });
      } else if (
        completed &&
        ["pending", "locked"].includes(ledger.status) &&
        (!ledger.releaseAt || new Date(ledger.releaseAt) <= new Date())
      ) {
        await this.referralRepository.updateWallet(ledger.influencerId, {
          $inc: {
            pendingBalance: -Number(ledger.amount || 0),
            availableBalance: Number(ledger.amount || 0),
          },
        });
        await this.referralRepository.updateCommissionLedgerEntry(this.getRecordId(ledger), {
          status: "available",
        });
      }
    }

    return this.referralRepository.updateReferralOrderByOrderId(orderId, {
      status: nextReferralStatus,
      orderStatus,
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(completed ? { completedAt: new Date() } : {}),
    });
  }

  async releaseMaturedInfluencerCoins(influencerId) {
    const matured = await this.referralRepository.listMaturedCommissionLedger(
      influencerId,
      new Date(),
    );
    let releasedCoins = 0;
    for (const entry of matured) {
      const claimed = await this.referralRepository.claimCommissionAsAvailable(
        this.getRecordId(entry),
      );
      if (!claimed) continue;
      const amount = Number(claimed.amount || 0);
      await this.referralRepository.updateWallet(influencerId, {
        $inc: { pendingBalance: -amount, availableBalance: amount },
      });
      releasedCoins += amount;
    }
    return this.roundCoins(releasedCoins);
  }

  async listReferralOrders(query = {}) {
    const result = await this.referralRepository.listReferralOrders({
      ...query,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    return {
      items: result.items.map((item) => this.toPlainObject(item)),
      total: result.total,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    };
  }

  async listReferralCommissions(query = {}) {
    const result = await this.referralRepository.listCommissionLedger({
      ...query,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    return {
      items: result.items.map((item) => this.toPlainObject(item)),
      total: result.total,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    };
  }

  async listPayouts(query = {}) {
    const result = await this.referralRepository.listPayoutRequests({
      ...query,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    return {
      items: result.items.map((item) => this.toPlainObject(item)),
      total: result.total,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    };
  }

  async approvePayout(payoutId, payload = {}) {
    const payout = await this.referralRepository.getPayoutRequestById(payoutId);
    if (!payout) throw new AppError("Payout request not found", 404);
    if (payout.status !== "pending") {
      throw new AppError("Only pending payouts can be approved", 400);
    }

    const wallet = await this.referralRepository.getWallet(payout.influencerId);
    if (Number(wallet?.availableBalance || 0) < Number(payout.amount || 0)) {
      throw new AppError("Insufficient available influencer wallet balance", 400);
    }

    return this.referralRepository.updatePayoutRequest(payoutId, {
      status: "approved",
      approvedAt: new Date(),
      adminNote: payload.adminNote || payout.adminNote || null,
    });
  }

  async rejectPayout(payoutId, payload = {}) {
    const payout = await this.referralRepository.getPayoutRequestById(payoutId);
    if (!payout) throw new AppError("Payout request not found", 404);
    if (payout.status === "paid") {
      throw new AppError("Paid payouts cannot be rejected", 400);
    }

    return this.referralRepository.updatePayoutRequest(payoutId, {
      status: "rejected",
      adminNote: payload.adminNote || payload.reason || null,
    });
  }

  async markPayoutPaid(payoutId, payload = {}) {
    const payout = await this.referralRepository.getPayoutRequestById(payoutId);
    if (!payout) throw new AppError("Payout request not found", 404);
    if (!["approved", "processing"].includes(payout.status)) {
      throw new AppError("Only approved or processing payouts can be marked paid", 400);
    }

    const wallet = await this.referralRepository.getWallet(payout.influencerId);
    if (Number(wallet?.availableBalance || 0) < Number(payout.amount || 0)) {
      throw new AppError("Insufficient available influencer wallet balance", 400);
    }

    await this.referralRepository.updateWallet(payout.influencerId, {
      $inc: {
        availableBalance: -Number(payout.amount),
        paidBalance: Number(payout.amount),
      },
    });

    return this.referralRepository.updatePayoutRequest(payoutId, {
      status: "paid",
      paidAt: payload.paidAt || new Date(),
      adminNote: payload.adminNote || payout.adminNote || null,
    });
  }

  async getCommissionRules(query = {}) {
    let current = await this.referralRepository.getActiveCommissionRule();
    if (!current) {
      current = await this.referralRepository.createCommissionRule({
        active: true,
        effectiveFrom: new Date(),
      });
    }
    const history = await this.referralRepository.listCommissionRules({
      active:
        query.active === undefined
          ? null
          : String(query.active).toLowerCase() === "true",
      page: Number(query.page || 1),
      limit: Number(query.limit || 20),
    });

    return {
      current: this.toPlainObject(current),
      history: history.items.map((item) => this.toPlainObject(item)),
      total: history.total,
    };
  }

  validateCommissionRule(rule = {}) {
    const shares = [
      Number(rule.customerSharePercent || 0),
      Number(rule.childSharePercent || 0),
      Number(rule.parentSharePercent || 0),
    ];
    const shareTotal = Number(shares.reduce((sum, value) => sum + value, 0).toFixed(2));
    if (shareTotal !== 100) {
      throw new AppError("Customer, child, and parent distribution shares must total 100%", 400);
    }
    if (
      rule.distributionType === "fixed_amount" &&
      Number(rule.referralPoolAmount || 0) <= 0
    ) {
      throw new AppError("Fixed amount distribution requires a referral pool amount", 400);
    }
    if (
      rule.distributionType === "percentage" &&
      Number(rule.referralPoolPercent || 0) <= 0
    ) {
      throw new AppError("Percentage distribution requires a referral pool percent", 400);
    }
  }

  async upsertCommissionRules(payload = {}) {
    const current = await this.referralRepository.getActiveCommissionRule();
    const currentPlain = current ? this.toPlainObject(current) : {};
    const ignoredKeys = [
      "_id",
      "id",
      "createdAt",
      "updatedAt",
      "__v",
      "customerDiscountPercent",
      "codeOwnerBasePercent",
      "directParentPercent",
      "lifetimeOverridePercent",
      "yearlyPromotionThreshold",
      "overrideMode",
      "overrideScope",
      "couponStackAllowed",
      "maxDiscountAmount",
      "monthlyBonusTiers",
    ];
    const base = Object.entries(currentPlain).reduce((acc, [key, value]) => {
      if (!ignoredKeys.includes(key)) acc[key] = value;
      return acc;
    }, {
      distributionType: "percentage",
      referralPoolAmount: 0,
      referralPoolPercent: 10,
      maximumReferralPoolAmount: 0,
      coinValue: 1,
      coinExpiryDays: 365,
      coinUsage: "wallet",
      customerSharePercent: 50,
      childSharePercent: 30,
      parentSharePercent: 20,
      withdrawalKycRequired: true,
      withdrawalApprovalMode: "manual",
      withdrawalMethods: ["upi", "bank", "manual"],
    });
    const nextRule = {
      ...base,
      ...payload,
      active: payload.active ?? true,
      effectiveFrom: payload.effectiveFrom || new Date(),
      effectiveTo: payload.effectiveTo || null,
    };
    this.validateCommissionRule(nextRule);

    return this.referralRepository.createCommissionRule(nextRule);
  }

  startOfUtcDay(date = new Date()) {
    const value = new Date(date);
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  addDays(date, days = 0) {
    const value = new Date(date);
    value.setUTCDate(value.getUTCDate() + Number(days || 0));
    return value;
  }

  getPeriodWindow(period = "monthly", referenceDate = new Date(), rule = {}) {
    const now = new Date(referenceDate);
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();

    if (period === "custom") {
      const start = rule.customStartAt
        ? this.startOfUtcDay(rule.customStartAt)
        : this.getPeriodWindow(rule.resetCycle || "monthly", referenceDate).periodStart;
      const end = rule.customEndAt
        ? this.addDays(this.startOfUtcDay(rule.customEndAt), 1)
        : this.getPeriodWindow(rule.resetCycle || "monthly", referenceDate).periodEnd;
      return {
        periodStart: start,
        periodEnd: end,
        cycleKey: `${start.toISOString().slice(0, 10)}_${this.addDays(end, -1)
          .toISOString()
          .slice(0, 10)}`,
      };
    }

    if (period === "quarterly") {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const periodStart = new Date(Date.UTC(year, quarterStartMonth, 1));
      const periodEnd = new Date(Date.UTC(year, quarterStartMonth + 3, 1));
      return {
        periodStart,
        periodEnd,
        cycleKey: `${year}-Q${Math.floor(month / 3) + 1}`,
      };
    }

    if (period === "yearly") {
      return {
        periodStart: new Date(Date.UTC(year, 0, 1)),
        periodEnd: new Date(Date.UTC(year + 1, 0, 1)),
        cycleKey: `${year}`,
      };
    }

    return {
      periodStart: new Date(Date.UTC(year, month, 1)),
      periodEnd: new Date(Date.UTC(year, month + 1, 1)),
      cycleKey: `${year}-${String(month + 1).padStart(2, "0")}`,
    };
  }

  isInfluencerEligibleForBonusRule(profile = {}, rule = {}) {
    if (profile.status !== "active") return false;
    if (rule.applyTo === "parent") {
      return profile.influencerType === "parent" || profile.canCreateChildren === true;
    }
    if (rule.applyTo === "child") return profile.influencerType === "child";
    return true;
  }

  async getPerformanceInfluencerIds(profile = {}, rule = {}) {
    const influencerId = this.getRecordId(profile);
    if (rule.applyTo !== "parent" || rule.targetType === "active_children") {
      return [influencerId];
    }
    const children = await this.referralRepository.listDirectChildren(influencerId, {
      status: "active",
      page: 1,
      limit: 1000,
    });
    return [
      influencerId,
      ...children.items.map((child) => this.getRecordId(child)).filter(Boolean),
    ];
  }

  async getBonusProgressForInfluencer(profile = {}, rule = {}, periodWindow = {}) {
    const influencerId = this.getRecordId(profile);
    if (rule.targetType === "active_children") {
      const children = await this.referralRepository.listDirectChildren(influencerId, {
        status: "active",
        page: 1,
        limit: 1,
      });
      return {
        achievedValue: Number(children.total || 0),
        relatedOrders: [],
        orderIds: [],
        customerCount: 0,
      };
    }

    const performanceInfluencerIds = await this.getPerformanceInfluencerIds(profile, rule);
    const performance = await this.referralRepository.aggregateReferralPerformance({
      influencerIds: performanceInfluencerIds,
      fromDate: periodWindow.periodStart,
      toDate: periodWindow.periodEnd,
    });

    const achievedValue = {
      order_value: performance.orderValue,
      order_count: performance.orderCount,
      customer_count: performance.customerCount,
    }[rule.targetType] || 0;

    return {
      achievedValue: Number(achievedValue || 0),
      relatedOrders: performance.orders || [],
      orderIds: performance.orderIds || [],
      customerCount: performance.customerCount || 0,
    };
  }

  relatedOrdersAreFulfilled(orders = []) {
    if (!orders.length) return false;
    const fulfilledStatuses = new Set(["completed", "fulfilled", "delivered"]);
    return orders.every((order) => {
      const plain = this.toPlainObject(order);
      return (
        fulfilledStatuses.has(String(plain.orderStatus || "").toLowerCase()) ||
        fulfilledStatuses.has(String(plain.status || "").toLowerCase())
      );
    });
  }

  async calculateBonusCoins(rule = {}, influencerId, periodWindow = {}) {
    if (rule.bonusType === "percentage_extra_coins") {
      const earned = await this.referralRepository.aggregateLedgerTotalsByInfluencer({
        influencerId,
        fromDate: periodWindow.periodStart,
        toDate: periodWindow.periodEnd,
        excludeTypes: ["performance_bonus", "reversal"],
      });
      return Number(((Number(earned.total || 0) * Number(rule.bonusValue || 0)) / 100).toFixed(2));
    }
    return Number(Number(rule.bonusValue || 0).toFixed(2));
  }

  getBonusReleaseState(rule = {}, periodWindow = {}, progress = {}) {
    const now = new Date();
    if (rule.releaseRule === "instantly_available") {
      return { ledgerStatus: "available", achievementStatus: "released", releaseAt: now };
    }
    if (rule.releaseRule === "locked_until_period_ends") {
      const periodEnded = periodWindow.periodEnd <= now;
      return {
        ledgerStatus: periodEnded ? "available" : "locked",
        achievementStatus: periodEnded ? "released" : "locked",
        releaseAt: periodWindow.periodEnd,
      };
    }
    const fulfilled = this.relatedOrdersAreFulfilled(progress.relatedOrders || []);
    return {
      ledgerStatus: fulfilled ? "available" : "locked",
      achievementStatus: fulfilled ? "released" : "locked",
      releaseAt: fulfilled ? now : null,
    };
  }

  async listBonusRules(query = {}) {
    const result = await this.referralRepository.listBonusRules({
      ...query,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    return {
      items: result.items.map((item) => this.toPlainObject(item)),
      total: result.total,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    };
  }

  async createBonusRule(payload = {}, actor = {}) {
    if (payload.period === "custom" && (!payload.customStartAt || !payload.customEndAt)) {
      throw new AppError("Custom bonus period requires start and end dates", 400);
    }
    if (Number(payload.targetValue || 0) <= 0) {
      throw new AppError("Target value must be greater than zero", 400);
    }
    if (Number(payload.bonusValue || 0) <= 0) {
      throw new AppError("Bonus value must be greater than zero", 400);
    }
    return this.referralRepository.createBonusRule({
      ...payload,
      ruleName: String(payload.ruleName || "").trim(),
      createdBy: actor?.userId || null,
    });
  }

  async updateBonusRule(ruleId, payload = {}) {
    const existing = await this.referralRepository.getBonusRuleById(ruleId);
    if (!existing) throw new AppError("Bonus rule not found", 404);
    if (payload.period === "custom" || existing.period === "custom") {
      const start = payload.customStartAt ?? existing.customStartAt;
      const end = payload.customEndAt ?? existing.customEndAt;
      if (!start || !end) {
        throw new AppError("Custom bonus period requires start and end dates", 400);
      }
    }
    return this.referralRepository.updateBonusRule(ruleId, payload);
  }

  async listBonusAchievements(query = {}) {
    const result = await this.referralRepository.listBonusAchievements({
      ...query,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    return {
      items: result.items.map((item) => this.toPlainObject(item)),
      total: result.total,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    };
  }

  async buildBonusProgressRows(query = {}) {
    const referenceDate = query.referenceDate ? new Date(query.referenceDate) : new Date();
    const rules = query.ruleId
      ? [await this.referralRepository.getBonusRuleById(query.ruleId)]
      : await this.referralRepository.listActiveBonusRules();
    const activeRules = rules.filter(Boolean).filter((rule) => query.includeInactive || rule.status === "active");
    const profiles = query.influencerId
      ? [await this.referralRepository.getInfluencerProfileById(query.influencerId)]
      : await this.referralRepository.listAllInfluencerProfiles();
    const candidates = profiles.filter(Boolean);
    const rows = [];

    for (const rule of activeRules) {
      const plainRule = this.toPlainObject(rule);
      const periodWindow = this.getPeriodWindow(
        plainRule.period,
        referenceDate,
        plainRule,
      );
      for (const profile of candidates) {
        const plainProfile = this.toPlainObject(profile);
        if (!this.isInfluencerEligibleForBonusRule(plainProfile, plainRule)) continue;
        const influencerId = this.getRecordId(plainProfile);
        const progress = await this.getBonusProgressForInfluencer(
          plainProfile,
          plainRule,
          periodWindow,
        );
        const existing = await this.referralRepository.findBonusAchievement(
          this.getRecordId(plainRule),
          influencerId,
          periodWindow.cycleKey,
        );
        rows.push({
          rule: plainRule,
          influencer: {
            id: influencerId,
            accountId: plainProfile.accountId || null,
            userId: plainProfile.userId,
            influencerType: plainProfile.influencerType,
            parentInfluencerId: plainProfile.parentInfluencerId || null,
            level: plainProfile.level || 1,
          },
          cycleKey: periodWindow.cycleKey,
          periodStart: periodWindow.periodStart,
          periodEnd: periodWindow.periodEnd,
          targetValue: Number(plainRule.targetValue || 0),
          achievedValue: progress.achievedValue,
          progressPercent: Number(
            Math.min(
              100,
              (Number(progress.achievedValue || 0) / Number(plainRule.targetValue || 1)) * 100,
            ).toFixed(2),
          ),
          achieved: Number(progress.achievedValue || 0) >= Number(plainRule.targetValue || 0),
          existingAchievement: existing ? this.toPlainObject(existing) : null,
        });
      }
    }

    return rows;
  }

  async getBonusProgressReport(query = {}) {
    const page = Number(query.page || 1);
    const limit = Number(query.limit || 50);
    const rows = await this.buildBonusProgressRows(query);
    const start = (page - 1) * limit;
    return {
      items: rows.slice(start, start + limit),
      total: rows.length,
      page,
      limit,
    };
  }

  async evaluateBonusRules(payload = {}) {
    const referenceDate = payload.referenceDate ? new Date(payload.referenceDate) : new Date();
    const rules = payload.ruleId
      ? [await this.referralRepository.getBonusRuleById(payload.ruleId)]
      : await this.referralRepository.listActiveBonusRules();
    const profiles = payload.influencerId
      ? [await this.referralRepository.getInfluencerProfileById(payload.influencerId)]
      : await this.referralRepository.listAllInfluencerProfiles();
    const created = [];
    const skipped = [];

    for (const rule of rules.filter(Boolean)) {
      const plainRule = this.toPlainObject(rule);
      if (plainRule.status !== "active") {
        skipped.push({ ruleId: this.getRecordId(plainRule), reason: "inactive_rule" });
        continue;
      }
      const periodWindow = this.getPeriodWindow(
        plainRule.period,
        referenceDate,
        plainRule,
      );

      for (const profile of profiles.filter(Boolean)) {
        const plainProfile = this.toPlainObject(profile);
        if (!this.isInfluencerEligibleForBonusRule(plainProfile, plainRule)) continue;

        const influencerId = this.getRecordId(plainProfile);
        const existing = await this.referralRepository.findBonusAchievement(
          this.getRecordId(plainRule),
          influencerId,
          periodWindow.cycleKey,
        );
        if (existing) {
          skipped.push({
            ruleId: this.getRecordId(plainRule),
            influencerId,
            cycleKey: periodWindow.cycleKey,
            reason: "already_awarded",
          });
          continue;
        }

        const progress = await this.getBonusProgressForInfluencer(
          plainProfile,
          plainRule,
          periodWindow,
        );
        if (Number(progress.achievedValue || 0) < Number(plainRule.targetValue || 0)) {
          skipped.push({
            ruleId: this.getRecordId(plainRule),
            influencerId,
            cycleKey: periodWindow.cycleKey,
            reason: "target_not_reached",
            achievedValue: progress.achievedValue,
          });
          continue;
        }

        const bonusCoins = await this.calculateBonusCoins(
          plainRule,
          influencerId,
          periodWindow,
        );
        if (bonusCoins <= 0) {
          skipped.push({
            ruleId: this.getRecordId(plainRule),
            influencerId,
            cycleKey: periodWindow.cycleKey,
            reason: "zero_bonus",
          });
          continue;
        }

        const releaseState = this.getBonusReleaseState(plainRule, periodWindow, progress);
        const achievement = await this.referralRepository.createBonusAchievement({
          ruleId: this.getRecordId(plainRule),
          ruleName: plainRule.ruleName,
          influencerId,
          cycleKey: periodWindow.cycleKey,
          periodStart: periodWindow.periodStart,
          periodEnd: periodWindow.periodEnd,
          targetType: plainRule.targetType,
          targetValue: Number(plainRule.targetValue || 0),
          achievedValue: Number(progress.achievedValue || 0),
          bonusType: plainRule.bonusType,
          bonusValue: Number(plainRule.bonusValue || 0),
          bonusCoins,
          applyTo: plainRule.applyTo,
          releaseRule: plainRule.releaseRule,
          status: releaseState.achievementStatus,
          releasedAt: releaseState.achievementStatus === "released" ? new Date() : null,
          metadata: {
            relatedOrderIds: progress.orderIds || [],
            customerCount: progress.customerCount || 0,
          },
        });

        const ledger = await this.referralRepository.createCommissionLedger({
          referralOrderId: `bonus:${this.getRecordId(achievement)}`,
          orderId: `bonus:${periodWindow.cycleKey}`,
          influencerId,
          commissionType: "performance_bonus",
          basisAmount: Number(progress.achievedValue || 0),
          percent: plainRule.bonusType === "percentage_extra_coins" ? Number(plainRule.bonusValue || 0) : 0,
          amount: bonusCoins,
          status: releaseState.ledgerStatus,
          releaseAt: releaseState.releaseAt,
          metadata: {
            bonusRuleId: this.getRecordId(plainRule),
            bonusAchievementId: this.getRecordId(achievement),
            cycleKey: periodWindow.cycleKey,
            releaseRule: plainRule.releaseRule,
          },
        });

        await this.referralRepository.updateWallet(influencerId, {
          $inc:
            releaseState.ledgerStatus === "available"
              ? { availableBalance: bonusCoins }
              : { pendingBalance: bonusCoins },
        });

        const updatedAchievement = await this.referralRepository.updateBonusAchievement(
          this.getRecordId(achievement),
          { ledgerEntryId: this.getRecordId(ledger) },
        );
        created.push(this.toPlainObject(updatedAchievement));
      }
    }

    return {
      created,
      skipped,
      totalCreated: created.length,
      totalSkipped: skipped.length,
    };
  }

  async getMyInfluencerProfileOrThrow(actor = {}) {
    const profile = await this.getInfluencerProfileByActorId(actor.userId);
    if (!profile) throw new AppError("Influencer profile not found", 404);
    if (profile.status !== "active") {
      throw new AppError("Influencer profile is not active", 403);
    }
    return profile;
  }

  async getInfluencerProfileByActorId(actorId) {
    if (!actorId) return null;
    return (
      (await this.referralRepository.getInfluencerProfileByAccountId(actorId)) ||
      (await this.referralRepository.getInfluencerProfileByUserId(actorId))
    );
  }

  async getInfluencerAccountForLogin(email) {
    return this.referralRepository.findInfluencerAccountByEmail(email, {
      includeSecrets: true,
    });
  }

  async getInfluencerAccountForSession(accountId) {
    return this.referralRepository.getInfluencerAccountById(accountId, {
      includeSecrets: true,
    });
  }

  async updateInfluencerAccountLastLogin(accountId, lastLoginAt) {
    return this.referralRepository.updateInfluencerAccountLastLogin(accountId, lastLoginAt);
  }

  async updateInfluencerAccountRefreshSessions(accountId, refreshSessions) {
    return this.referralRepository.updateInfluencerAccountRefreshSessions(
      accountId,
      refreshSessions,
    );
  }

  async getInfluencerSessionByUserId(userId) {
    const profile = await this.getInfluencerProfileByActorId(userId);
    if (!profile) throw new AppError("This account is not registered as an influencer", 403);
    const enriched = await this.enrichInfluencer(profile);
    const status = String(profile.status || "pending");
    const commonModules = [
      { key: "dashboard", label: "Dashboard", route: "/app/dashboard" },
      { key: "codes", label: "My Codes", route: "/app/codes" },
      { key: "orders", label: "Referral Orders", route: "/app/orders" },
      { key: "earnings", label: "Earnings", route: "/app/earnings" },
      { key: "wallet", label: "Wallet", route: "/app/wallet" },
      { key: "withdrawals", label: "Withdrawals", route: "/app/withdrawals" },
      { key: "bonuses", label: "Bonus Progress", route: "/app/bonuses" },
      { key: "analytics", label: "Analytics", route: "/app/analytics" },
      { key: "profile", label: "Profile", route: "/app/profile" },
    ];
    const parentModules = [
      { key: "network", label: "Brand Associates", route: "/app/network" },
      { key: "child-analytics", label: "Associate Analytics", route: "/app/child-analytics" },
    ];
    const allowedModules = status === "active"
      ? [
          ...commonModules,
          ...(profile.influencerType === "parent" && profile.canCreateChildren
            ? parentModules
            : []),
        ]
      : [{ key: "profile", label: "Profile", route: "/app/profile" }];

    return {
      isInfluencer: true,
      influencerId: this.getRecordId(profile),
      status,
      active: status === "active",
      canAccessAnalytics: status === "active",
      onboardingStatus: profile.onboardingStatus || "approved",
      kycStatus: profile.kycStatus || "pending",
      payoutProfileStatus: profile.payoutProfileStatus || "pending",
      influencerType: profile.influencerType,
      canCreateChildren: Boolean(profile.canCreateChildren),
      parentInfluencerId: profile.parentInfluencerId || null,
      allowedModules,
      primaryCode: enriched.primaryCode
        ? this.formatMobileReferralCode(enriched.primaryCode, {})
        : null,
      api: {
        session: "/influencer/referral/session",
        profile: "/influencer/referral/profile",
        dashboard: "/influencer/referral/dashboard/summary",
        codes: "/influencer/referral/codes",
        orders: "/influencer/referral/orders",
        ledger: "/influencer/referral/ledger",
        wallet: "/influencer/referral/wallet",
        bonusProgress: "/influencer/referral/bonus-progress",
        analytics: "/influencer/referral/analytics",
        network: "/influencer/referral/network",
        createBrandAssociate: "/influencer/referral/network/children",
        withdrawals: "/influencer/referral/withdrawals",
      },
    };
  }

  async getMyInfluencerSession(actor = {}) {
    const session = await this.getInfluencerSessionByUserId(actor.userId);
    return {
      ...session,
      authentication: {
        authenticated: true,
        role: actor.role,
        email: actor.email,
        scope: actor.authScope,
        issuedAt: actor.issuedAt,
        expiresAt: actor.expiresAt,
      },
    };
  }

  maskUser(user = {}) {
    const profile = user.profile || {};
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || user.email || "";
    const phone = String(user.phone || "");
    return {
      name: name ? `${name.slice(0, 2)}***` : "Customer",
      mobile: phone ? `${phone.slice(0, 2)}*****${phone.slice(-2)}` : null,
    };
  }

  publicInfluencerNode(enriched = {}) {
    const profile = enriched.user?.profile || {};
    const displayName = [profile.firstName, profile.lastName]
      .filter(Boolean)
      .join(" ");
    return {
      influencerType: enriched.influencerType,
      level: enriched.level || 1,
      status: enriched.status,
      canCreateChildren: Boolean(enriched.canCreateChildren),
      displayName: displayName || "Influencer",
      joinedOn: enriched.createdAt || null,
      primaryCode: enriched.primaryCode
        ? {
            code: enriched.primaryCode.code,
            status: enriched.primaryCode.status,
            usageCount: enriched.primaryCode.usageCount || 0,
          }
        : null,
    };
  }

  getRangeStart(range = "all") {
    const now = new Date();
    if (range === "today") return this.startOfUtcDay(now);
    if (range === "month") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    if (range === "year") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return null;
  }

  async getMinimumWithdrawalCoins() {
    const rule = await this.referralRepository.getActiveCommissionRule();
    return Number(rule?.minimumWithdrawalCoins || 0);
  }

  roundCoins(value = 0) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    return Number(number.toFixed(2));
  }

  getEarningExcludedTypes() {
    return ["reversal", "withdrawal", "coin_expiry"];
  }

  getPendingWithdrawalStatuses() {
    return ["pending", "approved", "processing"];
  }

  getOrderCoinStatus(order = {}, ledgerSummary = {}) {
    const statuses = new Set((ledgerSummary.statuses || []).map(String));
    const commissionTypes = new Set((ledgerSummary.commissionTypes || []).map(String));
    const orderStatus = String(order.status || "").toLowerCase();
    if (
      ["cancelled", "refunded", "reversed"].includes(orderStatus) ||
      statuses.has("reversed") ||
      commissionTypes.has("reversal")
    ) {
      return "reversed";
    }
    if (
      statuses.size > 0 &&
      [...statuses].every((status) =>
        ["available", "payout_requested", "paid"].includes(status),
      )
    ) {
      return "available";
    }
    return "locked";
  }

  getLedgerTransactionType(entry = {}) {
    const status = String(entry.status || "");
    const commissionType = String(entry.commissionType || "");
    if (entry.source === "withdrawal" || commissionType === "withdrawal") {
      return "withdrawal_coins";
    }
    if (status === "expired" || commissionType === "coin_expiry") {
      return "expired_coins";
    }
    if (status === "reversed" || commissionType === "reversal") {
      return "reversed_coins";
    }
    if (["pending", "locked"].includes(status)) {
      return "locked_coins";
    }
    if (status === "available") {
      return "released_coins";
    }
    if (Number(entry.amount || 0) < 0) {
      return "debit_coins";
    }
    return "credit_coins";
  }

  formatMobileLedgerEntry(entry = {}) {
    const plain = this.toPlainObject(entry);
    const transactionType = this.getLedgerTransactionType(plain);
    const debitTypes = new Set([
      "debit_coins",
      "withdrawal_coins",
      "expired_coins",
      "reversed_coins",
    ]);
    const direction = debitTypes.has(transactionType) ? "debit" : "credit";
    const amount = this.roundCoins(Math.abs(Number(plain.amount || 0)));
    return {
      id: plain.sourceId || this.getRecordId(plain),
      source: plain.source || "coin_ledger",
      transactionType,
      direction,
      coins: amount,
      signedCoins: direction === "debit" ? -amount : amount,
      status: plain.status,
      commissionType: plain.commissionType,
      orderId: plain.orderId || null,
      referralOrderId: plain.referralOrderId || null,
      releaseAt: plain.releaseAt || null,
      paidAt: plain.paidAt || null,
      reversedAt: plain.reversedAt || null,
      transactionDate: plain.createdAt || null,
      metadata: plain.metadata || {},
    };
  }

  formatWithdrawal(payout = {}) {
    const plain = this.toPlainObject(payout);
    return {
      id: this.getRecordId(plain),
      amount: this.roundCoins(plain.amount),
      status: plain.status,
      payoutMethod: plain.payoutMethod,
      bankAccountId: plain.bankAccountId || null,
      upiId: plain.upiId || null,
      requestedAt: plain.requestedAt || plain.createdAt || null,
      approvedAt: plain.approvedAt || null,
      paidAt: plain.paidAt || null,
      adminNote: plain.adminNote || null,
      metadata: plain.metadata || {},
      createdAt: plain.createdAt || null,
      updatedAt: plain.updatedAt || null,
    };
  }

  formatWallet(wallet = {}, pendingWithdrawalAmount = 0, minimumWithdrawalCoins = 0) {
    const plain = this.toPlainObject(wallet);
    const lockedCoins = this.roundCoins(plain.pendingBalance);
    const availableCoins = this.roundCoins(plain.availableBalance);
    const withdrawnCoins = this.roundCoins(plain.paidBalance);
    const reversedCoins = this.roundCoins(plain.reversedBalance);
    const expiredCoins = this.roundCoins(plain.expiredBalance);
    const pendingAmount = this.roundCoins(pendingWithdrawalAmount);
    const availableForWithdrawal = this.roundCoins(
      Math.max(0, availableCoins - pendingAmount),
    );
    return {
      influencerId: plain.influencerId || null,
      lockedCoins,
      availableCoins,
      withdrawnCoins,
      reversedCoins,
      expiredCoins,
      pendingWithdrawalAmount: pendingAmount,
      availableForWithdrawal,
      minimumWithdrawalRequirement: this.roundCoins(minimumWithdrawalCoins),
      canWithdraw: availableForWithdrawal >= Number(minimumWithdrawalCoins || 0),
      withdrawalShortfall: this.roundCoins(
        Math.max(Number(minimumWithdrawalCoins || 0) - availableForWithdrawal, 0),
      ),
      updatedAt: plain.updatedAt || null,
    };
  }

  formatMobileReferralCode(code = {}, stats = {}) {
    const plain = this.toPlainObject(code);
    const codeValue = plain.code || "";
    const usageLimit = plain.usageLimit || null;
    return {
      id: this.getRecordId(plain),
      code: codeValue,
      status: plain.status,
      usageCount: Number(plain.usageCount || 0),
      usageLimit,
      remainingUsage: usageLimit
        ? Math.max(Number(usageLimit) - Number(plain.usageCount || 0), 0)
        : null,
      expiryDate: plain.expiresAt || null,
      startsAt: plain.startsAt || null,
      totalOrdersFromCode: Number(stats.totalOrders || 0),
      totalCoinsEarned: this.roundCoins(stats.totalCoinsEarned),
      totalSalesAmount: this.roundCoins(stats.totalSalesAmount),
      customerDiscountAmount: this.roundCoins(stats.customerDiscountAmount),
      share: {
        copyText: codeValue,
        shareText: codeValue ? `Use my influencer code ${codeValue}` : "",
      },
      createdAt: plain.createdAt || null,
      updatedAt: plain.updatedAt || null,
    };
  }

  async getInfluencerDashboard(actor = {}, query = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    const influencerId = this.getRecordId(profile);
    await this.releaseMaturedInfluencerCoins(influencerId);
    const code = query.code ? this.normalizeCode(query.code) : null;
    const minimumWithdrawalCoins = await this.getMinimumWithdrawalCoins();
    const excludedTypes = this.getEarningExcludedTypes();
    const [
      wallet,
      totalPerformance,
      todayLedger,
      monthLedger,
      allLedger,
      pendingPayouts,
      chart,
      bonusProgress,
      orderStatus,
    ] =
      await Promise.all([
        this.referralRepository.ensureWallet(influencerId),
        this.referralRepository.aggregateReferralPerformance({
          influencerIds: [influencerId],
          code,
        }),
        this.referralRepository.aggregateLedgerTotalsByInfluencer({
          influencerId,
          code,
          fromDate: this.getRangeStart("today"),
          excludeTypes: excludedTypes,
        }),
        this.referralRepository.aggregateLedgerTotalsByInfluencer({
          influencerId,
          code,
          fromDate: this.getRangeStart("month"),
          excludeTypes: excludedTypes,
        }),
        this.referralRepository.aggregateLedgerTotalsByInfluencer({
          influencerId,
          code,
          excludeTypes: excludedTypes,
        }),
        this.referralRepository.aggregatePayoutTotalsByInfluencer({
          influencerId,
          statuses: this.getPendingWithdrawalStatuses(),
        }),
        this.referralRepository.aggregateLedgerByDay({
          influencerId,
          code,
          fromDate: query.fromDate || this.addDays(new Date(), -30),
          toDate: query.toDate || new Date(),
          excludeTypes: excludedTypes,
        }),
        this.getBonusProgressReport({ influencerId, page: 1, limit: 20 }),
        this.referralRepository.aggregateOrderStatusByInfluencer({
          influencerId,
          code,
          fromDate: query.fromDate,
          toDate: query.toDate,
        }),
      ]);
    const [recentOrders, codePerformance] = await Promise.all([
      this.listMyReferralOrders(actor, { ...query, page: 1, limit: 5 }),
      this.listMyInfluencerCodes(actor, { ...query, page: 1, limit: 10 }),
    ]);
    const walletSummary = this.formatWallet(
      wallet,
      pendingPayouts.total,
      minimumWithdrawalCoins,
    );

    return {
      profile: this.makeInfluencerSnapshot(profile),
      summaryCards: {
        totalReferralOrders: totalPerformance.orderCount,
        totalSalesAmount: this.roundCoins(totalPerformance.orderValue),
        totalLockedCoins: walletSummary.lockedCoins,
        totalAvailableCoins: walletSummary.availableCoins,
        totalWithdrawnCoins: walletSummary.withdrawnCoins,
        totalReversedCoins: walletSummary.reversedCoins,
        todaysEarnings: this.roundCoins(todayLedger.total),
        monthlyEarnings: this.roundCoins(monthLedger.total),
        lifetimeEarnings: this.roundCoins(allLedger.total),
        pendingWithdrawalAmount: walletSummary.pendingWithdrawalAmount,
      },
      wallet: walletSummary,
      charts: {
        dailyEarnings: chart,
        orderStatus,
      },
      bonusTargets: bonusProgress.items,
      recentOrders: recentOrders.items,
      codePerformance: codePerformance.items,
    };
  }

  async listMyInfluencerCodes(actor = {}, query = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    const influencerId = this.getRecordId(profile);
    const result = await this.listReferralCodes({
      ...query,
      code: query.code ? this.normalizeCode(query.code) : null,
      influencerId,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    const codeStats = await this.referralRepository.aggregateCodeStats(
      influencerId,
      result.items.map((code) => code.code),
    );
    return {
      ...result,
      items: result.items.map((code) =>
        this.formatMobileReferralCode(code, codeStats.get(String(code.code)) || {}),
      ),
    };
  }

  async listMyReferralOrders(actor = {}, query = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    const influencerId = this.getRecordId(profile);
    const coinStatuses = new Set(["locked", "available", "reversed"]);
    const status = query.status || null;
    const coinStatus = query.coinStatus || (coinStatuses.has(status) ? status : null);
    const result = await this.listReferralOrders({
      ...query,
      status: coinStatuses.has(status) ? null : status,
      coinStatus,
      participantInfluencerId: influencerId,
      relationshipScope: query.scope || "all",
      code: query.code ? this.normalizeCode(query.code) : null,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    const customerIds = result.items.map((order) => order.customerId).filter(Boolean);
    const orderIds = result.items.map((order) => order.orderId).filter(Boolean);
    const ownerIds = Array.from(new Set(result.items.map((order) => String(order.codeOwnerInfluencerId || "")).filter(Boolean)));
    const [users, ledgerByOrder, participantEarnings, ownerProfiles] = await Promise.all([
      this.referralRepository.listUsersByIds(customerIds),
      this.referralRepository.aggregateLedgerByOrderForInfluencer({
        influencerId,
        orderIds,
      }),
      this.referralRepository.aggregateParticipantEarningsByOrder(orderIds),
      Promise.all(ownerIds.map(async (ownerId) => {
        const owner = await this.referralRepository.getInfluencerProfileById(ownerId);
        return owner ? this.enrichInfluencer(owner) : null;
      })),
    ]);
    const usersById = new Map(
      users.map((user) => [this.getRecordId(user), this.toPlainObject(user)]),
    );
    const ownerById = new Map(ownerProfiles.filter(Boolean).map((owner) => [String(owner.id || this.getRecordId(owner)), owner]));
    const items = result.items.map((order) => {
      const ledgerSummary = ledgerByOrder.get(String(order.orderId)) || {};
      const statusForCoins = this.getOrderCoinStatus(order, ledgerSummary);
      const ownerId = String(order.codeOwnerInfluencerId || "");
      const owner = ownerById.get(ownerId) || {};
      const ownerUser = owner.user || {};
      const ownerName = [ownerUser.profile?.firstName, ownerUser.profile?.lastName]
        .filter(Boolean).join(" ") || ownerUser.email || "Influencer";
      const codeOwnerEarning = participantEarnings.get(`${order.orderId}:${ownerId}:code_owner_base`) || 0;
      const parentEarning = participantEarnings.get(`${order.orderId}:${influencerId}:direct_parent`) || 0;
      const relationship = ownerId === influencerId ? "own_order" : "child_order";
      return {
        orderId: order.orderId,
        code: order.code,
        influencerName: ownerName,
        relationship,
        customer: this.maskUser(usersById.get(String(order.customerId)) || {}),
        orderAmount: this.roundCoins(order.eligibleAmount),
        customerDiscount: this.roundCoins(order.discountAmount),
        codeOwnerEarning: this.roundCoins(codeOwnerEarning),
        childEarning: relationship === "child_order" ? this.roundCoins(codeOwnerEarning) : 0,
        parentEarning: this.roundCoins(parentEarning),
        yourEarning: this.roundCoins(ledgerSummary.coinsEarned),
        reversedCoins: this.roundCoins(ledgerSummary.reversedCoins),
        status: statusForCoins,
        referralOrderStatus: order.status,
        orderStatus: order.orderStatus || null,
        paymentStatus: order.paymentStatus || null,
        orderDate: order.createdAt || null,
        completedAt: order.completedAt || null,
        expectedReleaseDate: ledgerSummary.expectedReleaseDate || null,
      };
    });
    return {
      ...result,
      items,
      pageSummary: {
        displayedOrders: items.length,
        orderAmount: this.roundCoins(items.reduce((sum, item) => sum + item.orderAmount, 0)),
        childEarnings: this.roundCoins(items.reduce((sum, item) => sum + item.childEarning, 0)),
        parentEarnings: this.roundCoins(items.reduce((sum, item) => sum + item.parentEarning, 0)),
        yourEarnings: this.roundCoins(items.reduce((sum, item) => sum + item.yourEarning, 0)),
      },
    };
  }

  async listMyCoinLedger(actor = {}, query = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    const influencerId = this.getRecordId(profile);
    const result = await this.referralRepository.listMobileCoinLedger({
      ...query,
      influencerId,
      code: query.code ? this.normalizeCode(query.code) : null,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    const items = result.items.map((entry) => this.formatMobileLedgerEntry(entry));
    return {
      items,
      total: result.total,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    };
  }

  async getMyInfluencerWallet(actor = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    const influencerId = this.getRecordId(profile);
    await this.releaseMaturedInfluencerCoins(influencerId);
    const [wallet, minimumWithdrawalCoins, pendingPayouts] = await Promise.all([
      this.referralRepository.ensureWallet(influencerId),
      this.getMinimumWithdrawalCoins(),
      this.referralRepository.aggregatePayoutTotalsByInfluencer({
        influencerId,
        statuses: this.getPendingWithdrawalStatuses(),
      }),
    ]);
    return this.formatWallet(wallet, pendingPayouts.total, minimumWithdrawalCoins);
  }

  async listMyWithdrawals(actor = {}, query = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    const result = await this.listPayouts({
      ...query,
      influencerId: this.getRecordId(profile),
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    return {
      ...result,
      items: result.items.map((payout) => this.formatWithdrawal(payout)),
    };
  }

  async createMyWithdrawal(actor = {}, payload = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    const influencerId = this.getRecordId(profile);
    await this.releaseMaturedInfluencerCoins(influencerId);
    const amount = Number(payload.amount || 0);
    const minimumWithdrawalCoins = await this.getMinimumWithdrawalCoins();
    if (amount <= 0) throw new AppError("Withdrawal amount must be greater than zero", 400);
    if (amount < minimumWithdrawalCoins) {
      throw new AppError("Withdrawal amount is below the minimum requirement", 400);
    }
    const [wallet, pendingPayouts] = await Promise.all([
      this.referralRepository.ensureWallet(influencerId),
      this.referralRepository.aggregatePayoutTotalsByInfluencer({
        influencerId,
        statuses: this.getPendingWithdrawalStatuses(),
      }),
    ]);
    const availableForWithdrawal =
      Number(wallet.availableBalance || 0) - Number(pendingPayouts.total || 0);
    if (availableForWithdrawal < amount) {
      throw new AppError("Insufficient available influencer wallet balance", 400);
    }
    const payout = await this.referralRepository.createPayoutRequest({
      influencerId,
      amount,
      payoutMethod: payload.payoutMethod || "manual",
      bankAccountId: payload.bankAccountId || null,
      upiId: payload.upiId || null,
      metadata: payload.metadata || {},
    });
    return this.formatWithdrawal(payout);
  }

  async getMyInfluencerNetwork(actor = {}, query = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    if (profile.influencerType !== "parent" || profile.canCreateChildren !== true) {
      throw new AppError("Child network is available only to eligible parent influencers", 403);
    }
    const influencerId = this.getRecordId(profile);
    const code = query.code ? this.normalizeCode(query.code) : null;
    const [children, allChildIds, parent] = await Promise.all([
      this.referralRepository.listDirectChildren(influencerId, {
        status: query.status || null,
        code,
        page: Number(query.page || 1),
        limit: Number(query.limit || 50),
      }),
      this.referralRepository.listDirectChildIds(influencerId, {
        status: query.status || null,
        code,
      }),
      profile.parentInfluencerId
        ? this.referralRepository.getInfluencerProfileById(profile.parentInfluencerId)
        : null,
    ]);
    const enrichedChildren = await Promise.all(
      children.items.map(async (child) => {
        const childId = this.getRecordId(child);
        const [enriched, performance, ledger] = await Promise.all([
          this.enrichInfluencer(child),
          this.referralRepository.aggregateReferralPerformance({
            influencerIds: [childId],
            code,
            fromDate: query.fromDate || null,
            toDate: query.toDate || null,
          }),
          this.referralRepository.aggregateLedgerTotalsByInfluencer({
            influencerId: childId,
            code,
            fromDate: query.fromDate || null,
            toDate: query.toDate || null,
            excludeTypes: this.getEarningExcludedTypes(),
          }),
        ]);
        return {
          ...this.publicInfluencerNode(enriched),
          performance: {
            totalSalesAmount: this.roundCoins(performance.orderValue),
            totalOrders: performance.orderCount,
            totalCommissionCoins: this.roundCoins(ledger.total),
            customerCount: performance.customerCount,
          },
        };
      }),
    );
    const [childPerformance, childCommissionRows] = await Promise.all([
      this.referralRepository.aggregateReferralPerformance({
        influencerIds: allChildIds,
        code,
        fromDate: query.fromDate || null,
        toDate: query.toDate || null,
      }),
      Promise.all(
        allChildIds.map((childId) =>
          this.referralRepository.aggregateLedgerTotalsByInfluencer({
            influencerId: childId,
            code,
            fromDate: query.fromDate || null,
            toDate: query.toDate || null,
            excludeTypes: this.getEarningExcludedTypes(),
          }),
        ),
      ),
    ]);
    const totalChildCommission = childCommissionRows.reduce(
      (sum, row) => sum + Number(row.total || 0),
      0,
    );
    return {
      parent: parent ? this.publicInfluencerNode(await this.enrichInfluencer(parent)) : null,
      summary: {
        directChildren: allChildIds.length,
        totalChildSales: this.roundCoins(childPerformance.orderValue),
        totalChildOrders: childPerformance.orderCount,
        totalChildCommission: this.roundCoins(totalChildCommission),
        customerCount: childPerformance.customerCount,
      },
      children: enrichedChildren,
      total: children.total,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    };
  }

  async getMyInfluencerProfile(actor = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    const enriched = await this.enrichInfluencer(profile);
    const user = enriched.user || {};
    const userProfile = user.profile || {};
    const displayName = [userProfile.firstName, userProfile.lastName]
      .filter(Boolean)
      .join(" ");
    return {
      profile: {
        ...this.makeInfluencerSnapshot(profile),
        id: this.getRecordId(profile),
        createdAt: enriched.createdAt || null,
        updatedAt: enriched.updatedAt || null,
      },
      user: {
        id: user._id ? String(user._id) : enriched.userId,
        displayName: displayName || "Influencer",
        email: user.email || null,
        mobile: user.phone || null,
        accountStatus: user.accountStatus || null,
        profile: userProfile,
      },
      kyc: {
        status: enriched.kycStatus || "pending",
        onboardingStatus: enriched.onboardingStatus || "approved",
      },
      payoutProfile: {
        status: enriched.payoutProfileStatus || "pending",
        bankOrUpiConfigured: Boolean(
          enriched.metadata?.bankAccountId || enriched.metadata?.upiId,
        ),
      },
      details: enriched.metadata?.details || {},
      primaryCode: enriched.primaryCode
        ? this.formatMobileReferralCode(enriched.primaryCode, {})
        : null,
      wallet: this.formatWallet(enriched.wallet, 0, await this.getMinimumWithdrawalCoins()),
    };
  }

  async updateMyInfluencerProfile(actor = {}, payload = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    const accountId = profile.accountId || actor.userId;
    const account = await this.referralRepository.getInfluencerAccountById(accountId);
    if (!account) throw new AppError("Influencer account not found", 404);

    const accountProfile = {
      ...(this.toPlainObject(account).profile || {}),
      ...(payload.firstName !== undefined ? { firstName: payload.firstName } : {}),
      ...(payload.lastName !== undefined ? { lastName: payload.lastName } : {}),
      ...(payload.avatarUrl !== undefined ? { avatarUrl: payload.avatarUrl } : {}),
    };
    await this.referralRepository.updateInfluencerAccount(accountId, {
      $set: {
        profile: accountProfile,
        ...(payload.phone !== undefined ? { phone: payload.phone } : {}),
      },
    });

    const currentMetadata = this.toPlainObject(profile).metadata || {};
    const details = currentMetadata.details || {};
    const nextDetails = {
      ...details,
      ...(payload.dateOfBirth !== undefined ? { dateOfBirth: payload.dateOfBirth } : {}),
      ...(payload.gender !== undefined ? { gender: payload.gender } : {}),
      ...(payload.address ? { address: { ...(details.address || {}), ...payload.address } } : {}),
      ...(payload.documents ? { documents: { ...(details.documents || {}), ...payload.documents } } : {}),
      ...(payload.payout ? { payout: { ...(details.payout || {}), ...payload.payout } } : {}),
    };
    await this.referralRepository.updateInfluencerProfile(this.getRecordId(profile), {
      metadata: { ...currentMetadata, details: nextDetails },
      ...(payload.payout ? { payoutProfileStatus: "submitted" } : {}),
      ...(payload.documents ? { kycStatus: "submitted" } : {}),
    });
    return this.getMyInfluencerProfile(actor);
  }

  async getMyInfluencerAnalytics(actor = {}, query = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    const dashboard = await this.getInfluencerDashboard(actor, query);
    let network = null;
    if (profile.influencerType === "parent" && profile.canCreateChildren) {
      network = await this.getMyInfluencerNetwork(actor, { ...query, page: 1, limit: 10 });
    }
    return {
      summary: dashboard.summaryCards,
      dailyEarnings: dashboard.charts?.dailyEarnings || [],
      orderStatus: dashboard.charts?.orderStatus || [],
      codePerformance: dashboard.codePerformance || [],
      recentOrders: dashboard.recentOrders || [],
      bonusTargets: dashboard.bonusTargets || [],
      networkSummary: network?.summary || null,
      topChildren: network?.children || [],
    };
  }

  async getMyBonusProgress(actor = {}, query = {}) {
    const profile = await this.getMyInfluencerProfileOrThrow(actor);
    return this.getBonusProgressReport({
      ...query,
      influencerId: this.getRecordId(profile),
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
  }

  async getSummaryReport() {
    const [
      totalInfluencers,
      activeInfluencers,
      parentInfluencers,
      totalCodes,
      activeCodes,
      orderTotals,
      ledgerTotals,
      walletTotals,
      pendingPayouts,
      bonusTotals,
    ] = await Promise.all([
      this.referralRepository.countInfluencers(),
      this.referralRepository.countInfluencers({ status: "active" }),
      this.referralRepository.countInfluencers({ influencerType: "parent" }),
      this.referralRepository.countCodes(),
      this.referralRepository.countCodes({ status: "active" }),
      this.referralRepository.aggregateOrderTotals(),
      this.referralRepository.aggregateLedgerTotals(),
      this.referralRepository.aggregateWalletTotals(),
      this.referralRepository.listPayoutRequests({ status: "pending", limit: 1 }),
      this.referralRepository.aggregateBonusAchievementTotals(),
    ]);

    return {
      influencers: {
        total: totalInfluencers,
        active: activeInfluencers,
        parents: parentInfluencers,
        children: Math.max(totalInfluencers - parentInfluencers, 0),
      },
      codes: {
        total: totalCodes,
        active: activeCodes,
      },
      orders: {
        total: Number(orderTotals.orderCount || 0),
        eligibleAmount: Number(orderTotals.eligibleAmount || 0),
        discountAmount: Number(orderTotals.discountAmount || 0),
      },
      commissions: {
        totalEntries: Number(ledgerTotals.ledgerCount || 0),
        amount: Number(ledgerTotals.commissionAmount || 0),
      },
      wallets: {
        lockedBalance: Number(walletTotals.pendingBalance || 0),
        pendingBalance: Number(walletTotals.pendingBalance || 0),
        availableBalance: Number(walletTotals.availableBalance || 0),
        withdrawnBalance: Number(walletTotals.paidBalance || 0),
        paidBalance: Number(walletTotals.paidBalance || 0),
        reversedBalance: Number(walletTotals.reversedBalance || 0),
      },
      payouts: {
        pending: pendingPayouts.total || 0,
      },
      bonuses: {
        achievements: Number(bonusTotals.achievementCount || 0),
        totalCoins: Number(bonusTotals.bonusCoins || 0),
        lockedCoins: Number(bonusTotals.lockedCoins || 0),
        releasedCoins: Number(bonusTotals.releasedCoins || 0),
      },
    };
  }

  async getHierarchyReport() {
    const profiles = await this.referralRepository.listAllInfluencerProfiles();
    const enriched = await Promise.all(
      profiles.map((profile) => this.enrichInfluencer(profile)),
    );
    const byId = new Map(
      enriched.map((profile) => [
        profile.id,
        {
          ...profile,
          children: [],
        },
      ]),
    );

    const roots = [];
    byId.forEach((node) => {
      const parentId = node.parentInfluencerId;
      if (parentId && byId.has(parentId)) {
        byId.get(parentId).children.push(node);
      } else {
        roots.push(node);
      }
    });

    return {
      roots,
      total: enriched.length,
      maxLevel: enriched.reduce(
        (max, item) => Math.max(max, Number(item.level || 1)),
        1,
      ),
    };
  }

  async listFraudReviews(query = {}) {
    const result = await this.referralRepository.listFraudReviews({
      ...query,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    });
    return {
      items: result.items.map((item) => this.toPlainObject(item)),
      total: result.total,
      page: Number(query.page || 1),
      limit: Number(query.limit || 50),
    };
  }
}

module.exports = { ReferralService };
