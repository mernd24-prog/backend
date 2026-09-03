const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");

const brandName = process.env.BRAND_NAME || process.env.APP_NAME || "Sam Global";
const supportEmail = process.env.SUPPORT_EMAIL || process.env.REPLY_TO_EMAIL || "";

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

const publicOrderReference = (payload = {}) =>
  publicValue(payload.orderNumber, payload.order_number, payload.publicOrderNumber, payload.displayOrderNumber);

const publicReturnReference = (payload = {}) =>
  publicValue(payload.returnNumber, payload.return_number, payload.publicReturnNumber);

const publicPayoutReference = (payload = {}) =>
  publicValue(payload.payoutNumber, payload.payout_number, payload.referenceId, payload.reference_id, payload.utr);

const moneyOf = (payload = {}, ...keys) => {
  const key = keys.find((candidate) => payload[candidate] !== undefined && payload[candidate] !== null && payload[candidate] !== "");
  return key ? formatMoney(payload[key], payload.currency || "INR") : "";
};

const businessNameOf = (payload = {}) =>
  firstValue(
    payload.businessName,
    payload.legalBusinessName,
    payload.storeDisplayName,
    payload.sellerName,
    payload.legalName,
    payload.sellerProfile?.displayName,
    payload.sellerProfile?.businessName,
  );

const customerNameOf = (payload = {}) => {
  const shippingAddress = payload.shippingAddress || payload.shipping_address || {};
  return firstValue(payload.customerName, payload.buyerName, payload.name, shippingAddress.fullName);
};

const partnerNameOf = (payload = {}) =>
  firstValue(payload.partnerName, payload.referrerName, payload.influencerName, payload.profile?.firstName);

const orderRows = (payload = {}) => compactRows([
  row("Order", publicOrderReference(payload)),
  row("Status", humanize(firstValue(payload.status, payload.orderStatus))),
  row("Payment status", humanize(firstValue(payload.paymentStatus, payload.payment_status))),
  row("Payment method", humanize(firstValue(payload.paymentProvider, payload.payment_provider))),
  row("Total", moneyOf(payload, "payableAmount", "payable_amount", "totalAmount", "total_amount", "amount")),
  row("Tracking number", publicValue(payload.trackingNumber, payload.tracking_number)),
  row("Carrier", firstValue(payload.carrierName, payload.carrier_name)),
  row("Reason", firstValue(payload.reason, payload.cancellationReason, payload.rejectionReason)),
]);

const returnRows = (payload = {}) => compactRows([
  row("Return", publicReturnReference(payload)),
  row("Order", publicOrderReference(payload)),
  row("Status", humanize(firstValue(payload.status, payload.returnStatus))),
  row("Refund amount", moneyOf(payload, "refundAmount", "refund_amount", "amount")),
  row("Refund method", humanize(firstValue(payload.refundMethod, payload.refund_method, payload.method))),
  row("Reason", firstValue(payload.reason, payload.rejectionReason, payload.failureReason)),
]);

const sellerRows = (payload = {}) => compactRows([
  row("Business", businessNameOf(payload)),
  row("Status", humanize(firstValue(payload.status, payload.verificationStatus, payload.approvalStatus))),
  row("KYC status", humanize(payload.kycStatus)),
  row("Bank status", humanize(payload.bankVerificationStatus)),
  row("Go-live status", humanize(payload.goLiveStatus)),
  row("Reason", firstValue(payload.rejectionReason, payload.reason)),
]);

const payoutRows = (payload = {}) => compactRows([
  row("Payout", publicPayoutReference(payload)),
  row("Status", humanize(payload.status)),
  row("Amount", moneyOf(payload, "amount", "netAmount", "payoutAmount")),
  row("Reference", publicValue(payload.paymentReference, payload.utr, payload.referenceNumber)),
]);

const supportRows = (payload = {}) => compactRows([
  row("Ticket", publicValue(payload.queryId, payload.ticketNumber, payload.ticketNo)),
  row("Category", humanize(payload.category)),
  row("Status", humanize(payload.status)),
  row("Subject", payload.subject),
]);

const growthRows = (payload = {}) => compactRows([
  row("Program", "Growth Partner"),
  row("Reward", moneyOf(payload, "rewardAmount", "referrerRewardAmount", "amount", "commissionAmount")),
  row("Status", humanize(firstValue(payload.status, payload.rewardStatus))),
  row("Reason", firstValue(payload.reason, payload.adjustmentReason)),
]);

const inventoryRows = (payload = {}) => compactRows([
  row("Product", firstValue(payload.productName, payload.productTitle, payload.title)),
  row("SKU", publicValue(payload.sku, payload.variantSku)),
  row("Available stock", payload.available),
  row("Threshold", payload.threshold),
]);

const authRows = (payload = {}) => compactRows([
  row("Action", humanize(payload.action || payload.purpose)),
  row("Account", payload.email),
]);

const EMAIL_TEMPLATE_DEFINITIONS = {
  auth_otp: {
    subject: "Your Sam Global verification code",
    title: "Verification Code",
    intro: ({ otp, purpose }) => `Use ${otp} to complete ${humanize(purpose) || "verification"}. This code will expire soon.`,
    rows: authRows,
    ctaText: "",
  },
  auth_password_changed: {
    subject: "Your Sam Global password was changed",
    title: "Password Changed",
    intro: () => "Your account password was changed successfully. If this was not you, contact support immediately.",
    rows: authRows,
  },
  account_welcome: {
    subject: "Welcome to Sam Global",
    title: "Welcome to Sam Global",
    intro: () => "Your account is ready. You can now continue shopping or managing your Sam Global account.",
    rows: authRows,
  },
  seller_account_created_admin: {
    subject: "New Seller Account Created",
    title: "New Seller Account Created",
    intro: ({ sellerName, email }) => `${sellerName || email || "A seller"} created a seller account and is waiting for onboarding review.`,
    rows: sellerRows,
    ctaText: "Review seller",
  },
  seller_onboarding_submitted_admin: {
    subject: "Seller Onboarding Submitted",
    title: "Seller Onboarding Submitted",
    intro: ({ legalName, sellerName }) => `${legalName || sellerName || "A seller"} completed onboarding and is ready for review.`,
    rows: sellerRows,
    ctaText: "Review onboarding",
  },
  seller_onboarding_approved: {
    subject: "Seller Onboarding Approved",
    title: "Seller Onboarding Approved",
    intro: () => "Your seller onboarding has been approved. You can continue selling on Sam Global.",
    rows: sellerRows,
    ctaText: "View status",
  },
  seller_onboarding_rejected: {
    subject: "Seller Onboarding Rejected",
    title: "Seller Onboarding Rejected",
    intro: ({ rejectionReason, reason }) => `Your seller onboarding was not approved. ${rejectionReason || reason || "Please review the requested changes and resubmit."}`,
    rows: sellerRows,
    ctaText: "View status",
  },
  order_created_customer: {
    subject: "Order Received",
    title: "Order Received",
    intro: ({ orderNumber }) => `Your order ${publicValue(orderNumber) || ""} has been received. We will notify you when it moves to the next stage.`,
    rows: orderRows,
    ctaText: "View order",
  },
  order_paid_customer: {
    subject: "Order Confirmed",
    title: "Order Confirmed",
    intro: ({ orderNumber }) => `Your order ${publicValue(orderNumber) || ""} has been confirmed. Payment has been received.`,
    rows: orderRows,
    ctaText: "View order",
  },
  order_received_seller: {
    subject: "New Order Received",
    title: "New Order Received",
    intro: ({ paymentProvider }) => `${String(paymentProvider || "").toLowerCase() === "cash_on_delivery" ? "A COD order" : "A confirmed order"} is ready for processing.`,
    rows: orderRows,
    ctaText: "View order",
  },
  order_status_updated_customer: {
    subject: "Order Status Updated",
    title: "Order Status Updated",
    intro: ({ status }) => `Your order is now ${humanize(status) || "updated"}.`,
    rows: orderRows,
    ctaText: "View order",
  },
  payment_failed_customer: {
    subject: "Payment Failed",
    title: "Payment Failed",
    intro: () => "Payment could not be completed for this order. Please try again or use another payment method.",
    rows: orderRows,
    ctaText: "Retry payment",
  },
  order_cancelled: {
    subject: "Order Cancelled",
    title: "Order Cancelled",
    intro: () => "This order has been cancelled. The details are listed below for your reference.",
    rows: orderRows,
    ctaText: "View order",
  },
  return_requested: {
    subject: "Return Request Received",
    title: "Return Request Received",
    intro: () => "We have received the return request and will share the next update soon.",
    rows: returnRows,
    ctaText: "View return",
  },
  return_approved: {
    subject: "Return Approved",
    title: "Return Approved",
    intro: () => "The return request has been approved. Please follow the return instructions in your account.",
    rows: returnRows,
    ctaText: "View return",
  },
  return_rejected: {
    subject: "Return Rejected",
    title: "Return Rejected",
    intro: () => "The return request was not approved. Please check the reason below.",
    rows: returnRows,
    ctaText: "View return",
  },
  return_received: {
    subject: "Return Received",
    title: "Return Received",
    intro: () => "The returned item has been received and is being checked.",
    rows: returnRows,
    ctaText: "View return",
  },
  refund_processed: {
    subject: "Refund Processed",
    title: "Refund Processed",
    intro: () => "Your refund has been processed successfully.",
    rows: returnRows,
    ctaText: "View details",
  },
  refund_failed: {
    subject: "Refund Failed",
    title: "Refund Failed",
    intro: () => "We could not process the refund. Please review the details below or contact support.",
    rows: returnRows,
    ctaText: "View details",
  },
  invoice_generated: {
    subject: "Invoice Generated",
    title: "Invoice Generated",
    intro: () => "Your invoice is ready and available in your account.",
    rows: orderRows,
    ctaText: "View invoice",
  },
  credit_note_generated: {
    subject: "Credit Note Generated",
    title: "Credit Note Generated",
    intro: () => "Your credit note is ready and available in your account.",
    rows: returnRows,
    ctaText: "View document",
  },
  support_ticket_created: {
    subject: "Support Ticket Created",
    title: "Support Ticket Created",
    intro: () => "Your support request has been received. Our team will review it and respond soon.",
    rows: supportRows,
    ctaText: "View ticket",
  },
  support_ticket_admin: {
    subject: "New Support Query",
    title: "New Support Query",
    intro: ({ userType }) => `A new ${humanize(userType) || "user"} support query was submitted.`,
    rows: supportRows,
    ctaText: "Open support",
  },
  low_stock_alert: {
    subject: "Low Stock Alert",
    title: "Low Stock Alert",
    intro: () => "A product has reached its low stock threshold.",
    rows: inventoryRows,
    ctaText: "Review inventory",
  },
  product_approved: {
    subject: "Product Approved",
    title: "Product Approved",
    intro: () => "Your product has been approved.",
    rows: inventoryRows,
    ctaText: "View product",
  },
  product_rejected: {
    subject: "Product Needs Changes",
    title: "Product Needs Changes",
    intro: ({ reason }) => `Your product was not approved. ${reason || "Please review the requested changes."}`,
    rows: inventoryRows,
    ctaText: "View product",
  },
  seller_payout_update: {
    subject: "Payout Update",
    title: "Payout Update",
    intro: ({ status }) => `Your payout is now ${humanize(status) || "updated"}.`,
    rows: payoutRows,
    ctaText: "View payout",
  },
  growth_partner_welcome: {
    subject: "Welcome to Sam Global Growth Partner Program",
    title: "Welcome to Growth Partner",
    intro: () => "Your Growth Partner account is ready. You can now share your link and track your rewards.",
    rows: growthRows,
    ctaText: "Open dashboard",
  },
  growth_partner_joined: {
    subject: "New Growth Partner Activity",
    title: "New Customer Joined",
    intro: () => "A new customer joined through your Growth Partner link.",
    rows: growthRows,
    ctaText: "View rewards",
  },
  growth_reward_credited: {
    subject: "Growth Reward Credited",
    title: "Growth Reward Credited",
    intro: () => "A Growth Partner reward has been credited to your account.",
    rows: growthRows,
    ctaText: "View rewards",
  },
  growth_reward_adjusted: {
    subject: "Growth Reward Adjusted",
    title: "Growth Reward Adjusted",
    intro: () => "A Growth Partner reward was adjusted because the related order status changed.",
    rows: growthRows,
    ctaText: "View rewards",
  },
  growth_partner_payout_update: {
    subject: "Growth Partner Payout Update",
    title: "Growth Partner Payout Update",
    intro: ({ status }) => `Your Growth Partner payout is now ${humanize(status) || "updated"}.`,
    rows: payoutRows,
    ctaText: "View payout",
  },
};

const eventTemplateMap = {
  [DOMAIN_EVENTS.AUTH_USER_REGISTERED_V1]: ({ recipientType, payload }) =>
    recipientType === "admin" ? "seller_account_created_admin" : "account_welcome",
  [DOMAIN_EVENTS.SELLER_KYC_SUBMITTED_V1]: () => "seller_onboarding_submitted_admin",
  [DOMAIN_EVENTS.SELLER_ORGANIZATION_CREATED_V1]: () => "seller_onboarding_submitted_admin",
  [DOMAIN_EVENTS.KYC_STATUS_UPDATED_V1]: ({ payload }) =>
    String(firstValue(payload.status, payload.verificationStatus, payload.approvalStatus) || "") === "rejected"
      ? "seller_onboarding_rejected"
      : "seller_onboarding_approved",
  [DOMAIN_EVENTS.SELLER_ORGANIZATION_STATUS_UPDATED_V1]: ({ payload }) =>
    String(firstValue(payload.status, payload.verificationStatus, payload.approvalStatus) || "") === "rejected"
      ? "seller_onboarding_rejected"
      : "seller_onboarding_approved",
  [DOMAIN_EVENTS.ORDER_CREATED_V1]: ({ recipientType }) =>
    recipientType === "seller" ? "order_received_seller" : "order_created_customer",
  [DOMAIN_EVENTS.ORDER_PAID_V1]: ({ recipientType }) =>
    recipientType === "seller" ? "order_received_seller" : "order_paid_customer",
  [DOMAIN_EVENTS.ORDER_STATUS_UPDATED_V1]: () => "order_status_updated_customer",
  [DOMAIN_EVENTS.ORDER_PAYMENT_FAILED_V1]: () => "payment_failed_customer",
  [DOMAIN_EVENTS.ORDER_CANCELLED_V1]: () => "order_cancelled",
  [DOMAIN_EVENTS.RETURN_REQUESTED_V1]: () => "return_requested",
  [DOMAIN_EVENTS.RETURN_APPROVED_V1]: () => "return_approved",
  [DOMAIN_EVENTS.RETURN_REJECTED_V1]: () => "return_rejected",
  [DOMAIN_EVENTS.RETURN_RECEIVED_V1]: () => "return_received",
  [DOMAIN_EVENTS.RETURN_REFUNDED_V1]: () => "refund_processed",
  [DOMAIN_EVENTS.REFUND_PROCESSED_V1]: () => "refund_processed",
  [DOMAIN_EVENTS.REFUND_FAILED_V1]: () => "refund_failed",
  [DOMAIN_EVENTS.PAYMENT_REFUNDED_V1]: () => "refund_processed",
  [DOMAIN_EVENTS.INVOICE_GENERATED_V1]: () => "invoice_generated",
  [DOMAIN_EVENTS.CREDIT_NOTE_GENERATED_V1]: () => "credit_note_generated",
  [DOMAIN_EVENTS.SELLER_PAYOUT_STATUS_UPDATED_V1]: () => "seller_payout_update",
  [DOMAIN_EVENTS.INVENTORY_LOW_STOCK_V1]: () => "low_stock_alert",
  [DOMAIN_EVENTS.REFERRAL_REWARDED_V1]: () => "growth_reward_credited",
};

function resolveTemplateKey({ templateKey, eventName, recipientType = "customer", payload = {} } = {}) {
  if (templateKey && EMAIL_TEMPLATE_DEFINITIONS[templateKey]) return templateKey;
  const resolver = eventTemplateMap[eventName || payload.eventName];
  if (resolver) return resolver({ recipientType, payload });
  return null;
}

function renderEmailTemplate({
  templateKey,
  eventName,
  recipientType = "customer",
  subject,
  message,
  payload = {},
  ctaUrl = "",
} = {}) {
  const resolvedKey = resolveTemplateKey({ templateKey, eventName, recipientType, payload });
  const definition = EMAIL_TEMPLATE_DEFINITIONS[resolvedKey] || EMAIL_TEMPLATE_DEFINITIONS.account_welcome;
  const title = subject || definition.subject;
  const heading = definition.title || title;
  const intro = typeof definition.intro === "function"
    ? definition.intro(payload)
    : definition.intro || message || "";
  const rows = typeof definition.rows === "function" ? definition.rows(payload) : [];
  const preheader = [heading, rows[0]?.value].filter(Boolean).join(" - ");
  const safeCtaUrl = containsPrivateReference(ctaUrl) ? "" : ctaUrl;
  const button = safeCtaUrl && definition.ctaText
    ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(safeCtaUrl)}" style="display:inline-block;background:#d7a316;color:#111827;text-decoration:none;border-radius:7px;padding:12px 18px;font-weight:700;font-size:14px;">${escapeHtml(definition.ctaText)}</a></p>`
    : "";
  const detailRows = compactRows(rows)
    .map((item) => `
      <tr>
        <td style="padding:10px 0;color:#667085;font-size:13px;border-bottom:1px solid #eef0f4;">${escapeHtml(item.label)}</td>
        <td style="padding:10px 0;color:#111827;font-size:13px;font-weight:700;text-align:right;border-bottom:1px solid #eef0f4;">${escapeHtml(item.value)}</td>
      </tr>`)
    .join("");

  const html = `<!doctype html>
  <html>
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(heading)}</title>
    </head>
    <body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;font-size:1px;">${escapeHtml(preheader)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:30px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #d9dee8;border-radius:12px;overflow:hidden;">
              <tr>
                <td style="background:#1b1d60;padding:24px 26px;">
                  <div style="font-size:12px;line-height:1.3;color:#f5c542;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(brandName)}</div>
                  <h1 style="margin:12px 0 0;font-size:22px;line-height:1.3;color:#ffffff;">${escapeHtml(heading)}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:26px;">
                  <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#344054;">${escapeHtml(message || intro)}</p>
                  ${detailRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f4;">${detailRows}</table>` : ""}
                  ${button}
                  <p style="margin:26px 0 0;border-top:1px solid #eef0f4;padding-top:16px;font-size:12px;line-height:1.6;color:#667085;">
                    This is an automated update from ${escapeHtml(brandName)}. Please do not reply to this email.
                    ${supportEmail ? ` For assistance, contact ${escapeHtml(supportEmail)}.` : ""}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;

  const textRows = compactRows(rows).map((item) => `${item.label}: ${item.value}`).join("\n");
  return {
    templateKey: resolvedKey,
    subject: title,
    text: [heading, "", message || intro, textRows ? `\n${textRows}` : ""].filter(Boolean).join("\n"),
    html,
  };
}

module.exports = {
  EMAIL_TEMPLATE_DEFINITIONS,
  renderEmailTemplate,
  resolveTemplateKey,
  helpers: {
    escapeHtml,
    humanize,
    formatMoney,
    row,
    compactRows,
    firstValue,
    publicValue,
    publicOrderReference,
    publicReturnReference,
    publicPayoutReference,
    containsPrivateReference,
    customerNameOf,
    businessNameOf,
    partnerNameOf,
  },
};
