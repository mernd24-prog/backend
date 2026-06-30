const DEFAULT_CURRENCY = "INR";

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
      : "Marketplace Platform";
    const issuerGstin = isSeller ? (inv.gstinSeller || seller.gstNumber || null) : (inv.gstinMarketplace || null);
    const issuerAddrLines = isSeller ? this.formatAddressLines(seller.billingAddress || seller.businessAddress) : [];
    const marketplaceGstin = inv.gstinMarketplace || null;

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
      : `<tr><td colspan="${isIgst ? 8 : 9}" class="empty-row">No line items on record</td></tr>`;

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
    <div>
      <div class="hdr-brand">${this.escapeHtml(issuerName)}</div>
      ${issuerAddrLines.length ? `<div class="hdr-sub">${this.escapeHtml(issuerAddrLines[0])}</div>` : ""}
      ${issuerGstin ? `<div class="hdr-sub">GSTIN: ${this.escapeHtml(issuerGstin)}</div>` : ""}
    </div>
    <div class="hdr-right">
      <div class="hdr-doctype">${this.escapeHtml(document.title || "Tax Invoice")}</div>
      <div class="hdr-invnum">${this.escapeHtml(inv.number || "")}</div>
      <div class="hdr-date">${invoiceDate}</div>
    </div>
  </div>
  <div class="accent-bar"></div>

  <!-- Meta bar -->
  <div class="meta-bar">
    ${this.metaCell("Invoice No.", inv.number || "—")}
    ${this.metaCell("Invoice Date", invoiceDate)}
    ${this.metaCell("Order Ref.", orderRef)}
    ${this.metaCell("Place of Supply", inv.placeOfSupply || "—")}
    ${this.metaCell("Currency", currency)}
  </div>

  <!-- Parties -->
  <div class="parties">
    ${this.renderPartyBlock("Billed By", issuerName, issuerAddrLines, issuerGstin, null)}
    ${this.renderPartyBlock(isCommission ? "Billed To (Seller)" : "Bill To", recipientName, [], null, recipientEmail)}
    ${!isCommission ? this.renderShipToBlock(shippingAddr) : ""}
  </div>

  <!-- Items table -->
  <div class="section-hdr">Line Items</div>
  <table class="tbl">
    <thead>
      <tr>
        <th class="l" style="width:3%">#</th>
        <th class="l" style="min-width:160px">Description</th>
        <th class="c" style="width:8%">HSN / SAC</th>
        <th class="c" style="width:5%">Qty</th>
        <th style="width:10%">Unit Price</th>
        <th style="width:10%">Taxable</th>
        ${isIgst
          ? '<th style="width:9%">IGST</th>'
          : '<th style="width:8%">CGST</th><th style="width:8%">SGST</th>'}
        <th style="width:10%">Total</th>
      </tr>
    </thead>
    <tbody>${itemRowsHtml}</tbody>
  </table>

  <!-- Footer: GST Summary + Amounts -->
  <div class="footer-grid">
    <div class="gst-col">
      <div class="col-title">GST Summary</div>
      ${this.renderTaxTable(cgst, sgst, igst, tcs, isIgst, currency)}
      ${marketplaceGstin && isSeller
        ? `<div class="mktplace-gstin">Marketplace GSTIN: <strong>${this.escapeHtml(marketplaceGstin)}</strong></div>`
        : ""}
    </div>
    <div class="amt-col">
      <div class="col-title">Amount Summary</div>
      ${this.buildInvoiceAmountRows(amounts, currency).join("")}
    </div>
  </div>

  <!-- Declaration -->
  <div class="declaration">
    This is a computer-generated document and does not require a physical signature.
    ${marketplaceGstin ? `&nbsp;·&nbsp; Marketplace GSTIN: ${this.escapeHtml(marketplaceGstin)}` : ""}
    &nbsp;·&nbsp; Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
  </div>

</div>
</body>
</html>`;
  }

  /* ─────────────────── CREDIT NOTE HTML ─────────────────── */

  renderCreditNoteHtml(document = {}) {
    const d = document.data || {};
    const cn = d.creditNote || {};
    const parentInvoice = d.parentInvoice || {};
    const seller = d.seller || {};
    const buyer = d.buyer || {};
    const amounts = d.amounts || {};
    const items = d.items || [];
    const currency = cn.currency || DEFAULT_CURRENCY;
    const isIgst = parentInvoice.taxMode === "igst";

    const issuerName = "Marketplace Platform";
    const issuerGstin = parentInvoice.gstinMarketplace || cn.gstinMarketplace || null;
    const recipientName = cn.scope === "platform_commission_invoice"
      ? (seller.legalBusinessName || seller.displayName || "Seller")
      : this.getBuyerName(buyer);
    const recipientEmail = cn.scope === "platform_commission_invoice" ? seller.email : buyer.email;

    const cnDate = this.formatDate(cn.issuedAt);
    const orderRef = cn.orderNumber || (cn.orderId ? `#${String(cn.orderId).slice(-8).toUpperCase()}` : "—");

    const itemRowsHtml = items.length
      ? items.map((item, i) => this.renderCreditNoteItemRow(item, i + 1, currency)).join("")
      : `<tr><td colspan="5" class="empty-row">No reversed items on record</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Credit Note — ${this.escapeHtml(cn.number || "")}</title>
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
      <div class="hdr-doctype">Credit Note</div>
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
    ${this.metaCell("Reason", (cn.reason || "—").replace(/_/g, " "))}
  </div>

  <!-- Parties -->
  <div class="parties">
    ${this.renderPartyBlock("Issued By", issuerName, [], issuerGstin, null)}
    ${this.renderPartyBlock("Credit To", recipientName, [], null, recipientEmail || null)}
  </div>

  <!-- Reversed items -->
  <div class="section-hdr">Reversed Items</div>
  <table class="tbl">
    <thead>
      <tr>
        <th class="l" style="width:4%">#</th>
        <th class="l">Description</th>
        <th class="c" style="width:7%">Qty</th>
        <th style="width:13%">Taxable</th>
        <th style="width:13%">Tax</th>
        <th style="width:13%">Reversal</th>
      </tr>
    </thead>
    <tbody>${itemRowsHtml}</tbody>
  </table>

  <!-- Reversal amounts -->
  <div class="footer-grid">
    <div class="gst-col">
      <div class="col-title">Tax Reversed</div>
      ${this.renderTaxTable(
        Number(amounts.cgstAmount || 0),
        Number(amounts.sgstAmount || 0),
        Number(amounts.igstAmount || 0),
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
    This credit note reverses the tax liability on the referenced invoice.
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
    background: #eef0f7;
    color: #1a1a2e;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    padding: 24px;
  }
  .page {
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 4px 32px rgba(27,29,96,0.13);
    margin: 0 auto;
    max-width: 900px;
    overflow: hidden;
  }
  /* Header */
  .hdr {
    background: #1B1D60;
    color: #fff;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 28px 36px 26px;
  }
  .hdr-brand { font-size: 20px; font-weight: 700; letter-spacing: 0.3px; }
  .hdr-sub { font-size: 10.5px; opacity: 0.72; margin-top: 4px; letter-spacing: 0.2px; }
  .hdr-right { text-align: right; }
  .hdr-doctype {
    font-size: 23px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: ${accentColor};
    text-transform: uppercase;
  }
  .hdr-invnum { font-size: 12px; opacity: 0.85; margin-top: 4px; }
  .hdr-date { font-size: 11px; opacity: 0.60; margin-top: 2px; }
  /* Accent bar */
  .accent-bar { background: ${accentColor}; height: 4px; }
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
    background: #1B1D60;
    color: #fff;
    font-size: 10.5px;
    font-weight: 700;
    padding: 9px 10px;
    text-align: right;
    white-space: nowrap;
    letter-spacing: 0.2px;
  }
  .tbl td {
    padding: 10px 10px;
    border-bottom: 1px solid #f0f2f8;
    vertical-align: top;
    text-align: right;
    color: #2E2E2E;
    font-size: 11.5px;
  }
  .tbl th.l, .tbl td.l { text-align: left; }
  .tbl th.c, .tbl td.c { text-align: center; }
  .tbl tbody tr:last-child td { border-bottom: none; }
  .tbl tbody tr:hover td { background: #f9fafb; }
  .item-title { font-weight: 600; color: #1B1D60; }
  .item-sub { font-size: 10.5px; color: #8b90a7; margin-top: 2px; }
  .item-total { font-weight: 700; color: #1B1D60; }
  td.empty-row { text-align: center; color: #b0b4c9; padding: 28px; font-style: italic; }
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
    background: #f0f2f8;
    color: #4b4f6b;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 6px 8px;
    text-align: right;
  }
  .tax-tbl th.l, .tax-tbl td.l { text-align: left; }
  .tax-tbl td {
    padding: 6px 8px;
    border-bottom: 1px solid #f0f2f8;
    text-align: right;
    color: #2E2E2E;
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
  /* Declaration */
  .declaration {
    background: #f9fafb;
    border-top: 1px solid #e8eaf0;
    color: #9ca3af;
    font-size: 10px;
    padding: 14px 24px;
    text-align: center;
    line-height: 1.8;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .page { border-radius: 0; box-shadow: none; }
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
    const taxable = this.money(item.taxableAmount ?? item.taxable_amount, currency);
    const cgst = this.money(item.cgstAmount ?? item.cgst_amount, currency);
    const sgst = this.money(item.sgstAmount ?? item.sgst_amount, currency);
    const igst = this.money(item.igstAmount ?? item.igst_amount, currency);
    const total = this.money(item.totalAmount ?? item.lineTotal ?? item.line_total, currency);
    const discount = Number(item.discountAmount ?? item.discount_amount ?? 0);

    return `<tr>
      <td class="l c" style="color:#8b90a7">${index}</td>
      <td class="l">
        <div class="item-title">${this.escapeHtml(title)}</div>
        ${sku ? `<div class="item-sub">SKU: ${this.escapeHtml(sku)}</div>` : ""}
        ${discount > 0 ? `<div class="item-sub" style="color:#16a34a">Disc: ${this.escapeHtml(this.money(discount, currency))}</div>` : ""}
      </td>
      <td class="c">${this.escapeHtml(hsn)}</td>
      <td class="c">${this.escapeHtml(String(qty))}</td>
      <td>${this.escapeHtml(unitPrice)}</td>
      <td>${this.escapeHtml(taxable)}</td>
      ${isIgst
        ? `<td>${this.escapeHtml(igst)}</td>`
        : `<td>${this.escapeHtml(cgst)}</td><td>${this.escapeHtml(sgst)}</td>`}
      <td class="item-total">${this.escapeHtml(total)}</td>
    </tr>`;
  }

  renderCreditNoteItemRow(item, index, currency) {
    const title = item.productTitle || item.product_title || item.description || "—";
    const qty = item.quantity ?? "—";
    const taxable = this.money(item.taxableAmount ?? item.taxable_amount, currency);
    const tax = this.money(item.taxAmount ?? item.tax_amount, currency);
    const total = this.money(item.totalAmount ?? item.total_amount, currency);
    return `<tr>
      <td class="l c" style="color:#8b90a7">${index}</td>
      <td class="l"><div class="item-title">${this.escapeHtml(title)}</div></td>
      <td class="c">${this.escapeHtml(String(qty))}</td>
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
    if (tcs > 0) rows.push({ component: "TCS (1%)", amount: tcs });

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
    if (a(amounts.discountAmount) > 0) {
      rows.push(`<div class="amt-row savings">
        <span class="amt-lbl">Discount</span>
        <span class="amt-val">−${this.escapeHtml(this.money(amounts.discountAmount, currency))}</span>
      </div>`);
    }
    if (a(amounts.walletDiscountAmount) > 0) {
      rows.push(`<div class="amt-row savings">
        <span class="amt-lbl">Wallet Discount</span>
        <span class="amt-val">−${this.escapeHtml(this.money(amounts.walletDiscountAmount, currency))}</span>
      </div>`);
    }
    const delivery = a(amounts.deliveryChargeAmount || amounts.shippingChargeAmount);
    if (delivery > 0) addRow("Delivery Charge", delivery);
    if (a(amounts.codChargeAmount) > 0) addRow("COD Charge", amounts.codChargeAmount);
    if (a(amounts.customerPlatformFeeAmount) > 0) addRow("Platform Fee", amounts.customerPlatformFeeAmount);
    if (a(amounts.customerPlatformFeeTaxAmount) > 0) addRow("Platform Fee GST", amounts.customerPlatformFeeTaxAmount);

    const taxPayable = a(amounts.taxPayableAmount ?? (a(amounts.cgstAmount) + a(amounts.sgstAmount) + a(amounts.igstAmount) + a(amounts.tcsAmount)));
    if (taxPayable > 0) addRow("GST", taxPayable);

    const total = a(amounts.finalPayableAmount || amounts.totalAmount || amounts.customerFinalAmount);
    rows.push(`<div class="amt-row grand">
      <span class="amt-lbl">Grand Total</span>
      <span class="amt-val">${this.escapeHtml(this.money(total, currency))}</span>
    </div>`);

    return rows;
  }

  buildCreditNoteAmountRows(amounts = {}, currency) {
    const a = (v) => Number(v || 0);
    const rows = [];
    const addRow = (label, value) => {
      rows.push(`<div class="amt-row">
        <span class="amt-lbl">${this.escapeHtml(label)}</span>
        <span class="amt-val">${this.escapeHtml(this.money(value, currency))}</span>
      </div>`);
    };
    if (a(amounts.taxableAmount) > 0) addRow("Taxable Amount", amounts.taxableAmount);
    if (a(amounts.cgstAmount) > 0) addRow("CGST Reversed", amounts.cgstAmount);
    if (a(amounts.sgstAmount) > 0) addRow("SGST Reversed", amounts.sgstAmount);
    if (a(amounts.igstAmount) > 0) addRow("IGST Reversed", amounts.igstAmount);
    if (a(amounts.taxAmount) > 0) addRow("Total Tax Reversed", amounts.taxAmount);
    rows.push(`<div class="amt-row grand">
      <span class="amt-lbl">Total Credit</span>
      <span class="amt-val">${this.escapeHtml(this.money(a(amounts.totalAmount), currency))}</span>
    </div>`);
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
