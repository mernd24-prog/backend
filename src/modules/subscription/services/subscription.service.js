const { AppError } = require("../../../shared/errors/app-error");
const { SubscriptionRepository } = require("../repositories/subscription.repository");

class SubscriptionService {
  constructor({ subscriptionRepository = new SubscriptionRepository() } = {}) {
    this.subscriptionRepository = subscriptionRepository;
  }

  async listPlans() {
    return this.subscriptionRepository.listActivePlans();
  }

  async purchasePlan(payload, actor) {
    const plan = await this.subscriptionRepository.getPlanById(payload.planId);
    if (!plan || !plan.active) {
      throw new AppError("Plan not found", 404);
    }

    const roleAllowed = !Array.isArray(plan.target_roles) || plan.target_roles.length === 0
      ? true
      : plan.target_roles.includes(actor.role);

    if (!roleAllowed) {
      throw new AppError("This plan is not available for your role", 403);
    }

    const billingCycle = payload.billingCycle || "monthly";
    const amount = Number(billingCycle === "yearly" ? plan.yearly_price : plan.monthly_price);

    return this.subscriptionRepository.createSubscription({
      userId: actor.userId,
      userRole: actor.role,
      planId: plan.id,
      billingCycle,
      amount,
      currency: plan.currency || "INR",
      metadata: payload.metadata || {},
    });
  }

  async listMySubscriptions(actor) {
    return this.subscriptionRepository.listSubscriptionsByUser(actor.userId);
  }

  async pauseSubscription(subscriptionId, actor) {
    const sub = await this.subscriptionRepository.findSubscriptionById(subscriptionId);
    if (!sub || sub.user_id !== actor.userId) {
      throw new AppError("Subscription not found", 404);
    }
    return this.subscriptionRepository.updateSubscriptionStatus(subscriptionId, "paused");
  }

  async resumeSubscription(subscriptionId, actor) {
    const sub = await this.subscriptionRepository.findSubscriptionById(subscriptionId);
    if (!sub || sub.user_id !== actor.userId) {
      throw new AppError("Subscription not found", 404);
    }
    return this.subscriptionRepository.updateSubscriptionStatus(subscriptionId, "active");
  }

  async cancelSubscription(subscriptionId, actor) {
    const sub = await this.subscriptionRepository.findSubscriptionById(subscriptionId);
    if (!sub || sub.user_id !== actor.userId) {
      throw new AppError("Subscription not found", 404);
    }
    return this.subscriptionRepository.updateSubscriptionStatus(subscriptionId, "cancelled");
  }

  async createPlan(payload) {
    return this.subscriptionRepository.createPlan(payload);
  }

  async listPlansAdmin(query) {
    const active = query.active === undefined ? null : String(query.active).toLowerCase() === "true";
    return this.subscriptionRepository.listPlansAdmin({
      active,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async getPlan(planId) {
    const plan = await this.subscriptionRepository.getPlanById(planId);
    if (!plan) {
      throw new AppError("Plan not found", 404);
    }
    return plan;
  }

  async updatePlan(planId, payload) {
    const updated = await this.subscriptionRepository.updatePlan(planId, payload);
    if (!updated) {
      throw new AppError("Plan not found", 404);
    }
    return updated;
  }

  async deletePlan(planId) {
    const deleted = await this.subscriptionRepository.deletePlan(planId);
    if (!deleted) {
      throw new AppError("Plan not found", 404);
    }
    return deleted;
  }

  async listSubscriptionsAdmin(query) {
    return this.subscriptionRepository.listSubscriptionsAdmin({
      status: query.status || null,
      userRole: query.userRole || null,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async updateSubscriptionStatusAdmin(subscriptionId, status) {
    const existing = await this.subscriptionRepository.findSubscriptionById(subscriptionId);
    if (!existing) {
      throw new AppError("Subscription not found", 404);
    }

    return this.subscriptionRepository.updateSubscriptionStatus(subscriptionId, status);
  }

}

module.exports = { SubscriptionService };
