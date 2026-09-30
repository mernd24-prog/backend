const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");
const { ApitxtClient } = require("./apitxt.client");
const { ApitxtService } = require("./apitxt.service");

logger.info(
  {
    enabled: env.apitxt.enabled,
    features: {
      aadhaar: env.apitxt.enabled && env.apitxt.verifyAadhaar,
      pan: env.apitxt.enabled && env.apitxt.verifyPan,
      gst: env.apitxt.enabled && env.apitxt.verifyGst,
      bank: env.apitxt.enabled && env.apitxt.verifyBank,
      drivingLicense: env.apitxt.enabled && env.apitxt.verifyDrivingLicense,
      smsOtp: env.apitxt.enabled && env.apitxt.smsOtpEnabled,
      whatsappOtp: env.apitxt.enabled && env.apitxt.whatsappOtpEnabled,
    },
    smsOtpConfigured: env.apitxt.smsOtpConfigured,
    smsOtpUsesDefaultTemplate: env.apitxt.smsOtpUsesDefaultTemplate,
    hasAuthKey: Boolean(env.apitxt.authKey),
  },
  "APITXT configuration loaded",
);

const apitxtClient = new ApitxtClient({
  baseUrl: env.apitxt.baseUrl,
  apiKey: env.apitxt.apiKey,
  timeoutMs: env.apitxt.timeoutMs,
  retries: env.apitxt.retries,
  logger,
});

const apitxtService = new ApitxtService({
  client: apitxtClient,
  authKey: env.apitxt.authKey,
  panVerifyUrl: env.apitxt.panVerifyUrl,
});

module.exports = {
  ApitxtClient,
  ApitxtService,
  apitxtClient,
  apitxtService,
};
