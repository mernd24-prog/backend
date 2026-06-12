const { okResponse } = require("../../../shared/http/reply");
const { CartService } = require("../services/cart.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { auditService } = require("../../../shared/logger/audit.service");
const { getPage } = require("../../../shared/tools/page");

class CartController {
  constructor({ cartService = new CartService() } = {}) {
    this.cartService = cartService;
  }

  getMyCart = async (req, res) => {
    const actor = getCurrentUser(req);
    const cart = await this.cartService.getCart(actor.userId);
    res.json(okResponse(cart));
  };

  upsertMyCart = async (req, res) => {
    const actor = getCurrentUser(req);
    const cart = await this.cartService.upsertCart(actor.userId, req.body);
    res.json(okResponse(cart));
  };

  listAdminCarts = async (req, res) => {
    const pagination = getPage(req.query);
    const result = await this.cartService.listCarts(req.query, pagination);
    res.json(okResponse(result.items, {
      total: result.total,
      page: result.page,
      limit: result.limit,
    }));
  };

  getAdminCart = async (req, res) => {
    const cart = await this.cartService.getCartById(req.params.cartId);
    res.json(okResponse(cart));
  };

  clearAdminCart = async (req, res) => {
    const actor = getCurrentUser(req);
    const cart = await this.cartService.clearCart(req.params.cartId, actor);
    await auditService.record(req, {
      module: "carts",
      action: "delete",
      entityType: "Cart",
      entityId: req.params.cartId,
      newData: cart,
      reason: req.body?.reason || "admin_cart_clear",
      description: "Admin cleared customer cart",
    });
    res.json(okResponse(cart));
  };
}

module.exports = { CartController };
