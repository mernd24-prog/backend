const { okResponse } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { SubscriptionService } = require("../services/subscription.service");

class SubscriptionController {
  constructor({ subscriptionService = new SubscriptionService() } = {}) {
    this.subscriptionService = subscriptionService;
  }

  listPlans = async (req, res) => {
    const plans = await this.subscriptionService.listPlans();
    res.json(okResponse(plans));
  };

  purchasePlan = async (req, res) => {
    const actor = getCurrentUser(req);
    const subscription = await this.subscriptionService.purchasePlan(req.body, actor);
    res.status(201).json(okResponse(subscription));
  };

  listMine = async (req, res) => {
    const actor = getCurrentUser(req);
    const subscriptions = await this.subscriptionService.listMySubscriptions(actor);
    res.json(okResponse(subscriptions));
  };

  pauseMine = async (req, res) => {
    const actor = getCurrentUser(req);
    const subscription = await this.subscriptionService.pauseSubscription(req.params.subscriptionId, actor);
    res.json(okResponse(subscription));
  };

  resumeMine = async (req, res) => {
    const actor = getCurrentUser(req);
    const subscription = await this.subscriptionService.resumeSubscription(req.params.subscriptionId, actor);
    res.json(okResponse(subscription));
  };

  cancelMine = async (req, res) => {
    const actor = getCurrentUser(req);
    const subscription = await this.subscriptionService.cancelSubscription(req.params.subscriptionId, actor);
    res.json(okResponse(subscription));
  };

  createPlan = async (req, res) => {
    const plan = await this.subscriptionService.createPlan(req.body);
    res.status(201).json(okResponse(plan));
  };

  listPlansAdmin = async (req, res) => {
    const plans = await this.subscriptionService.listPlansAdmin(req.query);
    res.json(okResponse(plans));
  };

  getPlan = async (req, res) => {
    const plan = await this.subscriptionService.getPlan(req.params.planId);
    res.json(okResponse(plan));
  };

  updatePlan = async (req, res) => {
    const plan = await this.subscriptionService.updatePlan(req.params.planId, req.body);
    res.json(okResponse(plan));
  };

  deletePlan = async (req, res) => {
    const plan = await this.subscriptionService.deletePlan(req.params.planId);
    res.json(okResponse(plan));
  };

  listSubscriptionsAdmin = async (req, res) => {
    const subscriptions = await this.subscriptionService.listSubscriptionsAdmin(req.query);
    res.json(okResponse(subscriptions));
  };

  updateSubscriptionStatusAdmin = async (req, res) => {
    const subscription = await this.subscriptionService.updateSubscriptionStatusAdmin(
      req.params.subscriptionId,
      req.body.status,
    );
    res.json(okResponse(subscription));
  };

}

module.exports = { SubscriptionController };
