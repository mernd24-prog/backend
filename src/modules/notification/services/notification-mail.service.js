const { sendMail } = require("../../../infrastructure/mail/mailer");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { logger } = require("../../../shared/logger/logger");
const {
  buildOrderEmailTemplate,
  isOrderEmailEvent,
  helpers,
} = require("./order-email-template.service");
const {
  renderEmailTemplate,
  resolveTemplateKey,
} = require("./email-template-catalog");

const { escapeHtml, humanize, formatMoney, toAbsoluteUrl, row } = helpers;
const titleCase = (value = "") =>
  String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
const brandName = process.env.EMAIL_BRAND_NAME ||
  process.env.BRAND_NAME ||
  titleCase(process.env.APP_NAME) ||
  "Sam Global Ecommerce";
const customerAppBaseUrl = String(process.env.CUSTOMER_APP_BASE_URL || "").replace(/\/+$/, "");
const logoUrl = process.env.EMAIL_LOGO_URL ||
  process.env.BRAND_LOGO_URL ||
  process.env.INVOICE_LOGO_URL ||
  (customerAppBaseUrl ? `${customerAppBaseUrl}/favicon.png` : "");
const supportEmail = process.env.SUPPORT_EMAIL || process.env.REPLY_TO_EMAIL || "";

const publicValue = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[0-9a-f]{24}$/i.test(text)) return "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return "";
  return text;
};

const referenceOf = (payload = {}) =>
  payload.orderNumber ||
  payload.returnNumber ||
  payload.payoutNumber ||
  payload.referenceNumber ||
  "";

const displayReferenceOf = (payload = {}) =>
  payload.orderNumber ||
  payload.returnNumber ||
  payload.payoutNumber ||
  payload.referenceNumber ||
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
    row("Return", payload.returnNumber),
    row("Order", payload.orderNumber),
    row("Status", humanize(payload.status)),
    row("Refund Amount", amountOf(payload) ? formatMoney(amountOf(payload), currency) : ""),
    row("Reason", payload.reason || payload.rejectionReason),
  ].filter(Boolean);
};

const payoutRows = (payload = {}) => {
  const currency = payload.currency || "INR";
  return [
    row("Payout", payload.payoutNumber || payload.referenceNumber || payload.paymentReference || payload.utr),
    row("Status", humanize(payload.status)),
    row("Amount", amountOf(payload) ? formatMoney(amountOf(payload), currency) : ""),
    row("Reference", publicValue(payload.referenceNumber || payload.paymentReference || payload.utr)),
  ].filter(Boolean);
};

const onboardingRows = (payload = {}) => [
  row("Business", payload.legalBusinessName || payload.storeDisplayName),
  row("Seller", payload.sellerName || payload.legalName),
  row("Email", payload.email || payload.sellerEmail || payload.seller_email),
  row("Phone", payload.phone || payload.sellerPhone || payload.seller_phone),
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
  const orderRef = payload.orderNumber || "your order";
  const productSummary = productSummaryOf(payload);
  const productText = productSummary ? ` for ${productSummary}` : "";
  const returnRef = payload.returnNumber || "your return request";
  const payoutRef = payload.payoutNumber || payload.referenceNumber || "your payout";

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
      title: "New Seller Account Created",
      intro: `${payload.legalBusinessName || payload.storeDisplayName || payload.legalName || payload.sellerName || "A seller"} completed seller onboarding and is ready for admin review.`,
      rows: onboardingRows(payload),
      ctaText: "Review onboarding",
    },
    [DOMAIN_EVENTS.SELLER_ORGANIZATION_CREATED_V1]: {
      title: "New Seller Account Created",
      intro: `${payload.legalBusinessName || payload.storeDisplayName || "A seller organization"} submitted seller onboarding details and is ready for admin review.`,
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
          ? `A return has been requested for order ${payload.orderNumber || ""}.`
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
      (row) => {
        const isLongValue = String(row.value || "").length > 42;
        if (isLongValue) {
          return `
        <tr>
          <td colspan="2" style="padding:11px 0 4px;color:#8a91a7;font-size:13px;">${escapeHtml(row.label)}</td>
        </tr>
        <tr>
          <td colspan="2" style="padding:0 0 11px;color:#061044;font-size:13px;font-weight:700;text-align:right;border-bottom:1px solid #eef0f4;">${escapeHtml(row.value)}</td>
        </tr>`;
        }
        return `
        <tr>
          <td style="padding:10px 10px 10px 0;color:#8a91a7;font-size:13px;border-bottom:1px solid #eef0f4;vertical-align:top;">${escapeHtml(row.label)}</td>
          <td style="padding:10px 0 10px 10px;color:#061044;font-size:13px;font-weight:700;text-align:right;border-bottom:1px solid #eef0f4;vertical-align:top;">${escapeHtml(row.value)}</td>
        </tr>`;
      },
    )
    .join("");
  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="34" height="34" alt="${escapeHtml(brandName)}" style="display:block;width:34px;height:34px;border-radius:8px;object-fit:contain;background:#ffffff;">`
    : `<span style="display:inline-block;width:31px;height:31px;border-radius:8px;background:#f4ab2f;color:#061044;font-size:14px;line-height:31px;text-align:center;font-weight:800;">S</span>`;

  return `<!doctype html>
  <html>
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(title)}</title>
      <style>
        @media only screen and (max-width: 520px) {
          .sg-wrapper { padding: 16px 8px !important; }
          .sg-card { border-radius: 12px !important; }
          .sg-header { padding: 24px 20px !important; }
          .sg-body { padding: 24px 20px !important; }
          .sg-footer { padding: 22px 20px !important; }
          .sg-title { font-size: 22px !important; }
        }
      </style>
    </head>
    <body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="sg-wrapper" style="background:#f4f6f8;padding:30px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="sg-card" style="max-width:620px;background:#ffffff;border:1px solid #d9dee8;border-radius:14px;overflow:hidden;box-shadow:0 14px 34px rgba(17,24,39,0.08);">
              <tr>
                <td class="sg-header" style="background:#211b63;padding:30px 36px 28px;border-bottom:4px solid #f4ab2f;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="44" valign="middle">${logoBlock}</td>
                      <td valign="middle">
                        <div style="font-size:12px;line-height:1.3;color:#ffc34d;text-transform:uppercase;letter-spacing:1.8px;font-weight:700;">${escapeHtml(brandName)}</div>
                      </td>
                    </tr>
                  </table>
                  <h1 class="sg-title" style="margin:20px 0 0;font-size:24px;line-height:1.3;color:#ffffff;font-weight:800;">${escapeHtml(title)}</h1>
                </td>
              </tr>
              <tr>
                <td class="sg-body" style="padding:34px 36px 32px;">
                  <p style="margin:0 0 26px;font-size:16px;line-height:1.8;color:#26324a;">${escapeHtml(intro)}</p>
                  ${
                    detailRows
                      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f4;border-bottom:1px solid #eef0f4;margin:18px 0;">${detailRows}</table>`
                      : ""
                  }
                  ${
                    ctaUrl
                      ? `<p style="margin:28px 0 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#f4ab2f;color:#061044;text-decoration:none;border-radius:8px;padding:13px 24px;font-weight:700;font-size:14px;">${escapeHtml(ctaText)}</a></p>`
                      : ""
                  }
                </td>
              </tr>
              <tr>
                <td class="sg-footer" style="background:#f7f8fc;border-top:1px solid #e6e9f2;padding:26px 36px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;line-height:1.6;color:#061044;font-weight:800;">${escapeHtml(brandName)}</td>
                      <td align="right" style="font-size:12px;line-height:1.6;color:#8a91a7;">Help&nbsp;&nbsp;&nbsp; Settings&nbsp;&nbsp;&nbsp; Unsubscribe</td>
                    </tr>
                  </table>
                  <p style="margin:18px 0 0;font-size:12px;line-height:1.7;color:#9aa1b5;">
                    This is an automated transactional email from ${escapeHtml(brandName)}.
                    ${supportEmail ? ` For assistance, contact ${escapeHtml(supportEmail)}.` : " Please contact support if you need assistance."}
                    <br>&copy; ${new Date().getFullYear()} ${escapeHtml(brandName)}. All rights reserved.
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

const buildTemplate = ({ subject, message, payload = {}, recipientType = "customer", eventName, templateKey }) => {
  if (isOrderEmailEvent(eventName, payload)) {
    return buildOrderEmailTemplate({ subject, message, payload, recipientType, eventName });
  }

  const ctaUrl = toAbsoluteUrl(payload.viewUrl || "", recipientType);
  const resolvedTemplateKey = resolveTemplateKey({
    templateKey: templateKey || payload.templateKey,
    eventName: eventName || payload.eventName,
    recipientType,
    payload,
  });
  if (resolvedTemplateKey) {
    return renderEmailTemplate({
      templateKey: resolvedTemplateKey,
      eventName: eventName || payload.eventName,
      recipientType,
      subject,
      message,
      payload,
      ctaUrl,
    });
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
  async sendTemplatedMail({ to, subject, message, payload = {}, recipientType, eventName, templateKey }) {
    if (!to) return null;
    if (String(recipientType || "") === "admin" && isOrderEmailEvent(eventName, payload)) {
      logger.info({
        to,
        subject,
        eventName,
        recipientType,
      }, "Admin order email skipped by notification policy");
      return null;
    }
    const template = buildTemplate({ subject, message, payload, recipientType, eventName, templateKey });
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
