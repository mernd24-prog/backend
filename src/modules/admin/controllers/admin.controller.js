const { okResponse } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { AdminService } = require("../services/admin.service");
const { sellerOrganizationService } = require("../../seller/services/seller-organization.service");

class AdminController {
  constructor({ adminService = new AdminService() } = {}) {
    this.adminService = adminService;
  }

  overview = async (req, res) => {
    const data = await this.adminService.getOverview();
    res.json(okResponse(data));
  };

  listActivityLogs = async (req, res) => {
    const result = await this.adminService.listActivityLogs(req.query);
    res.json(okResponse(result.logs, {
      total: result.total,
      page: result.page,
      limit: result.limit,
    }));
  };

  listVendors = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.adminService.listVendors(req.query, actor);
    res.json(okResponse(result.items, { total: result.total }));
  };

  listUsers = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.adminService.listUsers(req.query, actor);
    res.json(okResponse(result.items, { total: result.total }));
  };

  createUser = async (req, res) => {
    const actor = getCurrentUser(req);
    const user = await this.adminService.createUser(req.body, actor);
    res.status(201).json(okResponse(user));
  };

  getUser = async (req, res) => {
    const actor = getCurrentUser(req);
    const user = await this.adminService.getUser(req.params.userId, actor);
    res.json(okResponse(user));
  };

  updateUser = async (req, res) => {
    const user = await this.adminService.updateUser(
      req.params.userId,
      req.body,
      getCurrentUser(req),
    );
    res.json(okResponse(user));
  };

  deactivateUser = async (req, res) => {
    const user = await this.adminService.deactivateUser(
      req.params.userId,
      req.body,
      getCurrentUser(req),
    );
    res.json(okResponse(user));
  };

  updateVendorStatus = async (req, res) => {
    const seller = await this.adminService.updateVendorStatus(
      req.params.sellerId,
      req.body,
    );
    res.json(okResponse(seller));
  };

  getSeller = async (req, res) => {
    const seller = await this.adminService.getSeller(req.params.sellerId);
    res.json(okResponse(seller));
  };

  getSellerKyc = async (req, res) => {
    const result = await this.adminService.getSellerKyc(req.params.sellerId);
    res.json(okResponse(result));
  };

  listAllSellerOrganizations = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await sellerOrganizationService.adminList(req.query, actor);
    res.json(okResponse(result.items, {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    }));
  };

  listSellerOrganizations = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await sellerOrganizationService.adminListForSeller(
      req.params.sellerId,
      req.query,
      actor,
    );
    res.json(okResponse(result));
  };

  createSellerOrganization = async (req, res) => {
    const actor = getCurrentUser(req);
    const organization = await sellerOrganizationService.adminCreate(
      req.params.sellerId,
      req.body,
      actor,
    );
    res.status(201).json(okResponse(organization));
  };

  getSellerOrganization = async (req, res) => {
    const actor = getCurrentUser(req);
    const organization = await sellerOrganizationService.adminGet(
      req.params.sellerId,
      req.params.organizationId,
      actor,
    );
    res.json(okResponse(organization));
  };

  updateSellerOrganization = async (req, res) => {
    const actor = getCurrentUser(req);
    const organization = await sellerOrganizationService.adminUpdate(
      req.params.sellerId,
      req.params.organizationId,
      req.body,
      actor,
    );
    res.json(okResponse(organization));
  };

  reviewSellerOrganization = async (req, res) => {
    const actor = getCurrentUser(req);
    const organization = await sellerOrganizationService.adminReview(
      req.params.sellerId,
      req.params.organizationId,
      req.body,
      actor,
    );
    res.json(okResponse(organization));
  };

  updateSellerKycStatus = async (req, res) => {
    const actor = getCurrentUser(req);
    const seller = await this.adminService.updateSellerKycStatus(
      req.params.sellerId,
      req.body,
      actor,
    );
    res.json(okResponse(seller));
  };

  updateSellerBankStatus = async (req, res) => {
    const actor = getCurrentUser(req);
    const seller = await this.adminService.updateSellerBankStatus(
      req.params.sellerId,
      req.body,
      actor,
    );
    res.json(okResponse(seller));
  };

  updateSellerOnboardingStatus = async (req, res) => {
    const seller = await this.adminService.updateSellerOnboardingStatus(
      req.params.sellerId,
      req.body,
    );
    res.json(okResponse(seller));
  };

  updateSellerGoLiveStatus = async (req, res) => {
    const actor = getCurrentUser(req);
    const seller = await this.adminService.updateSellerGoLiveStatus(
      req.params.sellerId,
      req.body,
      actor,
    );
    res.json(okResponse(seller));
  };

  moderationQueue = async (req, res) => {
    const result = await this.adminService.listProductModerationQueue(
      req.query,
    );
    res.json(okResponse(result.items, { total: result.total }));
  };

  moderateProduct = async (req, res) => {
    const actor = getCurrentUser(req);
    const product = await this.adminService.moderateProduct(
      req.params.productId,
      req.body,
      actor,
    );
    res.json(okResponse(product));
  };

  listOrders = async (req, res) => {
    const items = await this.adminService.listOrders(req.query);
    res.json(okResponse(items));
  };

  listPayments = async (req, res) => {
    const items = await this.adminService.listPayments(req.query);
    res.json(okResponse(items));
  };

  createPayout = async (req, res) => {
    const payout = await this.adminService.createPayout(req.body);
    res.status(201).json(okResponse(payout));
  };

  listPayouts = async (req, res) => {
    const payouts = await this.adminService.listPayouts(req.query);
    res.json(okResponse(payouts));
  };

  taxReport = async (req, res) => {
    const report = await this.adminService.getTaxReport(req.query);
    res.json(okResponse(report));
  };

  createInvoice = async (req, res) => {
    const invoice = await this.adminService.createInvoice(req.params.orderId);
    res.status(201).json(okResponse(invoice));
  };

  createApiKey = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.adminService.createApiKey(req.body, actor);
    res.status(201).json(okResponse(result));
  };

  listApiKeys = async (req, res) => {
    const keys = await this.adminService.listApiKeys(req.query);
    res.json(okResponse(keys));
  };

  createWebhookSubscription = async (req, res) => {
    const actor = getCurrentUser(req);
    const subscription = await this.adminService.createWebhookSubscription(
      req.body,
      actor,
    );
    res.status(201).json(okResponse(subscription));
  };

  listWebhookSubscriptions = async (req, res) => {
    const subscriptions = await this.adminService.listWebhookSubscriptions(
      req.query,
    );
    res.json(okResponse(subscriptions));
  };

  upsertFeatureFlag = async (req, res) => {
    const actor = getCurrentUser(req);
    const flag = await this.adminService.upsertFeatureFlag(req.body, actor);
    res.json(okResponse(flag));
  };

  listFeatureFlags = async (req, res) => {
    const flags = await this.adminService.listFeatureFlags(req.query);
    res.json(okResponse(flags));
  };

  realtimeAnalytics = async (req, res) => {
    const data = await this.adminService.getRealtimeAnalytics(req.query);
    res.json(okResponse(data));
  };

  returnsAnalytics = async (req, res) => {
    const data = await this.adminService.getReturnsAnalytics(req.query);
    res.json(okResponse(data));
  };

  listChargebacks = async (req, res) => {
    const data = await this.adminService.listChargebacks(req.query);
    res.json(okResponse(data.items, { total: data.total }));
  };

  systemHealth = async (req, res) => {
    const data = await this.adminService.getSystemHealth();
    res.json(okResponse(data));
  };

  queueStatus = async (req, res) => {
    const data = await this.adminService.getQueueStatus();
    res.json(okResponse(data));
  };

  pauseQueue = async (req, res) => {
    const result = await this.adminService.pauseQueue(req.params.queueName);
    res.json(okResponse(result));
  };

  resumeQueue = async (req, res) => {
    const result = await this.adminService.resumeQueue(req.params.queueName);
    res.json(okResponse(result));
  };

  listDeadLetterEvents = async (req, res) => {
    const data = await this.adminService.listDeadLetterEvents(req.query);
    res.json(okResponse(data.items, { total: data.total }));
  };

  retryDeadLetterEvent = async (req, res) => {
    const event = await this.adminService.retryDeadLetterEvent(
      req.params.eventId,
      req.body,
    );
    res.json(okResponse(event));
  };

  discardDeadLetterEvent = async (req, res) => {
    const event = await this.adminService.discardDeadLetterEvent(
      req.params.eventId,
      req.body,
    );
    res.json(okResponse(event));
  };

  createSubscriptionPlan = async (req, res) => {
    const plan = await this.adminService.createSubscriptionPlan(req.body);
    res.status(201).json(okResponse(plan));
  };

  listSubscriptionPlans = async (req, res) => {
    const plans = await this.adminService.listSubscriptionPlans(req.query);
    res.json(okResponse(plans));
  };

  getSubscriptionPlan = async (req, res) => {
    const plan = await this.adminService.getSubscriptionPlan(req.params.planId);
    res.json(okResponse(plan));
  };

  updateSubscriptionPlan = async (req, res) => {
    const plan = await this.adminService.updateSubscriptionPlan(
      req.params.planId,
      req.body,
    );
    res.json(okResponse(plan));
  };

  deleteSubscriptionPlan = async (req, res) => {
    const plan = await this.adminService.deleteSubscriptionPlan(
      req.params.planId,
    );
    res.json(okResponse(plan));
  };

  listPlatformSubscriptions = async (req, res) => {
    const subscriptions = await this.adminService.listPlatformSubscriptions(
      req.query,
    );
    res.json(okResponse(subscriptions));
  };

  updatePlatformSubscriptionStatus = async (req, res) => {
    const subscription =
      await this.adminService.updatePlatformSubscriptionStatus(
        req.params.subscriptionId,
        req.body.status,
      );
    res.json(okResponse(subscription));
  };

  createPlatformFeeConfig = async (req, res) => {
    const config = await this.adminService.createPlatformFeeConfig(req.body);
    res.status(201).json(okResponse(config));
  };

  listPlatformFeeConfigs = async (req, res) => {
    const configs = await this.adminService.listPlatformFeeConfigs(req.query);
    res.json(okResponse(configs));
  };

  getPlatformFeeConfig = async (req, res) => {
    const config = await this.adminService.getPlatformFeeConfig(
      req.params.configId,
    );
    res.json(okResponse(config));
  };

  updatePlatformFeeConfig = async (req, res) => {
    const config = await this.adminService.updatePlatformFeeConfig(
      req.params.configId,
      req.body,
    );
    res.json(okResponse(config));
  };

  deletePlatformFeeConfig = async (req, res) => {
    const config = await this.adminService.deletePlatformFeeConfig(
      req.params.configId,
    );
    res.json(okResponse(config));
  };

  listAccessModules = async (req, res) => {
    const actor = getCurrentUser(req);
    const modules = await this.adminService.listAccessModules(req.query, actor);
    res.json(okResponse(modules));
  };

  createAdmin = async (req, res) => {
    const actor = getCurrentUser(req);
    const user = await this.adminService.createAdmin(req.body, actor);
    res.status(201).json(okResponse(user));
  };

  listAdmins = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.adminService.listAdmins(req.query, actor);
    res.json(okResponse(result.items, { total: result.total }));
  };

  createPlatformSubAdmin = async (req, res) => {
    const actor = getCurrentUser(req);
    const user = await this.adminService.createPlatformSubAdmin(
      req.body,
      actor,
    );
    res.status(201).json(okResponse(user));
  };

  listPlatformSubAdmins = async (req, res) => {
    const actor = getCurrentUser(req);
    const users = await this.adminService.listPlatformSubAdmins(
      req.query,
      actor,
    );
    res.json(okResponse(users));
  };

  listSellerUsers = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.adminService.listSellerUsers(req.query, actor);
    res.json(okResponse(result.items, { total: result.total }));
  };

  listSellerAdmins = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.adminService.listSellerStaffByRole(
      req.query,
      actor,
      "seller-admin",
    );
    res.json(okResponse(result.items, { total: result.total }));
  };

  listSellerSubAdmins = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.adminService.listSellerStaffByRole(
      req.query,
      actor,
      "seller-sub-admin",
    );
    res.json(okResponse(result.items, { total: result.total }));
  };

  createSellerAdmin = async (req, res) => {
    const actor = getCurrentUser(req);
    const user = await this.adminService.createSellerStaff(
      req.body,
      actor,
      "seller-admin",
    );
    res.status(201).json(okResponse(user));
  };

  createSellerSubAdmin = async (req, res) => {
    const actor = getCurrentUser(req);
    const user = await this.adminService.createSellerStaff(
      req.body,
      actor,
      "seller-sub-admin",
    );
    res.status(201).json(okResponse(user));
  };

  updatePlatformSubAdminModules = async (req, res) => {
    const actor = getCurrentUser(req);
    const user = await this.adminService.updatePlatformSubAdminModules(
      req.params.userId,
      req.body,
      actor,
    );
    res.json(okResponse(user));
  };
}

module.exports = { AdminController };
