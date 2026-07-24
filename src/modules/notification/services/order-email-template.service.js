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
  firstValue(payload.orderNumber, payload.order_number, payload.orderId, payload.order_id);

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
  row("Refund reference", firstValue(payload.refundReferenceId, payload.refund_reference_id, payload.referenceId, payload.reference_id)),
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
      title: "Thank you for your order",
      intro: `We have received your order ${orderRef}${productText}, and it is now being processed.`,
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
      title: "Thank you for your order",
      intro: `We have received your order ${orderRef}${productText}.`,
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
    <td style="padding:22px 0 8px;font-size:16px;font-weight:700;color:#111827;">${escapeHtml(title)}</td>
  </tr>`;

const renderKeyValueRows = (rows = []) => {
  const html = compactRows(rows)
    .map((item) => `
      <tr>
        <td style="padding:7px 0;color:#6b7280;font-size:13px;">${escapeHtml(item.label)}</td>
        <td style="padding:7px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(item.value)}</td>
      </tr>`)
    .join("");
  if (!html) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f4;border-bottom:1px solid #eef0f4;">${html}</table>`;
};

const renderProductsTable = (items = []) => {
  if (!items.length) return "";
  const rows = items.map((item) => `
    <tr>
      <td style="padding:10px 0;border-top:1px solid #eef0f4;">
        <div style="font-size:14px;font-weight:700;color:#111827;">${escapeHtml(item.name)}</div>
        ${item.meta ? `<div style="margin-top:3px;font-size:12px;color:#6b7280;">${escapeHtml(item.meta)}</div>` : ""}
      </td>
      <td style="padding:10px 0;border-top:1px solid #eef0f4;text-align:center;font-size:13px;color:#111827;">${escapeHtml(item.quantity)}</td>
      <td style="padding:10px 0;border-top:1px solid #eef0f4;text-align:right;font-size:13px;color:#111827;font-weight:600;">${escapeHtml(item.price)}</td>
    </tr>`).join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <th align="left" style="padding:6px 0;color:#6b7280;font-size:12px;font-weight:700;">Product</th>
        <th align="center" style="padding:6px 0;color:#6b7280;font-size:12px;font-weight:700;">Quantity</th>
        <th align="right" style="padding:6px 0;color:#6b7280;font-size:12px;font-weight:700;">Price</th>
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
        <td style="font-size:13px;line-height:1.65;color:#374151;">${lines.map(escapeHtml).join("<br>")}</td>
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
  const ctaUrl = toAbsoluteUrl(payload.viewUrl || "", recipientType);
  const ctaText = recipientType === "seller"
    ? "View order"
    : recipientType === "admin"
      ? "Open order"
      : "View order";

  const orderHeading = [
    orderReferenceOf(payload) ? `Order ${orderReferenceOf(payload)}` : "",
    orderDateOf(payload) ? `(${orderDateOf(payload)})` : "",
  ].filter(Boolean).join(" ");

  const html = `<!doctype html>
  <html>
    <body style="margin:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:28px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
              <tr>
                <td style="background:#1b1d60;color:#ffffff;padding:22px 26px;">
                  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#f3c950;">Sam Global</div>
                  <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">${escapeHtml(copy.title)}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 26px;">
                  ${greeting ? `<p style="margin:0 0 10px;font-size:15px;color:#374151;">${escapeHtml(greeting)}</p>` : ""}
                  <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(copy.intro)}</p>
                  ${items.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderSectionTitle("Here is what was ordered")}<tr><td>${renderProductsTable(items)}</td></tr></table>` : ""}
                  ${summaryRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderSectionTitle(orderHeading || "Order summary")}<tr><td>${renderKeyValueRows(summaryRows)}</td></tr></table>` : ""}
                  ${refundRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderSectionTitle("Refund details")}<tr><td>${renderKeyValueRows(refundRows)}</td></tr></table>` : ""}
                  ${orderRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${renderSectionTitle("Order details")}<tr><td>${renderKeyValueRows(orderRows)}</td></tr></table>` : ""}
                  ${renderBlock("Customer note", payload.customerNote || payload.note)}
                  ${renderAddress("Billing address", billingAddress)}
                  ${renderAddress("Shipping address", shippingAddress)}
                  ${
                    ctaUrl
                      ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(ctaUrl)}" style="color:#2563eb;text-decoration:underline;font-weight:600;font-size:14px;">${escapeHtml(ctaText)}</a></p>`
                      : ""
                  }
                  <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">Thanks again. This is an automated update from Sam Global.</p>
                </td>
              </tr>
            </table>
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
  },
};
