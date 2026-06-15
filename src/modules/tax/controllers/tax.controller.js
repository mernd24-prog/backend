const { okResponse } = require("../../../shared/http/reply");
const { TaxService } = require("../services/tax.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { auditService } = require("../../../shared/logger/audit.service");

class TaxController {
  constructor({ taxService = new TaxService() } = {}) {
    this.taxService = taxService;
  }

  createOrderInvoice = async (req, res) => {
    const actor = getCurrentUser(req);
    const invoice = await this.taxService.createInvoice(req.params.orderId, actor);
    await auditService.create(req, {
      module: "tax",
      entityId: invoice?.id,
      entityType: "TaxInvoice",
      newData: invoice,
      description: "Generated tax invoice",
    });
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
    const actor = getCurrentUser(req);
    const creditNote = await this.taxService.createCreditNote(req.body, actor);
    await auditService.create(req, {
      module: "tax",
      entityId: creditNote?.id,
      entityType: "TaxCreditNote",
      newData: creditNote,
      reason: req.body.reason || "credit_note_generated",
      description: "Generated tax credit note",
    });
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
