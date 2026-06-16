const { AppError } = require("../../../shared/errors/app-error");
const { TaxRepository } = require("../repositories/tax.repository");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { env } = require("../../../config/env");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { ROLES } = require("../../../shared/constants/roles");
const { UserModel } = require("../../user/models/user.model");

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
          productId: item.product_id,
          productTitle: item.product_title,
          sellerId: item.seller_id,
          hsnCode: item.hsn_code,
          gstRate: Number(item.gst_rate || 0),
          taxableAmount: Number(item.line_total || 0) - Number(item.discount_amount || 0),
          taxAmount: Number(item.tax_amount || 0),
          taxBreakup: this.normalizeJson(item.tax_breakup, {}),
        })),
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
        items: group.items,
        sellerProfile,
        actor,
        parentInvoiceId: orderInvoice?.id || null,
      });
      const commissionInvoice = await this.findOrCreatePlatformCommissionInvoice({
        order,
        sellerId: group.sellerId,
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

  async findOrCreateSellerCustomerInvoice({
    order,
    sellerId,
    items,
    sellerProfile,
    actor,
    parentInvoiceId,
  }) {
    const referenceId = `${order.id}:${sellerId}`;
    const existing = await this.taxRepository.findInvoiceByOrderAndType({
      orderId: order.id,
      invoiceType: INVOICE_TYPES.SELLER_CUSTOMER,
      sellerId,
      referenceType: "seller_order",
      referenceId,
    });
    if (existing) {
      return existing;
    }

    const amounts = this.calculateSellerCustomerAmounts(order, sellerId, items);
    const sellerSnapshot = this.buildSellerSnapshot(sellerId, sellerProfile);
    const invoiceNumber = await this.taxRepository.nextInvoiceNumber("GST-S");
    const invoice = await this.taxRepository.createInvoice({
      invoiceNumber,
      orderId: order.id,
      buyerId: order.buyer_id,
      sellerId,
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

    await this.taxRepository.insertLedgerEntries(this.buildTaxLedgerEntries(order.id, invoice.id, amounts));
    await this.publishInvoiceGenerated(invoice, order, {
      invoiceType: INVOICE_TYPES.SELLER_CUSTOMER,
      sellerId,
    });
    return invoice;
  }

  async findOrCreatePlatformCommissionInvoice({
    order,
    sellerId,
    items,
    sellerProfile,
    actor,
    parentInvoiceId,
  }) {
    const referenceId = `${order.id}:${sellerId}`;
    const existing = await this.taxRepository.findInvoiceByOrderAndType({
      orderId: order.id,
      invoiceType: INVOICE_TYPES.PLATFORM_COMMISSION,
      sellerId,
      referenceType: "platform_commission",
      referenceId,
    });
    if (existing) {
      return existing;
    }

    const sellerSnapshot = this.buildSellerSnapshot(sellerId, sellerProfile);
    const amounts = this.calculatePlatformCommissionAmounts(items, sellerSnapshot);
    const invoiceNumber = await this.taxRepository.nextInvoiceNumber("GST-C");
    const invoice = await this.taxRepository.createInvoice({
      invoiceNumber,
      orderId: order.id,
      buyerId: sellerId,
      sellerId,
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

    await this.taxRepository.insertLedgerEntries(this.buildTaxLedgerEntries(order.id, invoice.id, amounts));
    await this.publishInvoiceGenerated(invoice, order, {
      invoiceType: INVOICE_TYPES.PLATFORM_COMMISSION,
      sellerId,
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
      const current = grouped.get(sellerId) || [];
      current.push(item);
      grouped.set(sellerId, current);
    }
    return [...grouped.entries()].map(([sellerId, groupItems]) => ({ sellerId, items: groupItems }));
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

  buildTaxLedgerEntries(orderId, invoiceId, amounts = {}) {
    const entries = [];
    if (Number(amounts.cgstAmount || 0) > 0) {
      entries.push(this.makeLedgerEntry(orderId, invoiceId, "tax_collected", "cgst", amounts.cgstAmount));
    }
    if (Number(amounts.sgstAmount || 0) > 0) {
      entries.push(this.makeLedgerEntry(orderId, invoiceId, "tax_collected", "sgst", amounts.sgstAmount));
    }
    if (Number(amounts.igstAmount || 0) > 0) {
      entries.push(this.makeLedgerEntry(orderId, invoiceId, "tax_collected", "igst", amounts.igstAmount));
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

  buildSellerSnapshot(sellerId, seller = {}) {
    const sellerProfile = seller?.sellerProfile || {};
    const profile = seller?.profile || {};
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
