const { AppError } = require("../../../shared/errors/app-error");

// An empty override preserves the existing per-flow channel selection.
function getOtpChannelOverride() {
  const channel = String(process.env.AUTH_OTP_CHANNEL || "").trim().toLowerCase();
  if (channel && !["email", "sms"].includes(channel)) {
    throw new AppError("AUTH_OTP_CHANNEL must be email or sms", 503);
  }
  return channel;
}

module.exports = { getOtpChannelOverride };
