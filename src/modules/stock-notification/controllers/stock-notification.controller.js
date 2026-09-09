const { okResponse, paginationMeta } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { StockNotificationService } = require("../services/stock-notification.service");

class StockNotificationController {
  constructor({ stockNotificationService = new StockNotificationService() } = {}) {
    this.stockNotificationService = stockNotificationService;
  }

  create = async (req, res) => {
    const notification = await this.stockNotificationService.create(req.body, req.auth || {});
    res.status(201).json(okResponse(notification, { message: "Stock notification request saved" }));
  };

  list = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.stockNotificationService.list(req.query, actor);
    res.json(okResponse(result.items, {
      pagination: paginationMeta(
        Math.floor(result.offset / result.limit) + 1,
        result.limit,
        result.total,
      ),
      meta: { total: result.total, limit: result.limit, offset: result.offset },
    }));
  };

  notify = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.stockNotificationService.notifyBackInStock(req.body, actor);
    res.json(okResponse(result, { message: "Back-in-stock emails queued" }));
  };

  notifyBulk = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.stockNotificationService.notifyManyBackInStock(req.body, actor);
    res.json(okResponse(result, { message: "Back-in-stock email batch queued" }));
  };
}

module.exports = { StockNotificationController };
