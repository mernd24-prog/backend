const { AppError } = require("../../../shared/errors/app-error");
const { TaxRepository } = require("../repositories/tax.repository");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { env } = require("../../../config/env");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { ROLES } = require("../../../shared/constants/roles");
const { UserModel } = require("../../user/models/user.model");
const { documentRendererService } = require("../../../shared/services/document-renderer.service");
const { sendMail } = require("../../../infrastructure/mail/mailer");
const { NotificationQueueModel } = require("../../notification/models/notification-preference.model");

const INVOICE_TYPES = {
  ORDER_CUSTOMER: "order_customer",
  SELLER_CUSTOMER: "seller_customer",
  PLATFORM_COMMISSION: "platform_commission",
};

const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUB_ADMIN, ROLES.SUPER_ADMIN];
const SELLER_ROLES = [ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN];

class TaxService {
  constructor({
    taxRepository = new TaxRepository(),
    orderRepository = new OrderRepository(),
  } = {}) {
    this.taxRepository = taxRepository;
    this.orderRepository = orderRepository;
  }

  async createInvoice(orderId, actor = {}) {
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
    const orderMetadata = this.normalizeJson(order.metadata, {});
    const pricingSummary = orderMetadata.pricingSummary || {};
    const grossSalesAmount = Number(order.subtotal_amount || 0);
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
      invoiceType: INVOICE_TYPES.ORDER_CUSTOMER,
      issuerType: "platform",
      recipientType: "buyer",
      referenceType: "order",
      referenceId: orderId,
      metadata: {
        invoiceType: INVOICE_TYPES.ORDER_CUSTOMER,
        orderStatus: order.status,
        orderNumber: order.order_number,
        items: (order.items || []).map((item) => ({
          ...this.buildInvoiceItem(item),
          productId: item.product_id,
          productTitle: item.product_title,
          sellerId: item.seller_id,
          organizationId: item.organization_id || null,
          storeId: item.store_id || null,
          warehouseId: item.warehouse_id || null,
          taxBreakup: this.normalizeJson(item.tax_breakup, {}),
        })),
        amounts: {
          grossSalesAmount,
          productTaxableAmount: taxableAmount,
          discountAmount: Number(order.discount_amount || 0),
          deliveryChargeAmount: Number(order.shipping_fee_amount || pricingSummary.deliveryChargeAmount || pricingSummary.shippingFeeAmount || 0),
          shippingChargeAmount: Number(order.shipping_fee_amount || pricingSummary.shippingFeeAmount || pricingSummary.deliveryChargeAmount || 0),
          sellerPlatformFeeAmount: Number(pricingSummary.sellerPlatformFeeAmount || order.platform_fee_amount || 0),
          customerPlatformFeeAmount: Number(pricingSummary.customerPlatformFeeAmount || 0),
          customerPlatformFeeTaxAmount: Number(pricingSummary.customerPlatformFeeTaxAmount || 0),
          codChargeAmount: Number(order.cod_charge_amount || 0),
          walletDiscountAmount: Number(order.wallet_discount_amount || 0),
          finalPayableAmount: Number(order.payable_amount || order.total_amount || 0),
          sellerOrganizationDetails: (order.items || []).map((item) => this.normalizeJson(item.organization_snapshot, {})).filter(Boolean),
        },
        generatedBy: actor.userId || "tax-service",
        generatedByRole: actor.role || "system",
      },
      createdBy: actor.userId || null,
      updatedBy: actor.userId || null,
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
    const isAdmin = this.isAdminActor(actor);
    if (!isOwner && !isAdmin) {
      throw new AppError("You are not allowed to view this invoice", 403);
    }

    return invoice;
  }

  async createMarketplaceInvoices(orderId, actor = {}) {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    const scope = await this.resolveMarketplaceInvoiceScope(order, actor, { write: true });
    const sellerGroups = this.groupItemsBySeller(order.items || [], scope.sellerId);
    if (!sellerGroups.length) {
      throw new AppError("No seller items found for invoice generation", 400);
    }

    const sellerProfiles = await this.loadSellerProfiles(sellerGroups.map((group) => group.sellerId));
    const orderInvoice = scope.isAdmin
      ? await this.createInvoice(orderId, actor)
      : await this.taxRepository.findInvoiceByOrderId(orderId);
    const sellerInvoices = [];
    const platformCommissionInvoices = [];

    for (const group of sellerGroups) {
      const sellerProfile = sellerProfiles.get(String(group.sellerId)) || null;
      const sellerInvoice = await this.findOrCreateSellerCustomerInvoice({
        order,
        sellerId: group.sellerId,
        organizationId: group.organizationId,
        organizationSnapshot: group.organizationSnapshot,
        items: group.items,
        sellerProfile,
        actor,
        parentInvoiceId: orderInvoice?.id || null,
      });
      const commissionInvoice = await this.findOrCreatePlatformCommissionInvoice({
        order,
        sellerId: group.sellerId,
        organizationId: group.organizationId,
        organizationSnapshot: group.organizationSnapshot,
        items: group.items,
        sellerProfile,
        actor,
        parentInvoiceId: sellerInvoice?.id || orderInvoice?.id || null,
      });
      sellerInvoices.push(sellerInvoice);
      platformCommissionInvoices.push(commissionInvoice);
    }

    return {
      orderId,
      orderNumber: order.order_number,
      orderInvoice,
      sellerInvoices,
      platformCommissionInvoices,
    };
  }

  async getMarketplaceInvoices(orderId, actor = {}) {
    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    const scope = await this.resolveMarketplaceInvoiceScope(order, actor, { write: false });
    const invoices = await this.taxRepository.findInvoicesByOrderId(orderId);
    const visibleInvoices = this.filterInvoicesForScope(invoices, scope);

    return {
      orderId,
      orderNumber: order.order_number,
      orderInvoice: visibleInvoices.find((invoice) => this.invoiceType(invoice) === INVOICE_TYPES.ORDER_CUSTOMER) || null,
      sellerInvoices: visibleInvoices.filter((invoice) => this.invoiceType(invoice) === INVOICE_TYPES.SELLER_CUSTOMER),
      platformCommissionInvoices: visibleInvoices.filter((invoice) => this.invoiceType(invoice) === INVOICE_TYPES.PLATFORM_COMMISSION),
    };
  }

  async createCreditNote(payload = {}, actor = {}) {
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
      organizationId: invoice.organization_id || payload.organizationId || null,
      organizationSnapshot: this.normalizeJson(invoice.organization_snapshot, payload.organizationSnapshot || {}),
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
      metadata: {
        ...(payload.metadata || {}),
        createdBy: actor.userId || null,
        createdByRole: actor.role || null,
      },
      createdBy: actor.userId || null,
      updatedBy: actor.userId || null,
    });

    const ledgerEntries = [];
    const creditOrganization = {
      organizationId: creditNote.organization_id || null,
      organizationSnapshot: this.normalizeJson(creditNote.organization_snapshot, {}),
    };
    if (cgstAmount > 0) ledgerEntries.push(this.makeLedgerEntry(invoice.order_id, invoice.id, "tax_reversed", "cgst", cgstAmount, "credit_note", creditNote.id, creditOrganization));
    if (sgstAmount > 0) ledgerEntries.push(this.makeLedgerEntry(invoice.order_id, invoice.id, "tax_reversed", "sgst", sgstAmount, "credit_note", creditNote.id, creditOrganization));
    if (igstAmount > 0) ledgerEntries.push(this.makeLedgerEntry(invoice.order_id, invoice.id, "tax_reversed", "igst", igstAmount, "credit_note", creditNote.id, creditOrganization));

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

  async createMarketplaceCreditNotes(payload = {}, actor = {}) {
    const orderId = payload.orderId;
    const referenceType = payload.referenceType || "manual";
    const referenceId = payload.referenceId || orderId;
    if (!orderId || !referenceId) {
      throw new AppError("orderId and referenceId are required for marketplace credit notes", 400);
    }

    const order = await this.orderRepository.findByIdWithItems(orderId);
    if (!order) {
      throw new AppError("Order not found for marketplace credit notes", 404);
    }

    const marketplaceInvoices = await this.ensureMarketplaceInvoicesForCreditNote(order, actor);
    const orderCreditNote = payload.createOrderCreditNote === false
      ? null
      : await this.createCreditNote(payload, actor);
    const refundGroups = this.groupRefundItemsBySeller(order.items || [], payload.items || [], {
      refundAmount: payload.totalAmount,
    });
    const sellerCreditNotes = [];
    const platformCommissionCreditNotes = [];

    for (const group of refundGroups) {
      const sellerInvoice = marketplaceInvoices.sellerInvoices.find((invoice) =>
        String(invoice.seller_id || "") === String(group.sellerId) &&
        String(invoice.organization_id || "") === String(group.organizationId || ""),
      );
      if (!sellerInvoice) continue;

      const sellerCreditNote = await this.createCreditNote({
        orderId,
        invoiceId: sellerInvoice.id,
        referenceType: `${referenceType}_seller`,
        referenceId: `${referenceId}:${group.sellerId}:${group.organizationId || "default"}`,
        taxableAmount: group.taxableAmount,
        taxAmount: group.taxAmount,
        cgstAmount: group.cgstAmount,
        sgstAmount: group.sgstAmount,
        igstAmount: group.igstAmount,
        totalAmount: group.totalAmount,
        reason: payload.reason || "seller_tax_reversal",
        metadata: {
          ...(payload.metadata || {}),
          parentCreditNoteId: orderCreditNote?.id || null,
          parentReferenceType: referenceType,
          parentReferenceId: referenceId,
          sellerId: group.sellerId,
          organizationId: group.organizationId || null,
          organization: group.organizationSnapshot || {},
          creditNoteScope: "seller_customer_invoice",
          items: group.items,
        },
      }, actor);
      sellerCreditNotes.push(sellerCreditNote);

      const commissionInvoice = marketplaceInvoices.platformCommissionInvoices.find((invoice) =>
        String(invoice.seller_id || "") === String(group.sellerId) &&
        String(invoice.organization_id || "") === String(group.organizationId || ""),
      );
      const commissionAmounts = this.calculateCommissionReversalAmounts(commissionInvoice, sellerInvoice, group);
      if (!commissionInvoice || commissionAmounts.totalAmount <= 0) continue;

      const commissionCreditNote = await this.createCreditNote({
        orderId,
        invoiceId: commissionInvoice.id,
        referenceType: `${referenceType}_commission`,
        referenceId: `${referenceId}:${group.sellerId}:${group.organizationId || "default"}`,
        taxableAmount: commissionAmounts.taxableAmount,
        taxAmount: commissionAmounts.taxAmount,
        cgstAmount: commissionAmounts.cgstAmount,
        sgstAmount: commissionAmounts.sgstAmount,
        igstAmount: commissionAmounts.igstAmount,
        totalAmount: commissionAmounts.totalAmount,
        reason: payload.reason || "platform_commission_reversal",
        metadata: {
          ...(payload.metadata || {}),
          parentCreditNoteId: orderCreditNote?.id || null,
          sellerCreditNoteId: sellerCreditNote?.id || null,
          parentReferenceType: referenceType,
          parentReferenceId: referenceId,
          sellerId: group.sellerId,
          organizationId: group.organizationId || null,
          organization: group.organizationSnapshot || {},
          creditNoteScope: "platform_commission_invoice",
          reversalRatio: commissionAmounts.reversalRatio,
        },
      }, actor);
      platformCommissionCreditNotes.push(commissionCreditNote);
    }

    return {
      id: orderCreditNote?.id || sellerCreditNotes[0]?.id || platformCommissionCreditNotes[0]?.id || null,
      credit_note_number: orderCreditNote?.credit_note_number ||
        sellerCreditNotes[0]?.credit_note_number ||
        platformCommissionCreditNotes[0]?.credit_note_number ||
        null,
      orderCreditNote,
      sellerCreditNotes,
      platformCommissionCreditNotes,
    };
  }

  async listCreditNotes(query = {}) {
    return this.taxRepository.listCreditNotes({
      ...query,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async getInvoiceDocument(invoiceId, query = {}, actor = {}) {
    const invoice = await this.taxRepository.findInvoiceById(invoiceId);
    if (!invoice) {
      throw new AppError("Invoice not found", 404);
    }
    this.assertInvoiceDocumentAccess(invoice, actor);
    return documentRendererService.render(this.buildInvoiceDocument(invoice), {
      format: query.format || "pdf",
      fileBaseName: invoice.invoice_number || `invoice-${invoice.id}`,
    });
  }

  async getCreditNoteDocument(creditNoteId, query = {}, actor = {}) {
    const creditNote = await this.taxRepository.findCreditNoteById(creditNoteId);
    if (!creditNote) {
      throw new AppError("Credit note not found", 404);
    }
    const invoice = creditNote.invoice_id
      ? await this.taxRepository.findInvoiceById(creditNote.invoice_id)
      : null;
    if (invoice) {
      this.assertInvoiceDocumentAccess(invoice, actor);
    } else if (!this.isAdminActor(actor) && String(creditNote.buyer_id || "") !== String(actor.userId || "")) {
      throw new AppError("You are not allowed to download this credit note", 403);
    }
    return documentRendererService.render(this.buildCreditNoteDocument(creditNote, invoice), {
      format: query.format || "pdf",
      fileBaseName: creditNote.credit_note_number || `credit-note-${creditNote.id}`,
    });
  }

  async dispatchInvoiceDocument(invoiceId, payload = {}, actor = {}) {
    const invoice = await this.taxRepository.findInvoiceById(invoiceId);
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (!this.isAdminActor(actor)) {
      throw new AppError("Only admins can dispatch tax documents", 403);
    }
    return this.dispatchTaxDocument({
      documentType: "invoice",
      documentId: invoice.id,
      source: invoice,
      document: this.buildInvoiceDocument(invoice),
      payload,
      actor,
    });
  }

  async dispatchCreditNoteDocument(creditNoteId, payload = {}, actor = {}) {
    const creditNote = await this.taxRepository.findCreditNoteById(creditNoteId);
    if (!creditNote) throw new AppError("Credit note not found", 404);
    if (!this.isAdminActor(actor)) {
      throw new AppError("Only admins can dispatch tax documents", 403);
    }
    const invoice = creditNote.invoice_id
      ? await this.taxRepository.findInvoiceById(creditNote.invoice_id)
      : null;
    return this.dispatchTaxDocument({
      documentType: "credit_note",
      documentId: creditNote.id,
      source: creditNote,
      invoice,
      document: this.buildCreditNoteDocument(creditNote, invoice),
      payload,
      actor,
    });
  }

  async dispatchTaxDocument({ documentType, documentId, source, invoice = null, document, payload = {}, actor = {} }) {
    const channels = Array.isArray(payload.channels) && payload.channels.length
      ? payload.channels
      : ["email"];
    const recipient = this.resolveDocumentRecipient(source, invoice, payload, actor);
    const results = [];

    for (const channel of channels) {
      if (channel === "email") {
        results.push(await this.queueAndSendTaxDocumentEmail({
          documentType,
          documentId,
          source,
          document,
          recipient,
          actor,
          payload,
        }));
      } else if (channel === "whatsapp") {
        results.push(await this.queueTaxDocumentWhatsapp({
          documentType,
          documentId,
          source,
          document,
          recipient,
          actor,
          payload,
        }));
      }
    }

    return { documentType, documentId, recipient, results };
  }

  async queueAndSendTaxDocumentEmail({ documentType, documentId, source, document, recipient, actor, payload = {} }) {
    if (!recipient.email) {
      throw new AppError("Recipient email is required for email dispatch", 400);
    }
    const htmlDocument = documentRendererService.render(document, { format: "html" });
    const textDocument = documentRendererService.render(document, { format: "text" });
    const queueItem = await NotificationQueueModel.create({
      userId: recipient.userId || source.buyer_id || source.seller_id || actor.userId || "tax-document-recipient",
      type: "email",
      channel: "tax_document_dispatch",
      recipient: recipient.email,
      subject: payload.subject || document.subtitle || document.title,
      body: textDocument.body,
      payload: {
        documentType,
        documentId,
        orderId: source.order_id || null,
        referenceId: source.reference_id || null,
        requestedBy: actor.userId || null,
      },
      status: "queued",
      scheduledFor: payload.scheduledFor || null,
    });

    return this.sendQueuedTaxDocument(queueItem, {
      html: htmlDocument.body,
      text: textDocument.body,
    });
  }

  async queueTaxDocumentWhatsapp({ documentType, documentId, source, document, recipient, actor, payload = {} }) {
    const queueItem = await NotificationQueueModel.create({
      userId: recipient.userId || source.buyer_id || source.seller_id || actor.userId || "tax-document-recipient",
      type: "whatsapp",
      channel: "tax_document_dispatch",
      recipient: payload.recipientPhone || recipient.phone || "",
      subject: payload.subject || document.subtitle || document.title,
      body: `${document.title}: ${document.subtitle}`,
      payload: {
        documentType,
        documentId,
        orderId: source.order_id || null,
        referenceId: source.reference_id || null,
        requestedBy: actor.userId || null,
        provider: "not_configured",
      },
      status: "queued",
      failureReason: "WhatsApp provider is not configured in this backend environment.",
      scheduledFor: payload.scheduledFor || null,
    });
    return queueItem;
  }

  async retryTaxDocumentDispatch(dispatchId, actor = {}) {
    if (!this.isAdminActor(actor)) {
      throw new AppError("Only admins can retry tax document dispatch", 403);
    }
    const queueItem = await NotificationQueueModel.findById(dispatchId);
    if (!queueItem) throw new AppError("Dispatch queue item not found", 404);
    if (queueItem.channel !== "tax_document_dispatch") {
      throw new AppError("Dispatch queue item is not a tax document dispatch", 400);
    }
    if (queueItem.type !== "email") {
      queueItem.attempts = Number(queueItem.attempts || 0) + 1;
      queueItem.lastAttemptAt = new Date();
      queueItem.status = "queued";
      queueItem.failureReason = `${queueItem.type || "channel"} provider is not configured`;
      await queueItem.save();
      return queueItem;
    }
    return this.sendQueuedTaxDocument(queueItem);
  }

  async listTaxDocumentDispatches(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const page = Math.max(Number(query.page || 1), 1);
    const filter = { channel: "tax_document_dispatch" };
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;
    if (query.documentType) filter["payload.documentType"] = query.documentType;
    if (query.documentId) filter["payload.documentId"] = query.documentId;
    const [items, total] = await Promise.all([
      NotificationQueueModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      NotificationQueueModel.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  async sendQueuedTaxDocument(queueItem, rendered = {}) {
    try {
      const result = await sendMail({
        to: queueItem.recipient,
        subject: queueItem.subject || "Tax document",
        html: rendered.html || `<pre>${queueItem.body || ""}</pre>`,
        text: rendered.text || queueItem.body || "",
      });
      queueItem.status = "sent";
      queueItem.attempts = Number(queueItem.attempts || 0) + 1;
      queueItem.lastAttemptAt = new Date();
      queueItem.sentAt = new Date();
      queueItem.failureReason = "";
      queueItem.payload = {
        ...(queueItem.payload || {}),
        mailResult: {
          messageId: result?.messageId || null,
          response: result?.response || null,
          mode: result?.mode || null,
        },
      };
      await queueItem.save();
      return queueItem;
    } catch (error) {
      queueItem.status = "failed";
      queueItem.attempts = Number(queueItem.attempts || 0) + 1;
      queueItem.lastAttemptAt = new Date();
      queueItem.failureReason = error.message;
      await queueItem.save();
      throw error;
    }
  }

  async getTaxReport(query) {
    const fromDate = query.fromDate ? new Date(query.fromDate) : this.getDateBeforeDays(30);
    const toDate = query.toDate ? new Date(query.toDate) : new Date();

    const reportRows = await this.taxRepository.listTaxReports({
      fromDate,
      toDate,
      taxComponent: query.taxComponent || null,
      organizationId: query.organizationId || null,
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

  async exportInvoices(query = {}) {
    const result = await this.listInvoices({
      ...query,
      limit: Number(query.limit || 500),
      offset: Number(query.offset || 0),
    });
    return documentRendererService.render(this.buildInvoicesExportDocument(result.list || [], result.summary), {
      format: query.format || "csv",
      fileBaseName: "tax-invoices-export",
    });
  }

  async exportCreditNotes(query = {}) {
    const result = await this.listCreditNotes({
      ...query,
      limit: Number(query.limit || 500),
      offset: Number(query.offset || 0),
    });
    return documentRendererService.render(this.buildCreditNotesExportDocument(result.list || []), {
      format: query.format || "csv",
      fileBaseName: "tax-credit-notes-export",
    });
  }

  async exportTaxReport(query = {}) {
    const report = await this.getTaxReport({
      ...query,
      limit: Number(query.limit || 500),
      offset: Number(query.offset || 0),
    });
    return documentRendererService.render(this.buildTaxReportExportDocument(report), {
      format: query.format || "csv",
      fileBaseName: "tax-ledger-report-export",
    });
  }

  async findOrCreateSellerCustomerInvoice({
    order,
    sellerId,
    organizationId = null,
    organizationSnapshot = {},
    items,
    sellerProfile,
    actor,
    parentInvoiceId,
  }) {
    const referenceId = `${order.id}:${sellerId}:${organizationId || "default"}`;
    const existing = await this.taxRepository.findInvoiceByOrderAndType({
      orderId: order.id,
      invoiceType: INVOICE_TYPES.SELLER_CUSTOMER,
      sellerId,
      organizationId,
      referenceType: "seller_order",
      referenceId,
    });
    if (existing) {
      return existing;
    }

    const amounts = this.calculateSellerCustomerAmounts(order, sellerId, items);
    const sellerSnapshot = this.buildSellerSnapshot(sellerId, sellerProfile, organizationSnapshot);
    const invoiceNumber = await this.taxRepository.nextInvoiceNumber("GST-S");
    const invoice = await this.taxRepository.createInvoice({
      invoiceNumber,
      orderId: order.id,
      buyerId: order.buyer_id,
      sellerId,
      organizationId,
      organizationSnapshot,
      taxableAmount: amounts.taxableAmount,
      taxAmount: amounts.taxAmount,
      cgstAmount: amounts.cgstAmount,
      sgstAmount: amounts.sgstAmount,
      igstAmount: amounts.igstAmount,
      tcsAmount: 0,
      totalAmount: amounts.customerFinalAmount,
      currency: order.currency || "INR",
      taxMode: amounts.taxMode,
      gstinMarketplace: env.commerce.gstinMarketplace || null,
      gstinSeller: sellerSnapshot.gstNumber || null,
      placeOfSupply: amounts.placeOfSupply,
      invoiceType: INVOICE_TYPES.SELLER_CUSTOMER,
      issuerType: "seller",
      recipientType: "buyer",
      referenceType: "seller_order",
      referenceId,
      parentInvoiceId,
      metadata: {
        invoiceType: INVOICE_TYPES.SELLER_CUSTOMER,
        orderId: order.id,
        orderNumber: order.order_number,
        orderStatus: order.status,
        organizationId: organizationId || null,
        organization: organizationSnapshot || {},
        seller: sellerSnapshot,
        buyer: this.buildBuyerSnapshot(order),
        shippingAddress: this.normalizeJson(order.shipping_address, {}),
        amounts,
        items: items.map((item) => this.buildInvoiceItem(item)),
        generatedBy: actor.userId || "tax-service",
        generatedByRole: actor.role || "system",
      },
      createdBy: actor.userId || null,
      updatedBy: actor.userId || null,
    });

    await this.taxRepository.insertLedgerEntries(this.buildTaxLedgerEntries(order.id, invoice.id, amounts, {
      organizationId,
      organizationSnapshot,
    }));
    await this.publishInvoiceGenerated(invoice, order, {
      invoiceType: INVOICE_TYPES.SELLER_CUSTOMER,
      sellerId,
      organizationId,
    });
    return invoice;
  }

  async ensureMarketplaceInvoicesForCreditNote(order, actor = {}) {
    const existingInvoices = await this.taxRepository.findInvoicesByOrderId(order.id);
    const existingSellerInvoices = existingInvoices.filter((invoice) =>
      this.invoiceType(invoice) === INVOICE_TYPES.SELLER_CUSTOMER,
    );
    const existingCommissionInvoices = existingInvoices.filter((invoice) =>
      this.invoiceType(invoice) === INVOICE_TYPES.PLATFORM_COMMISSION,
    );
    const sellerGroups = this.groupItemsBySeller(order.items || []);

    if (
      existingSellerInvoices.length >= sellerGroups.length &&
      existingCommissionInvoices.length >= sellerGroups.length
    ) {
      return {
        sellerInvoices: existingSellerInvoices,
        platformCommissionInvoices: existingCommissionInvoices,
      };
    }

    const orderInvoice = await this.createInvoice(order.id, actor);
    const sellerProfiles = await this.loadSellerProfiles(sellerGroups.map((group) => group.sellerId));
    const sellerInvoices = [];
    const platformCommissionInvoices = [];

    for (const group of sellerGroups) {
      const sellerProfile = sellerProfiles.get(String(group.sellerId)) || null;
      const sellerInvoice = await this.findOrCreateSellerCustomerInvoice({
        order,
        sellerId: group.sellerId,
        organizationId: group.organizationId,
        organizationSnapshot: group.organizationSnapshot,
        items: group.items,
        sellerProfile,
        actor,
        parentInvoiceId: orderInvoice?.id || null,
      });
      const commissionInvoice = await this.findOrCreatePlatformCommissionInvoice({
        order,
        sellerId: group.sellerId,
        organizationId: group.organizationId,
        organizationSnapshot: group.organizationSnapshot,
        items: group.items,
        sellerProfile,
        actor,
        parentInvoiceId: sellerInvoice?.id || orderInvoice?.id || null,
      });
      sellerInvoices.push(sellerInvoice);
      platformCommissionInvoices.push(commissionInvoice);
    }

    return { sellerInvoices, platformCommissionInvoices };
  }

  async findOrCreatePlatformCommissionInvoice({
    order,
    sellerId,
    organizationId = null,
    organizationSnapshot = {},
    items,
    sellerProfile,
    actor,
    parentInvoiceId,
  }) {
    const referenceId = `${order.id}:${sellerId}:${organizationId || "default"}`;
    const existing = await this.taxRepository.findInvoiceByOrderAndType({
      orderId: order.id,
      invoiceType: INVOICE_TYPES.PLATFORM_COMMISSION,
      sellerId,
      organizationId,
      referenceType: "platform_commission",
      referenceId,
    });
    if (existing) {
      return existing;
    }

    const sellerSnapshot = this.buildSellerSnapshot(sellerId, sellerProfile, organizationSnapshot);
    const amounts = this.calculatePlatformCommissionAmounts(items, sellerSnapshot);
    const invoiceNumber = await this.taxRepository.nextInvoiceNumber("GST-C");
    const invoice = await this.taxRepository.createInvoice({
      invoiceNumber,
      orderId: order.id,
      buyerId: sellerId,
      sellerId,
      organizationId,
      organizationSnapshot,
      taxableAmount: amounts.taxableAmount,
      taxAmount: amounts.taxAmount,
      cgstAmount: amounts.cgstAmount,
      sgstAmount: amounts.sgstAmount,
      igstAmount: amounts.igstAmount,
      tcsAmount: 0,
      totalAmount: amounts.totalAmount,
      currency: order.currency || "INR",
      taxMode: amounts.taxMode,
      gstinMarketplace: env.commerce.gstinMarketplace || null,
      gstinSeller: sellerSnapshot.gstNumber || null,
      placeOfSupply: sellerSnapshot.businessAddress?.state || sellerSnapshot.pickupAddress?.state || null,
      invoiceType: INVOICE_TYPES.PLATFORM_COMMISSION,
      issuerType: "platform",
      recipientType: "seller",
      referenceType: "platform_commission",
      referenceId,
      parentInvoiceId,
      metadata: {
        invoiceType: INVOICE_TYPES.PLATFORM_COMMISSION,
        orderId: order.id,
        orderNumber: order.order_number,
        orderStatus: order.status,
        organizationId: organizationId || null,
        organization: organizationSnapshot || {},
        seller: sellerSnapshot,
        buyer: this.buildBuyerSnapshot(order),
        amounts,
        lineItems: [
          {
            description: "Marketplace commission/service charge",
            taxableAmount: amounts.taxableAmount,
            taxAmount: amounts.taxAmount,
            totalAmount: amounts.totalAmount,
          },
        ],
        itemReferences: items.map((item) => ({
          orderItemId: item.id,
          productId: item.product_id,
          productTitle: item.product_title,
          platformFeeAmount: this.money(item.platform_fee_amount),
          platformFeeTaxAmount: this.money(this.readJsonNumber(item.pricing_snapshot, "platformFeeTaxAmount")),
        })),
        generatedBy: actor.userId || "tax-service",
        generatedByRole: actor.role || "system",
      },
      createdBy: actor.userId || null,
      updatedBy: actor.userId || null,
    });

    await this.taxRepository.insertLedgerEntries(this.buildTaxLedgerEntries(order.id, invoice.id, amounts, {
      organizationId,
      organizationSnapshot,
    }));
    await this.publishInvoiceGenerated(invoice, order, {
      invoiceType: INVOICE_TYPES.PLATFORM_COMMISSION,
      sellerId,
      organizationId,
    });
    return invoice;
  }

  async resolveMarketplaceInvoiceScope(order, actor = {}, { write = false } = {}) {
    if (this.isAdminActor(actor)) {
      return { isAdmin: true, isBuyer: false, isSeller: false, sellerId: null };
    }

    const actorSellerId = this.getActorSellerId(actor);
    if (actorSellerId) {
      const isSellerInOrder = await this.orderRepository.isSellerInOrder(order.id, actorSellerId);
      if (isSellerInOrder) {
        return { isAdmin: false, isBuyer: false, isSeller: true, sellerId: actorSellerId };
      }
    }

    if (!write && order.buyer_id === actor.userId) {
      return { isAdmin: false, isBuyer: true, isSeller: false, sellerId: null };
    }

    throw new AppError(
      write
        ? "Only admins or order sellers can generate marketplace invoices"
        : "You are not allowed to view these invoices",
      403,
    );
  }

  filterInvoicesForScope(invoices = [], scope = {}) {
    if (scope.isAdmin) {
      return invoices;
    }

    if (scope.isSeller) {
      return invoices.filter((invoice) => String(invoice.seller_id || "") === String(scope.sellerId));
    }

    if (scope.isBuyer) {
      return invoices.filter((invoice) =>
        [INVOICE_TYPES.ORDER_CUSTOMER, INVOICE_TYPES.SELLER_CUSTOMER].includes(this.invoiceType(invoice)),
      );
    }

    return [];
  }

  groupItemsBySeller(items = [], sellerScope = null) {
    const grouped = new Map();
    for (const item of items) {
      const sellerId = String(item.seller_id || "");
      if (!sellerId) continue;
      if (sellerScope && sellerId !== String(sellerScope)) continue;
      const organizationId = item.organization_id ? String(item.organization_id) : null;
      const key = `${sellerId}:${organizationId || "default"}`;
      const current = grouped.get(key) || {
        sellerId,
        organizationId,
        organizationSnapshot: this.normalizeJson(item.organization_snapshot, {}),
        items: [],
      };
      current.items.push(item);
      grouped.set(key, current);
    }
    return [...grouped.values()];
  }

  groupRefundItemsBySeller(orderItems = [], refundItems = [], options = {}) {
    const orderItemMap = new Map();
    for (const item of orderItems) {
      orderItemMap.set(String(item.id), item);
      orderItemMap.set(`${item.product_id}:${item.variant_sku || item.variant_id || ""}`, item);
      orderItemMap.set(`${item.product_id}:`, item);
    }

    const grouped = new Map();
    for (const item of refundItems) {
      const orderItem = this.findOrderItemForRefund(orderItemMap, item);
      const sellerId = String(item.sellerId || item.seller_id || orderItem?.seller_id || "");
      if (!sellerId) continue;
      const organizationId = item.organizationId || item.organization_id || orderItem?.organization_id || null;
      const key = `${sellerId}:${organizationId || "default"}`;

      const normalized = this.normalizeRefundItem(item, orderItem);
      const current = grouped.get(key) || {
        sellerId,
        organizationId,
        organizationSnapshot: this.normalizeJson(orderItem?.organization_snapshot, item.organizationSnapshot || item.organization_snapshot || {}),
        taxableAmount: 0,
        taxAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        totalAmount: 0,
        items: [],
      };
      current.taxableAmount += normalized.taxableAmount;
      current.taxAmount += normalized.taxAmount;
      current.cgstAmount += normalized.cgstAmount;
      current.sgstAmount += normalized.sgstAmount;
      current.igstAmount += normalized.igstAmount;
      current.totalAmount += normalized.totalAmount;
      current.items.push(normalized);
      grouped.set(key, current);
    }

    const groups = [...grouped.values()];
    const rawTotal = groups.reduce((sum, group) => sum + group.totalAmount, 0);
    const requestedTotal = Number(options.refundAmount || 0);
    const scale = requestedTotal > 0 && rawTotal > 0 && requestedTotal < rawTotal
      ? requestedTotal / rawTotal
      : 1;

    return groups.map((group) => ({
      ...group,
      taxableAmount: this.money(group.taxableAmount * scale),
      taxAmount: this.money(group.taxAmount * scale),
      cgstAmount: this.money(group.cgstAmount * scale),
      sgstAmount: this.money(group.sgstAmount * scale),
      igstAmount: this.money(group.igstAmount * scale),
      totalAmount: this.money(group.totalAmount * scale),
      items: group.items.map((item) => ({
        ...item,
        taxableAmount: this.money(item.taxableAmount * scale),
        taxAmount: this.money(item.taxAmount * scale),
        cgstAmount: this.money(item.cgstAmount * scale),
        sgstAmount: this.money(item.sgstAmount * scale),
        igstAmount: this.money(item.igstAmount * scale),
        totalAmount: this.money(item.totalAmount * scale),
      })),
    }));
  }

  findOrderItemForRefund(orderItemMap, item = {}) {
    if (item.orderItemId || item.order_item_id || item.id) {
      const direct = orderItemMap.get(String(item.orderItemId || item.order_item_id || item.id));
      if (direct) return direct;
    }
    return orderItemMap.get(`${item.productId || item.product_id || ""}:${item.variantSku || item.variant_sku || item.variantId || item.variant_id || ""}`) ||
      orderItemMap.get(`${item.productId || item.product_id || ""}:`) ||
      null;
  }

  normalizeRefundItem(item = {}, orderItem = null) {
    const quantity = Number(
      item.quantity ||
      item.approvedQuantity ||
      item.requestedQuantity ||
      item.receivedQuantity ||
      0,
    );
    const orderedQuantity = Math.max(Number(orderItem?.quantity || item.orderedQuantity || quantity || 1), 1);
    const ratio = quantity > 0 ? Math.min(quantity / orderedQuantity, 1) : 1;
    const orderTaxBreakup = this.normalizeJson(orderItem?.tax_breakup, {});
    const itemTaxBreakup = this.normalizeJson(item.taxBreakup || item.tax_breakup, {});
    const taxBreakup = Object.keys(itemTaxBreakup).length ? itemTaxBreakup : orderTaxBreakup;

    const grossAmount = this.money(
      item.itemAmount ??
      item.lineTotal ??
      item.line_total ??
      Number(orderItem?.line_total || 0) * ratio,
    );
    const discountAmount = this.money(
      item.discountAmount ??
      item.discount_amount ??
      Number(orderItem?.discount_amount || 0) * ratio,
    );
    const taxableAmount = this.money(
      item.taxableAmount ??
      taxBreakup.taxableAmount ??
      Math.max(grossAmount - discountAmount, 0),
    );
    const cgstAmount = this.money(item.cgstAmount ?? taxBreakup.cgstAmount ?? 0);
    const sgstAmount = this.money(item.sgstAmount ?? taxBreakup.sgstAmount ?? 0);
    const igstAmount = this.money(item.igstAmount ?? taxBreakup.igstAmount ?? 0);
    const taxAmount = this.money(
      item.taxAmount ??
      item.tax_amount ??
      taxBreakup.taxAmount ??
      cgstAmount + sgstAmount + igstAmount,
    );
    const totalAmount = this.money(
      item.refundAmount ??
      item.eligibleRefundAmount ??
      item.totalAmount ??
      taxableAmount + taxAmount,
    );

    return {
      orderItemId: item.orderItemId || item.order_item_id || orderItem?.id || null,
      productId: item.productId || item.product_id || orderItem?.product_id || null,
      productTitle: item.productTitle || item.product_title || orderItem?.product_title || null,
      sellerId: item.sellerId || item.seller_id || orderItem?.seller_id || null,
      organizationId: item.organizationId || item.organization_id || orderItem?.organization_id || null,
      storeId: item.storeId || item.store_id || orderItem?.store_id || null,
      warehouseId: item.warehouseId || item.warehouse_id || orderItem?.warehouse_id || null,
      quantity,
      taxableAmount,
      taxAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      totalAmount,
    };
  }

  calculateCommissionReversalAmounts(commissionInvoice, sellerInvoice, refundGroup) {
    if (!commissionInvoice || !sellerInvoice) {
      return {
        taxableAmount: 0,
        taxAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        totalAmount: 0,
        reversalRatio: 0,
      };
    }

    const sellerInvoiceTotal = Number(sellerInvoice.total_amount || 0);
    const reversalRatio = sellerInvoiceTotal > 0
      ? Math.min(Number(refundGroup.totalAmount || 0) / sellerInvoiceTotal, 1)
      : 0;
    const taxableAmount = this.money(Number(commissionInvoice.taxable_amount || 0) * reversalRatio);
    const taxAmount = this.money(Number(commissionInvoice.tax_amount || 0) * reversalRatio);
    const cgstAmount = this.money(Number(commissionInvoice.cgst_amount || 0) * reversalRatio);
    const sgstAmount = this.money(Number(commissionInvoice.sgst_amount || 0) * reversalRatio);
    const igstAmount = this.money(Number(commissionInvoice.igst_amount || 0) * reversalRatio);

    return {
      taxableAmount,
      taxAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      totalAmount: this.money(taxableAmount + taxAmount),
      reversalRatio: this.money(reversalRatio),
    };
  }

  async loadSellerProfiles(sellerIds = []) {
    const uniqueIds = Array.from(new Set(sellerIds.map((sellerId) => String(sellerId || "")).filter(Boolean)));
    const objectIds = uniqueIds.filter((sellerId) => UserModel.db.base.Types.ObjectId.isValid(sellerId));
    if (!objectIds.length) {
      return new Map();
    }

    const sellers = await UserModel.find({ _id: { $in: objectIds } })
      .select("email phone profile sellerProfile sellerSettings accountStatus")
      .lean();
    return new Map(sellers.map((seller) => [String(seller._id), seller]));
  }

  calculateSellerCustomerAmounts(order, sellerId, items = []) {
    const shippingAddress = this.normalizeJson(order.shipping_address, {});
    const deliveryChargeAmount = this.getDeliveryChargeBySeller(order, sellerId);
    const totals = items.reduce((acc, item) => {
      const itemAmounts = this.buildInvoiceItem(item);
      acc.grossSalesAmount += itemAmounts.lineTotal;
      acc.discountAmount += itemAmounts.discountAmount;
      acc.taxableAmount += itemAmounts.taxableAmount;
      acc.taxAmount += itemAmounts.taxAmount;
      acc.cgstAmount += itemAmounts.cgstAmount;
      acc.sgstAmount += itemAmounts.sgstAmount;
      acc.igstAmount += itemAmounts.igstAmount;
      acc.taxPayableAmount += itemAmounts.taxPayableAmount;
      return acc;
    }, {
      grossSalesAmount: 0,
      discountAmount: 0,
      taxableAmount: 0,
      taxAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      taxPayableAmount: 0,
    });

    const computedCustomerTotal = totals.grossSalesAmount + totals.taxPayableAmount + deliveryChargeAmount;
    const fallbackCustomerTotal = totals.taxableAmount + totals.taxAmount + deliveryChargeAmount;
    const customerFinalAmount = computedCustomerTotal > 0 ? computedCustomerTotal : fallbackCustomerTotal;

    return {
      grossSalesAmount: this.money(totals.grossSalesAmount),
      discountAmount: this.money(totals.discountAmount),
      taxableAmount: this.money(totals.taxableAmount),
      taxAmount: this.money(totals.taxAmount),
      cgstAmount: this.money(totals.cgstAmount),
      sgstAmount: this.money(totals.sgstAmount),
      igstAmount: this.money(totals.igstAmount),
      taxPayableAmount: this.money(totals.taxPayableAmount),
      deliveryChargeAmount: this.money(deliveryChargeAmount),
      customerFinalAmount: this.money(customerFinalAmount),
      placeOfSupply: shippingAddress.state || null,
      taxMode: totals.igstAmount > 0 ? "igst" : "cgst_sgst",
    };
  }

  calculatePlatformCommissionAmounts(items = [], sellerSnapshot = {}) {
    const taxableAmount = items.reduce((sum, item) => {
      const pricing = this.normalizeJson(item.pricing_snapshot, {});
      return sum + this.money(item.platform_fee_amount || pricing.platformFeeAmount);
    }, 0);
    const taxAmount = items.reduce((sum, item) =>
      sum + this.money(this.readJsonNumber(item.pricing_snapshot, "platformFeeTaxAmount")),
    0);
    const taxSplit = this.splitTaxAmountByState(taxAmount, sellerSnapshot);

    return {
      taxableAmount: this.money(taxableAmount),
      taxAmount: this.money(taxAmount),
      cgstAmount: taxSplit.cgstAmount,
      sgstAmount: taxSplit.sgstAmount,
      igstAmount: taxSplit.igstAmount,
      totalAmount: this.money(taxableAmount + taxAmount),
      taxMode: taxSplit.taxMode,
      marketplaceGstin: env.commerce.gstinMarketplace || null,
      sellerGstin: sellerSnapshot.gstNumber || null,
    };
  }

  buildInvoiceItem(item = {}) {
    const taxBreakup = this.normalizeJson(item.tax_breakup, {});
    const taxableAmount = this.money(taxBreakup.taxableAmount ?? Number(item.line_total || 0) - Number(item.discount_amount || 0));
    const cgstAmount = this.money(taxBreakup.cgstAmount);
    const sgstAmount = this.money(taxBreakup.sgstAmount);
    const igstAmount = this.money(taxBreakup.igstAmount);
    const taxAmount = this.money(item.tax_amount ?? taxBreakup.taxAmount ?? (cgstAmount + sgstAmount + igstAmount));

    return {
      orderItemId: item.id,
      productId: item.product_id,
      productTitle: item.product_title,
      productSku: item.product_sku,
      sellerId: item.seller_id || null,
      organizationId: item.organization_id || null,
      storeId: item.store_id || null,
      warehouseId: item.warehouse_id || null,
      variantId: item.variant_id,
      variantSku: item.variant_sku,
      hsnCode: item.hsn_code,
      gstRate: this.money(item.gst_rate),
      quantity: Number(item.quantity || 0),
      unitPrice: this.money(item.unit_price),
      lineTotal: this.money(item.line_total),
      discountAmount: this.money(item.discount_amount),
      taxableAmount,
      taxAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      taxPayableAmount: this.money(taxBreakup.taxPayableAmount),
      taxBreakup,
    };
  }

  buildTaxLedgerEntries(orderId, invoiceId, amounts = {}, organization = {}) {
    const entries = [];
    if (Number(amounts.cgstAmount || 0) > 0) {
      entries.push(this.makeLedgerEntry(orderId, invoiceId, "tax_collected", "cgst", amounts.cgstAmount, "invoice", invoiceId, organization));
    }
    if (Number(amounts.sgstAmount || 0) > 0) {
      entries.push(this.makeLedgerEntry(orderId, invoiceId, "tax_collected", "sgst", amounts.sgstAmount, "invoice", invoiceId, organization));
    }
    if (Number(amounts.igstAmount || 0) > 0) {
      entries.push(this.makeLedgerEntry(orderId, invoiceId, "tax_collected", "igst", amounts.igstAmount, "invoice", invoiceId, organization));
    }
    return entries;
  }

  async publishInvoiceGenerated(invoice, order, extraPayload = {}) {
    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.INVOICE_GENERATED_V1,
        {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoice_number,
          orderId: order.id,
          buyerId: invoice.buyer_id,
          sellerId: invoice.seller_id || null,
          invoiceType: this.invoiceType(invoice),
          totalAmount: Number(invoice.total_amount || 0),
          ...extraPayload,
        },
        { source: "tax-module", aggregateId: order.id },
      ),
    );
  }

  buildSellerSnapshot(sellerId, seller = {}, organizationSnapshot = {}) {
    const sellerProfile = seller?.sellerProfile || {};
    const profile = seller?.profile || {};
    const organization = this.normalizeJson(organizationSnapshot, {});
    if (organization?.organizationId || organization?.legalBusinessName || organization?.gstin) {
      const billingAddress = organization.billingAddress || organization.businessAddress || null;
      return {
        sellerId,
        organizationId: organization.organizationId || organization.id || null,
        email: seller?.email || null,
        phone: seller?.phone || null,
        displayName: organization.storeDisplayName || organization.legalBusinessName || null,
        legalBusinessName: organization.legalBusinessName || null,
        businessName: organization.storeDisplayName || null,
        primaryContactName: sellerProfile.primaryContactName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null,
        gstNumber: organization.gstin || organization.taxSettings?.gstin || null,
        panNumber: organization.pan || organization.taxSettings?.pan || null,
        businessAddress: billingAddress,
        billingAddress,
        pickupAddress: organization.pickupAddress || null,
        returnAddress: organization.returnAddress || null,
        taxSettings: organization.taxSettings || {},
        invoiceSettings: organization.invoiceSettings || {},
        payoutSettings: organization.payoutSettings || {},
      };
    }
    return {
      sellerId,
      email: seller?.email || null,
      phone: seller?.phone || null,
      displayName: sellerProfile.displayName || sellerProfile.businessName || sellerProfile.legalBusinessName || null,
      legalBusinessName: sellerProfile.legalBusinessName || sellerProfile.businessName || null,
      businessName: sellerProfile.businessName || null,
      primaryContactName: sellerProfile.primaryContactName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null,
      gstNumber: sellerProfile.gstNumber || null,
      panNumber: sellerProfile.panNumber || null,
      businessAddress: sellerProfile.businessAddress || null,
      pickupAddress: sellerProfile.pickupAddress || null,
      returnAddress: sellerProfile.returnAddress || null,
    };
  }

  buildBuyerSnapshot(order = {}) {
    const buyer = order.relations?.buyer || {};
    return {
      buyerId: order.buyer_id,
      email: buyer.email || null,
      phone: buyer.phone || null,
      profile: buyer.profile || {},
      shippingAddress: this.normalizeJson(order.shipping_address, {}),
    };
  }

  getDeliveryChargeBySeller(order = {}, sellerId) {
    const metadata = this.normalizeJson(order.metadata, {});
    const sellerCharges = Array.isArray(metadata.deliveryCharge?.sellers)
      ? metadata.deliveryCharge.sellers
      : [];
    const sellerCharge = sellerCharges.find((entry) => String(entry.sellerId) === String(sellerId));
    return this.money(sellerCharge?.chargeAmount);
  }

  splitTaxAmountByState(taxAmount, sellerSnapshot = {}) {
    const roundedTaxAmount = this.money(taxAmount);
    const marketplaceState = String(env.commerce.businessState || "").trim().toLowerCase();
    const sellerState = String(
      sellerSnapshot.businessAddress?.state ||
      sellerSnapshot.pickupAddress?.state ||
      sellerSnapshot.returnAddress?.state ||
      "",
    ).trim().toLowerCase();

    if (roundedTaxAmount <= 0) {
      return { cgstAmount: 0, sgstAmount: 0, igstAmount: 0, taxMode: marketplaceState && sellerState && marketplaceState !== sellerState ? "igst" : "cgst_sgst" };
    }

    if (marketplaceState && sellerState && marketplaceState !== sellerState) {
      return { cgstAmount: 0, sgstAmount: 0, igstAmount: roundedTaxAmount, taxMode: "igst" };
    }

    const cgstAmount = this.money(roundedTaxAmount / 2);
    return {
      cgstAmount,
      sgstAmount: this.money(roundedTaxAmount - cgstAmount),
      igstAmount: 0,
      taxMode: "cgst_sgst",
    };
  }

  invoiceType(invoice = {}) {
    return invoice.invoice_type || INVOICE_TYPES.ORDER_CUSTOMER;
  }

  assertInvoiceDocumentAccess(invoice = {}, actor = {}) {
    if (this.isAdminActor(actor)) return;

    const invoiceType = this.invoiceType(invoice);
    const sellerId = this.getActorSellerId(actor);
    if (sellerId && invoice.seller_id && String(invoice.seller_id) === String(sellerId)) {
      if (
        actor.organizationId &&
        String(invoice.organization_id || "") !== String(actor.organizationId)
      ) {
        throw new AppError("This tax document belongs to another organization", 403);
      }
      return;
    }

    if (
      actor.userId &&
      String(invoice.buyer_id || "") === String(actor.userId) &&
      invoiceType !== INVOICE_TYPES.PLATFORM_COMMISSION
    ) {
      return;
    }

    throw new AppError("You are not allowed to download this tax document", 403);
  }

  buildInvoiceDocument(invoice = {}) {
    const metadata = this.normalizeJson(invoice.metadata, {});
    const amounts = metadata.amounts || {};
    const items = metadata.items || metadata.lineItems || [];
    const currency = invoice.currency || "INR";
    const seller = metadata.seller || {};
    const buyer = metadata.buyer || {};
    const shippingAddress = metadata.shippingAddress || buyer.shippingAddress || {};

    return {
      layout: "invoice",
      title: this.getInvoiceDocumentTitle(invoice),
      subtitle: `Invoice ${invoice.invoice_number || invoice.id}`,
      fileBaseName: invoice.invoice_number || `invoice-${invoice.id}`,
      generatedAt: new Date().toISOString(),
      data: {
        invoice: {
          number: invoice.invoice_number,
          type: this.invoiceType(invoice),
          issuedAt: invoice.issued_at || invoice.created_at,
          orderId: invoice.order_id,
          orderNumber: metadata.orderNumber || null,
          currency,
          placeOfSupply: invoice.place_of_supply,
          taxMode: invoice.tax_mode || amounts.taxMode,
          gstinMarketplace: invoice.gstin_marketplace,
          gstinSeller: invoice.gstin_seller,
          issuerType: invoice.issuer_type,
          recipientType: invoice.recipient_type,
        },
        seller,
        buyer,
        shippingAddress,
        amounts: {
          ...amounts,
          cgstAmount: amounts.cgstAmount ?? invoice.cgst_amount,
          sgstAmount: amounts.sgstAmount ?? invoice.sgst_amount,
          igstAmount: amounts.igstAmount ?? invoice.igst_amount,
          tcsAmount: amounts.tcsAmount ?? invoice.tcs_amount,
          taxableAmount: amounts.productTaxableAmount ?? invoice.taxable_amount,
          totalAmount: amounts.finalPayableAmount ?? invoice.total_amount,
        },
        items,
      },
      raw: { invoice },
      sections: [
        {
          title: "Document Summary",
          rows: [
            { label: "Invoice Number", value: invoice.invoice_number },
            { label: "Invoice Type", value: this.invoiceType(invoice) },
            { label: "Order ID", value: invoice.order_id },
            { label: "Reference", value: [invoice.reference_type, invoice.reference_id].filter(Boolean).join(" / ") },
            { label: "Issued At", value: invoice.issued_at || invoice.created_at },
            { label: "Currency", value: currency },
          ],
        },
        {
          title: "Parties",
          rows: [
            { label: "Issuer", value: invoice.issuer_type || "-" },
            { label: "Recipient", value: invoice.recipient_type || "-" },
            { label: "Buyer ID", value: invoice.buyer_id || "-" },
            { label: "Seller ID", value: invoice.seller_id || "-" },
            { label: "Marketplace GSTIN", value: invoice.gstin_marketplace || "-" },
            { label: "Seller GSTIN", value: invoice.gstin_seller || "-" },
            { label: "Place Of Supply", value: invoice.place_of_supply || "-" },
          ],
        },
        {
          title: "Amounts",
          rows: [
            { label: "Gross Sales", value: this.renderMoney(amounts.grossSalesAmount, currency) },
            { label: "Discount", value: this.renderMoney(amounts.discountAmount, currency) },
            { label: "Taxable Amount", value: this.renderMoney(invoice.taxable_amount, currency) },
            { label: "CGST", value: this.renderMoney(invoice.cgst_amount, currency) },
            { label: "SGST", value: this.renderMoney(invoice.sgst_amount, currency) },
            { label: "IGST", value: this.renderMoney(invoice.igst_amount, currency) },
            { label: "TCS", value: this.renderMoney(invoice.tcs_amount, currency) },
            { label: "Tax Amount", value: this.renderMoney(invoice.tax_amount, currency) },
            { label: "Delivery Charge", value: this.renderMoney(amounts.deliveryChargeAmount, currency) },
            { label: "Customer Platform Fee", value: this.renderMoney(amounts.customerPlatformFeeAmount, currency) },
            { label: "Platform Fee GST", value: this.renderMoney(amounts.customerPlatformFeeTaxAmount, currency) },
            { label: "COD Charge", value: this.renderMoney(amounts.codChargeAmount, currency) },
            { label: "Wallet Discount", value: this.renderMoney(amounts.walletDiscountAmount, currency) },
            { label: "Final Payable", value: this.renderMoney(amounts.finalPayableAmount, currency) },
            { label: "Total Amount", value: this.renderMoney(invoice.total_amount, currency) },
          ],
        },
        {
          title: "Line Items",
          rows: this.buildDocumentItemRows(items, currency),
        },
      ],
    };
  }

  buildCreditNoteDocument(creditNote = {}, invoice = null) {
    const metadata = this.normalizeJson(creditNote.metadata, {});
    const currency = creditNote.currency || invoice?.currency || "INR";

    return {
      layout: "credit_note",
      title: "Marketplace Credit Note",
      subtitle: `Credit Note ${creditNote.credit_note_number || creditNote.id}`,
      fileBaseName: creditNote.credit_note_number || `credit-note-${creditNote.id}`,
      generatedAt: new Date().toISOString(),
      data: {
        creditNote: {
          number: creditNote.credit_note_number,
          invoiceNumber: invoice?.invoice_number || creditNote.invoice_id || null,
          orderId: creditNote.order_id,
          orderNumber: metadata.orderNumber || null,
          referenceType: creditNote.reference_type,
          referenceId: creditNote.reference_id,
          reason: creditNote.reason,
          issuedAt: creditNote.issued_at || creditNote.created_at,
          currency,
          scope: metadata.creditNoteScope || null,
          sellerId: metadata.sellerId || invoice?.seller_id || null,
        },
        seller: metadata.seller || {},
        buyer: metadata.buyer || {},
        shippingAddress: metadata.shippingAddress || metadata.buyer?.shippingAddress || {},
        amounts: {
          taxableAmount: creditNote.taxable_amount,
          cgstAmount: creditNote.cgst_amount,
          sgstAmount: creditNote.sgst_amount,
          igstAmount: creditNote.igst_amount,
          taxAmount: creditNote.tax_amount,
          totalAmount: creditNote.total_amount,
        },
        items: metadata.items || [],
        parentInvoice: invoice ? {
          number: invoice.invoice_number,
          gstinSeller: invoice.gstin_seller,
          gstinMarketplace: invoice.gstin_marketplace,
          placeOfSupply: invoice.place_of_supply,
          taxMode: invoice.tax_mode,
          issuerType: invoice.issuer_type,
          recipientType: invoice.recipient_type,
        } : null,
      },
      raw: { creditNote, invoice },
      sections: [
        {
          title: "Document Summary",
          rows: [
            { label: "Credit Note Number", value: creditNote.credit_note_number },
            { label: "Invoice Number", value: invoice?.invoice_number || creditNote.invoice_id || "-" },
            { label: "Order ID", value: creditNote.order_id },
            { label: "Reference", value: [creditNote.reference_type, creditNote.reference_id].filter(Boolean).join(" / ") },
            { label: "Reason", value: creditNote.reason || "-" },
            { label: "Issued At", value: creditNote.issued_at || creditNote.created_at },
            { label: "Scope", value: metadata.creditNoteScope || "-" },
            { label: "Seller ID", value: metadata.sellerId || invoice?.seller_id || "-" },
          ],
        },
        {
          title: "Reversal Amounts",
          rows: [
            { label: "Taxable Amount", value: this.renderMoney(creditNote.taxable_amount, currency) },
            { label: "CGST", value: this.renderMoney(creditNote.cgst_amount, currency) },
            { label: "SGST", value: this.renderMoney(creditNote.sgst_amount, currency) },
            { label: "IGST", value: this.renderMoney(creditNote.igst_amount, currency) },
            { label: "Tax Amount", value: this.renderMoney(creditNote.tax_amount, currency) },
            { label: "Total Amount", value: this.renderMoney(creditNote.total_amount, currency) },
          ],
        },
        {
          title: "Reversed Items",
          rows: this.buildDocumentItemRows(metadata.items || [], currency),
        },
      ],
    };
  }

  buildInvoicesExportDocument(invoices = []) {
    return {
      title: "Tax Invoice Export",
      subtitle: `${invoices.length} invoice row(s)`,
      generatedAt: new Date().toISOString(),
      sections: [
        {
          title: "Invoices",
          rows: [
            ["Invoice Number", "Type", "Order ID", "Seller ID", "Buyer ID", "Taxable", "Tax", "Total", "Issued At"],
            ...invoices.map((invoice) => [
              invoice.invoice_number,
              this.invoiceType(invoice),
              invoice.order_id,
              invoice.seller_id || "-",
              invoice.buyer_id || "-",
              this.renderMoney(invoice.taxable_amount, invoice.currency),
              this.renderMoney(invoice.tax_amount, invoice.currency),
              this.renderMoney(invoice.total_amount, invoice.currency),
              invoice.issued_at || invoice.created_at,
            ]),
          ],
        },
      ],
    };
  }

  buildCreditNotesExportDocument(creditNotes = []) {
    return {
      title: "Tax Credit Note Export",
      subtitle: `${creditNotes.length} credit-note row(s)`,
      generatedAt: new Date().toISOString(),
      sections: [
        {
          title: "Credit Notes",
          rows: [
            ["Credit Note Number", "Invoice ID", "Order ID", "Reference", "Taxable", "Tax", "Total", "Reason", "Issued At"],
            ...creditNotes.map((creditNote) => [
              creditNote.credit_note_number,
              creditNote.invoice_id || "-",
              creditNote.order_id,
              [creditNote.reference_type, creditNote.reference_id].filter(Boolean).join(" / "),
              this.renderMoney(creditNote.taxable_amount, creditNote.currency),
              this.renderMoney(creditNote.tax_amount, creditNote.currency),
              this.renderMoney(creditNote.total_amount, creditNote.currency),
              creditNote.reason || "-",
              creditNote.issued_at || creditNote.created_at,
            ]),
          ],
        },
      ],
    };
  }

  buildTaxReportExportDocument(report = {}) {
    return {
      title: "Tax Ledger Report Export",
      subtitle: `${report.window?.fromDate || "-"} to ${report.window?.toDate || "-"}`,
      generatedAt: new Date().toISOString(),
      sections: [
        {
          title: "Tax Ledger",
          rows: [
            ["Component", "Entry Type", "Entry Count", "Total Amount"],
            ...(report.entries || []).map((entry) => [
              entry.tax_component,
              entry.entry_type,
              entry.entry_count,
              this.renderMoney(entry.total_amount, "INR"),
            ]),
          ],
        },
      ],
    };
  }

  resolveDocumentRecipient(source = {}, invoice = null, payload = {}, actor = {}) {
    const sourceMetadata = this.normalizeJson(source.metadata, {});
    const invoiceMetadata = this.normalizeJson(invoice?.metadata, {});
    const metadata = { ...invoiceMetadata, ...sourceMetadata };
    const seller = metadata.seller || {};
    const buyer = metadata.buyer || {};
    const recipientType = invoice?.recipient_type || source.recipient_type || null;
    const sellerRecipient = recipientType === "seller" || metadata.creditNoteScope === "platform_commission_invoice";
    const email = payload.recipientEmail ||
      (sellerRecipient ? seller.email : buyer.email) ||
      buyer.email ||
      seller.email ||
      actor.email ||
      null;
    const phone = payload.recipientPhone ||
      (sellerRecipient ? seller.phone : buyer.phone) ||
      buyer.phone ||
      seller.phone ||
      null;

    return {
      userId: sellerRecipient
        ? source.seller_id || metadata.sellerId || invoice?.seller_id || null
        : source.buyer_id || invoice?.buyer_id || null,
      email,
      phone,
      recipientType: sellerRecipient ? "seller" : "buyer",
    };
  }

  getInvoiceDocumentTitle(invoice = {}) {
    const type = this.invoiceType(invoice);
    if (type === INVOICE_TYPES.SELLER_CUSTOMER) return "Seller Customer Tax Invoice";
    if (type === INVOICE_TYPES.PLATFORM_COMMISSION) return "Platform Commission Tax Invoice";
    return "Order Tax Invoice";
  }

  buildDocumentItemRows(items = [], currency = "INR") {
    if (!items.length) {
      return [{ label: "Items", value: "No line items available" }];
    }

    return [
      ["Title", "HSN", "Qty", "Taxable", "Tax", "Total"],
      ...items.map((item) => [
        item.productTitle || item.description || item.product_title || "-",
        item.hsnCode || item.hsn_code || "-",
        item.quantity ?? "-",
        this.renderMoney(item.taxableAmount ?? item.taxable_amount, currency),
        this.renderMoney(item.taxAmount ?? item.tax_amount, currency),
        this.renderMoney(item.totalAmount ?? item.total_amount ?? item.lineTotal ?? item.line_total, currency),
      ]),
    ];
  }

  renderMoney(value, currency = "INR") {
    return `${currency} ${Number(value || 0).toFixed(2)}`;
  }

  isAdminActor(actor = {}) {
    return actor.isSuperAdmin || ADMIN_ROLES.includes(actor.role);
  }

  getActorSellerId(actor = {}) {
    if (!SELLER_ROLES.includes(actor.role)) {
      return null;
    }
    return actor.ownerSellerId || actor.userId || null;
  }

  readJsonNumber(value, key) {
    const parsed = this.normalizeJson(value, {});
    return Number(parsed?.[key] || 0);
  }

  money(value) {
    return Number(Number(value || 0).toFixed(2));
  }

  makeLedgerEntry(orderId, invoiceId, entryType, taxComponent, amount, referenceType = "invoice", referenceId = invoiceId, organization = {}) {
    return {
      orderId,
      invoiceId,
      entryType,
      taxComponent,
      amount: Number(amount),
      currency: "INR",
      organizationId: organization.organizationId || null,
      organizationSnapshot: organization.organizationSnapshot || {},
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
