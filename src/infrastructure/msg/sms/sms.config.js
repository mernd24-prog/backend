const { env } = require("../../../config/env");
const { SMS_HEADERS } = require("./sms.constants");

const smsConfig = Object.freeze({
  provider: env.sms.provider,
  enabled: env.sms.enabled,
  transactionalEnabled: env.sms.transactionalEnabled,
  enforceDlt: env.sms.enforceDlt,
  apiUrl: env.sms.apiUrl,
  otpApiUrl: env.sms.otpApiUrl,
  apiMethod: env.sms.apiMethod,
  apiKey: env.sms.apiKey,
  username: env.sms.username,
  password: env.sms.password,
  peId: env.sms.peId,
  headers: Object.freeze({
    [SMS_HEADERS.SERVICE]: env.sms.headers.service,
    [SMS_HEADERS.TRANSACTIONAL]: env.sms.headers.transactional,
  }),
  route: env.sms.route,
  country: env.sms.country,
  timeoutMs: env.sms.timeoutMs,
});

module.exports = { smsConfig };
