const { sendMail } = require("../../../infrastructure/mail/mailer");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { logger } = require("../../../shared/logger/logger");
const {
  buildOrderEmailTemplate,
  isOrderEmailEvent,
  helpers,
} = require("./order-email-template.service");

const { escapeHtml, humanize, formatMoney, toAbsoluteUrl, row } = helpers;
const brandName = process.env.BRAND_NAME || process.env.APP_NAME || "Sam Global";
const supportEmail = process.env.SUPPORT_EMAIL || process.env.REPLY_TO_EMAIL || "";

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

const productDetailsOf = (payload = {}) => {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const details = items
    .map((item) => {
      const name = item.productName || item.product_name || item.productTitle || item.product_title || item.title || item.name;
      if (!name) return "";
      const variant = item.variantTitle || item.variant_title;
      const sku = item.productSku || item.product_sku || item.sku;
      const quantity = Number(item.quantity || 0);
      return [
        name,
        variant ? `(${variant})` : "",
        sku ? `SKU: ${sku}` : "",
        quantity ? `Qty: ${quantity}` : "",
      ].filter(Boolean).join(" ");
    })
    .filter(Boolean);
  if (!details.length) return productSummaryOf(payload);
  if (details.length <= 4) return details.join(", ");
  return `${details.slice(0, 4).join(", ")} + ${details.length - 4} more`;
};

const amountOf = (payload = {}) =>
  payload.netAmount ||
  payload.payableAmount ||
  payload.totalAmount ||
  payload.grandTotal ||
  payload.refundAmount ||
  payload.amount ||
  "";

const addressSummaryOf = (address = {}) =>
  [
    address.line1 || address.addressLine1 || address.address_line1,
    address.line2 || address.addressLine2 || address.address_line2,
    address.city,
    address.state,
    address.postalCode || address.postal_code || address.pincode,
    address.country,
  ].filter(Boolean).join(", ");

const orderRows = (payload = {}, recipientType = "customer") => {
  const currency = payload.currency || "INR";
  const shippingAddress = payload.shippingAddress || payload.shipping_address || {};
  const customerName = payload.customerName || payload.buyerName || shippingAddress.fullName;
  const customerEmail = payload.customerEmail || payload.buyerEmail;
  const customerPhone = payload.customerPhone || payload.buyerPhone || shippingAddress.phone;
  return [
    recipientType === "seller" ? row("Customer", customerName) : row("Customer Name", customerName),
    recipientType === "seller" ? row("Customer Email", customerEmail) : null,
    recipientType === "seller" ? row("Customer Phone", customerPhone) : row("Contact Phone", customerPhone),
    row("Products", productDetailsOf(payload)),
    row("Order Reference", payload.orderNumber),
    row("Previous Status", humanize(payload.previousStatus || payload.previous_status)),
    row("Order Status", humanize(payload.status || payload.orderStatus)),
    row("Payment Status", humanize(payload.paymentStatus || payload.payment_status)),
    row("Tracking Number", payload.trackingNumber || payload.tracking_number),
    row("Carrier", payload.carrierName || payload.carrier_name),
    row("Reason", payload.reason),
    row("Items", itemCountOf(payload)),
    row("Amount", amountOf(payload) ? formatMoney(amountOf(payload), currency) : ""),
    row("Delivery Address", addressSummaryOf(shippingAddress)),
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
  row("Seller", payload.sellerName || payload.legalName || payload.legalBusinessName || payload.storeDisplayName),
  row("Email", payload.email || payload.sellerEmail || payload.seller_email),
  row("Phone", payload.phone || payload.sellerPhone || payload.seller_phone),
  row("Organization", payload.legalBusinessName || payload.storeDisplayName),
  row("Status", humanize(payload.status || payload.verificationStatus || payload.approvalStatus)),
  row("KYC status", humanize(payload.kycStatus)),
  row("Bank status", humanize(payload.bankVerificationStatus)),
  row("Go-live status", humanize(payload.goLiveStatus)),
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
    [DOMAIN_EVENTS.AUTH_USER_REGISTERED_V1]: {
      title: recipientType === "admin" ? "New Seller Account Created" : "Welcome to Sam Global",
      intro:
        recipientType === "admin"
          ? `${payload.sellerName || payload.email || "A seller"} created a seller account. Please review the seller onboarding status in the admin panel.`
          : "Your account has been created successfully.",
      rows: onboardingRows(payload),
      ctaText: recipientType === "admin" ? "Review seller" : "Open account",
    },
    [DOMAIN_EVENTS.SELLER_KYC_SUBMITTED_V1]: {
      title: "Seller Onboarding Submitted",
      intro: `${payload.legalName || payload.sellerName || "A seller"} has submitted onboarding details and is ready for review.`,
      rows: onboardingRows(payload),
      ctaText: "Review onboarding",
    },
    [DOMAIN_EVENTS.SELLER_ORGANIZATION_CREATED_V1]: {
      title: "Seller Organization Submitted",
      intro: `${payload.legalBusinessName || payload.storeDisplayName || "A seller organization"} has been submitted for review.`,
      rows: onboardingRows(payload),
      ctaText: "Review organization",
    },
    [DOMAIN_EVENTS.ORDER_CREATED_V1]: {
      title: recipientType === "seller" ? "New Order Received" : "Order Received",
      intro:
        recipientType === "seller"
          ? `A new order${productText} has been placed. Please review the order details in your seller panel.`
          : `Thanks for shopping with Sam Global. We have received your order${productText}.`,
      rows: orderRows(payload, recipientType),
      ctaText: "View order",
    },
    [DOMAIN_EVENTS.ORDER_PAID_V1]: {
      title: recipientType === "seller" ? "New Order Received" : "Order Confirmed",
      intro:
        recipientType === "seller"
          ? `You have received a paid order${productText}. Please review it and start processing.`
          : `Your order${productText} is confirmed. Payment has been received and we are preparing it for processing.`,
      rows: orderRows(payload, recipientType),
      ctaText: "View order",
    },
    [DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1]: {
      title: "Payment Failed",
      intro: `Payment could not be completed for this order${productText}. Please review the order details.`,
      rows: orderRows(payload, recipientType),
      ctaText: "View order",
    },
    [DOMAIN_EVENTS.ORDER_CANCELLED_V1]: {
      title: "Order Cancelled",
      intro: `This order${productText} has been cancelled. The details are listed below for your reference.`,
      rows: orderRows(payload, recipientType),
      ctaText: "View order",
    },
    [DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1]: {
      title: "Order Status Updated",
      intro: `This order${productText} is now ${humanize(payload.status || payload.orderStatus) || "updated"}.`,
      rows: orderRows(payload, recipientType),
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
      title: subject || (String(payload.status || "") === "rejected" ? "Seller Onboarding Rejected" : "Seller Onboarding Approved"),
      intro: message || (String(payload.status || "") === "rejected"
        ? "Your seller onboarding was not approved. Please review the details and resubmit the requested information."
        : "Your seller onboarding has been approved. You can continue with your seller account setup."),
      rows: onboardingRows(payload),
      ctaText: "View status",
    },
    [DOMAIN_EVENTS.KYC_STATUS_UPDATED_V1]: {
      title: subject || (String(payload.verificationStatus || payload.status || "") === "rejected" ? "Seller Verification Rejected" : "Seller Verification Approved"),
      intro: message || (String(payload.verificationStatus || payload.status || "") === "rejected"
        ? "Your seller verification was not approved. Please review the reason below and submit the requested changes."
        : "Your seller verification has been approved."),
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
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #d9dee8;border-radius:8px;overflow:hidden;">
              <tr>
                <td style="background:#ffffff;border-top:4px solid #1b1d60;border-bottom:1px solid #eef0f4;padding:22px 26px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:18px;font-weight:800;color:#1b1d60;">${escapeHtml(brandName)}</td>
                      <td align="right" style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em;">Official Notification</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 26px;">
                  <h1 style="margin:0 0 12px;font-size:23px;line-height:1.25;color:#111827;">${escapeHtml(title)}</h1>
                  <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#344054;">${escapeHtml(intro)}</p>
                  ${
                    detailRows
                      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f4;border-bottom:1px solid #eef0f4;margin:18px 0;">${detailRows}</table>`
                      : ""
                  }
                  ${
                    ctaUrl
                      ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#1b1d60;color:#ffffff;text-decoration:none;border-radius:6px;padding:12px 18px;font-weight:700;font-size:14px;">${escapeHtml(ctaText)}</a></p>`
                      : ""
                  }
                  <p style="margin:24px 0 0;border-top:1px solid #eef0f4;padding-top:16px;font-size:12px;line-height:1.6;color:#667085;">
                    This is an automated transactional email from ${escapeHtml(brandName)}.
                    ${supportEmail ? `For assistance, contact ${escapeHtml(supportEmail)}.` : "Please contact support if you need assistance."}
                  </p>
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
  if (isOrderEmailEvent(eventName, payload)) {
    return buildOrderEmailTemplate({ subject, message, payload, recipientType, eventName });
  }

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
  const detailText = (rows || [])
    .filter((row) => row?.value !== undefined && row?.value !== null && row?.value !== "")
    .map((row) => `${row.label}: ${row.value}`)
    .join("\n");

  return {
    subject: title,
    text: `${title}\n\n${intro}${detailText ? `\n\n${detailText}` : ""}${!detailText && reference ? `\nReference: ${reference}` : ""}${!detailText && status ? `\nStatus: ${status}` : ""}`,
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
      const result = await sendMail({
        to,
        subject: template.subject,
        text: template.text,
        html: template.html,
      });
      logger.info({
        to,
        subject: template.subject,
        eventName,
        recipientType,
        messageId: result?.messageId,
        accepted: result?.accepted,
        rejected: result?.rejected,
        response: result?.response,
      }, "Templated notification email sent");
      return result;
    } catch (error) {
      logger.error({ err: error, to, subject }, "Templated notification email failed");
      throw error;
    }
  }
}

module.exports = {
  NotificationMailService,
  notificationMailService: new NotificationMailService(),
  buildTemplate,
};
