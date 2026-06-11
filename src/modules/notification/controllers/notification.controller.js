const { okResponse } = require("../../../shared/http/reply");
const { NotificationService } = require("../services/notification.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

class NotificationController {
  constructor({ notificationService = new NotificationService() } = {}) {
    this.notificationService = notificationService;
  }

  create = async (req, res) => {
    const notification = await this.notificationService.createNotification(req.body);
    res.status(201).json(okResponse(notification));
  };

  listMine = async (req, res) => {
    const actor = getCurrentUser(req);
    const notifications = await this.notificationService.listMyNotifications(actor);
    res.json(okResponse(notifications));
  };

  listAdmin = async (req, res) => {
    const { page, limit, type, userId, search } = req.query;
    const result = await this.notificationService.notificationRepository.listAll({
      page, limit, type, userId, search,
    });
    res.json(okResponse(result.items, { total: result.total }));
  };
}

module.exports = { NotificationController };
