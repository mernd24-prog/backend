"use strict";

const { AppError } = require("../../../shared/errors/app-error");
const { DealRepository } = require("../repositories/deal.repository");
const { ProductRepository } = require("../../product/repositories/product.repository");
const { NotificationRepository } = require("../../notification/repositories/notification.repository");
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
    return this.dealRepository.listDeals(this.scopeListQuery(query, actor));
  }

  async getDeal(dealId, actor = {}) {
    const deal = await this.dealRepository.getDealDetail(dealId);
    await this.assertDealVisible(deal, actor);
    return deal;
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
