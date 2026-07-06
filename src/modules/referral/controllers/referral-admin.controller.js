const { okResponse } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { ReferralService } = require("../services/referral.service");

class ReferralAdminController {
  constructor({ referralService = new ReferralService() } = {}) {
    this.referralService = referralService;
  }

  listInfluencers = async (req, res) => {
    const result = await this.referralService.listInfluencers(req.query);
    res.json(
      okResponse(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }),
    );
  };

  createParentInfluencer = async (req, res) => {
    const actor = getCurrentUser(req);
    const influencer = await this.referralService.createParentInfluencer(
      req.body,
      actor,
    );
    res.status(201).json(okResponse(influencer));
  };

  createChildInfluencer = async (req, res) => {
    const actor = getCurrentUser(req);
    const influencer = await this.referralService.createChildInfluencer(
      req.params.parentId,
      req.body,
      actor,
    );
    res.status(201).json(okResponse(influencer));
  };

  updateInfluencerStatus = async (req, res) => {
    const influencer = await this.referralService.updateInfluencerStatus(
      req.params.influencerId,
      req.body,
    );
    res.json(okResponse(influencer));
  };

  promoteInfluencer = async (req, res) => {
    const influencer = await this.referralService.promoteInfluencer(
      req.params.influencerId,
      req.body,
    );
    res.json(okResponse(influencer));
  };

  listCodes = async (req, res) => {
    const result = await this.referralService.listReferralCodes(req.query);
    res.json(
      okResponse(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }),
    );
  };

  createCode = async (req, res) => {
    const actor = getCurrentUser(req);
    const code = await this.referralService.createReferralCode(req.body, actor);
    res.status(201).json(okResponse(code));
  };

  updateCode = async (req, res) => {
    const code = await this.referralService.updateReferralCode(
      req.params.codeId,
      req.body,
    );
    res.json(okResponse(code));
  };

  listOrders = async (req, res) => {
    const result = await this.referralService.listReferralOrders(req.query);
    res.json(
      okResponse(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }),
    );
  };

  listCommissions = async (req, res) => {
    const result = await this.referralService.listReferralCommissions(req.query);
    res.json(
      okResponse(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }),
    );
  };

  listPayouts = async (req, res) => {
    const result = await this.referralService.listPayouts(req.query);
    res.json(
      okResponse(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }),
    );
  };

  approvePayout = async (req, res) => {
    const payout = await this.referralService.approvePayout(
      req.params.payoutId,
      req.body,
    );
    res.json(okResponse(payout));
  };

  rejectPayout = async (req, res) => {
    const payout = await this.referralService.rejectPayout(
      req.params.payoutId,
      req.body,
    );
    res.json(okResponse(payout));
  };

  markPayoutPaid = async (req, res) => {
    const payout = await this.referralService.markPayoutPaid(
      req.params.payoutId,
      req.body,
    );
    res.json(okResponse(payout));
  };

  getRules = async (req, res) => {
    const rules = await this.referralService.getCommissionRules(req.query);
    res.json(okResponse(rules));
  };

  upsertRules = async (req, res) => {
    const rules = await this.referralService.upsertCommissionRules(req.body);
    res.json(okResponse(rules));
  };

  listBonusRules = async (req, res) => {
    const result = await this.referralService.listBonusRules(req.query);
    res.json(
      okResponse(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }),
    );
  };

  createBonusRule = async (req, res) => {
    const actor = getCurrentUser(req);
    const rule = await this.referralService.createBonusRule(req.body, actor);
    res.status(201).json(okResponse(rule));
  };

  updateBonusRule = async (req, res) => {
    const rule = await this.referralService.updateBonusRule(
      req.params.ruleId,
      req.body,
    );
    res.json(okResponse(rule));
  };

  listBonusAchievements = async (req, res) => {
    const result = await this.referralService.listBonusAchievements(req.query);
    res.json(
      okResponse(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }),
    );
  };

  bonusProgressReport = async (req, res) => {
    const result = await this.referralService.getBonusProgressReport(req.query);
    res.json(
      okResponse(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }),
    );
  };

  evaluateBonusRules = async (req, res) => {
    const result = await this.referralService.evaluateBonusRules(req.body);
    res.json(okResponse(result));
  };

  summaryReport = async (req, res) => {
    const report = await this.referralService.getSummaryReport();
    res.json(okResponse(report));
  };

  hierarchyReport = async (req, res) => {
    const report = await this.referralService.getHierarchyReport();
    res.json(okResponse(report));
  };

  listFraudReviews = async (req, res) => {
    const result = await this.referralService.listFraudReviews(req.query);
    res.json(
      okResponse(result.items, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      }),
    );
  };
}

module.exports = { ReferralAdminController };
