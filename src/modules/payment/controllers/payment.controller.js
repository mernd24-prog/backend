const { okResponse } = require("../../../shared/http/reply");
const { PaymentService } = require("../services/payment.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

class PaymentController {
  constructor({ paymentService = new PaymentService() } = {}) {
    this.paymentService = paymentService;
  }

  initiate = async (req, res) => {
    const actor = getCurrentUser(req);
    const payment = await this.paymentService.initiatePayment(req.body, actor);
    res.status(201).json(okResponse(payment));
  };

  options = async (req, res) => {
    const options = await this.paymentService.getPaymentOptions(req.query);
    res.json(okResponse(options));
  };

  verify = async (req, res) => {
    const actor = getCurrentUser(req);
    const payment = await this.paymentService.verifyPayment(req.body, actor);
    res.json(okResponse(payment));
  };

  listMine = async (req, res) => {
    const actor = getCurrentUser(req);
    const payments = await this.paymentService.listPayments(actor);
    res.json(okResponse(payments));
  };

  listAdmin = async (req, res) => {
    const actor = getCurrentUser(req);
    const payments = await this.paymentService.listPaymentsForAdmin(req.query, actor);
    res.json(okResponse(payments));
  };

  getAdminPayment = async (req, res) => {
    const actor = getCurrentUser(req);
    const payment = await this.paymentService.getPaymentForAdmin(req.params.paymentId, actor);
    res.json(okResponse(payment));
  };

  approveManual = async (req, res) => {
    const actor = getCurrentUser(req);
    const payment = await this.paymentService.approveManualPayment(req.params.paymentId, req.body, actor);
    await auditService.approve(req, {
      module: "payments",
      entityId: req.params.paymentId,
      entityType: "Payment",
      newData: payment,
      reason: req.body.reason || "manual_payment_approved",
    });
    res.json(okResponse(payment));
  };

  rejectManual = async (req, res) => {
    const actor = getCurrentUser(req);
    const payment = await this.paymentService.rejectManualPayment(req.params.paymentId, req.body, actor);
    await auditService.reject(req, {
      module: "payments",
      entityId: req.params.paymentId,
      entityType: "Payment",
      newData: payment,
      reason: req.body.reason,
    });
    res.json(okResponse(payment));
  };

  webhook = async (req, res) => {
    const result = await this.paymentService.handleWebhook(
      req.headers["x-razorpay-signature"],
      req.rawBody,
    );
    res.json(okResponse(result));
  };
}

module.exports = { PaymentController };
