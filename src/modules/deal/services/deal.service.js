"use strict";

const { AppError } = require("../../../shared/errors/app-error");
const { DealRepository } = require("../repositories/deal.repository");
const { ProductRepository } = require("../../product/repositories/product.repository");
const { NotificationRepository } = require("../../notification/repositories/notification.repository");
const { UserModel } = require("../../user/models/user.model");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const {
  DEAL_STATUS,
  DEAL_TYPE,
  DEAL_FULFILLMENT_MODEL,
  DEAL_TIMELINE_EVENT,
} = require("../models/deal.model");

class DealService {
  constructor({
    dealRepository = new DealRepository(),
    productRepository = new ProductRepository(),
    notificationRepository = new NotificationRepository(),
  } = {}) {
    this.dealRepository = dealRepository;
    this.productRepository = productRepository;
    this.notificationRepository = notificationRepository;
  }

  isAdmin(actor = {}) {
    return ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
  }

  isSeller(actor = {}) {
    return ["seller", "seller-admin", "seller-sub-admin"].includes(actor.role);
  }

  sellerIdFor(actor = {}) {
    return actor.ownerSellerId || actor.sellerId || actor.userId;
  }

  scopeListQuery(query = {}, actor = {}) {
    if (!this.isAdmin(actor)) {
      return { ...query, sellerId: this.sellerIdFor(actor) };
    }
    return query;
  }

  getSellerDisplayName(user = {}) {
    const fullName = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ").trim();
    return user.sellerProfile?.displayName ||
      user.sellerProfile?.businessName ||
      user.sellerProfile?.legalBusinessName ||
      fullName ||
      user.email ||
      String(user._id || "");
  }

  async getSellerSummaries(sellerIds = []) {
    const ids = Array.from(new Set(
      sellerIds
        .map((sellerId) => String(sellerId || ""))
        .filter((sellerId) => UserModel.base.Types.ObjectId.isValid(sellerId)),
    ));
    if (!ids.length) return new Map();

    const users = await UserModel.find({ _id: { $in: ids } })
      .select("email phone profile sellerProfile accountStatus")
      .lean()
      .catch(() => []);

    return new Map(users.map((user) => {
      const displayName = this.getSellerDisplayName(user);
      return [String(user._id), {
        id: String(user._id),
        displayName,
        businessName: user.sellerProfile?.businessName || user.sellerProfile?.legalBusinessName || null,
        email: user.email || null,
        phone: user.phone || null,
        status: user.accountStatus || null,
      }];
    }));
  }

  async enrichDealsWithSellers(deals = []) {
    if (!deals.length) return deals;
    const sellersById = await this.getSellerSummaries(deals.map((deal) => deal.sellerId || deal.seller_id));
    return deals.map((deal) => {
      const seller = sellersById.get(String(deal.sellerId || deal.seller_id || "")) || null;
      return {
        ...deal,
        seller,
        sellerName: seller?.displayName || null,
      };
    });
  }

  async assertDealVisible(deal, actor = {}) {
    if (!deal) throw new AppError("Deal not found", 404);
    if (this.isAdmin(actor)) return;
    if (String(deal.sellerId || deal.seller_id) !== String(this.sellerIdFor(actor))) {
      throw new AppError("You are not allowed to access this deal", 403);
    }
  }

  async assertDealManageable(deal, actor = {}) {
    await this.assertDealVisible(deal, actor);
    if (this.isAdmin(actor)) return;
    if (![DEAL_STATUS.DRAFT, DEAL_STATUS.REJECTED].includes(deal.status)) {
      throw new AppError("Seller can edit only draft or rejected deals", 409);
    }
  }

  normalizeMoney(value) {
    return Number(Number(value || 0).toFixed(2));
  }

  calculateDealPrice(payload = {}) {
    const originalPrice = this.normalizeMoney(payload.originalPrice);
    if (payload.dealType === DEAL_TYPE.SPONSORED_PLACEMENT) {
      return { dealPrice: originalPrice, discountPercent: 0 };
    }
    if (payload.dealPrice !== null && payload.dealPrice !== undefined) {
      const dealPrice = this.normalizeMoney(payload.dealPrice);
      const discountPercent = originalPrice > 0
        ? this.normalizeMoney(((originalPrice - dealPrice) / originalPrice) * 100)
        : 0;
      return { dealPrice, discountPercent: payload.discountPercent ?? discountPercent };
    }
    const discountPercent = Number(payload.discountPercent || 0);
    const dealPrice = this.normalizeMoney(originalPrice - ((originalPrice * discountPercent) / 100));
    return { dealPrice, discountPercent };
  }

  normalizeDealPayload(payload = {}, actor = {}) {
    const isAdmin = this.isAdmin(actor);
    const sellerId = payload.sellerId || this.sellerIdFor(actor);
    const price = this.calculateDealPrice(payload);
    if (!sellerId) throw new AppError("Seller ID is required", 400);
    if (payload.dealType !== DEAL_TYPE.SPONSORED_PLACEMENT && price.dealPrice >= Number(payload.originalPrice || 0)) {
      throw new AppError("Deal price must be lower than original price", 400);
    }
    const verificationMethods = payload.deliveryVerificationRequired
      ? Array.from(new Set(payload.deliveryVerificationMethods || ["otp"]))
      : [];
    return {
      ...payload,
      sellerId,
      dealPrice: price.dealPrice,
      discountPercent: price.discountPercent,
      status: payload.status && isAdmin ? payload.status : DEAL_STATUS.DRAFT,
      fulfillmentModel: payload.fulfillmentModel || DEAL_FULFILLMENT_MODEL.SELLER_FULFILLED,
      deliveryVerificationMethods: verificationMethods,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      metadata: {
        ...(payload.metadata || {}),
        createdByRole: actor.role || null,
      },
    };
  }

  async listDeals(query = {}, actor = {}) {
    await this.dealRepository.expireDueDeals({ userId: "system", role: "system" }).catch(() => null);
    const result = await this.dealRepository.listDeals(this.scopeListQuery(query, actor));
    return {
      ...result,
      items: await this.enrichDealsWithSellers(result.items || []),
    };
  }

  async getDeal(dealId, actor = {}) {
    const deal = await this.dealRepository.getDealDetail(dealId);
    await this.assertDealVisible(deal, actor);
    const [enriched] = await this.enrichDealsWithSellers(deal ? [deal] : []);
    return enriched || deal;
  }

  async createDeal(payload = {}, actor = {}) {
    const normalized = this.normalizeDealPayload(payload, actor);
    const deal = await this.dealRepository.createDeal(normalized, {
      eventType: DEAL_TIMELINE_EVENT.CREATED,
      toStatus: normalized.status,
      payload: normalized,
      actorId: actor.userId,
      actorRole: actor.role,
    });
    if (payload.commissionRule) {
      await this.dealRepository.upsertCommissionRule(deal.id, {
        ...payload.commissionRule,
        sellerId: deal.sellerId,
      }, actor);
    }
    if (payload.sponsorship) {
      await this.dealRepository.upsertSponsorship(deal.id, payload.sponsorship, actor);
    }
    await this.publishDealEvent(DOMAIN_EVENTS.DEAL_CREATED_V1, deal, actor);
    return this.dealRepository.getDealDetail(deal.id);
  }

  async updateDeal(dealId, payload = {}, actor = {}) {
    const existing = await this.dealRepository.findDealById(dealId);
    await this.assertDealManageable(existing, actor);
    const normalized = {
      ...existing,
      ...payload,
      sellerId: payload.sellerId || existing.sellerId,
      productId: payload.productId || existing.productId,
      originalPrice: payload.originalPrice ?? existing.originalPrice,
      startAt: payload.startAt || existing.startAt,
      endAt: payload.endAt || existing.endAt,
      dealType: payload.dealType || existing.dealType,
      fulfillmentModel: payload.fulfillmentModel || existing.fulfillmentModel,
      deliveryVerificationRequired: payload.deliveryVerificationRequired ?? existing.deliveryVerificationRequired,
      deliveryVerificationMethods: payload.deliveryVerificationMethods || existing.deliveryVerificationMethods,
      updatedBy: actor.userId,
    };
    const priced = this.normalizeDealPayload(normalized, { ...actor, userId: existing.created_by || actor.userId });
    const deal = await this.dealRepository.updateDeal(dealId, {
      ...priced,
      status: existing.status,
      createdBy: undefined,
    }, {
      eventType: DEAL_TIMELINE_EVENT.UPDATED,
      fromStatus: existing.status,
      toStatus: existing.status,
      payload,
      actorId: actor.userId,
      actorRole: actor.role,
    });
    if (!deal) throw new AppError("Deal not found", 404);
    await this.publishDealEvent(DOMAIN_EVENTS.DEAL_UPDATED_V1, deal, actor);
    return this.dealRepository.getDealDetail(dealId);
  }

  async submitDeal(dealId, payload = {}, actor = {}) {
    const deal = await this.dealRepository.findDealById(dealId);
    await this.assertDealManageable(deal, actor);
    if (![DEAL_STATUS.DRAFT, DEAL_STATUS.REJECTED].includes(deal.status)) {
      throw new AppError("Only draft or rejected deals can be submitted", 409);
    }
    const updated = await this.dealRepository.updateDealStatus(dealId, {
      status: DEAL_STATUS.PENDING_APPROVAL,
      updatedBy: actor.userId,
      metadata: { submittedAt: new Date().toISOString() },
    }, {
      eventType: DEAL_TIMELINE_EVENT.SUBMITTED,
      reason: payload.reason,
      note: payload.note,
      actorId: actor.userId,
      actorRole: actor.role,
    });
    await this.publishDealEvent(DOMAIN_EVENTS.DEAL_SUBMITTED_V1, updated, actor);
    return updated;
  }

  async approveDeal(dealId, payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can approve deals", 403);
    const deal = await this.dealRepository.findDealById(dealId);
    if (!deal) throw new AppError("Deal not found", 404);
    if (![DEAL_STATUS.PENDING_APPROVAL, DEAL_STATUS.DRAFT].includes(deal.status)) {
      throw new AppError("Only submitted deals can be approved", 409);
    }
    const nextStatus = new Date(deal.startAt).getTime() > Date.now() ? DEAL_STATUS.SCHEDULED : DEAL_STATUS.ACTIVE;
    const updated = await this.dealRepository.updateDealStatus(dealId, {
      status: nextStatus,
      approvedAt: new Date(),
      approvedBy: actor.userId,
      updatedBy: actor.userId,
      metadata: { approvalNote: payload.note || null },
    }, {
      eventType: DEAL_TIMELINE_EVENT.APPROVED,
      reason: payload.reason,
      note: payload.note,
      actorId: actor.userId,
      actorRole: actor.role,
    });
    await this.publishDealEvent(DOMAIN_EVENTS.DEAL_APPROVED_V1, updated, actor);
    return updated;
  }

  async rejectDeal(dealId, payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can reject deals", 403);
    const deal = await this.dealRepository.findDealById(dealId);
    if (!deal) throw new AppError("Deal not found", 404);
    if ([DEAL_STATUS.CANCELLED, DEAL_STATUS.COMPLETED, DEAL_STATUS.EXPIRED].includes(deal.status)) {
      throw new AppError("This deal cannot be rejected", 409);
    }
    const updated = await this.dealRepository.updateDealStatus(dealId, {
      status: DEAL_STATUS.REJECTED,
      rejectedAt: new Date(),
      rejectionReason: payload.reason,
      updatedBy: actor.userId,
    }, {
      eventType: DEAL_TIMELINE_EVENT.REJECTED,
      reason: payload.reason,
      note: payload.note,
      actorId: actor.userId,
      actorRole: actor.role,
    });
    await this.publishDealEvent(DOMAIN_EVENTS.DEAL_REJECTED_V1, updated, actor);
    return updated;
  }

  async pauseDeal(dealId, payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can pause deals", 403);
    const deal = await this.dealRepository.findDealById(dealId);
    if (!deal) throw new AppError("Deal not found", 404);
    if (deal.status !== DEAL_STATUS.ACTIVE) throw new AppError("Only active deals can be paused", 409);
    return this.dealRepository.updateDealStatus(dealId, {
      status: DEAL_STATUS.PAUSED,
      pausedAt: new Date(),
      updatedBy: actor.userId,
    }, {
      eventType: DEAL_TIMELINE_EVENT.PAUSED,
      reason: payload.reason,
      note: payload.note,
      actorId: actor.userId,
      actorRole: actor.role,
    });
  }

  async resumeDeal(dealId, payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can resume deals", 403);
    const deal = await this.dealRepository.findDealById(dealId);
    if (!deal) throw new AppError("Deal not found", 404);
    if (deal.status !== DEAL_STATUS.PAUSED) throw new AppError("Only paused deals can be resumed", 409);
    const nextStatus = new Date(deal.endAt).getTime() <= Date.now()
      ? DEAL_STATUS.EXPIRED
      : new Date(deal.startAt).getTime() > Date.now()
        ? DEAL_STATUS.SCHEDULED
        : DEAL_STATUS.ACTIVE;
    return this.dealRepository.updateDealStatus(dealId, {
      status: nextStatus,
      updatedBy: actor.userId,
    }, {
      eventType: DEAL_TIMELINE_EVENT.RESUMED,
      reason: payload.reason,
      note: payload.note,
      actorId: actor.userId,
      actorRole: actor.role,
    });
  }

  async cancelDeal(dealId, payload = {}, actor = {}) {
    const deal = await this.dealRepository.findDealById(dealId);
    await this.assertDealVisible(deal, actor);
    if (!this.isAdmin(actor) && ![DEAL_STATUS.DRAFT, DEAL_STATUS.PENDING_APPROVAL, DEAL_STATUS.REJECTED].includes(deal.status)) {
      throw new AppError("Seller can cancel only draft, submitted, or rejected deals", 409);
    }
    if ([DEAL_STATUS.COMPLETED, DEAL_STATUS.EXPIRED, DEAL_STATUS.CANCELLED].includes(deal.status)) {
      throw new AppError("This deal is already closed", 409);
    }
    const updated = await this.dealRepository.updateDealStatus(dealId, {
      status: DEAL_STATUS.CANCELLED,
      cancelledAt: new Date(),
      updatedBy: actor.userId,
      metadata: { cancellationReason: payload.reason || null },
    }, {
      eventType: DEAL_TIMELINE_EVENT.CANCELLED,
      reason: payload.reason,
      note: payload.note,
      actorId: actor.userId,
      actorRole: actor.role,
    });
    await this.publishDealEvent(DOMAIN_EVENTS.DEAL_CANCELLED_V1, updated, actor);
    return updated;
  }

  async renewDeal(dealId, payload = {}, actor = {}) {
    const deal = await this.getDeal(dealId, actor);
    const renewed = await this.createDeal({
      ...deal,
      title: payload.title || `${deal.title} Renewal`,
      startAt: payload.startAt || deal.startAt,
      endAt: payload.endAt || deal.endAt,
      allocatedQuantity: payload.allocatedQuantity ?? deal.allocatedQuantity,
      soldQuantity: 0,
      reservedQuantity: 0,
      status: DEAL_STATUS.DRAFT,
      metadata: {
        ...(deal.metadata || {}),
        renewedFromDealId: deal.id,
      },
    }, actor);
    await this.dealRepository.updateDealStatus(deal.id, {
      status: deal.status,
      updatedBy: actor.userId,
      metadata: { renewedToDealId: renewed.id },
    }, {
      eventType: DEAL_TIMELINE_EVENT.RENEWED,
      payload: { renewedToDealId: renewed.id },
      actorId: actor.userId,
      actorRole: actor.role,
    });
    return renewed;
  }

  async upsertCommissionRule(dealId, payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can update deal commission", 403);
    const deal = await this.dealRepository.findDealById(dealId);
    if (!deal) throw new AppError("Deal not found", 404);
    return this.dealRepository.upsertCommissionRule(dealId, { ...payload, sellerId: deal.sellerId }, actor);
  }

  async upsertSponsorship(dealId, payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can update deal sponsorship", 403);
    const deal = await this.dealRepository.findDealById(dealId);
    if (!deal) throw new AppError("Deal not found", 404);
    return this.dealRepository.upsertSponsorship(dealId, payload, actor);
  }

  async removeSponsorship(sponsorshipId, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can remove deal sponsorship", 403);
    const row = await this.dealRepository.removeSponsorship(sponsorshipId, actor);
    if (!row) throw new AppError("Sponsorship not found", 404);
    return row;
  }

  async getPublicPlacements(query = {}) {
    return this.dealRepository.listActivePlacements(query);
  }

  normalizeProductForDeal(product = {}) {
    const raw = typeof product.toObject === "function" ? product.toObject() : product;
    return {
      ...raw,
      id: String(raw._id || raw.id || ""),
      _id: raw._id,
    };
  }

  productMatchesDealFilters(product = {}, query = {}) {
    const search = String(query.q || query.search || "").trim().toLowerCase();
    if (search) {
      const haystack = [
        product.title,
        product.name,
        product.description,
        product.sku,
        product.brand,
        product.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (query.category && String(product.category || product.categoryId || "") !== String(query.category)) {
      return false;
    }
    if (query.brand && String(product.brand || "").toLowerCase() !== String(query.brand).toLowerCase()) {
      return false;
    }
    return true;
  }

  sortDealProducts(items = [], sort = "") {
    const sorted = [...items];
    if (sort === "price_asc") {
      return sorted.sort((left, right) => Number(left.price || 0) - Number(right.price || 0));
    }
    if (sort === "price_desc") {
      return sorted.sort((left, right) => Number(right.price || 0) - Number(left.price || 0));
    }
    if (sort === "ending_soon") {
      return sorted.sort((left, right) => new Date(left.deal?.endAt || 0) - new Date(right.deal?.endAt || 0));
    }
    if (sort === "discount") {
      return sorted.sort((left, right) => Number(right.discountPercent || 0) - Number(left.discountPercent || 0));
    }
    return sorted;
  }

  async getPublicDealProducts(query = {}) {
    await this.dealRepository.expireDueDeals({ userId: "system", role: "system" }).catch(() => null);

    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 12)));
    const dealRows = await this.dealRepository.listActiveDealProducts({
      sellerId: query.sellerId,
      productId: query.productId,
      dealType: query.dealType,
      sortBy: ["price_asc", "price_desc", "ending_soon", "discount"].includes(query.sort)
        ? "priority"
        : query.sortBy,
      sortDir: query.sortDir,
      limit: 500,
    });

    const productIds = Array.from(new Set(dealRows.map((deal) => String(deal.productId)).filter(Boolean)));
    const products = await this.productRepository.findByIds(productIds);
    const productById = new Map(
      products.map((product) => {
        const normalized = this.normalizeProductForDeal(product);
        return [String(normalized._id || normalized.id), normalized];
      }),
    );

    const items = dealRows
      .map((deal) => {
        const product = productById.get(String(deal.productId));
        if (!product || product.status !== "active") return null;
        if (!this.productMatchesDealFilters(product, query)) return null;

        const dealBadge = deal.metadata?.dealBadge || deal.metadata?.badge || "Deal";
        const remainingQuantity = Math.max(
          0,
          Number(deal.allocatedQuantity || 0) -
            Number(deal.soldQuantity || 0) -
            Number(deal.reservedQuantity || 0),
        );

        return {
          ...product,
          id: String(product._id || product.id),
          productId: String(product._id || product.id),
          price: Number(deal.dealPrice || 0),
          salePrice: Number(deal.dealPrice || 0),
          sellingPrice: Number(deal.dealPrice || 0),
          mrp: Number(deal.originalPrice || product.mrp || product.price || 0),
          originalPrice: Number(deal.originalPrice || product.price || 0),
          compareAtPrice: Number(deal.originalPrice || product.mrp || product.price || 0),
          discountPercent: Number(deal.discountPercent || 0),
          metadata: {
            ...(product.metadata || {}),
            isDealProduct: true,
            dealBadge,
            dealSource: deal.metadata?.dealSource || null,
          },
          deal: {
            dealId: deal.id,
            dealNumber: deal.dealNumber,
            title: deal.title,
            badge: dealBadge,
            source: deal.metadata?.dealSource || null,
            dealType: deal.dealType,
            originalPrice: Number(deal.originalPrice || 0),
            dealPrice: Number(deal.dealPrice || 0),
            discountPercent: Number(deal.discountPercent || 0),
            allocatedQuantity: Number(deal.allocatedQuantity || 0),
            soldQuantity: Number(deal.soldQuantity || 0),
            reservedQuantity: Number(deal.reservedQuantity || 0),
            remainingQuantity,
            maxQuantityPerOrder: deal.maxQuantityPerOrder,
            startAt: deal.startAt,
            endAt: deal.endAt,
          },
        };
      })
      .filter(Boolean);

    const sortedItems = this.sortDealProducts(items, query.sort);
    const total = sortedItems.length;
    const offset = (page - 1) * limit;
    return {
      items: sortedItems.slice(offset, offset + limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  async getAnalytics(query = {}, actor = {}) {
    const filters = this.scopeListQuery(query, actor);
    return this.dealRepository.getAnalytics(filters);
  }

  async listPayouts(query = {}, actor = {}) {
    return this.dealRepository.listPayouts(this.scopeListQuery(query, actor));
  }

  async generatePayout(payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can generate deal payouts", 403);
    return this.dealRepository.generatePayout(payload, actor);
  }

  async processPayout(payoutId, payload = {}, actor = {}) {
    if (!this.isAdmin(actor)) throw new AppError("Only admin users can process deal payouts", 403);
    const row = await this.dealRepository.processPayout(payoutId, payload, actor);
    if (!row) throw new AppError("Deal payout not found", 404);
    return row;
  }

  async findActiveDealForItem(input = {}) {
    const deal = await this.dealRepository.findActiveDealForItem(input);
    if (!deal) return null;
    return this.buildDealPricingSnapshot(deal);
  }

  buildDealPricingSnapshot(deal = {}) {
    return {
      dealId: deal.id,
      dealNumber: deal.dealNumber || deal.deal_number,
      title: deal.title,
      sellerId: deal.sellerId,
      productId: deal.productId,
      variantId: deal.variantId || null,
      variantSku: deal.variantSku || null,
      dealType: deal.dealType,
      originalPrice: deal.originalPrice,
      dealPrice: deal.dealPrice,
      discountPercent: deal.discountPercent,
      startAt: deal.startAt,
      endAt: deal.endAt,
      allocatedQuantity: deal.allocatedQuantity,
      soldQuantity: deal.soldQuantity,
      reservedQuantity: deal.reservedQuantity,
      maxQuantityPerOrder: deal.maxQuantityPerOrder,
      commissionRuleSnapshot: deal.commissionRuleSnapshot || {},
      fulfillmentSnapshot: {
        dealId: deal.id,
        fulfillmentModel: deal.fulfillmentModel,
        deliveryVerificationRequired: deal.deliveryVerificationRequired,
        deliveryVerificationMethods: deal.deliveryVerificationMethods || [],
      },
    };
  }

  async reserveOrderSales(order, actor = {}) {
    if (!order?.id) return { reserved: 0, items: [] };
    const items = order.items || [];
    return this.dealRepository.reserveOrderSales({ orderId: order.id, orderItems: items, actor });
  }

  async commitOrderSales(orderId, actor = {}) {
    return this.dealRepository.updateSalesForOrder(orderId, {
      status: "confirmed",
      eventType: DEAL_TIMELINE_EVENT.SALE_CONFIRMED,
      actor,
    });
  }

  async releaseOrderSales(orderId, actor = {}) {
    return this.dealRepository.updateSalesForOrder(orderId, {
      status: "cancelled",
      eventType: DEAL_TIMELINE_EVENT.CANCELLED,
      actor,
    });
  }

  async cancelOrderItemSales(orderId, cancellationId, items, actor = {}) {
    return this.dealRepository.cancelOrderItemSales(orderId, cancellationId, items, actor);
  }

  async markOrderDeliveryVerified(orderId, actor = {}) {
    return this.dealRepository.updateSalesForOrder(orderId, {
      status: "delivered_verified",
      payoutEligible: true,
      eventType: DEAL_TIMELINE_EVENT.DELIVERY_VERIFIED,
      actor,
    });
  }

  async publishDealEvent(eventName, deal, actor = {}) {
    if (!eventName || !deal) return;
    await eventPublisher.publish(
      makeEvent(
        eventName,
        {
          dealId: deal.id,
          dealNumber: deal.dealNumber || deal.deal_number,
          sellerId: deal.sellerId || deal.seller_id,
          productId: deal.productId || deal.product_id,
          status: deal.status,
          updatedBy: actor.userId || null,
        },
        { source: "deal-module", aggregateId: deal.id },
      ),
    );
  }
}

module.exports = { DealService };
