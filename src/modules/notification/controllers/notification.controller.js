const { okResponse } = require("../../../shared/http/reply");
const { NotificationService } = require("../services/notification.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { AppError } = require("../../../shared/errors/app-error");
const { ROLES } = require("../../../shared/constants/roles");

const ADMIN_ROLES = new Set([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SUB_ADMIN]);
const SELLER_ROLES = new Set([
  ROLES.SELLER,
  ROLES.SELLER_ADMIN,
  ROLES.SELLER_SUB_ADMIN,
]);

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
    const result = await this.notificationService.listMyNotifications(actor, req.query);
    res.json(okResponse(result.items, {
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit) || 0,
      },
    }));
  };

  listAdmin = async (req, res) => {
    const actor = getCurrentUser(req);
    if (!ADMIN_ROLES.has(actor.role) && actor.isSuperAdmin !== true) {
      if (SELLER_ROLES.has(actor.role)) {
        const result = await this.notificationService.listMyNotifications(actor, req.query);
        res.json(okResponse(result.items, {
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: Math.ceil(result.total / result.limit) || 0,
          },
        }));
        return;
      }
      throw new AppError("Only admin users can view all notifications", 403);
    }
    const { page, limit, type, userId, search } = req.query;
    const result = await this.notificationService.notificationRepository.listAll({
      page, limit, type, userId, search,
    });
    res.json(okResponse(result.items, { total: result.total }));
  };
}

module.exports = { NotificationController };
