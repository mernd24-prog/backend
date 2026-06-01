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

  getCodConfig = async (req, res) => {
    const actor = getCurrentUser(req);
    const config = await this.paymentService.getCodConfig(actor);
    res.json(okResponse(config));
  };

  updateCodConfig = async (req, res) => {
    const actor = getCurrentUser(req);
    const config = await this.paymentService.updateCodConfig(req.body, actor);
    res.json(okResponse(config));
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

  approveManual = async (req, res) => {
    const actor = getCurrentUser(req);
    const payment = await this.paymentService.approveManualPayment(req.params.paymentId, req.body, actor);
    res.json(okResponse(payment));
  };

  rejectManual = async (req, res) => {
    const actor = getCurrentUser(req);
    const payment = await this.paymentService.rejectManualPayment(req.params.paymentId, req.body, actor);
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
