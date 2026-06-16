const { AnalyticsRepository } = require("../repositories/analytics.repository");
const { eventBus } = require("../../../infrastructure/events/event-bus");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { AppError } = require("../../../shared/errors/app-error");
const { ROLES } = require("../../../shared/constants/roles");
const { CommissionService } = require("../../seller/services/commission.service");

let subscribersRegistered = false;

class AnalyticsService {
  constructor({
    analyticsRepository = new AnalyticsRepository(),
    commissionService = CommissionService,
  } = {}) {
    this.analyticsRepository = analyticsRepository;
    this.commissionService = commissionService;
    this.registerSubscribers();
  }

  registerSubscribers() {
    if (subscribersRegistered) {
      return;
    }

    subscribersRegistered = true;

    eventBus.subscribe(DOMAIN_EVENTS.ORDER_CREATED_V1, async (event) => {
      await this.analyticsRepository.create({
        eventName: DOMAIN_EVENTS.ORDER_CREATED_V1,
        actorId: event.payload.buyerId,
        metadata: event.payload,
      });
    });

    eventBus.subscribe(DOMAIN_EVENTS.PAYMENT_INITIATED_V1, async (event) => {
      await this.analyticsRepository.create({
        eventName: DOMAIN_EVENTS.PAYMENT_INITIATED_V1,
        actorId: event.payload.buyerId,
        metadata: event.payload,
      });
    });
  }

  async track(payload) {
    return this.analyticsRepository.create(payload);
  }

  async listEvents() {
    return this.analyticsRepository.list();
  }

  async getSellerDashboard(query = {}, actor = {}) {
    const sellerId = this.resolveSellerId(query.sellerId, actor);
    const [dashboard, wallet] = await Promise.all([
      this.analyticsRepository.getSellerDashboard({
        sellerId,
        fromDate: query.fromDate || null,
        toDate: query.toDate || null,
        recentLimit: Number(query.limit || 10),
      }),
      this.commissionService.getSellerWalletSummary(sellerId, {
        fromDate: query.fromDate || null,
        toDate: query.toDate || null,
        limit: Number(query.walletLimit || 5),
        offset: 0,
      }),
    ]);

    return {
      ...dashboard,
      wallet: {
        balances: wallet.balances,
        counts: wallet.counts,
        payoutPolicy: wallet.payoutPolicy,
        nextEligibleAt: wallet.nextEligibleAt,
        canRequestPayout: wallet.canRequestPayout,
        minimumPayoutShortfall: wallet.minimumPayoutShortfall,
        payouts: wallet.payouts,
        recentItems: wallet.items || [],
      },
    };
  }

  async getAdminDashboard(query = {}, actor = {}) {
    if (!this.isAdmin(actor)) {
      throw new AppError("Only admin users can view marketplace analytics", 403);
    }

    return this.analyticsRepository.getAdminDashboard({
      fromDate: query.fromDate || null,
      toDate: query.toDate || null,
      topSellerLimit: Number(query.limit || 10),
    });
  }

  resolveSellerId(requestedSellerId, actor = {}) {
    if (this.isAdmin(actor)) {
      if (!requestedSellerId) {
        throw new AppError("sellerId is required for admin seller analytics", 400);
      }
      return requestedSellerId;
    }

    if (this.isSeller(actor)) {
      return actor.ownerSellerId || actor.userId;
    }

    throw new AppError("Only seller or admin users can view seller analytics", 403);
  }

  isAdmin(actor = {}) {
    return actor.isSuperAdmin ||
      [ROLES.ADMIN, ROLES.SUB_ADMIN, ROLES.SUPER_ADMIN].includes(actor.role);
  }

  isSeller(actor = {}) {
    return [ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN].includes(actor.role);
  }
}

module.exports = { AnalyticsService };
