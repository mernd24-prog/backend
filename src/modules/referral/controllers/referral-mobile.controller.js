const { okResponse, paginationMeta } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { ReferralService } = require("../services/referral.service");

class ReferralMobileController {
  constructor({ referralService = new ReferralService() } = {}) {
    this.referralService = referralService;
  }

  dashboardSummary = async (req, res) => {
    const result = await this.referralService.getInfluencerDashboard(
      getCurrentUser(req),
      req.query,
    );
    res.json(okResponse(result));
  };

  analytics = async (req, res) => {
    const result = await this.referralService.getMyInfluencerAnalytics(
      getCurrentUser(req),
      req.query,
    );
    res.json(okResponse(result));
  };

  myCodes = async (req, res) => {
    const result = await this.referralService.listMyInfluencerCodes(
      getCurrentUser(req),
      req.query,
    );
    res.json(
      okResponse(result.items, {
        pagination: paginationMeta(result.page, result.limit, result.total),
      }),
    );
  };

  referralOrders = async (req, res) => {
    const result = await this.referralService.listMyReferralOrders(
      getCurrentUser(req),
      req.query,
    );
    res.json(
      okResponse(result.items, {
        pagination: paginationMeta(result.page, result.limit, result.total),
        meta: { summary: result.pageSummary },
      }),
    );
  };

  coinLedger = async (req, res) => {
    const result = await this.referralService.listMyCoinLedger(
      getCurrentUser(req),
      req.query,
    );
    res.json(
      okResponse(result.items, {
        pagination: paginationMeta(result.page, result.limit, result.total),
      }),
    );
  };

  wallet = async (req, res) => {
    const result = await this.referralService.getMyInfluencerWallet(getCurrentUser(req));
    res.json(okResponse(result));
  };

  withdrawals = async (req, res) => {
    const result = await this.referralService.listMyWithdrawals(
      getCurrentUser(req),
      req.query,
    );
    res.json(
      okResponse(result.items, {
        pagination: paginationMeta(result.page, result.limit, result.total),
      }),
    );
  };

  createWithdrawal = async (req, res) => {
    const result = await this.referralService.createMyWithdrawal(
      getCurrentUser(req),
      req.body,
    );
    res.status(201).json(okResponse(result));
  };

  network = async (req, res) => {
    const result = await this.referralService.getMyInfluencerNetwork(
      getCurrentUser(req),
      req.query,
    );
    res.json(
      okResponse(
        {
          parent: result.parent,
          summary: result.summary,
          children: result.children,
        },
        {
          pagination: paginationMeta(result.page, result.limit, result.total),
          meta: { summary: result.summary },
        },
      ),
    );
  };

  networkChildDetail = async (req, res) => {
    const result = await this.referralService.getMyChildInfluencerDetail(
      getCurrentUser(req),
      req.params.childId,
      req.query,
    );
    res.json(okResponse(result));
  };

  createNetworkChild = async (req, res) => {
    const result = await this.referralService.createMyChildInfluencer(
      getCurrentUser(req),
      req.body,
    );
    res.status(201).json(okResponse(result));
  };

  profile = async (req, res) => {
    const result = await this.referralService.getMyInfluencerProfile(getCurrentUser(req));
    res.json(okResponse(result));
  };

  updateProfile = async (req, res) => {
    const result = await this.referralService.updateMyInfluencerProfile(
      getCurrentUser(req),
      req.body,
    );
    res.json(okResponse(result));
  };

  session = async (req, res) => {
    const result = await this.referralService.getMyInfluencerSession(getCurrentUser(req));
    res.json(okResponse(result));
  };

  bonusProgress = async (req, res) => {
    const result = await this.referralService.getMyBonusProgress(
      getCurrentUser(req),
      req.query,
    );
    res.json(
      okResponse(result.items, {
        pagination: paginationMeta(result.page, result.limit, result.total),
      }),
    );
  };
}

module.exports = { ReferralMobileController };
