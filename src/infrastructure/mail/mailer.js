const nodemailer = require("nodemailer");
const { env } = require("../../config/env");
const { AppError } = require("../../shared/errors/app-error");
const { logger } = require("../../shared/logger/logger");

const thirdPartyMailEnabled = env.smtp.live;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const transporter = thirdPartyMailEnabled
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.authConfigured ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

function buildStaticMailResult({ to, subject, html, text, from, reason }) {
  return {
    accepted: [to],
    rejected: [],
    messageId: `static-${Date.now()}`,
    response: reason,
    envelope: { from, to: [to] },
    mode: env.smtp.mode,
    preview: { subject, text, html },
  };
}

async function sendMail({ to, subject, html, text, from = env.defaultFromEmail }) {
  const recipient = String(to || "").trim();
  if (!emailPattern.test(recipient)) {
    throw new AppError("A valid recipient email address is required.", 400);
  }

  if (!thirdPartyMailEnabled) {
    logger.warn({
      to: recipient,
      subject,
      from,
      smtpMode: env.smtp.mode,
      smtpLive: env.smtp.live,
      smtpConfigured: env.smtp.configured,
      missingKeys: env.smtp.missingKeys,
    }, "Email delivery skipped by SMTP configuration");
    return buildStaticMailResult({
      to: recipient,
      subject,
      html,
      text,
      from,
      reason:
        env.smtp.mode === "mock"
          ? "Mock mail mode: third-party email delivery is disabled by environment."
          : "Email delivery is disabled because live SMTP is not configured.",
    });
  }

  try {
    logger.warn({
      to: recipient,
      subject,
      from,
      smtpHost: env.smtp.host,
      smtpPort: env.smtp.port,
      smtpSecure: env.smtp.secure,
      smtpAuthConfigured: env.smtp.authConfigured,
    }, "Sending email through SMTP");
    const result = await transporter.sendMail({
      from,
      to: recipient,
      subject,
      text,
      html,
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
        "X-Entity-Ref-ID": subject,
      },
      replyTo: process.env.REPLY_TO_EMAIL || process.env.SUPPORT_EMAIL || from,
    });
    logger.info({
      to: recipient,
      subject,
      messageId: result?.messageId,
      accepted: result?.accepted,
      rejected: result?.rejected,
      response: result?.response,
    }, "Email delivered through SMTP");
    return result;
  } catch (error) {
    logger.error({ err: error, to: recipient, subject }, "Email delivery failed");
    throw new AppError("Email delivery failed. Please try again later.", 503);
  }
}

module.exports = { transporter, sendMail, thirdPartyMailEnabled };
