const nodemailer = require("nodemailer");
const { env } = require("../../config/env");
const { AppError } = require("../../shared/errors/app-error");
const { logger } = require("../../shared/logger/logger");

const thirdPartyMailEnabled = env.smtp.live;
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
  if (!thirdPartyMailEnabled) {
    return buildStaticMailResult({
      to,
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
    return await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    logger.error({ err: error, to, subject }, "Email delivery failed");
    throw new AppError("Email delivery failed. Please try again later.", 503);
  }
}

module.exports = { transporter, sendMail, thirdPartyMailEnabled };
