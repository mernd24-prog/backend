const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { ORDER_STATUS } = require("../../../shared/domain/commerce-constants");

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const humanize = (value = "") =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const formatMoney = (value, currency = "INR") => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
};

const trimTrailingSlash = (value = "") => String(value || "").replace(/\/+$/, "");
const absoluteUrlPattern = /^https?:\/\//i;
const brandName = process.env.BRAND_NAME || process.env.APP_NAME || "Sam Global";
const supportEmail = process.env.SUPPORT_EMAIL || process.env.REPLY_TO_EMAIL || "";

const hiddenPreheader = (text = "") => `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;font-size:1px;">
    ${escapeHtml(text)}
  </div>`;

const getBaseUrl = (recipientType = "customer") => {
  if (recipientType === "admin") {
    return trimTrailingSlash(process.env.ADMIN_APP_BASE_URL || "http://45.195.90.183:5000");
  }
  if (recipientType === "seller") {
    return trimTrailingSlash(process.env.SELLER_APP_BASE_URL || "http://45.195.90.183:3000");
  }
  return trimTrailingSlash(
    process.env.CUSTOMER_APP_BASE_URL ||
      process.env.SELLER_APP_BASE_URL ||
      "http://45.195.90.183",
  );
};

const toAbsoluteUrl = (value = "", recipientType = "customer") => {
  const url = String(value || "").trim();
  if (!url) return "";
  if (absoluteUrlPattern.test(url)) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${getBaseUrl(recipientType)}${path}`;
};

const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const isPublicReference = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^[0-9a-f]{24}$/i.test(text)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return false;
  return true;
};

const containsPrivateReference = (value = "") =>
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(String(value || "")) ||
  /(^|[^0-9a-f])[0-9a-f]{24}([^0-9a-f]|$)/i.test(String(value || ""));

const publicValue = (...values) => {
  const value = firstValue(...values);
  return isPublicReference(value) ? value : "";
};

const compactRows = (rows = []) =>
  rows.filter((row) => row?.value !== undefined && row?.value !== null && row?.value !== "");

const row = (label, value) =>
  value !== undefined && value !== null && value !== "" ? { label, value } : null;

const productNameOf = (item = {}) =>
  firstValue(item.productName, item.product_name, item.productTitle, item.product_title, item.title, item.name);

const productSkuOf = (item = {}) =>
  firstValue(item.productSku, item.product_sku, item.variantSku, item.variant_sku, item.sku);

const productVariantOf = (item = {}) =>
  firstValue(item.variantTitle, item.variant_title);

const moneyOf = (payload = {}, ...keys) => {
  const key = keys.find((candidate) => payload[candidate] !== undefined && payload[candidate] !== null && payload[candidate] !== "");
  return key ? formatMoney(payload[key], payload.currency || "INR") : "";
};

const orderReferenceOf = (payload = {}) =>
  publicValue(payload.orderNumber, payload.order_number, payload.publicOrderNumber, payload.displayOrderNumber);

const orderDateOf = (payload = {}) => {
  const value = firstValue(payload.orderDate, payload.createdAt, payload.created_at, payload.orderCreatedAt);
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
};

const recipientNameOf = (payload = {}, recipientType = "customer") => {
  if (recipientType === "seller") {
    return firstValue(payload.sellerName, payload.storeDisplayName, payload.businessName);
  }
  if (recipientType === "admin") {
    return firstValue(payload.adminName);
  }
  const shippingAddress = payload.shippingAddress || payload.shipping_address || {};
  return firstValue(payload.customerName, payload.buyerName, payload.name, shippingAddress.fullName);
};

const addressLinesOf = (address = {}) =>
  [
    firstValue(address.fullName, address.name),
    firstValue(address.company, address.companyName),
    firstValue(address.line1, address.addressLine1, address.address_line1, address.address),
    firstValue(address.line2, address.addressLine2, address.address_line2),
    [
      firstValue(address.city),
      firstValue(address.state),
      firstValue(address.postalCode, address.postal_code, address.pincode, address.zip),
    ].filter(Boolean).join(", "),
    firstValue(address.country),
    firstValue(address.phone, address.mobile),
    firstValue(address.email),
  ].filter(Boolean);

const orderItemsOf = (payload = {}) =>
  (Array.isArray(payload.items) ? payload.items : [])
    .map((item) => {
      const name = productNameOf(item);
      if (!name) return null;
      const quantity = Number(item.quantity || 0);
      const price = firstValue(item.lineTotal, item.line_total, item.total, item.price);
      return {
        name,
        meta: [productVariantOf(item), productSkuOf(item) ? `SKU: ${productSkuOf(item)}` : ""].filter(Boolean).join(" | "),
        quantity: quantity > 0 ? quantity : "",
        price: price !== undefined && price !== null && price !== "" ? formatMoney(price, payload.currency || "INR") : "",
      };
    })
    .filter(Boolean);

const orderSummaryRowsOf = (payload = {}) => compactRows([
  row("Subtotal", moneyOf(payload, "subtotalAmount", "subtotal_amount", "subtotal")),
  row("Discount", moneyOf(payload, "discountAmount", "discount_amount")),
  row("Shipping", moneyOf(payload, "shippingFeeAmount", "shipping_fee_amount", "deliveryChargeAmount")),
  row("Platform fee", moneyOf(payload, "platformFeeAmount", "platform_fee_amount")),
  row("COD charge", moneyOf(payload, "codChargeAmount", "cod_charge_amount")),
  row("Total", moneyOf(payload, "payableAmount", "payable_amount", "totalAmount", "total_amount", "amount")),
  row("Payment method", humanize(firstValue(payload.paymentProvider, payload.payment_provider))),
  row("Payment status", humanize(firstValue(payload.paymentStatus, payload.payment_status))),
]);

const refundRowsOf = (payload = {}) => compactRows([
  row("Refund amount", moneyOf(payload, "refundAmount", "refund_amount", "amount")),
  row("Refund method", humanize(firstValue(payload.refundMethod, payload.refund_method, payload.method))),
  row("Refund reference", publicValue(payload.refundReferenceId, payload.refund_reference_id, payload.referenceNumber, payload.reference_number, payload.utr)),
  row("Reason", firstValue(payload.reason, payload.rejectionReason, payload.failureReason)),
]);

const orderRowsOf = (payload = {}) => compactRows([
  row("Order", orderReferenceOf(payload)),
  row("Order date", orderDateOf(payload)),
  row("Order status", humanize(firstValue(payload.status, payload.orderStatus))),
  row("Payment status", humanize(firstValue(payload.paymentStatus, payload.payment_status))),
  row("Tracking number", firstValue(payload.trackingNumber, payload.tracking_number)),
  row("Carrier", firstValue(payload.carrierName, payload.carrier_name)),
  row("Reason", firstValue(payload.reason, payload.cancellationReason)),
]);

const isOrderCompleteStatus = (payload = {}) =>
  [ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED, "completed", "complete"].includes(String(firstValue(payload.status, payload.orderStatus) || ""));

const resolveOrderEmailCopy = ({ eventName, subject, message, payload = {}, recipientType = "customer" }) => {
  const orderRef = orderReferenceOf(payload) || "your order";
  const productCount = orderItemsOf(payload).length;
  const productText = productCount ? ` (${productCount} item${productCount === 1 ? "" : "s"})` : "";

  if (eventName === DOMAIN_EVENTS.ORDER_PAID_V1) {
    if (recipientType === "seller") {
      return {
        title: "New paid order received",
        intro: `A paid order ${orderRef}${productText} is ready for processing.`,
      };
    }
    if (recipientType === "admin") {
      return {
        title: "Order payment captured",
        intro: `Order ${orderRef}${productText} has been paid and moved into processing.`,
      };
    }
    return {
      title: "Order Confirmed",
      intro: `Your order ${orderRef}${productText} has been confirmed. We will notify you again when it moves to the next stage.`,
    };
  }

  if (eventName === DOMAIN_EVENTS.ORDER_CREATED_V1) {
    if (recipientType === "seller") {
      return {
        title: "New order received",
        intro: `A new order ${orderRef}${productText} has been placed. Please review it in your seller panel.`,
      };
    }
    if (recipientType === "admin") {
      return {
        title: "New order placed",
        intro: `Order ${orderRef}${productText} has been created.`,
      };
    }
    return {
      title: "Order Received",
      intro: `Your order ${orderRef}${productText} has been received. We are reviewing the details and will share further updates by email.`,
    };
  }

  if (eventName === DOMAIN_EVENTS.ORDER_CANCELLED_V1) {
    return {
      title: recipientType === "admin" ? "Order cancelled" : "Your order has been cancelled",
      intro: `Order ${orderRef} has been cancelled.`,
    };
  }

  if ([DOMAIN_EVENTS.REFUND_PROCESSED_V1, DOMAIN_EVENTS.RETURN_REFUNDED_V1, DOMAIN_EVENTS.PAYMENT_REFUNDED_V1].includes(eventName)) {
    return {
      title: recipientType === "admin" ? "Refund processed" : "Your refund has been processed",
      intro: `Refund details for order ${orderRef} are listed below.`,
    };
  }

  if (eventName === DOMAIN_EVENTS.REFUND_FAILED_V1) {
    return {
      title: "Refund failed",
      intro: `Refund could not be completed for order ${orderRef}.`,
    };
  }

  if (eventName === DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1 && isOrderCompleteStatus(payload)) {
    return {
      title: recipientType === "admin" ? "Order completed" : "Your order is complete",
      intro: `Order ${orderRef} has been completed.`,
    };
  }

  if (eventName === DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1) {
    return {
      title: "Payment failed",
      intro: `Payment failed for order ${orderRef}.`,
    };
  }

  return {
    title: subject || "Sam Global order update",
    intro: message || `There is an update for order ${orderRef}.`,
  };
};

const renderSectionTitle = (title) => `
  <tr>
    <td style="padding:22px 0 10px;font-size:15px;font-weight:700;color:#111827;">${escapeHtml(title)}</td>
  </tr>`;

const renderKeyValueRows = (rows = []) => {
  const html = compactRows(rows)
    .map((item) => `
      <tr>
        <td style="padding:9px 0;color:#667085;font-size:13px;border-bottom:1px solid #eef0f4;">${escapeHtml(item.label)}</td>
        <td style="padding:9px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #eef0f4;">${escapeHtml(item.value)}</td>
      </tr>`)
    .join("");
  if (!html) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f4;">${html}</table>`;
};

const renderProductsTable = (items = []) => {
  if (!items.length) return "";
  const rows = items.map((item) => `
    <tr>
      <td style="padding:12px 0;border-top:1px solid #eef0f4;">
        <div style="font-size:14px;font-weight:700;color:#111827;line-height:1.4;">${escapeHtml(item.name)}</div>
        ${item.meta ? `<div style="margin-top:3px;font-size:12px;color:#6b7280;">${escapeHtml(item.meta)}</div>` : ""}
      </td>
      <td style="padding:12px 0;border-top:1px solid #eef0f4;text-align:center;font-size:13px;color:#111827;">${escapeHtml(item.quantity)}</td>
      <td style="padding:12px 0;border-top:1px solid #eef0f4;text-align:right;font-size:13px;color:#111827;font-weight:700;">${escapeHtml(item.price)}</td>
    </tr>`).join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <th align="left" style="padding:8px 0;color:#667085;font-size:12px;font-weight:700;text-transform:uppercase;">Product</th>
        <th align="center" style="padding:8px 0;color:#667085;font-size:12px;font-weight:700;text-transform:uppercase;">Qty</th>
        <th align="right" style="padding:8px 0;color:#667085;font-size:12px;font-weight:700;text-transform:uppercase;">Amount</th>
      </tr>
      ${rows}
    </table>`;
};

const renderAddress = (title, address = {}) => {
  const lines = addressLinesOf(address);
  if (!lines.length) return "";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${renderSectionTitle(title)}
      <tr>
        <td style="font-size:13px;line-height:1.7;color:#374151;background:#f9fafb;border:1px solid #eef0f4;border-radius:8px;padding:14px 16px;">${lines.map(escapeHtml).join("<br>")}</td>
      </tr>
    </table>`;
};

const renderBlock = (title, body) => {
  if (!body) return "";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${renderSectionTitle(title)}
      <tr><td style="font-size:13px;line-height:1.65;color:#374151;white-space:pre-line;">${escapeHtml(body)}</td></tr>
    </table>`;
};

const plainTextSections = ({ title, intro, payload, items, summaryRows, refundRows, orderRows }) => {
  const lines = [title, "", intro];
  if (items.length) {
    lines.push("", "Items");
    items.forEach((item) => {
      lines.push([item.name, item.quantity ? `x${item.quantity}` : "", item.price].filter(Boolean).join(" - "));
    });
  }
  if (summaryRows.length) {
    lines.push("", "Order summary");
    summaryRows.forEach((item) => lines.push(`${item.label}: ${item.value}`));
  }
  if (refundRows.length) {
    lines.push("", "Refund details");
    refundRows.forEach((item) => lines.push(`${item.label}: ${item.value}`));
  }
  if (orderRows.length) {
    lines.push("", "Order details");
    orderRows.forEach((item) => lines.push(`${item.label}: ${item.value}`));
  }
  if (payload.customerNote || payload.note) {
    lines.push("", "Customer note", payload.customerNote || payload.note);
  }
  return lines.join("\n");
};

function buildOrderEmailTemplate({ subject, message, payload = {}, recipientType = "customer", eventName }) {
  const resolvedEventName = eventName || payload.eventName;
  const copy = resolveOrderEmailCopy({ eventName: resolvedEventName, subject, message, payload, recipientType });
  const recipientName = recipientNameOf(payload, recipientType);
  const greeting = recipientName ? `Hi ${recipientName},` : "";
  const items = orderItemsOf(payload);
  const summaryRows = orderSummaryRowsOf(payload);
  const refundRows = refundRowsOf(payload);
  const orderRows = orderRowsOf(payload);
  const shippingAddress = payload.shippingAddress || payload.shipping_address || {};
  const billingAddress = payload.billingAddress || payload.billing_address || {};
  const rawCtaUrl = toAbsoluteUrl(payload.viewUrl || "", recipientType);
  const ctaUrl = containsPrivateReference(rawCtaUrl) ? "" : rawCtaUrl;
  const ctaText = recipientType === "seller"
    ? "View order"
    : recipientType === "admin"
      ? "Open order"
      : "View order";

  const orderHeading = [
    orderReferenceOf(payload) ? `Order ${orderReferenceOf(payload)}` : "",
    orderDateOf(payload) ? `(${orderDateOf(payload)})` : "",
  ].filter(Boolean).join(" ");
  const orderRef = orderReferenceOf(payload);
  const preheader = [
    copy.title,
    orderRef ? `Order ${orderRef}` : "",
    moneyOf(payload, "payableAmount", "payable_amount", "totalAmount", "total_amount", "amount"),
  ].filter(Boolean).join(" - ");

  const html = `<!doctype html>
  <html>
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(copy.title)}</title>
    </head>
    <body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      ${hiddenPreheader(preheader)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:30px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #d9dee8;border-radius:12px;overflow:hidden;">
              <tr>
                <td style="background:#1b1d60;padding:24px 28px;">
                  <div style="font-size:12px;line-height:1.3;color:#f5c542;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(brandName)}</div>
                  <h1 style="margin:12px 0 0;font-size:22px;line-height:1.3;color:#ffffff;">${escapeHtml(copy.title)}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:28px;">
                  ${orderRef ? `<p style="margin:0 0 20px;"><span style="display:inline-block;background:#f4f6fb;border:1px solid #d9dee8;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:700;color:#1b1d60;">Order Reference: ${escapeHtml(orderRef)}</span></p>` : ""}
                  ${greeting ? `<p style="margin:0 0 10px;font-size:15px;color:#344054;">${escapeHtml(greeting)}</p>` : ""}
                  <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#344054;">${escapeHtml(copy.intro)}</p>
                  ${items.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderSectionTitle("Items in this order")}<tr><td>${renderProductsTable(items)}</td></tr></table>` : ""}
                  ${summaryRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderSectionTitle(orderHeading || "Order summary")}<tr><td>${renderKeyValueRows(summaryRows)}</td></tr></table>` : ""}
                  ${refundRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderSectionTitle("Refund details")}<tr><td>${renderKeyValueRows(refundRows)}</td></tr></table>` : ""}
                  ${orderRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderSectionTitle("Order details")}<tr><td>${renderKeyValueRows(orderRows)}</td></tr></table>` : ""}
                  ${renderBlock("Customer note", payload.customerNote || payload.note)}
                  ${renderAddress("Billing address", billingAddress)}
                  ${renderAddress("Shipping address", shippingAddress)}
                  ${
                    ctaUrl
                      ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#d7a316;color:#111827;text-decoration:none;border-radius:7px;padding:12px 18px;font-weight:700;font-size:14px;">${escapeHtml(ctaText)}</a></p>`
                      : ""
                  }
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border-top:1px solid #eef0f4;">
                    <tr>
                      <td style="padding-top:16px;font-size:12px;line-height:1.6;color:#667085;">
                        This is an automated transactional email from ${escapeHtml(brandName)}.
                        ${supportEmail ? `For assistance, contact ${escapeHtml(supportEmail)}.` : "Please contact customer support if you need assistance."}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <p style="max-width:680px;margin:14px auto 0;font-size:11px;line-height:1.5;color:#98a2b3;text-align:center;">
              Please do not share order or payment information with anyone claiming to represent ${escapeHtml(brandName)} outside official support channels.
            </p>
          </td>
        </tr>
      </table>
    </body>
  </html>`;

  return {
    subject: copy.title,
    text: plainTextSections({ title: copy.title, intro: [greeting, copy.intro].filter(Boolean).join("\n\n"), payload, items, summaryRows, refundRows, orderRows }),
    html,
  };
}

const ORDER_EMAIL_EVENTS = new Set([
  DOMAIN_EVENTS.ORDER_CREATED_V1,
  DOMAIN_EVENTS.ORDER_PAID_V1,
  DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1,
  DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1,
  DOMAIN_EVENTS.ORDER_CANCELLED_V1,
  DOMAIN_EVENTS.RETURN_REFUNDED_V1,
  DOMAIN_EVENTS.REFUND_PROCESSED_V1,
  DOMAIN_EVENTS.REFUND_FAILED_V1,
  DOMAIN_EVENTS.PAYMENT_REFUNDED_V1,
]);

function isOrderEmailEvent(eventName, payload = {}) {
  return ORDER_EMAIL_EVENTS.has(eventName || payload.eventName);
}

module.exports = {
  buildOrderEmailTemplate,
  isOrderEmailEvent,
  helpers: {
    escapeHtml,
    humanize,
    formatMoney,
    toAbsoluteUrl,
    row,
    compactRows,
    publicValue,
    containsPrivateReference,
  },
};
