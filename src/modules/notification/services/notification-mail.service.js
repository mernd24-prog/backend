const { sendMail } = require("../../../infrastructure/mail/mailer");
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

const referenceOf = (payload = {}) =>
  payload.orderNumber ||
  payload.orderId ||
  payload.returnNumber ||
  payload.returnId ||
  payload.payoutId ||
  "";

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

const buildTemplate = ({ subject, message, payload = {}, recipientType = "customer" }) => {
  const reference = referenceOf(payload);
  const status = humanize(payload.status || payload.verificationStatus || payload.approvalStatus);
  const amount = payload.netAmount || payload.payableAmount || payload.totalAmount || payload.refundAmount;
  const currency = payload.currency || "INR";
  const rows = [
    reference ? { label: "Reference", value: reference } : null,
    status ? { label: "Status", value: status } : null,
    amount ? { label: "Amount", value: formatMoney(amount, currency) } : null,
    payload.reason ? { label: "Reason", value: humanize(payload.reason) } : null,
  ].filter(Boolean);

  const title = subject || "Sam Global update";
  const intro = message || "There is a new update on your Sam Global account.";
  const ctaUrl = payload.viewUrl || "";

  return {
    subject: title,
    text: `${title}\n\n${intro}${reference ? `\nReference: ${reference}` : ""}${status ? `\nStatus: ${status}` : ""}`,
    html: wrapEmail({
      title,
      intro,
      rows,
      ctaText: recipientType === "seller" ? "Open seller panel" : "View details",
      ctaUrl,
    }),
  };
};

class NotificationMailService {
  async sendTemplatedMail({ to, subject, message, payload = {}, recipientType }) {
    if (!to) return null;
    const template = buildTemplate({ subject, message, payload, recipientType });
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
