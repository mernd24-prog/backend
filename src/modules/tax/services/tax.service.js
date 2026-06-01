const { AppError } = require("../../../shared/errors/app-error");
const { TaxRepository } = require("../repositories/tax.repository");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { env } = require("../../../config/env");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");

class TaxService {
  constructor({
    taxRepository = new TaxRepository(),
    orderRepository = new OrderRepository(),
  } = {}) {
    this.taxRepository = taxRepository;
    this.orderRepository = orderRepository;
  }

  async createInvoice(orderId) {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    const existingInvoice = await this.taxRepository.findInvoiceByOrderId(orderId);
    if (existingInvoice) {
      return existingInvoice;
    }

    const taxBreakup = this.normalizeJson(order.tax_breakup, {});
    const shippingAddress = this.normalizeJson(order.shipping_address, {});
    const taxableAmount = Number(taxBreakup.taxableAmount || 0);
    const taxAmount = Number(order.tax_amount || taxBreakup.totalTaxAmount || 0);
    const cgstAmount = Number(taxBreakup.cgstAmount || 0);
    const sgstAmount = Number(taxBreakup.sgstAmount || 0);
    const igstAmount = Number(taxBreakup.igstAmount || 0);
    const tcsAmount = Number((taxableAmount * 0.01).toFixed(2));
    const invoiceNumber = await this.taxRepository.nextInvoiceNumber("GST");

    const invoice = await this.taxRepository.createInvoice({
      invoiceNumber,
      orderId,
      buyerId: order.buyer_id,
      taxableAmount,
      taxAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      tcsAmount,
      totalAmount: Number(order.total_amount || 0),
      currency: order.currency || "INR",
      taxMode: taxBreakup.taxMode || "cgst_sgst",
      gstinMarketplace: env.commerce.gstinMarketplace || null,
      gstinSeller: null,
      placeOfSupply: shippingAddress?.state || null,
      metadata: {
        orderStatus: order.status,
        orderNumber: order.order_number,
        items: (order.items || []).map((item) => ({
          productId: item.product_id,
          productTitle: item.product_title,
          sellerId: item.seller_id,
          hsnCode: item.hsn_code,
          gstRate: Number(item.gst_rate || 0),
          taxableAmount: Number(item.line_total || 0) - Number(item.discount_amount || 0),
          taxAmount: Number(item.tax_amount || 0),
          taxBreakup: this.normalizeJson(item.tax_breakup, {}),
        })),
        generatedBy: "tax-service",
      },
    });

    const ledgerEntries = [];
    if (cgstAmount > 0) {
      ledgerEntries.push(this.makeLedgerEntry(orderId, invoice.id, "tax_collected", "cgst", cgstAmount));
    }
    if (sgstAmount > 0) {
      ledgerEntries.push(this.makeLedgerEntry(orderId, invoice.id, "tax_collected", "sgst", sgstAmount));
    }
    if (igstAmount > 0) {
      ledgerEntries.push(this.makeLedgerEntry(orderId, invoice.id, "tax_collected", "igst", igstAmount));
    }
    if (tcsAmount > 0) {
      ledgerEntries.push(this.makeLedgerEntry(orderId, invoice.id, "tax_collected", "tcs", tcsAmount));
    }

    await this.taxRepository.insertLedgerEntries(ledgerEntries);
    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.INVOICE_GENERATED_V1,
        {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoice_number,
          orderId,
          buyerId: order.buyer_id,
          totalAmount: Number(invoice.total_amount || 0),
        },
        { source: "tax-module", aggregateId: orderId },
      ),
    );
    return invoice;
  }

  async listInvoices(query = {}) {
    return this.taxRepository.listInvoices({
      ...query,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async getOrderInvoice(orderId, actor = {}) {
    const invoice = await this.taxRepository.findInvoiceByOrderId(orderId);
    if (!invoice) {
      return null;
    }

    const isOwner = invoice.buyer_id === actor.userId;
    const isAdmin = ["admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
    if (!isOwner && !isAdmin) {
      throw new AppError("You are not allowed to view this invoice", 403);
    }

    return invoice;
  }

  async createCreditNote(payload = {}) {
    const referenceType = payload.referenceType || "manual";
    const referenceId = payload.referenceId || payload.orderId;
    const existing = await this.taxRepository.findCreditNoteByReference(referenceType, referenceId);
    if (existing) {
      return existing;
    }

    const invoice = payload.invoiceId
      ? await this.taxRepository.findInvoiceById(payload.invoiceId)
      : await this.taxRepository.findInvoiceByOrderId(payload.orderId);
    if (!invoice) {
      throw new AppError("Invoice not found for credit note", 404);
    }

    const taxableAmount = Number(payload.taxableAmount ?? invoice.taxable_amount ?? 0);
    const totalInvoiceTax = Number(invoice.tax_amount || 0);
    const ratio = totalInvoiceTax > 0 && payload.taxAmount !== undefined
      ? Number(payload.taxAmount) / totalInvoiceTax
      : taxableAmount / Math.max(Number(invoice.taxable_amount || taxableAmount || 1), 1);
    const taxAmount = Number(Number(payload.taxAmount ?? totalInvoiceTax * ratio).toFixed(2));
    const cgstAmount = Number(Number(payload.cgstAmount ?? Number(invoice.cgst_amount || 0) * ratio).toFixed(2));
    const sgstAmount = Number(Number(payload.sgstAmount ?? Number(invoice.sgst_amount || 0) * ratio).toFixed(2));
    const igstAmount = Number(Number(payload.igstAmount ?? Number(invoice.igst_amount || 0) * ratio).toFixed(2));
    const totalAmount = Number(Number(payload.totalAmount ?? taxableAmount + taxAmount).toFixed(2));
    const creditNoteNumber = await this.taxRepository.nextInvoiceNumber("CN", "tax_credit_notes", "credit_note_number");

    const creditNote = await this.taxRepository.createCreditNote({
      creditNoteNumber,
      invoiceId: invoice.id,
      orderId: invoice.order_id,
      buyerId: invoice.buyer_id,
      referenceType,
      referenceId,
      taxableAmount,
      taxAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      totalAmount,
      currency: invoice.currency || "INR",
      reason: payload.reason || "tax_reversal",
      metadata: payload.metadata || {},
    });

    const ledgerEntries = [];
    if (cgstAmount > 0) ledgerEntries.push(this.makeLedgerEntry(invoice.order_id, invoice.id, "tax_reversed", "cgst", cgstAmount, "credit_note", creditNote.id));
    if (sgstAmount > 0) ledgerEntries.push(this.makeLedgerEntry(invoice.order_id, invoice.id, "tax_reversed", "sgst", sgstAmount, "credit_note", creditNote.id));
    if (igstAmount > 0) ledgerEntries.push(this.makeLedgerEntry(invoice.order_id, invoice.id, "tax_reversed", "igst", igstAmount, "credit_note", creditNote.id));

    await this.taxRepository.insertLedgerEntries(ledgerEntries);
    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.CREDIT_NOTE_GENERATED_V1,
        {
          creditNoteId: creditNote.id,
          creditNoteNumber: creditNote.credit_note_number,
          orderId: creditNote.order_id,
          buyerId: creditNote.buyer_id,
          referenceType,
          referenceId,
          totalAmount: Number(creditNote.total_amount || 0),
        },
        { source: "tax-module", aggregateId: creditNote.order_id },
      ),
    );
    return creditNote;
  }

  async listCreditNotes(query = {}) {
    return this.taxRepository.listCreditNotes({
      ...query,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async getTaxReport(query) {
    const fromDate = query.fromDate ? new Date(query.fromDate) : this.getDateBeforeDays(30);
    const toDate = query.toDate ? new Date(query.toDate) : new Date();

    const reportRows = await this.taxRepository.listTaxReports({
      fromDate,
      toDate,
      taxComponent: query.taxComponent || null,
      limit: Number(query.limit || 200),
      offset: Number(query.offset || 0),
    });

    return {
      window: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
      },
      entries: reportRows,
    };
  }

  makeLedgerEntry(orderId, invoiceId, entryType, taxComponent, amount, referenceType = "invoice", referenceId = invoiceId) {
    return {
      orderId,
      invoiceId,
      entryType,
      taxComponent,
      amount: Number(amount),
      currency: "INR",
      referenceType,
      referenceId,
    };
  }

  normalizeJson(value, fallback) {
    if (!value) return fallback;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch (error) {
        return fallback;
      }
    }
    return value;
  }

  getDateBeforeDays(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }
}

module.exports = { TaxService };
