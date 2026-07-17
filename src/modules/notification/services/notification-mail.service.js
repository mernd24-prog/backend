const { sendMail } = require("../../../infrastructure/mail/mailer");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { logger } = require("../../../shared/logger/logger");

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

const formatMoney = (value, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

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

const referenceOf = (payload = {}) =>
  payload.orderNumber ||
  payload.orderId ||
  payload.returnNumber ||
  payload.returnId ||
  payload.payoutId ||
  "";

const displayReferenceOf = (payload = {}) =>
  payload.orderNumber ||
  payload.returnNumber ||
  payload.returnId ||
  payload.payoutId ||
  "";

const itemCountOf = (payload = {}) => {
  if (payload.itemCount !== undefined) return payload.itemCount;
  if (payload.itemsCount !== undefined) return payload.itemsCount;
  if (Array.isArray(payload.items)) return payload.items.length;
  return "";
};

const productNamesOf = (payload = {}) => {
  const names = [];
  const add = (value) => {
    const name = String(value || "").trim();
    if (name && !names.includes(name)) names.push(name);
  };

  add(payload.productName || payload.product_name || payload.productTitle || payload.product_title);
  (Array.isArray(payload.items) ? payload.items : []).forEach((item) => {
    add(item.productName || item.product_name || item.productTitle || item.product_title || item.title || item.name);
  });

  return names;
};

const productSummaryOf = (payload = {}) => {
  const names = productNamesOf(payload);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  return `${names[0]} + ${names.length - 1} more`;
};

const amountOf = (payload = {}) =>
  payload.netAmount ||
  payload.payableAmount ||
  payload.totalAmount ||
  payload.grandTotal ||
  payload.refundAmount ||
  payload.amount ||
  "";

const row = (label, value) =>
  value !== undefined && value !== null && value !== "" ? { label, value } : null;

const orderRows = (payload = {}) => {
  const currency = payload.currency || "INR";
  return [
    row("Product", productSummaryOf(payload)),
    row("Order Reference", payload.orderNumber),
    row("Order Status", humanize(payload.status || payload.orderStatus)),
    row("Payment Status", humanize(payload.paymentStatus || payload.payment_status)),
    row("Items", itemCountOf(payload)),
    row("Amount", amountOf(payload) ? formatMoney(amountOf(payload), currency) : ""),
  ].filter(Boolean);
};

const returnRows = (payload = {}) => {
  const currency = payload.currency || "INR";
  return [
    row("Return ID", payload.returnNumber || payload.returnId),
    row("Order ID", payload.orderNumber || payload.orderId),
    row("Status", humanize(payload.status)),
    row("Refund Amount", amountOf(payload) ? formatMoney(amountOf(payload), currency) : ""),
    row("Reason", payload.reason || payload.rejectionReason),
  ].filter(Boolean);
};

const payoutRows = (payload = {}) => {
  const currency = payload.currency || "INR";
  return [
    row("Payout ID", payload.payoutId),
    row("Status", humanize(payload.status)),
    row("Amount", amountOf(payload) ? formatMoney(amountOf(payload), currency) : ""),
    row("Reference", payload.referenceId || payload.paymentReference || payload.utr),
  ].filter(Boolean);
};

const onboardingRows = (payload = {}) => [
  row("Status", humanize(payload.status || payload.verificationStatus || payload.approvalStatus)),
  row("Business", payload.legalName || payload.legalBusinessName || payload.storeDisplayName),
  row("Reason", payload.rejectionReason || payload.reason),
].filter(Boolean);

const defaultRows = (payload = {}) => {
  const reference = displayReferenceOf(payload);
  const status = humanize(payload.status || payload.verificationStatus || payload.approvalStatus);
  const amount = amountOf(payload);
  const currency = payload.currency || "INR";
  return [
    row("Reference", reference),
    row("Status", status),
    row("Amount", amount ? formatMoney(amount, currency) : ""),
    row("Reason", payload.reason || payload.rejectionReason),
  ].filter(Boolean);
};

const eventCopy = ({ eventName, subject, message, payload = {}, recipientType = "customer" }) => {
  const orderRef = payload.orderNumber || payload.orderId || "your order";
  const productSummary = productSummaryOf(payload);
  const productText = productSummary ? ` for ${productSummary}` : "";
  const returnRef = payload.returnNumber || payload.returnId || "your return request";
  const payoutRef = payload.payoutId || "your payout";

  const copy = {
    [DOMAIN_EVENTS.ORDER_CREATED_V1]: {
      title: recipientType === "seller" ? "New Order Received" : "Order Received",
      intro:
        recipientType === "seller"
          ? `A new order${productText} has been placed. Please review the order details in your seller panel.`
          : `Thanks for shopping with Sam Global. We have received your order${productText}.`,
      rows: orderRows(payload),
      ctaText: "View order",
    },
    [DOMAIN_EVENTS.ORDER_PAID_V1]: {
      title: recipientType === "seller" ? "New Order Received" : "Order Confirmed",
      intro:
        recipientType === "seller"
          ? `You have received a paid order${productText}. Please review it and start processing.`
          : `Your order${productText} is confirmed. Payment has been received and we are preparing it for processing.`,
      rows: orderRows(payload),
      ctaText: "View order",
    },
    [DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1]: {
      title: "Payment Failed",
      intro: `Payment could not be completed for this order${productText}. Please review the order details.`,
      rows: orderRows(payload),
      ctaText: "View order",
    },
    [DOMAIN_EVENTS.ORDER_CANCELLED_V1]: {
      title: "Order Cancelled",
      intro: `This order${productText} has been cancelled. The details are listed below for your reference.`,
      rows: orderRows(payload),
      ctaText: "View order",
    },
    [DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1]: {
      title: "Order Status Updated",
      intro: `This order${productText} is now ${humanize(payload.status || payload.orderStatus) || "updated"}.`,
      rows: orderRows(payload),
      ctaText: "View order",
    },
    [DOMAIN_EVENTS.RETURN_REQUESTED_V1]: {
      title: recipientType === "seller" ? "Return Requested" : "Return Request Received",
      intro:
        recipientType === "seller"
          ? `A return has been requested for order ${payload.orderNumber || payload.orderId || ""}.`
          : `We have received your return request ${returnRef}.`,
      rows: returnRows(payload),
      ctaText: "View return",
    },
    [DOMAIN_EVENTS.RETURN_APPROVED_V1]: {
      title: "Return Approved",
      intro: `Return request ${returnRef} has been approved.`,
      rows: returnRows(payload),
      ctaText: "View return",
    },
    [DOMAIN_EVENTS.RETURN_REJECTED_V1]: {
      title: "Return Rejected",
      intro: `Return request ${returnRef} has been rejected. Please check the reason below.`,
      rows: returnRows(payload),
      ctaText: "View return",
    },
    [DOMAIN_EVENTS.RETURN_RECEIVED_V1]: {
      title: "Return Received",
      intro: `Return ${returnRef} has been received and is being checked.`,
      rows: returnRows(payload),
      ctaText: "View return",
    },
    [DOMAIN_EVENTS.RETURN_REFUNDED_V1]: {
      title: "Return Refunded",
      intro: `Refund has been processed for return ${returnRef}.`,
      rows: returnRows(payload),
      ctaText: "View return",
    },
    [DOMAIN_EVENTS.REFUND_PROCESSED_V1]: {
      title: "Refund Processed",
      intro: "Your refund has been processed successfully.",
      rows: returnRows(payload),
      ctaText: "View details",
    },
    [DOMAIN_EVENTS.REFUND_FAILED_V1]: {
      title: "Refund Failed",
      intro: "We could not process the refund. Please review the details below.",
      rows: returnRows(payload),
      ctaText: "View details",
    },
    [DOMAIN_EVENTS.SELLER_ORGANIZATION_STATUS_UPDATED_V1]: {
      title: subject || "Seller Onboarding Update",
      intro: message || "There is an update on your seller onboarding status.",
      rows: onboardingRows(payload),
      ctaText: "View status",
    },
    [DOMAIN_EVENTS.KYC_STATUS_UPDATED_V1]: {
      title: subject || "Seller Verification Update",
      intro: message || "There is an update on your seller verification status.",
      rows: onboardingRows(payload),
      ctaText: "View status",
    },
    [DOMAIN_EVENTS.SELLER_PAYOUT_STATUS_UPDATED_V1]: {
      title: "Payout Update",
      intro: `Payout ${payoutRef} is now ${humanize(payload.status) || "updated"}.`,
      rows: payoutRows(payload),
      ctaText: "View payout",
    },
  };

  return copy[eventName] || {
    title: subject || "Sam Global Update",
    intro: message || "There is a new update on your Sam Global account.",
    rows: defaultRows(payload),
    ctaText: recipientType === "seller" ? "Open seller panel" : "View details",
  };
};

const wrapEmail = ({ title, intro, rows = [], ctaText = "View details", ctaUrl = "" }) => {
  const detailRows = rows
    .filter((row) => row?.value !== undefined && row?.value !== null && row?.value !== "")
    .map(
      (row) => `
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;">${escapeHtml(row.label)}</td>
          <td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
  <html>
    <body style="margin:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:28px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
              <tr>
                <td style="background:#1b1d60;color:#ffffff;padding:22px 26px;">
                  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#f3c950;">Sam Global</div>
                  <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">${escapeHtml(title)}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 26px;">
                  <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(intro)}</p>
                  ${
                    detailRows
                      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f4;border-bottom:1px solid #eef0f4;margin:18px 0;">${detailRows}</table>`
                      : ""
                  }
                  ${
                    ctaUrl
                      ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#d8a820;color:#111827;text-decoration:none;border-radius:8px;padding:11px 16px;font-weight:700;font-size:14px;">${escapeHtml(ctaText)}</a></p>`
                      : ""
                  }
                  <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">This is an automated update from Sam Global. Please do not reply to this email.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
};

const buildTemplate = ({ subject, message, payload = {}, recipientType = "customer", eventName }) => {
  const resolvedEventName = eventName || payload.eventName;
  const { title, intro, rows, ctaText } = eventCopy({
    eventName: resolvedEventName,
    subject,
    message,
    payload,
    recipientType,
  });
  const reference = displayReferenceOf(payload);
  const status = humanize(payload.status || payload.verificationStatus || payload.approvalStatus);
  const ctaUrl = toAbsoluteUrl(payload.viewUrl || "", recipientType);

  return {
    subject: title,
    text: `${title}\n\n${intro}${reference ? `\nReference: ${reference}` : ""}${status ? `\nStatus: ${status}` : ""}`,
    html: wrapEmail({
      title,
      intro,
      rows,
      ctaText,
      ctaUrl,
    }),
  };
};

class NotificationMailService {
  async sendTemplatedMail({ to, subject, message, payload = {}, recipientType, eventName }) {
    if (!to) return null;
    const template = buildTemplate({ subject, message, payload, recipientType, eventName });
    try {
      return await sendMail({
        to,
        subject: template.subject,
        text: template.text,
        html: template.html,
      });
    } catch (error) {
      logger.error({ err: error, to, subject }, "Templated notification email failed");
      return null;
    }
  }
}

module.exports = {
  NotificationMailService,
  notificationMailService: new NotificationMailService(),
  buildTemplate,
};
