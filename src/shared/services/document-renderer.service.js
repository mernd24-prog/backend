const DEFAULT_CURRENCY = "INR";
const PLATFORM_COMMISSION_SAC_CODE = process.env.PLATFORM_COMMISSION_SAC_CODE || "998599";
const PLATFORM_CUSTOMER_FEE_SAC_CODE =
  process.env.PLATFORM_CUSTOMER_FEE_SAC_CODE ||
  process.env.PLATFORM_COMMISSION_SAC_CODE ||
  "998599";
const SHIPPING_SERVICE_SAC_CODE = process.env.PLATFORM_SHIPPING_SAC_CODE || process.env.SHIPPING_SAC_CODE || "996812";
const DEFAULT_PLATFORM_FEE_GST_RATE = Number(process.env.PLATFORM_CUSTOMER_FEE_GST_RATE || process.env.PLATFORM_FEE_GST_RATE || 18);

class DocumentRendererService {
  render(document = {}, options = {}) {
    const format = this.normalizeFormat(options.format);
    const fileBaseName = this.safeFileName(options.fileBaseName || document.fileBaseName || "document");
    const rendered = {
      pdf: () => ({
        body: this.renderPdf(document),
        contentType: "application/pdf",
        fileName: `${fileBaseName}.pdf`,
      }),
      html: () => ({
        body: this.renderHtml(document),
        contentType: "text/html; charset=utf-8",
        fileName: `${fileBaseName}.html`,
      }),
      text: () => ({
        body: this.renderText(document),
        contentType: "text/plain; charset=utf-8",
        fileName: `${fileBaseName}.txt`,
      }),
      csv: () => ({
        body: this.renderCsv(document),
        contentType: "text/csv; charset=utf-8",
        fileName: `${fileBaseName}.csv`,
      }),
      json: () => ({
        body: JSON.stringify(document, null, 2),
        contentType: "application/json; charset=utf-8",
        fileName: `${fileBaseName}.json`,
      }),
    }[format]();

    return { ...rendered, format };
  }

  normalizeFormat(format = "pdf") {
    const normalized = String(format || "pdf").toLowerCase();
    return ["pdf", "html", "text", "csv", "json"].includes(normalized) ? normalized : "pdf";
  }

  money(value, currency = DEFAULT_CURRENCY) {
    const amount = Number(value || 0).toFixed(2);
    return `${currency} ${amount}`;
  }

  roundMoney(value) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return 0;
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  clampMoney(value, min = 0, max = Number.POSITIVE_INFINITY) {
    const num = this.roundMoney(value);
    const lower = Number.isFinite(Number(min)) ? Number(min) : 0;
    const upper = Number.isFinite(Number(max)) ? Number(max) : Number.POSITIVE_INFINITY;
    return this.roundMoney(Math.min(Math.max(num, lower), upper));
  }

  pickMoney(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") return this.roundMoney(value);
    }
    return 0;
  }

  getCreditNoteContext(data = {}) {
    const creditNote = data.creditNote || data.credit_note || {};
    const parentInvoice = data.parentInvoice || data.parent_invoice || {};
    const reversalContext = data.reversalContext || data.reversal_context || {};
    return {
      creditNote,
      parentInvoice,
      reversalContext: {
        overallWeight: reversalContext.overallWeight ?? reversalContext.overall_weight ?? null,
        originalTotals: reversalContext.originalTotals || reversalContext.original_totals || {},
        alreadyReversedTotals: reversalContext.alreadyReversedTotals || reversalContext.already_reversed_totals || {},
        componentPolicies: reversalContext.componentPolicies || reversalContext.component_policies || {},
      },
    };
  }

  normalizeCreditNoteItems(data = {}) {
    const items = Array.isArray(data.items) ? data.items : [];
    return items
      .map((item) => {
        const originalQuantity = Number(item.originalQuantity ?? item.original_quantity ?? item.invoiceQuantity ?? item.invoice_quantity ?? item.quantity ?? 0) || 0;
        const alreadyReversedQuantity = Number(item.alreadyReversedQuantity ?? item.already_reversed_quantity ?? 0) || 0;
        const requestedQuantity = Number(item.quantity ?? item.reversedQuantity ?? item.reversed_quantity ?? 0) || 0;
        const quantity = originalQuantity > 0
          ? this.clampMoney(requestedQuantity, 0, Math.max(0, originalQuantity - alreadyReversedQuantity))
          : this.roundMoney(requestedQuantity);
        const explicitWeight = item.reversalWeight ?? item.reversal_weight;
        const reversalWeight = explicitWeight !== undefined && explicitWeight !== null
          ? Number(explicitWeight)
          : originalQuantity > 0
            ? quantity / originalQuantity
            : 1;
        const originalLineTotal = this.pickMoney(item.originalLineTotal, item.original_line_total, item.invoiceLineTotal, item.invoice_line_total, item.totalAmount, item.total_amount);
        const alreadyReversedTotalAmount = this.pickMoney(item.alreadyReversedTotalAmount, item.already_reversed_total_amount);
        const maxLineTotal = originalLineTotal > 0
          ? Math.max(0, originalLineTotal - alreadyReversedTotalAmount)
          : Number.POSITIVE_INFINITY;
        const fallbackTotal = originalLineTotal > 0
          ? this.roundMoney(originalLineTotal * Math.max(0, Math.min(1, reversalWeight)))
          : this.pickMoney(item.totalAmount, item.total_amount);
        const totalAmount = this.clampMoney(
          this.pickMoney(item.totalAmount, item.total_amount, fallbackTotal),
          0,
          maxLineTotal,
        );
        const explicitTaxable = item.taxableAmount ?? item.taxable_amount;
        const explicitTax = item.taxAmount ?? item.tax_amount;
        const taxAmount = explicitTax !== undefined && explicitTax !== null
          ? this.pickMoney(explicitTax)
          : this.pickMoney(item.cgstAmount, item.cgst_amount) +
            this.pickMoney(item.sgstAmount, item.sgst_amount) +
            this.pickMoney(item.igstAmount, item.igst_amount);
        const taxableAmount = explicitTaxable !== undefined && explicitTaxable !== null
          ? this.pickMoney(explicitTaxable)
          : this.roundMoney(Math.max(0, totalAmount - taxAmount));

        return {
          ...item,
          orderItemId: item.orderItemId || item.order_item_id || null,
          productTitle: item.productTitle || item.product_title || item.description || "Reversed item",
          productSku: item.productSku || item.product_sku || item.variantSku || item.variant_sku || item.sku || "",
          hsnCode: item.hsnCode || item.hsn_code || item.sacCode || item.sac_code || "-",
          originalQuantity,
          quantity,
          reversalWeight: Number.isFinite(reversalWeight) ? reversalWeight : 0,
          taxableAmount,
          taxAmount: this.roundMoney(taxAmount),
          cgstAmount: this.pickMoney(item.cgstAmount, item.cgst_amount),
          sgstAmount: this.pickMoney(item.sgstAmount, item.sgst_amount),
          igstAmount: this.pickMoney(item.igstAmount, item.igst_amount),
          totalAmount,
          originalLineTotal,
          alreadyReversedQuantity,
          alreadyReversedTotalAmount,
        };
      })
      .filter((item) => Number(item.quantity || 0) > 0 || Number(item.totalAmount || 0) > 0);
  }

  getCreditNoteAmounts(data = {}, normalizedItems = []) {
    const { creditNote, reversalContext } = this.getCreditNoteContext(data);
    const input = data.amounts || data.refundBreakup || data.refund_breakup || {};
    const original = reversalContext.originalTotals || {};
    const already = reversalContext.alreadyReversedTotals || {};
    const policies = reversalContext.componentPolicies || {};
    const itemTaxable = this.roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.taxableAmount || 0), 0));
    const itemTax = this.roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0));
    const itemCgst = this.roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.cgstAmount || 0), 0));
    const itemSgst = this.roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.sgstAmount || 0), 0));
    const itemIgst = this.roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.igstAmount || 0), 0));
    const itemTotal = this.roundMoney(normalizedItems.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0));
    const originalEligibleGross = this.pickMoney(original.invoiceValue, original.grossSalesAmount, original.totalAmount, itemTotal);
    const explicitWeight = reversalContext.overallWeight ?? reversalContext.overall_weight;
    const overallWeight = explicitWeight !== undefined && explicitWeight !== null
      ? Number(explicitWeight)
      : originalEligibleGross > 0
        ? itemTotal / originalEligibleGross
        : 0;
    const originalInvoiceValue = this.pickMoney(original.invoiceValue, original.totalAmount, original.grossSalesAmount);
    const alreadyInvoiceValue = this.pickMoney(already.invoiceValue, already.totalAmount, already.grossSalesAmount);
    const closesRemainingInvoice =
      String(creditNote.reversalMode || creditNote.reversal_mode || "").toLowerCase() === "full" ||
      (originalInvoiceValue > 0 && this.roundMoney(originalInvoiceValue - alreadyInvoiceValue - itemTotal) <= 0.01);
    const reverseComponent = (key, policy = "prorate", explicitValue) => {
      if (explicitValue !== undefined && explicitValue !== null) return this.pickMoney(explicitValue);
      if (policy === "none" || policy === "separate_invoice") return 0;
      const originalAmount = this.pickMoney(original[key], original[`${key}Amount`]);
      const alreadyAmount = this.pickMoney(already[key], already[`${key}Amount`]);
      const remaining = Math.max(0, originalAmount - alreadyAmount);
      if (policy === "full" || closesRemainingInvoice) return this.roundMoney(remaining);
      return this.clampMoney(originalAmount * Math.max(0, Math.min(1, overallWeight || 0)), 0, remaining);
    };
    const taxableAmount = this.pickMoney(input.taxableAmount, input.taxable_amount, itemTaxable);
    const taxAmount = this.pickMoney(input.taxAmount, input.tax_amount, itemTax);
    const totalAmount = this.pickMoney(input.totalAmount, input.total_amount, input.productInvoiceValueReversed, itemTotal || taxableAmount + taxAmount);
    const promotion = reverseComponent(
      "customerPromotionAmount",
      policies.promotion || "prorate",
      input.customerPromotionReversalAmount ?? input.customer_promotion_reversal_amount ?? input.promotionReversalAmount,
    );
    const shipping = reverseComponent(
      "shippingAmount",
      policies.shipping || "prorate",
      input.shippingReversalAmount ?? input.shipping_reversal_amount,
    );
    const platformFee = reverseComponent(
      "customerPlatformFeeAmount",
      policies.customerPlatformFee || policies.customer_platform_fee || "separate_invoice",
      input.customerPlatformFeeReversalAmount ?? input.customer_platform_fee_reversal_amount,
    );
    const customerRefund = this.pickMoney(
      input.customerRefundAmount,
      input.customer_refund_amount,
      input.refundAmount,
      input.refund_amount,
      Math.max(0, totalAmount - promotion + shipping + platformFee),
    );
    return {
      ...input,
      taxableAmount,
      taxAmount,
      cgstAmount: this.pickMoney(input.cgstAmount, input.cgst_amount, itemCgst),
      sgstAmount: this.pickMoney(input.sgstAmount, input.sgst_amount, itemSgst),
      igstAmount: this.pickMoney(input.igstAmount, input.igst_amount, itemIgst),
      totalAmount,
      customerPromotionReversalAmount: promotion,
      shippingReversalAmount: shipping,
      customerPlatformFeeReversalAmount: platformFee,
      customerRefundAmount: customerRefund,
      remainingInvoiceBalance: this.pickMoney(input.remainingInvoiceBalance, input.remaining_invoice_balance, Math.max(0, this.pickMoney(original.invoiceValue, original.totalAmount) - this.pickMoney(already.invoiceValue, already.totalAmount) - totalAmount)),
      remainingCustomerBalance: this.pickMoney(input.remainingCustomerBalance, input.remaining_customer_balance, Math.max(0, this.pickMoney(original.customerPaid) - this.pickMoney(already.customerRefundAmount) - customerRefund)),
      overallWeight: Number.isFinite(overallWeight) ? overallWeight : 0,
    };
  }

  formatReversalMoney(value, currency = DEFAULT_CURRENCY) {
    return `-${this.money(Math.abs(this.roundMoney(value)), currency)}`;
  }

  formatReversalQuantity(value) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "-0";
    return `-${Number.isInteger(num) ? String(num) : this.roundMoney(num).toFixed(2)}`;
  }

  safeFileName(value) {
    return String(value || "document")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "document";
  }

  renderText(document = {}) {
    return `${this.flattenDocument(document).join("\n")}\n`;
  }

  renderCsv(document = {}) {
    const rows = [];
    for (const section of document.sections || []) {
      for (const row of section.rows || []) {
        const values = Array.isArray(row)
          ? row
          : [row.label, row.value];
        rows.push([section.title || "Section", ...values]);
      }
    }
    const maxColumns = Math.max(1, ...rows.map((row) => row.length - 1));
    const headers = [
      "section",
      ...Array.from({ length: maxColumns }, (_, index) => `column_${index + 1}`),
    ];
    rows.unshift(headers);
    return `${rows.map((row) => row.map((cell) => this.escapeCsv(cell)).join(",")).join("\n")}\n`;
  }

  renderHtml(document = {}) {
    if (document.layout === "invoice") return this.renderInvoiceHtml(document);
    if (document.layout === "credit_note") return this.renderCreditNoteHtml(document);
    return this.renderGenericHtml(document);
  }

  /* ─────────────────── INVOICE HTML ─────────────────── */

  renderInvoiceHtml(document = {}) {
    const d = document.data || {};
    const inv = d.invoice || {};
    const seller = d.seller || {};
    const buyer = d.buyer || {};
    const shippingAddr = d.shippingAddress || buyer.shippingAddress || {};
    const amounts = d.amounts || {};
    const items = d.items || [];
    const currency = inv.currency || DEFAULT_CURRENCY;
    const isSeller = inv.type === "seller_customer";
    const isCommission = inv.type === "platform_commission";

    const issuerName = isSeller
      ? (seller.legalBusinessName || seller.displayName || seller.businessName || "Seller")
      : (process.env.INVOICE_BRAND_NAME || "Sam Global");
    const brandName = process.env.INVOICE_BRAND_NAME || issuerName || "Sam Global";
    const platformName = process.env.INVOICE_BRAND_NAME || "Sam Global";
    const platformAddress = process.env.INVOICE_REGISTERED_OFFICE || d.marketplace?.registeredOffice || d.marketplace?.address || "";
    const logoUrl = process.env.INVOICE_LOGO_URL || d.marketplace?.logoUrl || document.logoUrl || "";
    const issuerGstin = isSeller
      ? (inv.gstinSeller || seller.gstNumber || null)
      : (inv.gstinMarketplace || d.marketplace?.gstin || process.env.GSTIN_MARKETPLACE || process.env.PLATFORM_GSTIN || null);
    const issuerAddrLines = isSeller ? this.formatAddressLines(seller.billingAddress || seller.businessAddress) : [];
    const marketplaceGstin = inv.gstinMarketplace || d.marketplace?.gstin || process.env.GSTIN_MARKETPLACE || process.env.PLATFORM_GSTIN || null;

    const recipientName = isCommission
      ? (seller.legalBusinessName || seller.displayName || seller.businessName || "Seller")
      : this.getBuyerName(buyer);
    const recipientEmail = isCommission ? (seller.email || null) : (buyer.email || null);

    const invoiceDate = this.formatDate(inv.issuedAt);
    const orderRef = inv.orderNumber || (inv.orderId ? `#${String(inv.orderId).slice(-8).toUpperCase()}` : "—");
    const isIgst = inv.taxMode === "igst";

    const cgst = Number(amounts.cgstAmount ?? 0);
    const sgst = Number(amounts.sgstAmount ?? 0);
    const igst = Number(amounts.igstAmount ?? 0);
    const tcs = Number(amounts.tcsAmount ?? 0);

    const itemRowsHtml = items.length
      ? items.map((item, i) => this.renderInvoiceItemRow(item, i + 1, currency, isIgst)).join("")
      : `<tr><td colspan="6" class="empty-row">No line items on record</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${this.escapeHtml(document.title || "Tax Invoice")}</title>
  ${this.invoiceStyles()}
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="hdr">
    <div class="brand-lockup">
      ${logoUrl
        ? `<img class="brand-logo-img" src="${this.escapeHtml(logoUrl)}" alt="${this.escapeHtml(brandName)} logo">`
        : ``}
      <div>
        <div class="hdr-brand">${this.escapeHtml(brandName)}</div>
        <div class="hdr-sub">Contact us: ${this.escapeHtml(process.env.INVOICE_CONTACT || process.env.SUPPORT_EMAIL || "support@samglobal.com")}</div>
       
        <div class="hdr-sub">Name: ${this.escapeHtml(platformName)}</div>
        <div class="hdr-sub">Registered office: ${this.escapeHtml(platformAddress || "Not configured")}</div>
        <div class="hdr-sub">Platform GSTIN: ${this.escapeHtml(marketplaceGstin || "Not configured")}</div>
      </div>
    </div>
    <div class="hdr-center">
      <div class="seller-name">${this.escapeHtml(issuerName)}</div>
      ${issuerAddrLines.length ? `<div class="hdr-sub">Address: ${issuerAddrLines.map((line) => this.escapeHtml(line)).join(", ")}</div>` : ""}
      ${issuerGstin ? `<div class="hdr-sub">GSTIN: ${this.escapeHtml(issuerGstin)}</div>` : ""}
    </div>
    <div class="hdr-right">
      <div class="tax-stamp">${this.escapeHtml(document.title || "Tax Invoice")} # ${this.escapeHtml(inv.number || "—")}</div>
      <div class="hdr-date">${invoiceDate}</div>
    </div>
  </div>

  <div class="invoice-info-grid">
    <div class="order-meta">
      <div><strong>Order ID:</strong> ${this.escapeHtml(inv.orderId || orderRef || "—")}</div>
      <div><strong>Order Date:</strong> ${this.escapeHtml(this.formatDate(inv.orderDate || inv.issuedAt))}</div>
      <div><strong>Invoice Date:</strong> ${this.escapeHtml(invoiceDate)}</div>
      <div><strong>Supplier GSTIN:</strong> ${this.escapeHtml(issuerGstin || marketplaceGstin || "—")}</div>
      <div><strong>Place of Supply:</strong> ${this.escapeHtml(inv.placeOfSupply || "—")}</div>
      <div><strong>Currency:</strong> ${this.escapeHtml(currency)}</div>
    </div>
    <div class="address-block">
      <div class="addr-title">Billing Address</div>
      ${this.renderCompactAddress(recipientName, [], recipientEmail)}
    </div>
    ${!isCommission
        ? `<div class="address-block">
          <div class="addr-title">Shipping Address</div>
          ${this.renderCompactAddressFromObject(shippingAddr, recipientName)}
        </div>`
        : `<div class="address-block">
          <div class="addr-title">Billed To Seller</div>
          ${this.renderCompactAddress(recipientName, [], recipientEmail)}
        </div>`}
    <div class="keep-note">Keep this invoice for warranty and tax purposes.</div>
  </div>

  <!-- Items table -->
  <table class="tbl">
    <thead>
      <tr>
        <th class="l" style="width:18%">Product</th>
        <th class="l">Title</th>
        <th class="c" style="width:8%">Qty</th>
        <th style="width:13%">Price (${this.escapeHtml(currency)})</th>
        <th style="width:13%">Tax (${this.escapeHtml(currency)})</th>
        <th style="width:14%">Total (${this.escapeHtml(currency)})</th>
      </tr>
    </thead>
    <tbody>${itemRowsHtml}</tbody>
  </table>

  <div class="table-total-line">
    <span>Total</span>
    <span>${this.escapeHtml(String(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || "—"))}</span>
    <span>${this.escapeHtml(this.money(amounts.productTaxableAmount ?? amounts.grossSalesAmount ?? 0, currency))}</span>
    <span>${this.escapeHtml(this.money(cgst + sgst + igst + tcs, currency))}</span>
    <span>${this.escapeHtml(this.money(amounts.finalPayableAmount || amounts.totalAmount || amounts.customerFinalAmount || inv.totalAmount || 0, currency))}</span>
  </div>

  <div class="grand-total">
    <span>Grand Total</span>
    <strong>${this.escapeHtml(this.money(amounts.finalPayableAmount || amounts.totalAmount || amounts.customerFinalAmount || inv.totalAmount || 0, currency))}</strong>
  </div>

  <div class="detail-summary">
    <div>
      <div class="detail-title">GST Summary</div>
      ${this.renderTaxTable(cgst, sgst, igst, tcs, isIgst, currency)}
      ${marketplaceGstin && isSeller
        ? `<div class="mktplace-gstin">Marketplace GSTIN: <strong>${this.escapeHtml(marketplaceGstin)}</strong></div>`
        : ""}
    </div>
    <div>
      <div class="detail-title">Amount Summary</div>
      ${this.buildInvoiceAmountRows(amounts, currency).join("")}
    </div>
  </div>

  <!-- Declaration -->
  <div class="declaration">
    This is a computer-generated document and does not require a physical signature.
    ${marketplaceGstin ? `&nbsp;·&nbsp; Marketplace GSTIN: ${this.escapeHtml(marketplaceGstin)}` : ""}
    &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
  </div>

  <div class="invoice-bottom">
    <div class="policy">
      <strong>Returns Policy:</strong>
      Please retain the original brand box/package, invoice and original packing if a return is requested.
      Terms and conditions apply.
    </div>
    <div class="thanks">
      
      <strong>Thank You!</strong>
      <span>for shopping with us</span>
    </div>
  </div>

  <div class="registry-line">
    Regd. office: ${this.escapeHtml(issuerAddrLines.join(", ") || process.env.INVOICE_REGISTERED_OFFICE || "Sam Global")}
    <span>page 1 of 1</span>
  </div>

</div>
</body>
</html>`;
  }

  /* ─────────────────── CREDIT NOTE HTML ─────────────────── */

  renderCreditNoteHtml(document = {}) {
    const d = document.data || {};
    const { creditNote: cn, parentInvoice } = this.getCreditNoteContext(d);
    const seller = d.seller || {};
    const buyer = d.buyer || {};
    const items = this.normalizeCreditNoteItems(d);
    const amounts = this.getCreditNoteAmounts(d, items);
    const currency = cn.currency || DEFAULT_CURRENCY;
    const isIgst = parentInvoice.taxMode === "igst";
    const isCommission = cn.scope === "platform_commission_invoice";
    const isCustomerFee = cn.scope === "platform_customer_fee_invoice";
    const isSellerCustomer = !isCommission && !isCustomerFee;

    const issuerName = isSellerCustomer
      ? (seller.legalBusinessName || seller.displayName || seller.businessName || "Seller")
      : (process.env.INVOICE_BRAND_NAME || d.marketplace?.name || "Sam Global");
    const issuerGstin = isSellerCustomer
      ? (parentInvoice.gstinSeller || cn.gstinSeller || seller.gstNumber || null)
      : (parentInvoice.gstinMarketplace || cn.gstinMarketplace || d.marketplace?.gstin || process.env.GSTIN_MARKETPLACE || process.env.PLATFORM_GSTIN || null);
    const issuerAddress = isSellerCustomer
      ? this.formatAddressLines(seller.billingAddress || seller.businessAddress)
      : [process.env.INVOICE_REGISTERED_OFFICE || d.marketplace?.registeredOffice || d.marketplace?.address].filter(Boolean);
    const recipientName = isCommission
      ? (seller.legalBusinessName || seller.displayName || "Seller")
      : this.getBuyerName(buyer);
    const recipientEmail = isCommission ? seller.email : buyer.email;
    const recipientAddress = isCommission
      ? this.formatAddressLines(seller.billingAddress || seller.businessAddress)
      : this.formatAddressLines(buyer.billingAddress || d.shippingAddress || buyer.shippingAddress);

    const cnDate = this.formatDate(cn.issuedAt);
    const orderRef = cn.orderNumber || (cn.orderId ? `#${String(cn.orderId).slice(-8).toUpperCase()}` : "—");
    const reference = cn.referenceNumber || cn.reference_number || cn.rmaNumber || cn.cancellationNumber || "—";
    const title = isCommission ? "COMMISSION CREDIT NOTE" : "CREDIT NOTE / REVERSE INVOICE";

    const itemRowsHtml = items.length
      ? items.map((item, i) => this.renderCreditNoteItemRow(item, i + 1, currency)).join("")
      : `<tr><td colspan="8" class="empty-row">No reversed items on record</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${this.escapeHtml(title)} — ${this.escapeHtml(cn.number || "")}</title>
  ${this.invoiceStyles("credit")}
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="hdr">
    <div>
      <div class="hdr-brand">${this.escapeHtml(issuerName)}</div>
      ${issuerGstin ? `<div class="hdr-sub">GSTIN: ${this.escapeHtml(issuerGstin)}</div>` : ""}
    </div>
    <div class="hdr-right">
      <div class="hdr-doctype">${this.escapeHtml(title)}</div>
      <div class="hdr-invnum">${this.escapeHtml(cn.number || "")}</div>
      <div class="hdr-date">${cnDate}</div>
    </div>
  </div>
  <div class="accent-bar"></div>

  <!-- Meta bar -->
  <div class="meta-bar">
    ${this.metaCell("Credit Note No.", cn.number || "—")}
    ${this.metaCell("Date", cnDate)}
    ${this.metaCell("Against Invoice", cn.invoiceNumber || "—")}
    ${this.metaCell("Order Ref.", orderRef)}
    ${this.metaCell("Return / Cancel Ref.", reference)}
    ${this.metaCell("Source", cn.sourceType || cn.source_type || "—")}
    ${this.metaCell("Mode", cn.reversalMode || cn.reversal_mode || "—")}
    ${this.metaCell("Reason", (cn.reason || "—").replace(/_/g, " "))}
  </div>

  <!-- Parties -->
  <div class="parties">
    ${this.renderPartyBlock("Issued By", issuerName, issuerAddress, issuerGstin, null)}
    ${this.renderPartyBlock("Credit To", recipientName, recipientAddress, isCommission ? (parentInvoice.gstinSeller || seller.gstNumber || null) : (buyer.gstin || buyer.gstNumber || null), recipientEmail || null)}
  </div>

  <!-- Reversed items -->
  <div class="section-hdr">Reversed Items</div>
  <table class="tbl">
    <thead>
      <tr>
        <th class="l" style="width:4%">#</th>
        <th class="l">Description</th>
        <th class="c" style="width:9%">HSN/SAC</th>
        <th class="c" style="width:7%">Qty</th>
        <th style="width:9%">Weight</th>
        <th style="width:13%">Taxable Reversed</th>
        <th style="width:13%">GST Reversed</th>
        <th style="width:13%">Invoice Value Reversed</th>
      </tr>
    </thead>
    <tbody>${itemRowsHtml}</tbody>
  </table>

  <!-- Reversal amounts -->
  <div class="footer-grid">
    <div class="gst-col">
      <div class="col-title">Tax Reversed</div>
      ${this.renderCreditNoteTaxTable(
      Number(amounts.cgstAmount ?? 0),
      Number(amounts.sgstAmount ?? 0),
      Number(amounts.igstAmount ?? 0),
      0,
      isIgst,
      currency,
    )}
    </div>
    <div class="amt-col">
      <div class="col-title">Reversal Summary</div>
      ${this.buildCreditNoteAmountRows(amounts, currency).join("")}
    </div>
  </div>

  <div class="declaration">
    This credit note reverses only the referenced invoice value, tax and eligible customer credits shown above.
    ${issuerGstin ? `&nbsp;·&nbsp; GSTIN: ${this.escapeHtml(issuerGstin)}` : ""}
    &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
  </div>

</div>
</body>
</html>`;
  }

  /* ─────────────────── SHARED TEMPLATE HELPERS ─────────────────── */

  invoiceStyles(variant = "invoice") {
    const accentColor = variant === "credit" ? "#dc2626" : "#CE9F2D";
    return `<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #fff;
    color: #222;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    padding: 8px;
  }
  .page {
    background: #fff;
    margin: 0 auto;
    max-width: 980px;
    min-height: 1320px;
    padding: 14px 16px 8px;
  }
  /* Header */
  .hdr {
    color: #222;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
    padding: 4px 0 10px;
    border-bottom: 2px solid #333;
  }
  .brand-lockup { display: flex; align-items: center; gap: 10px; min-width: 260px; }
  .brand-mark {
    width: 42px;
    height: 42px;
    border: 2px solid #111;
    display: grid;
    place-items: center;
    font-size: 15px;
    font-weight: 900;
    letter-spacing: -0.5px;
  }
  .brand-logo-img { display: block; max-width: 120px; max-height: 48px; object-fit: contain; }
  .hdr-brand { font-size: 20px; font-weight: 900; letter-spacing: -0.3px; color: #111; }
  .hdr-sub { font-size: 9.5px; color: #555; margin-top: 2px; font-style: italic; }
  .hdr-center { flex: 1; text-align: left; padding-top: 3px; }
  .seller-name { font-size: 15px; font-weight: 700; color: #333; }
  .hdr-right { text-align: right; min-width: 220px; padding-top: 4px; }
  .hdr-doctype {
    font-size: 23px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: ${accentColor};
    text-transform: uppercase;
  }
  .hdr-invnum { font-size: 12px; opacity: 0.85; margin-top: 4px; }
  .hdr-date { font-size: 10px; color: #555; margin-top: 4px; }
  .tax-stamp {
    border: 1px dashed #333;
    display: inline-block;
    padding: 2px 5px;
    font-size: 11px;
    font-weight: 700;
    color: #111;
  }
  /* Accent bar */
  .accent-bar { background: ${accentColor}; height: 4px; }
  .invoice-info-grid {
    display: grid;
    grid-template-columns: 1.05fr 1.15fr 1.15fr 0.75fr;
    gap: 16px;
    border-bottom: 2px solid #333;
    padding: 9px 0 8px;
  }
  .order-meta div { margin-bottom: 4px; font-size: 12px; }
  .address-block { font-size: 11px; color: #333; }
  .addr-title { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
  .addr-name { font-size: 11.5px; font-weight: 700; font-style: italic; }
  .addr-line { margin-top: 1px; }
  .keep-note { color: #555; font-size: 10px; font-style: italic; line-height: 1.55; align-self: center; }
  /* Meta bar */
  .meta-bar {
    display: flex;
    border-bottom: 1px solid #e8eaf0;
    flex-wrap: wrap;
  }
  .meta-cell {
    flex: 1;
    min-width: 120px;
    padding: 11px 20px;
    border-right: 1px solid #e8eaf0;
  }
  .meta-cell:last-child { border-right: none; }
  .meta-label {
    color: #8b90a7;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    margin-bottom: 3px;
  }
  .meta-val { color: #1B1D60; font-size: 12.5px; font-weight: 700; }
  /* Parties */
  .parties { display: flex; border-bottom: 2px solid #e8eaf0; flex-wrap: wrap; }
  .party {
    flex: 1;
    min-width: 200px;
    padding: 20px 24px;
    border-right: 1px solid #e8eaf0;
  }
  .party:last-child { border-right: none; }
  .party-lbl {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: ${accentColor};
    margin-bottom: 8px;
    padding-bottom: 7px;
    border-bottom: 1.5px solid ${accentColor}44;
  }
  .party-name { font-size: 13.5px; font-weight: 700; color: #1B1D60; margin-bottom: 4px; }
  .party-line { color: #4b4f6b; font-size: 11.5px; margin-bottom: 2px; }
  .gstin-badge {
    display: inline-block;
    margin-top: 9px;
    background: #eef0f7;
    border: 1px solid #c7cbe0;
    border-radius: 4px;
    padding: 3px 9px;
    font-size: 10.5px;
    font-weight: 700;
    color: #1B1D60;
    letter-spacing: 0.5px;
  }
  /* Section header */
  .section-hdr {
    padding: 13px 24px 10px;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #8b90a7;
    border-bottom: 1px solid #e8eaf0;
  }
  /* Items table */
  table.tbl { width: 100%; border-collapse: collapse; }
  .tbl th {
    background: #fff;
    color: #222;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 6px;
    text-align: right;
    white-space: nowrap;
    border-bottom: 2px solid #333;
  }
  .tbl td {
    padding: 8px 6px;
    border-bottom: 1px solid #777;
    vertical-align: top;
    text-align: right;
    color: #222;
    font-size: 11px;
  }
  .tbl th.l, .tbl td.l { text-align: left; }
  .tbl th.c, .tbl td.c { text-align: center; }
  .tbl tbody tr:last-child td { border-bottom: none; }
  .item-title { font-weight: 700; color: #222; }
  .item-sub { font-size: 9.5px; color: #444; margin-top: 2px; font-style: italic; }
  .item-product { color: #333; font-size: 10px; }
  .item-total { font-weight: 700; color: #222; }
  td.empty-row { text-align: center; color: #777; padding: 24px; font-style: italic; }
  .table-total-line {
    border-top: 1px solid #333;
    border-bottom: 1px solid #333;
    display: grid;
    grid-template-columns: 1fr 70px 140px 140px 150px;
    gap: 10px;
    align-items: center;
    min-height: 46px;
    padding: 8px 6px;
    text-align: right;
    font-size: 15px;
    font-weight: 700;
  }
  .table-total-line span:first-child { font-size: 18px; font-weight: 400; }
  .grand-total {
    display: flex;
    justify-content: flex-end;
    align-items: baseline;
    gap: 44px;
    border-bottom: 2px solid #333;
    padding: 18px 8px 14px;
    font-size: 24px;
  }
  .grand-total strong { font-size: 22px; }
  .detail-summary {
    display: grid;
    grid-template-columns: 1fr 330px;
    gap: 28px;
    border-bottom: 1px solid #333;
    padding: 10px 8px 12px;
  }
  .detail-title {
    color: #333;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.4px;
    margin-bottom: 6px;
    text-transform: uppercase;
  }
  /* Footer grid */
  .footer-grid {
    display: flex;
    border-top: 2px solid #e8eaf0;
    flex-wrap: wrap;
  }
  .gst-col {
    flex: 1;
    min-width: 260px;
    padding: 20px 24px;
    border-right: 1px solid #e8eaf0;
  }
  .amt-col { width: 290px; padding: 20px 28px 20px 20px; }
  .col-title {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #8b90a7;
    margin-bottom: 12px;
  }
  /* Tax table */
  table.tax-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
  .tax-tbl th {
    background: #fff;
    color: #333;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 4px 6px;
    text-align: right;
    border-bottom: 1px solid #777;
  }
  .tax-tbl th.l, .tax-tbl td.l { text-align: left; }
  .tax-tbl td {
    padding: 4px 6px;
    border-bottom: 1px solid #ddd;
    text-align: right;
    color: #222;
  }
  .tax-tbl tbody tr:last-child td { border-bottom: none; }
  .tax-total td { font-weight: 700; color: #1B1D60; border-top: 1px solid #c7cbe0; }
  .mktplace-gstin { margin-top: 14px; font-size: 10.5px; color: #8b90a7; }
  /* Amount rows */
  .amt-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 5px 0;
    border-bottom: 1px solid #f0f2f8;
    gap: 8px;
  }
  .amt-row:last-child { border-bottom: none; }
  .amt-lbl { color: #4b4f6b; font-size: 11.5px; flex: 1; }
  .amt-val { font-size: 12px; font-weight: 700; color: #1B1D60; white-space: nowrap; }
  .amt-row.savings .amt-lbl, .amt-row.savings .amt-val { color: #16a34a; }
  .amt-row.grand {
    border-top: 2px solid #1B1D60;
    border-bottom: none;
    padding-top: 10px;
    margin-top: 6px;
  }
  .amt-row.grand .amt-lbl { font-size: 13px; font-weight: 700; color: #1B1D60; }
  .amt-row.grand .amt-val { font-size: 15px; font-weight: 700; color: #1B1D60; }
  .amt-row.note {
    border-bottom: none;
    padding-top: 2px;
  }
  .amt-row.note .amt-lbl {
    color: #6b7280;
    font-size: 9.5px;
    line-height: 1.35;
  }
  /* Declaration */
  .declaration {
    color: #555;
    font-size: 10px;
    padding: 4px 24px 0;
    text-align: center;
    line-height: 1.5;
    font-style: italic;
  }
  .invoice-bottom {
    min-height: 680px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 24px;
    padding: 0 20px 30px;
  }
  .policy { max-width: 720px; font-size: 11px; color: #222; line-height: 1.45; }
  .thanks { min-width: 150px; text-align: center; color: #333; }
  .thanks-mark {
    width: 34px;
    height: 34px;
    border: 2px solid #333;
    margin: 0 auto 3px;
    display: grid;
    place-items: center;
    font-weight: 900;
  }
  .thanks strong { display: block; font-size: 16px; }
  .thanks span { display: block; font-size: 10px; }
  .registry-line {
    border-top: 1px dotted #333;
    color: #333;
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    padding: 5px 20px 0;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .page { max-width: none; padding: 8mm 8mm 4mm; }
  }
</style>`;
  }

  metaCell(label, value) {
    return `<div class="meta-cell">
      <div class="meta-label">${this.escapeHtml(label)}</div>
      <div class="meta-val">${this.escapeHtml(String(value || "—"))}</div>
    </div>`;
  }

  renderPartyBlock(label, name, addrLines = [], gstin = null, email = null) {
    return `<div class="party">
      <div class="party-lbl">${this.escapeHtml(label)}</div>
      <div class="party-name">${this.escapeHtml(name || "—")}</div>
      ${addrLines.filter(Boolean).map((line) => `<div class="party-line">${this.escapeHtml(line)}</div>`).join("")}
      ${email ? `<div class="party-line" style="margin-top:3px">${this.escapeHtml(email)}</div>` : ""}
      ${gstin ? `<div class="gstin-badge">GSTIN: ${this.escapeHtml(gstin)}</div>` : ""}
    </div>`;
  }

  renderCompactAddress(name, addrLines = [], email = null) {
    return `
      <div class="addr-name">${this.escapeHtml(name || "—")}</div>
      ${addrLines.filter(Boolean).map((line) => `<div class="addr-line">${this.escapeHtml(line)}</div>`).join("")}
      ${email ? `<div class="addr-line">${this.escapeHtml(email)}</div>` : ""}
      ${!addrLines.filter(Boolean).length && !email ? `<div class="addr-line">—</div>` : ""}
    `;
  }

  renderCompactAddressFromObject(addr = {}, fallbackName = "") {
    if (!addr || typeof addr !== "object") return this.renderCompactAddress(fallbackName, []);
    const name = addr.fullName || addr.full_name || addr.name || fallbackName || "";
    const lines = this.formatAddressLines(addr);
    const phone = addr.phone || addr.phoneNumber || addr.mobile || "";
    return `
      <div class="addr-name">${this.escapeHtml(name || "—")}</div>
      ${lines.map((line) => `<div class="addr-line">${this.escapeHtml(line)}</div>`).join("")}
      ${phone ? `<div class="addr-line">Phone: ${this.escapeHtml(phone)}</div>` : ""}
      ${!lines.length && !phone ? `<div class="addr-line">—</div>` : ""}
    `;
  }

  renderShipToBlock(addr = {}) {
    if (!addr || typeof addr !== "object") return "<div class=\"party\"><div class=\"party-lbl\">Ship To</div><div class=\"party-line\" style=\"color:#b0b4c9;font-style:italic\">Not provided</div></div>";
    const name = addr.fullName || addr.full_name || addr.name || "";
    const line1 = addr.line1 || addr.address1 || addr.street || "";
    const line2 = addr.line2 || addr.address2 || "";
    const cityLine = [addr.city, addr.state, addr.postalCode || addr.postal_code || addr.pincode].filter(Boolean).join(", ");
    const country = addr.country || "";
    return `<div class="party">
      <div class="party-lbl">Ship To</div>
      ${name ? `<div class="party-name">${this.escapeHtml(name)}</div>` : ""}
      ${line1 ? `<div class="party-line">${this.escapeHtml(line1)}</div>` : ""}
      ${line2 ? `<div class="party-line">${this.escapeHtml(line2)}</div>` : ""}
      ${cityLine ? `<div class="party-line">${this.escapeHtml(cityLine)}</div>` : ""}
      ${country ? `<div class="party-line">${this.escapeHtml(country)}</div>` : ""}
      ${!name && !line1 && !cityLine ? `<div class="party-line" style="color:#b0b4c9;font-style:italic">Not provided</div>` : ""}
    </div>`;
  }

  renderInvoiceItemRow(item, index, currency, isIgst) {
    const title = item.productTitle || item.description || item.product_title || "—";
    const sku = item.productSku || item.variantSku || item.product_sku || item.variant_sku || "";
    const hsn = item.hsnCode || item.hsn_code || "—";
    const qty = item.quantity ?? "—";
    const unitPrice = this.money(item.unitPrice ?? item.unit_price, currency);
    const cgst = this.money(item.cgstAmount ?? item.cgst_amount, currency);
    const sgst = this.money(item.sgstAmount ?? item.sgst_amount, currency);
    const igst = this.money(item.igstAmount ?? item.igst_amount, currency);
    const total = this.money(item.totalAmount ?? item.lineTotal ?? item.line_total, currency);
    const taxTotal = this.money(
      Number(item.taxAmount ?? item.tax_amount ?? 0) ||
      Number(item.cgstAmount ?? item.cgst_amount ?? 0) +
      Number(item.sgstAmount ?? item.sgst_amount ?? 0) +
      Number(item.igstAmount ?? item.igst_amount ?? 0),
      currency,
    );
    const discount = Number(item.discountAmount ?? item.discount_amount ?? 0);

    return `<tr>
      <td class="l item-product">
        <div>${this.escapeHtml(item.category || item.productCategory || "Product")}</div>
        <div>Item: ${this.escapeHtml(String(index).padStart(2, "0"))}</div>
      </td>
      <td class="l">
        <div class="item-title">${this.escapeHtml(title)}</div>
        ${sku ? `<div class="item-sub">SKU: ${this.escapeHtml(sku)}</div>` : ""}
        <div class="item-sub">HSN / SAC: ${this.escapeHtml(hsn)}</div>
        <div class="item-sub">${isIgst ? `IGST: ${this.escapeHtml(igst)}` : `CGST: ${this.escapeHtml(cgst)} · SGST: ${this.escapeHtml(sgst)}`}</div>
        ${discount > 0 ? `<div class="item-sub" style="color:#16a34a">Disc: ${this.escapeHtml(this.money(discount, currency))}</div>` : ""}
      </td>
      <td class="c">${this.escapeHtml(String(qty))}</td>
      <td>${this.escapeHtml(unitPrice)}</td>
      <td>${this.escapeHtml(taxTotal)}</td>
      <td class="item-total">${this.escapeHtml(total)}</td>
    </tr>`;
  }

  renderCreditNoteItemRow(item, index, currency) {
    const title = item.productTitle || item.product_title || item.description || "—";
    const sku = item.productSku || item.product_sku || item.variantSku || item.variant_sku || item.sku || "";
    const hsn = item.hsnCode || item.hsn_code || item.sacCode || item.sac_code || "-";
    const qty = this.formatReversalQuantity(item.quantity ?? item.reversedQuantity ?? item.reversed_quantity ?? 0);
    const weight = Number(item.reversalWeight ?? item.reversal_weight ?? 0);
    const taxable = this.formatReversalMoney(item.taxableAmount ?? item.taxable_amount, currency);
    const tax = this.formatReversalMoney(item.taxAmount ?? item.tax_amount, currency);
    const total = this.formatReversalMoney(item.totalAmount ?? item.total_amount, currency);
    return `<tr>
      <td class="l c" style="color:#8b90a7">${index}</td>
      <td class="l">
        <div class="item-title">${this.escapeHtml(title)}</div>
        ${sku ? `<div class="item-sub">SKU: ${this.escapeHtml(sku)}</div>` : ""}
      </td>
      <td class="c">${this.escapeHtml(hsn)}</td>
      <td class="c">${this.escapeHtml(String(qty))}</td>
      <td>${this.escapeHtml(Number.isFinite(weight) ? `${(weight * 100).toFixed(2)}%` : "—")}</td>
      <td>${this.escapeHtml(taxable)}</td>
      <td>${this.escapeHtml(tax)}</td>
      <td class="item-total">${this.escapeHtml(total)}</td>
    </tr>`;
  }

  renderTaxTable(cgst, sgst, igst, tcs, isIgst, currency) {
    const rows = [];
    if (!isIgst && cgst > 0) rows.push({ component: "CGST", amount: cgst });
    if (!isIgst && sgst > 0) rows.push({ component: "SGST", amount: sgst });
    if (igst > 0) rows.push({ component: "IGST", amount: igst });
    if (tcs > 0) rows.push({ component: "GST TCS", amount: tcs });

    if (!rows.length) {
      return `<p style="color:#b0b4c9;font-style:italic;font-size:11px;padding:8px 0">No tax applicable</p>`;
    }

    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    return `<table class="tax-tbl">
      <thead>
        <tr>
          <th class="l">Component</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td class="l">${this.escapeHtml(r.component)}</td>
          <td>${this.escapeHtml(this.money(r.amount, currency))}</td>
        </tr>`).join("")}
        <tr class="tax-total">
          <td class="l">Total Tax</td>
          <td>${this.escapeHtml(this.money(total, currency))}</td>
        </tr>
      </tbody>
    </table>`;
  }

  renderCreditNoteTaxTable(cgst, sgst, igst, tcs, isIgst, currency) {
    const rows = [];
    if (!isIgst && cgst > 0) rows.push({ component: "CGST reversed", amount: cgst });
    if (!isIgst && sgst > 0) rows.push({ component: "SGST reversed", amount: sgst });
    if (igst > 0) rows.push({ component: "IGST reversed", amount: igst });
    if (tcs > 0) rows.push({ component: "GST TCS reversed", amount: tcs });

    if (!rows.length) {
      return `<p style="color:#b0b4c9;font-style:italic;font-size:11px;padding:8px 0">No tax reversed</p>`;
    }

    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    return `<table class="tax-tbl">
      <thead>
        <tr>
          <th class="l">Component</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td class="l">${this.escapeHtml(r.component)}</td>
          <td>${this.escapeHtml(this.formatReversalMoney(r.amount, currency))}</td>
        </tr>`).join("")}
        <tr class="tax-total">
          <td class="l">Total Tax Reversed</td>
          <td>${this.escapeHtml(this.formatReversalMoney(total, currency))}</td>
        </tr>
      </tbody>
    </table>`;
  }

  buildInvoiceAmountRows(amounts = {}, currency) {
    const a = (v) => Number(v || 0);
    const rows = [];
    const addRow = (label, value, cls = "") => {
      rows.push(`<div class="amt-row ${cls}">
        <span class="amt-lbl">${this.escapeHtml(label)}</span>
        <span class="amt-val">${this.escapeHtml(this.money(value, currency))}</span>
      </div>`);
    };

    if (a(amounts.grossSalesAmount) > 0) addRow("Gross Sales", amounts.grossSalesAmount);
    const customerPromotion = a(amounts.customerDiscountAmount ?? amounts.discountAmount);
    if (customerPromotion > 0) {
      rows.push(`<div class="amt-row savings">
        <span class="amt-lbl">Customer Promotion</span>
        <span class="amt-val">−${this.escapeHtml(this.money(customerPromotion, currency))}</span>
      </div>`);
    }
    if (a(amounts.marketplaceFundedDiscountAmount) > 0) {
      addRow("Paid by Marketplace Promotion", amounts.marketplaceFundedDiscountAmount);
    }
    if (a(amounts.paymentPartnerFundedDiscountAmount) > 0) {
      addRow("Paid by Payment Partner", amounts.paymentPartnerFundedDiscountAmount);
    }
    if (a(amounts.customerPaidTowardInvoiceAmount) > 0) {
      addRow("Paid by Customer Toward Invoice", amounts.customerPaidTowardInvoiceAmount);
    }
    if (a(amounts.walletDiscountAmount) > 0) {
      rows.push(`<div class="amt-row savings">
        <span class="amt-lbl">Wallet Discount</span>
        <span class="amt-val">−${this.escapeHtml(this.money(amounts.walletDiscountAmount, currency))}</span>
      </div>`);
    }
    const shippingCollectedForSeller = a(amounts.shippingCollectedForSellerAmount);
    if (shippingCollectedForSeller > 0) {
      addRow("Delivery / shipping collected for seller", shippingCollectedForSeller);
    }
    const delivery = shippingCollectedForSeller > 0
      ? 0
      : a(amounts.deliveryChargeAmount || amounts.shippingChargeAmount);
    if (delivery > 0) addRow("Delivery Charge", delivery);
    if (a(amounts.codChargeAmount) > 0) addRow("COD Charge", amounts.codChargeAmount);
    if (a(amounts.customerPlatformFeeAmount) > 0) addRow("Platform Fee", amounts.customerPlatformFeeAmount);
    if (a(amounts.customerPlatformFeeTaxAmount) > 0) addRow("Platform Fee GST", amounts.customerPlatformFeeTaxAmount);

    const taxPayable = a(amounts.taxPayableAmount ?? (a(amounts.cgstAmount) + a(amounts.sgstAmount) + a(amounts.igstAmount) + a(amounts.tcsAmount)));
    if (taxPayable > 0) addRow("GST", taxPayable);

    const customerPaid = a(amounts.customerPaidTowardInvoiceAmount);
    const total = customerPaid > 0
      ? customerPaid + shippingCollectedForSeller
      : a(amounts.finalPayableAmount || amounts.totalAmount || amounts.customerFinalAmount);
    rows.push(`<div class="amt-row grand">
      <span class="amt-lbl">${customerPaid > 0 ? "Amount Paid by Customer" : "Grand Total"}</span>
      <span class="amt-val">${this.escapeHtml(this.money(total, currency))}</span>
    </div>`);
    if (shippingCollectedForSeller > 0) {
      rows.push(`<div class="amt-row note">
        <span class="amt-lbl">Product invoice table excludes shipping; shipping is shown in this summary and settled to the seller.</span>
        <span class="amt-val"></span>
      </div>`);
    }

    return rows;
  }

  buildCreditNoteAmountRows(amounts = {}, currency) {
    const rows = [];
    const addRow = (label, value, { reversal = true, force = false, note = "" } = {}) => {
      if (!force && Number(value ?? 0) === 0) return;
      rows.push(`<div class="amt-row">
        <span class="amt-lbl">${this.escapeHtml(label)}</span>
        <span class="amt-val">${this.escapeHtml(reversal ? this.formatReversalMoney(value, currency) : this.money(value, currency))}</span>
      </div>`);
      if (note) {
        rows.push(`<div class="amt-row note">
          <span class="amt-lbl">${this.escapeHtml(note)}</span>
          <span class="amt-val"></span>
        </div>`);
      }
    };
    addRow("Product taxable value reversed", amounts.taxableAmount);
    addRow("CGST reversed", amounts.cgstAmount);
    addRow("SGST reversed", amounts.sgstAmount);
    addRow("IGST reversed", amounts.igstAmount);
    addRow("Total GST reversed", amounts.taxAmount);
    addRow("Product invoice value reversed", amounts.totalAmount, { force: true });
    addRow("Customer promotion reversed", amounts.customerPromotionReversalAmount, { force: true });
    addRow("Shipping reversed", amounts.shippingReversalAmount, { force: true });
    addRow("Refundable platform fee reversed", amounts.customerPlatformFeeReversalAmount, {
      force: true,
      note: "Shown only when this credit note belongs to the platform-fee invoice or policy allows refund here.",
    });
    rows.push(`<div class="amt-row grand">
      <span class="amt-lbl">Customer refund / total credit</span>
      <span class="amt-val">${this.escapeHtml(this.formatReversalMoney(amounts.customerRefundAmount, currency))}</span>
    </div>`);
    addRow("Remaining invoice balance", amounts.remainingInvoiceBalance, { reversal: false, force: true });
    addRow("Remaining customer-paid balance", amounts.remainingCustomerBalance, { reversal: false, force: true });
    return rows;
  }

  formatAddressLines(addr = {}) {
    if (!addr || typeof addr !== "object") return [];
    return [
      addr.line1 || addr.address1 || addr.street,
      addr.line2 || addr.address2,
      [addr.city, addr.state, addr.postalCode || addr.postal_code].filter(Boolean).join(", "),
      addr.country,
    ].filter(Boolean);
  }

  getBuyerName(buyer = {}) {
    const profile = buyer.profile || {};
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
    return name || profile.displayName || buyer.email || "Customer";
  }

  formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  /* ─────────────────── GENERIC FALLBACK HTML ─────────────────── */

  renderGenericHtml(document = {}) {
    const sections = (document.sections || []).map((section) => `
      <section>
        <h2>${this.escapeHtml(section.title)}</h2>
        ${this.renderHtmlRows(section.rows || [])}
      </section>
    `).join("\n");

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${this.escapeHtml(document.title || "Document")}</title>
  <style>
    body { color: #111827; font-family: Arial, sans-serif; margin: 32px; }
    header { border-bottom: 2px solid #111827; margin-bottom: 24px; padding-bottom: 16px; }
    h1 { font-size: 24px; margin: 0 0 6px; }
    h2 { border-bottom: 1px solid #d1d5db; font-size: 16px; margin-top: 24px; padding-bottom: 6px; }
    table { border-collapse: collapse; margin-top: 10px; width: 100%; }
    th, td { border-bottom: 1px solid #e5e7eb; font-size: 12px; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 700; }
    .muted { color: #6b7280; font-size: 12px; }
    .kv td:first-child { color: #374151; font-weight: 700; width: 32%; }
    @media print { body { margin: 18mm; } }
  </style>
</head>
<body>
  <header>
    <h1>${this.escapeHtml(document.title || "Document")}</h1>
    <div class="muted">${this.escapeHtml(document.subtitle || "")}</div>
    <div class="muted">Generated at ${this.escapeHtml(document.generatedAt || new Date().toISOString())}</div>
  </header>
  ${sections}
</body>
</html>`;
  }

  renderHtmlRows(rows = []) {
    if (!rows.length) return "<p class=\"muted\">No data.</p>";
    const tableRows = rows.map((row) => {
      if (Array.isArray(row)) {
        return `<tr>${row.map((cell) => `<td>${this.escapeHtml(cell)}</td>`).join("")}</tr>`;
      }
      return `<tr><td>${this.escapeHtml(row.label)}</td><td>${this.escapeHtml(row.value)}</td></tr>`;
    }).join("\n");
    return `<table class="kv"><tbody>${tableRows}</tbody></table>`;
  }

  /* ─────────────────── PDF (TEXT-BASED) ─────────────────── */

  renderPdf(document = {}) {
    if (document.layout === "invoice") return this.renderInvoicePdf(document);
    if (document.layout === "credit_note") return this.renderCreditNotePdf(document);
    if (document.layout === "settlement") return this.renderSettlementPdf(document);
    const lines = this.flattenDocument(document).flatMap((line) => this.wrapLine(line, 92));
    const pages = this.chunk(lines.length ? lines : ["No data."], 48);
    const objects = [];
    const pageObjectIds = [];
    const fontObjectId = 3 + pages.length * 2;

    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    for (let index = 0; index < pages.length; index += 1) {
      const pageObjectId = 3 + index * 2;
      const contentObjectId = pageObjectId + 1;
      pageObjectIds.push(pageObjectId);
      const stream = this.buildPdfPageStream(pages[index], index + 1, pages.length);
      objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObjectId} 0 R /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> >>`;
      objects[contentObjectId] = `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`;
    }
    objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;
    objects[fontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

    return this.buildPdf(objects);
  }

  renderSettlementPdf(document = {}) {
    const raw = document.raw || {};
    const settlement = raw.settlement || {};
    const payout = raw.payout || {};
    const sections = Array.isArray(document.sections) ? document.sections : [];
    const currency = settlement.currency || payout.currency || DEFAULT_CURRENCY;
    const platformName = process.env.INVOICE_BRAND_NAME || "Sam Global";
    const platformAddress = process.env.INVOICE_REGISTERED_OFFICE || "";
    const platformGstin = process.env.GSTIN_MARKETPLACE || process.env.PLATFORM_GSTIN || "";
    const settlementId = settlement.id || document.subtitle || "-";
    const status = settlement.status || payout.status || "-";
    const generatedAt = this.formatDate(document.generatedAt || new Date());

    const rowsFromSection = (title) =>
      sections.find((section) => String(section.title || "").toLowerCase().includes(title))?.rows || [];
    const valueOf = (rows, labelPart) => {
      const row = rows.find((entry) =>
        !Array.isArray(entry) && String(entry.label || "").toLowerCase().includes(labelPart),
      );
      return row?.value || "-";
    };
    const sellerCredits = rowsFromSection("seller credits");
    const platformCharges = rowsFromSection("platform charges");
    const withholding = rowsFromSection("tax withholding");
    const payoutRows = rowsFromSection("final seller payout");
    const itemRows = rowsFromSection("item-wise");
    const finalPayout = valueOf(payoutRows, "final seller payout") ||
      this.money(settlement.net_amount, currency);

    const streams = [];
    let commands = [];
    let pageNo = 0;
    let y = 0;

    const text = (value, x, yy, size = 9, bold = false, align = "left", color = "0.10 0.11 0.14") => {
      const safe = this.escapePdfText(value);
      const approximateWidth = safe.length * size * 0.5;
      const tx = align === "right" ? x - approximateWidth : x;
      commands.push(
        `${color} rg`,
        "BT",
        `/${bold ? "F2" : "F1"} ${size} Tf`,
        `${tx.toFixed(1)} ${yy.toFixed(1)} Td`,
        `(${safe}) Tj`,
        "ET",
      );
    };
    const line = (x1, yy1, x2, yy2, width = 0.6, gray = 0.78) => {
      commands.push(`${gray} G`, `${width} w`, `${x1} ${yy1} m ${x2} ${yy2} l S`);
    };
    const fill = (x, yy, width, height, r, g, b) => {
      commands.push(`${r} ${g} ${b} rg`, `${x} ${yy} ${width} ${height} re f`);
    };
    const compact = (value, limit = 56) => {
      const normalized = String(value ?? "-").replace(/\s+/g, " ").trim();
      return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
    };
    const money = (value) => this.money(value, currency);

    const startPage = () => {
      if (commands.length) streams.push(commands.join("\n"));
      pageNo += 1;
      commands = [];
      fill(0, 0, 595, 842, 1, 1, 1);
      fill(36, 765, 523, 4, 0.81, 0.62, 0.18);
      text(platformName, 40, 808, 16, true);
      text("SELLER SETTLEMENT STATEMENT", 555, 806, 14, true, "right");
      text("Payout advice / accounting statement", 555, 790, 8, false, "right", "0.35 0.37 0.45");
      text("PLATFORM DETAILS", 40, 748, 7.5, true, "left", "0.35 0.37 0.45");
      text(compact(platformAddress || "Registered office not configured", 72), 40, 734, 8);
      text(`Platform GSTIN: ${platformGstin || "Not configured"}`, 40, 721, 8, true);
      text(`Generated: ${generatedAt}`, 555, 734, 8, false, "right");
      text(`Status: ${String(status).replace(/_/g, " ")}`, 555, 721, 8, true, "right");
      line(36, 702, 559, 702, 0.8, 0.25);
      y = 678;
    };
    const ensure = (height = 60) => {
      if (y - height < 54) startPage();
    };
    const sectionTitle = (title) => {
      ensure(48);
      fill(36, y - 18, 523, 24, 0.95, 0.93, 0.87);
      text(title, 44, y - 3, 10, true);
      y -= 34;
    };
    const keyValueRows = (rows = [], options = {}) => {
      rows.forEach((row) => {
        if (Array.isArray(row)) return;
        ensure(24);
        const label = compact(row.label, options.labelLimit || 46);
        const value = compact(row.value, options.valueLimit || 54);
        text(label, 44, y, 8.2, false, "left", "0.35 0.37 0.45");
        text(value, 553, y, 8.4, Boolean(options.boldValues), "right");
        line(42, y - 8, 553, y - 8, 0.25, 0.88);
        y -= 20;
      });
    };
    const summaryCard = (x, title, value, subtitle, tone = "blue") => {
      const isGreen = tone === "green";
      fill(x, y - 60, 166, 72, isGreen ? 0.93 : 0.95, isGreen ? 0.98 : 0.97, isGreen ? 0.94 : 1);
      text(title, x + 10, y - 10, 8, true, "left", isGreen ? "0.05 0.45 0.18" : "0.10 0.11 0.45");
      text(value, x + 156, y - 31, 13, true, "right", isGreen ? "0.05 0.45 0.18" : "0.10 0.11 0.45");
      text(compact(subtitle, 31), x + 10, y - 49, 7, false, "left", "0.35 0.37 0.45");
    };

    startPage();

    summaryCard(36, "Final seller payout", finalPayout, "Amount payable / paid to seller", "green");
    summaryCard(214, "Seller credits", valueOf(sellerCredits, "total seller credits"), "Product, shipping, discounts");
    summaryCard(392, "Deductions", valueOf(platformCharges, "total platform deductions"), "Commission, GST, shipping");
    y -= 92;

    sectionTitle("Settlement details");
    keyValueRows([
      { label: "Settlement ID", value: settlementId },
      { label: "Seller ID", value: settlement.seller_id || "-" },
      { label: "Payout ID", value: settlement.payout_id || "-" },
      { label: "Payment Reference", value: payout.payment_reference || "-" },
      { label: "Payment Method", value: payout.payment_method || "-" },
      { label: "Period", value: `${settlement.period_start || "-"} to ${settlement.period_end || "-"}` },
    ]);

    sectionTitle("Seller gets");
    keyValueRows(sellerCredits, { boldValues: true });

    sectionTitle("Platform charges");
    keyValueRows(platformCharges, { boldValues: true });

    sectionTitle("Tax withholding");
    keyValueRows(withholding, { boldValues: true });

    rowsFromSection("return").length && sectionTitle("Return / refund adjustments");
    if (rowsFromSection("return").length) keyValueRows(rowsFromSection("return"), { boldValues: true });

    sectionTitle("Final calculation");
    keyValueRows(payoutRows, { boldValues: true });

    const tableRows = Array.isArray(itemRows) && itemRows.length ? itemRows : [];
    if (tableRows.length > 1) {
      sectionTitle("Item-wise settlement lines");
      const headers = tableRows[0].slice(0, 7);
      const dataRows = tableRows.slice(1);
      const colX = [42, 116, 184, 252, 330, 408, 484];
      ensure(36);
      fill(38, y - 15, 516, 22, 0.95, 0.93, 0.87);
      headers.forEach((header, index) => text(compact(header, 12), colX[index], y - 2, 7, true));
      y -= 28;
      dataRows.forEach((row) => {
        ensure(34);
        row.slice(0, 7).forEach((cell, index) => {
          text(compact(cell, index === 0 ? 13 : 11), colX[index], y, 7);
        });
        line(38, y - 8, 554, y - 8, 0.25, 0.86);
        y -= 22;
      });
    }

    const notes = rowsFromSection("document notes");
    if (notes.length) {
      sectionTitle("Notes");
      keyValueRows(notes, { labelLimit: 34, valueLimit: 76 });
    }

    streams.push(commands.join("\n"));
    const objects = [];
    const pageObjectIds = [];
    const fontRegularId = 3 + streams.length * 2;
    const fontBoldId = fontRegularId + 1;
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    streams.forEach((stream, index) => {
      const footer = [
        stream,
        "0.35 0.37 0.45 rg",
        "BT",
        "/F1 8 Tf",
        `505 38 Td`,
        `(Page ${index + 1} of ${streams.length}) Tj`,
        "ET",
      ].join("\n");
      const pageId = 3 + index * 2;
      const contentId = pageId + 1;
      pageObjectIds.push(pageId);
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`;
      objects[contentId] = `<< /Length ${Buffer.byteLength(footer, "binary")} >>\nstream\n${footer}\nendstream`;
    });
    objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;
    objects[fontRegularId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    objects[fontBoldId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
    return this.buildPdf(objects);
  }

  renderCreditNotePdf(document = {}) {
    const data = document.data || {};
    const { creditNote, parentInvoice } = this.getCreditNoteContext(data);
    const items = this.normalizeCreditNoteItems(data);
    const amounts = this.getCreditNoteAmounts(data, items);
    const isCommission = creditNote.scope === "platform_commission_invoice";
    const isCustomerFee = creditNote.scope === "platform_customer_fee_invoice";
    return this.renderInvoicePdf({
      layout: "invoice",
      data: {
        invoice: {
          number: creditNote.number,
          type: isCommission ? "platform_commission" : isCustomerFee ? "platform_customer_fee" : "seller_customer",
          issuedAt: creditNote.issuedAt,
          orderId: creditNote.orderId,
          orderNumber: creditNote.orderNumber,
          currency: creditNote.currency,
          placeOfSupply: parentInvoice.placeOfSupply,
          taxMode: parentInvoice.taxMode,
          gstinMarketplace: parentInvoice.gstinMarketplace,
          gstinSeller: parentInvoice.gstinSeller,
          displayTitle: isCommission ? "COMMISSION CREDIT NOTE" : "CREDIT NOTE / REVERSE INVOICE",
          parentInvoiceNumber: creditNote.invoiceNumber,
          referenceNumber: creditNote.referenceNumber || creditNote.reference_number || creditNote.rmaNumber || creditNote.cancellationNumber || null,
          reason: creditNote.reason || null,
          sourceType: creditNote.sourceType || creditNote.source_type || null,
          reversalMode: creditNote.reversalMode || creditNote.reversal_mode || null,
          isCreditNote: true,
        },
        seller: data.seller || {},
        buyer: data.buyer || {},
        shippingAddress: data.shippingAddress || {},
        marketplace: data.marketplace || {},
        amounts,
        items,
      },
    });
  }

  renderInvoicePdf(document = {}) {
    const data = document.data || {};
    const inv = data.invoice || {};
    const seller = data.seller || {};
    const buyer = data.buyer || {};
    const shipping = data.shippingAddress || buyer.shippingAddress || {};
    const amounts = data.amounts || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const currency = inv.currency || DEFAULT_CURRENCY;
    const isCommission = inv.type === "platform_commission";
    const isOrderReceipt = inv.type === "order_customer";
    const isCustomerFee = inv.type === "platform_customer_fee";
    const isSellerCustomer = inv.type === "seller_customer";
    const isCreditNote = inv.isCreditNote === true || document.layout === "credit_note";
    const sellerName = seller.legalBusinessName || seller.displayName || seller.businessName || "Seller";
    const buyerName = this.getBuyerName(buyer);
    const sellerAddress = this.formatAddressLines(seller.billingAddress || seller.businessAddress);
    const shippingAddress = this.formatAddressLines(shipping);
    const issuerName = isCommission || isOrderReceipt || isCustomerFee
      ? (process.env.INVOICE_BRAND_NAME || "Sam Global")
      : sellerName;
    const platformName = process.env.INVOICE_BRAND_NAME || "SAM GLOBAL";
    const platformAddress = process.env.INVOICE_REGISTERED_OFFICE || data.marketplace?.registeredOffice || data.marketplace?.address || "";
    const platformGstin = inv.gstinMarketplace || data.marketplace?.gstin || process.env.GSTIN_MARKETPLACE || process.env.PLATFORM_GSTIN || "";
    const issuerGstin = isCommission || isCustomerFee || isOrderReceipt
      ? platformGstin
      : inv.gstinSeller;
    const recipientName = isCommission ? sellerName : buyerName;
    const recipientAddress = isCommission
      ? sellerAddress
      : this.formatAddressLines(buyer.billingAddress || shipping);
    const invoiceDate = this.formatDate(inv.issuedAt);
    const orderReference = inv.orderNumber || (inv.orderId ? String(inv.orderId).slice(-8).toUpperCase() : "-");
    const rawCustomerPlatformFeeAmount = Number(
      amounts.customerPlatformFeeAmount ??
      (isCustomerFee ? amounts.taxableAmount : 0) ??
      0,
    );
    const rawCustomerPlatformFeeTaxAmount = Number(
      amounts.customerPlatformFeeTaxAmount ??
      (isCustomerFee ? amounts.taxAmount || amounts.taxPayableAmount : 0) ??
      0,
    );
    const platformFeeGstRate = Number(
      amounts.platformFeeTaxRate ??
      amounts.customerPlatformFeeTaxRate ??
      DEFAULT_PLATFORM_FEE_GST_RATE,
    );
    const platformFeeIsInclusive = (isCustomerFee || isOrderReceipt) &&
      rawCustomerPlatformFeeAmount > 0 &&
      rawCustomerPlatformFeeTaxAmount <= 0 &&
      platformFeeGstRate > 0;
    const customerPlatformFeeTaxAmount = platformFeeIsInclusive
      ? Number((rawCustomerPlatformFeeAmount - (rawCustomerPlatformFeeAmount / (1 + (platformFeeGstRate / 100)))).toFixed(2))
      : rawCustomerPlatformFeeTaxAmount;
    const customerPlatformFeeAmount = platformFeeIsInclusive
      ? Number((rawCustomerPlatformFeeAmount - customerPlatformFeeTaxAmount).toFixed(2))
      : rawCustomerPlatformFeeAmount;
    const customerPlatformFeeInvoiceValue = platformFeeIsInclusive
      ? rawCustomerPlatformFeeAmount
      : customerPlatformFeeAmount + customerPlatformFeeTaxAmount;
    const visibleInvoiceItems = isSellerCustomer
      ? items.filter((item) => String(item.lineType || item.line_type || "") !== "seller_shipping")
      : items;
    const receiptItems = isOrderReceipt
      ? [{
        description: "Customer platform service fee",
        hsnCode: amounts.customerPlatformFeeSacCode || PLATFORM_CUSTOMER_FEE_SAC_CODE,
        quantity: 1,
        taxableAmount: customerPlatformFeeAmount,
        taxAmount: customerPlatformFeeTaxAmount,
        totalAmount: customerPlatformFeeInvoiceValue,
      }]
      : visibleInvoiceItems;
    const invoiceRowsPerPage = 8;
    const pageItems = this.chunk(receiptItems.length ? receiptItems : [{}], invoiceRowsPerPage);
    const streams = pageItems.map((pageRows, pageIndex) => {
      const commands = [];
      const text = (value, x, y, size = 9, bold = false, align = "left") => {
        let safe = this.escapePdfText(value);
        const approximateWidth = safe.length * size * 0.5;
        const tx = align === "right" ? x - approximateWidth : x;
        commands.push(
          "0.10 0.11 0.14 rg",
          "BT",
          `/${bold ? "F2" : "F1"} ${size} Tf`,
          `${tx.toFixed(1)} ${y.toFixed(1)} Td`,
          `(${safe}) Tj`,
          "ET",
        );
      };
      const line = (x1, y1, x2, y2, width = 0.6, gray = 0.25) => {
        commands.push(`${gray} G`, `${width} w`, `${x1} ${y1} m ${x2} ${y2} l S`);
      };
      const fill = (x, y, width, height, r, g, b) => {
        commands.push(`${r} ${g} ${b} rg`, `${x} ${y} ${width} ${height} re f`);
      };
      const money = (value) => `${currency} ${Number(value || 0).toFixed(2)}`;
      const reversalMoney = (value) => `-${money(Math.abs(Number(value || 0)))}`;
      const reversalQty = (value) => {
        const num = Number(value ?? 0);
        if (!Number.isFinite(num)) return "-0";
        return `-${Number.isInteger(num) ? String(num) : Number(num).toFixed(2)}`;
      };
      const compact = (value, limit = 44) => {
        const normalized = String(value || "-").replace(/\s+/g, " ").trim();
        return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
      };
      const textLines = (value, x, y, size = 8, bold = false, limit = 44, maxLines = 2, gap = 10) => {
        const raw = String(value || "-").replace(/\s+/g, " ").trim();
        const words = raw.split(" ");
        const lines = [];
        let current = "";
        words.forEach((word) => {
          const next = current ? `${current} ${word}` : word;
          if (next.length > limit && current) {
            lines.push(current);
            current = word;
          } else {
            current = next;
          }
        });
        if (current) lines.push(current);
        lines.slice(0, maxLines).forEach((lineText, index) => {
          const suffix = index === maxLines - 1 && lines.length > maxLines ? "..." : "";
          text(`${lineText}${suffix}`, x, y - index * gap, size, bold);
        });
      };

      fill(0, 0, 595, 842, 1, 1, 1);
      fill(36, 765, 523, 4, 0.81, 0.62, 0.18);
      text(platformName, 40, 808, 16, true);
      const documentTitle = inv.displayTitle || (isCommission
        ? "COMMISSION TAX INVOICE"
        : isCustomerFee
          ? Number(amounts.taxAmount || amounts.taxPayableAmount || 0) > 0
            ? "PLATFORM FEE TAX INVOICE"
            : "PLATFORM FEE INVOICE"
          : isOrderReceipt
            ? "ORDER RECEIPT"
            : "TAX INVOICE");
      text(documentTitle, 555, 806, isCreditNote ? 14 : isCommission ? 13 : 17, true, "right");
      text(isCreditNote ? "Credit Note for Recipient" : "Original for Recipient", 555, 790, 8, false, "right");
      text("PLATFORM DETAILS", 40, 752, 7.5, true);
      text(platformName, 40, 737, 12, true);
      text(`Marketplace / Platform Operator`, 40, 723, 8);
      textLines(platformAddress || "Registered office not configured", 40, 710, 7.5, false, 48, 2, 10);
      text(`Platform GSTIN: ${compact(platformGstin || "Not configured", 34)}`, 40, 688, 7.5, true);

      text("Invoice No.", 350, 748, 8);
      text(compact(inv.number || "-", 30), 555, 748, 9, true, "right");
      text("Invoice Date", 350, 732, 8);
      text(invoiceDate, 555, 732, 9, true, "right");
      text(isCreditNote ? "Against Invoice" : "Order Reference", 350, 716, 8);
      text(compact(isCreditNote ? inv.parentInvoiceNumber || "-" : orderReference, 30), 555, 716, 9, true, "right");
      text(isCreditNote ? "Return / Cancel Ref." : "Place of Supply", 350, 700, 8);
      text(compact(isCreditNote ? inv.referenceNumber || "-" : inv.placeOfSupply || "-", 30), 555, 700, 9, true, "right");
      if (isCreditNote) {
        text(`Reason: ${compact(inv.reason || "-", 46)}`, 350, 684, 7.5);
        text(`Source: ${compact(inv.sourceType || "-", 18)} · Mode: ${compact(inv.reversalMode || "-", 18)}`, 350, 672, 7.5);
      }
      line(36, 666, 559, 666, 0.8);

      text(isCommission
        ? "ISSUED BY / SERVICE PROVIDER"
        : isCustomerFee
          ? "ISSUED BY / SERVICE PROVIDER"
          : isOrderReceipt
            ? "ISSUED BY / MARKETPLACE"
            : "SOLD BY / SUPPLIER", 40, 650, 7.5, true);
      text(issuerName, 40, 636, 10, true);
      const issuerAddress = isCommission || isOrderReceipt || isCustomerFee
        ? [process.env.INVOICE_REGISTERED_OFFICE].filter(Boolean)
        : sellerAddress;
      issuerAddress.slice(0, 3).forEach((addressLine, index) => text(compact(addressLine, 46), 40, 622 - index * 10, 7.5));
      if (issuerGstin) text(`${isCommission || isCustomerFee || isOrderReceipt ? "Marketplace" : "Supplier"} GSTIN: ${issuerGstin}`, 40, 587, 7.5, true);

      text(isCommission ? "BILLED TO / SELLER" : "BILL TO / CUSTOMER", 220, 650, 8, true);
      text(recipientName, 220, 636, 10, true);
      recipientAddress.slice(0, 3).forEach((addressLine, index) => text(compact(addressLine, 34), 220, 622 - index * 11, 8));
      const recipientGstin = isCommission ? inv.gstinSeller : (buyer.gstin || buyer.gstNumber);
      if (recipientGstin) text(`Recipient GSTIN: ${recipientGstin}`, 220, 576, 8);

      if (isCommission || isCustomerFee || isOrderReceipt) {
        text("SERVICE DETAILS", 400, 650, 8, true);
        text(isCommission
          ? "Marketplace commission and related services"
          : "Customer platform services", 400, 636, 9, true);
        text(`Related order: ${orderReference}`, 400, 622, 8);
        text(isCommission
          ? "This document is not a customer product invoice."
          : "Seller product tax invoices are provided separately.", 400, 611, 8);
      } else {
        text("SHIP TO", 400, 650, 8, true);
        text(shipping.fullName || shipping.full_name || shipping.name || buyerName, 400, 636, 10, true);
        shippingAddress.slice(0, 3).forEach((addressLine, index) => text(compact(addressLine, 32), 400, 622 - index * 11, 8));
      }
      line(36, 558, 559, 558, 0.8);

      fill(36, 532, 523, 22, 0.95, 0.93, 0.87);
      text("#", 43, 540, 8, true);
      text("Description", 62, 540, 8, true);
      text("HSN/SAC", 270, 540, 8, true);
      text("Qty", 326, 540, 8, true);
      text(isCreditNote ? "Taxable" : "Taxable Value", 414, 540, 8, true, "right");
      text(isCreditNote ? "GST" : "GST", 484, 540, 8, true, "right");
      text(isCreditNote ? "Value Reversed" : "Invoice Value", 553, 540, 8, true, "right");

      let y = 514;
      pageRows.forEach((item, index) => {
        const title = item.description || item.productTitle || item.product_title || (items.length ? "Item" : "No line items");
        const lineType = String(item.lineType || item.line_type || "");
        const hsn = item.hsnCode || item.hsn_code ||
          (isCommission ? PLATFORM_COMMISSION_SAC_CODE : "") ||
          (isCustomerFee || isOrderReceipt ? PLATFORM_CUSTOMER_FEE_SAC_CODE : "") ||
          (lineType.includes("shipping") ? SHIPPING_SERVICE_SAC_CODE : "") ||
          "-";
        const qty = item.quantity ?? "-";
        const taxable = item.taxableAmount ?? item.taxable_amount ?? item.unitPrice ?? item.unit_price ?? 0;
        const tax = Number(item.taxAmount ?? item.tax_amount ?? 0) ||
          Number(item.cgstAmount ?? item.cgst_amount ?? 0) + Number(item.sgstAmount ?? item.sgst_amount ?? 0) + Number(item.igstAmount ?? item.igst_amount ?? 0);
        const total = item.totalAmount ?? item.total_amount ??
          (Number(taxable || 0) + Number(tax || 0));
        text(String(pageIndex * invoiceRowsPerPage + index + 1), 43, y, 8);
        text(compact(title, isCreditNote ? 30 : 34), 62, y, 8, true);
        const sku = item.productSku || item.variantSku || item.product_sku || item.variant_sku;
        if (sku) text(`SKU: ${compact(sku, 30)}`, 62, y - 11, 7);
        const customerPromotion = Number(
          item.customerDiscountAmount ?? item.discountAmount ?? item.discount_amount ?? 0,
        );
        if (!isCommission && customerPromotion > 0) {
          const marketplaceFunding = Number(item.marketplaceFundedDiscountAmount || 0);
          const partnerFunding = Number(item.paymentPartnerFundedDiscountAmount || 0);
          const fundingLabel = marketplaceFunding > 0
            ? "marketplace funded"
            : partnerFunding > 0
              ? "payment partner funded"
              : "seller funded";
          text(`Promotion: -${money(customerPromotion)} (${fundingLabel})`, 140, y - 11, 7);
        }
        if (isCommission && Number(item.commissionRate || 0) > 0) {
          text(`Commission: ${Number(item.commissionRate).toFixed(2)}%`, 160, y - 11, 7);
        }
        text(hsn, 270, y, 8);
        if (isCreditNote && item.reversalWeight !== undefined) {
          text(`Reversal: ${(Number(item.reversalWeight || 0) * 100).toFixed(2)}%`, 160, y - 11, 7);
        }
        text(isCreditNote ? reversalQty(qty) : String(qty), 330, y, 8);
        text(isCreditNote ? reversalMoney(taxable) : money(taxable), 414, y, 8, false, "right");
        text(isCreditNote ? reversalMoney(tax) : money(tax), 484, y, 8, false, "right");
        text(isCreditNote ? reversalMoney(total) : money(total), 553, y, 8, true, "right");
        line(36, y - 18, 559, y - 18, 0.35, 0.75);
        y -= 34;
      });

      if (pageIndex === pageItems.length - 1) {
        const summaryRows = [];
        const add = (label, value, negative = false, force = false) => {
          if (force || Number(value || 0) !== 0) summaryRows.push([label, Number(value), negative]);
        };
        if (isCreditNote) {
          add("Product taxable value reversed", amounts.taxableAmount, true);
          add("Total GST reversed", amounts.taxAmount, true);
          add("Product invoice value reversed", amounts.totalAmount, true, true);
          add("Customer promotion reversed", amounts.customerPromotionReversalAmount, true, true);
          add("Shipping reversed", amounts.shippingReversalAmount, true, true);
          add("Refundable platform fee reversed", amounts.customerPlatformFeeReversalAmount, true, true);
        } else if (isOrderReceipt || isCustomerFee) {
          add(platformFeeIsInclusive ? "Platform fee taxable value" : "Platform fee base", customerPlatformFeeAmount, false, true);
          add(platformFeeIsInclusive ? `Included GST on platform fee (${platformFeeGstRate}%)` : "GST on platform fee", customerPlatformFeeTaxAmount, false, true);
        } else {
          add("Subtotal", amounts.grossSalesAmount || amounts.taxableAmount);
          add("Customer Promotion", amounts.customerDiscountAmount ?? amounts.discountAmount, true);
          const sellerShipping = isSellerCustomer
            ? Number(amounts.shippingCollectedForSellerAmount || 0)
            : 0;
          if (sellerShipping > 0) {
            add("Delivery / shipping collected for seller", sellerShipping);
          } else {
            add("Delivery Charge", amounts.deliveryChargeAmount || amounts.shippingChargeAmount);
          }
          add("COD Charge", amounts.codChargeAmount);
          add("Platform Fee", amounts.customerPlatformFeeAmount);
          const taxTotal = Number(amounts.cgstAmount || 0) + Number(amounts.sgstAmount || 0) + Number(amounts.igstAmount || 0);
          const displayedTax = taxTotal || amounts.taxAmount || amounts.productTaxLiabilityAmount;
          add(isCommission
            ? "GST on Commission"
            : Number(amounts.taxPayableAmount || 0) > 0
              ? "GST"
              : "Included GST (information only)", displayedTax);
        }
        const productInvoiceValue = isCreditNote
          ? amounts.totalAmount || 0
          : isOrderReceipt
          ? customerPlatformFeeInvoiceValue
          : amounts.finalPayableAmount || amounts.totalAmount || amounts.customerFinalAmount || inv.totalAmount || 0;
        const sellerShippingAmount = isSellerCustomer
          ? Number(amounts.shippingCollectedForSellerAmount || 0)
          : 0;
        const invoiceValue = isSellerCustomer
          ? Number(productInvoiceValue || 0) + sellerShippingAmount
          : productInvoiceValue;
        const total = isSellerCustomer && Number(amounts.customerPaidTowardInvoiceAmount || 0) > 0
          ? Number(amounts.customerPaidTowardInvoiceAmount || 0) + sellerShippingAmount
          : invoiceValue;
        const summaryTop = Math.min(y - 4, 205 + summaryRows.length * 17);
        text("AMOUNT SUMMARY", 355, summaryTop + 18, 8, true);
        summaryRows.forEach(([label, value, negative], index) => {
          const rowY = summaryTop - index * 16;
          text(label, 355, rowY, 8);
          text(`${negative ? "- " : ""}${money(value)}`, 553, rowY, 8, false, "right");
        });
        const totalY = summaryTop - summaryRows.length * 16 - 4;
        line(350, totalY + 12, 559, totalY + 12, 0.8);
        const totalLabel = isCreditNote
          ? "Customer refund / total credit"
          : isSellerCustomer && Number(amounts.customerPaidTowardInvoiceAmount || 0) > 0
          ? "Amount paid by customer"
          : isOrderReceipt
            ? "Total paid"
            : "Grand total";
        text(totalLabel, 355, totalY - 2, isOrderReceipt ? 9 : 10, true);
        text(isCreditNote ? reversalMoney(amounts.customerRefundAmount) : money(total), 553, totalY - 2, 11, true, "right");
        if (isCreditNote) {
          text(`Remaining invoice balance: ${money(amounts.remainingInvoiceBalance || 0)}`, 355, totalY - 16, 7.5);
          text(`Remaining customer-paid balance: ${money(amounts.remainingCustomerBalance || 0)}`, 355, totalY - 29, 7.5);
        }
        if (!isCreditNote && isSellerCustomer && Number(amounts.customerPaidTowardInvoiceAmount || 0) > 0) {
          text(`Tax invoice value: ${money(invoiceValue)}`, 355, totalY - 16, 7.5);
        }
        if (!isCreditNote && isSellerCustomer && sellerShippingAmount > 0) {
          text("Product table excludes shipping; shipping is shown in summary and settled to seller.", 355, totalY - 29, 7);
        }
        if (!isCreditNote && platformFeeIsInclusive) {
          text(`Platform fee is GST-inclusive. Gross fee: ${money(rawCustomerPlatformFeeAmount)}`, 355, totalY - 16, 7.5);
        }
        const contribution = isOrderReceipt ? 0 : Number(amounts.marketplaceFundedDiscountAmount || 0);
        const partnerContribution = Number(amounts.paymentPartnerFundedDiscountAmount || 0);
        if (!isCreditNote && (contribution > 0 || partnerContribution > 0)) {
          const allocation = [
            Number(amounts.customerPaidTowardInvoiceAmount || 0) > 0
              ? `Customer: ${money(amounts.customerPaidTowardInvoiceAmount)}`
              : null,
            contribution > 0 ? `Marketplace promotion: ${money(contribution)}` : null,
            partnerContribution > 0 ? `Payment partner: ${money(partnerContribution)}` : null,
          ].filter(Boolean).join(" · ");
          text(`Payment allocation: ${compact(allocation, 78)}`, 40, 188, 7.5);
        }
        text(isCreditNote ? "Amount in words: As per the customer refund / total credit shown above." : "Amount in words: As per the grand total shown above.", 40, 174, 8);
        text(isCreditNote ? "This document reverses the referenced invoice values only; refund settlement may be processed separately." : "Payment status and transaction reference are available in the order details.", 40, 159, 8);
        line(36, 138, 559, 138, 0.8);
        text(isCreditNote
          ? "Credit Note Declaration"
          : isCommission || isCustomerFee
          ? "Service Provider Declaration"
          : isOrderReceipt
            ? "Receipt Information"
            : "Supplier Declaration", 40, 122, 8, true);
        text(isCreditNote
          ? "We declare that this credit note reverses the eligible value and tax of the referenced invoice correctly."
          : isCommission || isCustomerFee
          ? "We declare that this invoice shows the marketplace services supplied and the applicable tax correctly."
          : isOrderReceipt
            ? "This receipt is only for the platform fee charged by the marketplace to the customer. Seller product tax invoices are provided separately."
            : "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.", 40, 108, 7.5);
        text("This is a computer-generated tax invoice and does not require a physical signature.", 40, 96, 7.5);
        text(`For ${compact(issuerName, 34)}`, 553, 122, 8, true, "right");
        text(`Electronically issued by the ${isCommission || isOrderReceipt || isCustomerFee ? "platform" : "supplier"}`, 553, 96, 8, false, "right");
      } else {
        text("Continued on next page", 553, 100, 8, true, "right");
      }
      text(`Page ${pageIndex + 1} of ${pageItems.length}`, 553, 42, 8, false, "right");
      text(isCreditNote ? "Credit note generated against the referenced invoice." : "Thank you for shopping with us.", 40, 42, 8);
      return commands.join("\n");
    });

    const objects = [];
    const pageObjectIds = [];
    const fontRegularId = 3 + streams.length * 2;
    const fontBoldId = fontRegularId + 1;
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    streams.forEach((stream, index) => {
      const pageId = 3 + index * 2;
      const contentId = pageId + 1;
      pageObjectIds.push(pageId);
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`;
      objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`;
    });
    objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;
    objects[fontRegularId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    objects[fontBoldId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
    return this.buildPdf(objects);
  }

  buildPdfPageStream(lines = [], pageNumber, totalPages) {
    const safeLines = [...lines, "", `Page ${pageNumber} of ${totalPages}`];
    const commands = ["BT", "/F1 10 Tf", "50 790 Td", "14 TL"];
    safeLines.forEach((line) => {
      commands.push(`(${this.escapePdfText(line)}) Tj`);
      commands.push("T*");
    });
    commands.push("ET");
    return commands.join("\n");
  }

  buildPdf(objects) {
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (let id = 1; id < objects.length; id += 1) {
      if (!objects[id]) continue;
      offsets[id] = Buffer.byteLength(pdf, "binary");
      pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf, "binary");
    pdf += `xref\n0 ${objects.length}\n`;
    pdf += "0000000000 65535 f \n";
    for (let id = 1; id < objects.length; id += 1) {
      pdf += `${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, "binary");
  }

  flattenDocument(document = {}) {
    const lines = [
      String(document.title || "Document"),
      String(document.subtitle || ""),
      `Generated at: ${document.generatedAt || new Date().toISOString()}`,
      "",
    ];

    for (const section of document.sections || []) {
      lines.push(String(section.title || "Section"));
      lines.push("-".repeat(Math.min(String(section.title || "Section").length, 80)));
      for (const row of section.rows || []) {
        if (Array.isArray(row)) {
          lines.push(row.map((cell) => this.normalizeCell(cell)).join(" | "));
        } else {
          lines.push(`${this.normalizeCell(row.label)}: ${this.normalizeCell(row.value)}`);
        }
      }
      lines.push("");
    }

    return lines.filter((line, index) => line !== "" || lines[index - 1] !== "");
  }

  normalizeCell(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  wrapLine(line = "", maxLength = 92) {
    const words = String(line).split(/\s+/);
    const lines = [];
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (`${current} ${word}`.length <= maxLength) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  }

  chunk(items = [], size = 48) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks.length ? chunks : [[]];
  }

  escapeHtml(value) {
    return this.normalizeCell(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  escapePdfText(value) {
    return this.normalizeCell(value)
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  escapeCsv(value) {
    const cell = this.normalizeCell(value);
    if (/[",\n\r]/.test(cell)) {
      return `"${cell.replace(/"/g, "\"\"")}"`;
    }
    return cell;
  }
}

const documentRendererService = new DocumentRendererService();

module.exports = { DocumentRendererService, documentRendererService };
