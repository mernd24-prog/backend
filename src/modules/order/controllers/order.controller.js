const { okResponse } = require("../../../shared/http/reply");
const { OrderService } = require("../services/order.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

function orderResponse(data, message, meta = {}) {
  return {
    ...okResponse(data, meta),
    message,
  };
}

class OrderController {
  constructor({ orderService = new OrderService() } = {}) {
    this.orderService = orderService;
  }

  create = async (req, res) => {
    const actor = getCurrentUser(req);
    const order = await this.orderService.createOrder(req.body, actor);
    res.status(201).json(orderResponse(order, "Order created successfully"));
  };

  quote = async (req, res) => {
    const actor = getCurrentUser(req);
    const quote = await this.orderService.quoteOrder(req.body, actor);
    res.json(orderResponse(quote, "Order quote calculated successfully"));
  };

  adminQuote = async (req, res) => {
    const actor = getCurrentUser(req);
    const quote = await this.orderService.quoteOrder(req.body, actor, {
      buyerId: req.body.buyerId || actor.userId,
    });
    res.json(orderResponse(quote, "Checkout quote calculated successfully"));
  };

  listMine = async (req, res) => {
    const actor = getCurrentUser(req);
    const orders = await this.orderService.listMyOrders(actor, req.query);
    res.json(orderResponse(orders, "Orders fetched successfully"));
  };

  listSellerOrders = async (req, res) => {
    const actor = getCurrentUser(req);
    const orders = await this.orderService.listSellerOrders(actor, req.query);
    res.json(orderResponse(orders, "Seller orders fetched successfully"));
  };

  listAdminOrders = async (req, res) => {
    const actor = getCurrentUser(req);
    const orders = await this.orderService.listAdminOrders(actor, req.query);
    res.json(orderResponse(orders, "Order management list fetched successfully"));
  };

  getOne = async (req, res) => {
    const actor = getCurrentUser(req);
    const order = await this.orderService.getOrder(req.params.orderId, actor);
    res.json(orderResponse(order, "Order details fetched successfully"));
  };

  cancel = async (req, res) => {
    const actor = getCurrentUser(req);
    const order = await this.orderService.cancelOrder(req.params.orderId, req.body, actor);
    res.json(orderResponse(order, "Order cancelled successfully"));
  };

  updateStatus = async (req, res) => {
    const actor = getCurrentUser(req);
    const order = await this.orderService.updateOrderStatus(req.params.orderId, req.body.status, {
      ...actor,
      reason: req.body.reason || null,
      note: req.body.note || null,
      trackingNumber: req.body.trackingNumber || null,
      carrierName: req.body.carrierName || null,
      carrierUrl: req.body.carrierUrl || null,
    });
    res.json(orderResponse(order, "Order status updated successfully"));
  };

  addNote = async (req, res) => {
    const actor = getCurrentUser(req);
    const note = await this.orderService.addNote(req.params.orderId, req.body, actor);
    res.status(201).json(orderResponse(note, "Order note added successfully"));
  };

  reopenPayment = async (req, res) => {
    const actor = getCurrentUser(req);
    const order = await this.orderService.reopenPayment(req.params.orderId, actor);
    res.json(orderResponse(order, "Order payment reopened successfully"));
  };
}

module.exports = { OrderController };
