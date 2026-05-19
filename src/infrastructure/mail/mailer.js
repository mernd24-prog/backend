const nodemailer = require("nodemailer");
const { env } = require("../../config/env");

const thirdPartyMailEnabled = env.production;
const transporter = thirdPartyMailEnabled
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

async function sendMail({ to, subject, html, text, from = env.defaultFromEmail }) {
  if (!thirdPartyMailEnabled) {
    return {
      accepted: [to],
      rejected: [],
      messageId: `static-${Date.now()}`,
      response: "Static mail mode: third-party email is disabled because PRODUCTION is not true.",
      envelope: { from, to: [to] },
      preview: { subject, text, html },
    };
  }

  return transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });
}

module.exports = { transporter, sendMail, thirdPartyMailEnabled };
