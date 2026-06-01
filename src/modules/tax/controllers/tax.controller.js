const { okResponse } = require("../../../shared/http/reply");
const { TaxService } = require("../services/tax.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

class TaxController {
  constructor({ taxService = new TaxService() } = {}) {
    this.taxService = taxService;
  }

  createOrderInvoice = async (req, res) => {
    const invoice = await this.taxService.createInvoice(req.params.orderId);
    res.status(201).json(okResponse(invoice));
  };

  getOrderInvoice = async (req, res) => {
    const actor = getCurrentUser(req);
    const invoice = await this.taxService.getOrderInvoice(req.params.orderId, actor);
    res.json(okResponse(invoice));
  };

  listInvoices = async (req, res) => {
    const invoices = await this.taxService.listInvoices(req.query);
    res.json(okResponse(invoices));
  };

  createCreditNote = async (req, res) => {
    const creditNote = await this.taxService.createCreditNote(req.body);
    res.status(201).json(okResponse(creditNote));
  };

  listCreditNotes = async (req, res) => {
    const creditNotes = await this.taxService.listCreditNotes(req.query);
    res.json(okResponse(creditNotes));
  };

  getReport = async (req, res) => {
    const report = await this.taxService.getTaxReport(req.query);
    res.json(okResponse(report));
  };
}

module.exports = { TaxController };
