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

  createMarketplaceInvoices = async (req, res) => {
    const actor = getCurrentUser(req);
    const bundle = await this.taxService.createMarketplaceInvoices(req.params.orderId, actor);
    await auditService.create(req, {
      module: "tax",
      entityId: req.params.orderId,
      entityType: "MarketplaceInvoiceBundle",
      newData: bundle,
      description: "Generated marketplace seller and commission invoices",
    });
    res.status(201).json(okResponse(bundle));
  };

  getMarketplaceInvoices = async (req, res) => {
    const actor = getCurrentUser(req);
    const bundle = await this.taxService.getMarketplaceInvoices(req.params.orderId, actor);
    res.json(okResponse(bundle));
  };

  listInvoices = async (req, res) => {
    const invoices = await this.taxService.listInvoices(req.query);
    res.json(okResponse(invoices));
  };

  exportInvoices = async (req, res) => {
    const document = await this.taxService.exportInvoices(req.query);
    this.sendDocument(res, document);
  };

  downloadInvoice = async (req, res) => {
    const actor = getCurrentUser(req);
    const document = await this.taxService.getInvoiceDocument(req.params.invoiceId, req.query, actor);
    this.sendDocument(res, document);
  };

  dispatchInvoice = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.taxService.dispatchInvoiceDocument(req.params.invoiceId, req.body, actor);
    res.status(202).json(okResponse(result));
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

  exportCreditNotes = async (req, res) => {
    const document = await this.taxService.exportCreditNotes(req.query);
    this.sendDocument(res, document);
  };

  downloadCreditNote = async (req, res) => {
    const actor = getCurrentUser(req);
    const document = await this.taxService.getCreditNoteDocument(req.params.creditNoteId, req.query, actor);
    this.sendDocument(res, document);
  };

  dispatchCreditNote = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.taxService.dispatchCreditNoteDocument(req.params.creditNoteId, req.body, actor);
    res.status(202).json(okResponse(result));
  };

  getReport = async (req, res) => {
    const report = await this.taxService.getTaxReport(req.query);
    res.json(okResponse(report));
  };

  exportReport = async (req, res) => {
    const document = await this.taxService.exportTaxReport(req.query);
    this.sendDocument(res, document);
  };

  listDocumentDispatches = async (req, res) => {
    const dispatches = await this.taxService.listTaxDocumentDispatches(req.query);
    res.json(okResponse(dispatches.items, { total: dispatches.total, page: dispatches.page, limit: dispatches.limit }));
  };

  retryDocumentDispatch = async (req, res) => {
    const actor = getCurrentUser(req);
    const dispatch = await this.taxService.retryTaxDocumentDispatch(req.params.dispatchId, actor);
    res.json(okResponse(dispatch));
  };

  sendDocument(res, document) {
    res.setHeader("Content-Type", document.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${document.fileName}"`);
    res.send(document.body);
  }
}

module.exports = { TaxController };
