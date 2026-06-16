const { okResponse } = require("../../../shared/http/reply");
const { AnalyticsService } = require("../services/analytics.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

class AnalyticsController {
  constructor({ analyticsService = new AnalyticsService() } = {}) {
    this.analyticsService = analyticsService;
  }

  track = async (req, res) => {
    const event = await this.analyticsService.track(req.body);
    res.status(201).json(okResponse(event));
  };

  list = async (req, res) => {
    const events = await this.analyticsService.listEvents();
    res.json(okResponse(events));
  };

  sellerDashboard = async (req, res) => {
    const actor = getCurrentUser(req);
    const dashboard = await this.analyticsService.getSellerDashboard(req.query, actor);
    res.json(okResponse(dashboard));
  };

  adminDashboard = async (req, res) => {
    const actor = getCurrentUser(req);
    const dashboard = await this.analyticsService.getAdminDashboard(req.query, actor);
    res.json(okResponse(dashboard));
  };
}

module.exports = { AnalyticsController };
