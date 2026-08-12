const {
  AppError,
} = require("../../shared/errors/app-error");
const { env } = require("../../config/env");
const { apitxtService } = require("../../integrations/apitxt");
const { logger } = require("../../shared/logger/logger");

const DAILY_TTL_SECONDS = 24 * 60 * 60;

const normalizeMobile = (mobile = "") =>
  String(mobile || "").replace(/\D/g, "");

const maskMobile = (mobile = "") => {
  const normalized = normalizeMobile(mobile);
  if (normalized.length <= 4) return "****";
  return `${normalized.slice(0, 2)}****${normalized.slice(-4)}`;
};

const makeDailyLimitKey = (mobile, purpose) =>
  `apitxt:sms-otp:daily:${purpose}:${mobile}`;

const sendSmsOtp = async ({
  mobile,
  otp,
  purpose = "buyer_auth",
}) => {
  const mobileNumber =
    normalizeMobile(mobile);

  if (!mobileNumber) {
    throw new AppError("Mobile number is required for SMS OTP", 400);
  }

  logger.debug(
    {
      provider: "apitxt",
      purpose,
      mobile: maskMobile(mobileNumber),
      smsOtpEnabled: env.apitxt.smsOtpEnabled,
    },
    "SMS OTP delivery requested",
  );

  if (!env.apitxt.smsOtpEnabled) {
    logger.info(
      {
        provider: "static",
        purpose,
        mobile: maskMobile(mobileNumber),
        reason: "apitxt_sms_otp_disabled",
      },
      "APITXT SMS OTP disabled; OTP will be verified from local store",
    );

    return {
      success: true,
      skipped: true,
      testMode: true,
      provider: "static",
      requestId: null,
      providerResponse: {
        status: "skipped",
        reason: "apitxt_sms_otp_disabled",
        message: "APITXT SMS OTP is disabled. OTP is stored locally for testing.",
      },
      purpose,
    };
  }

  if (!env.apitxt.enabled || !env.apitxt.authKey) {
    logger.warn(
      {
        provider: "apitxt",
        purpose,
        mobile: maskMobile(mobileNumber),
        apitxtEnabled: env.apitxt.enabled,
        hasAuthKey: Boolean(env.apitxt.authKey),
      },
      "APITXT SMS OTP provider is not configured",
    );

    throw new AppError(
      "APITXT SMS OTP provider is not configured",
      503,
    );
  }

  const { redis } = require("../redis/redis-client");
  const limitKey = makeDailyLimitKey(mobileNumber, purpose);
  const nextCount = await redis.incr(limitKey);
  if (nextCount === 1) {
    await redis.expire(limitKey, DAILY_TTL_SECONDS);
  }
  if (nextCount > env.apitxt.smsOtpDailyLimit) {
    logger.warn(
      {
        provider: "apitxt",
        purpose,
        mobile: maskMobile(mobileNumber),
        nextCount,
        limit: env.apitxt.smsOtpDailyLimit,
      },
      "APITXT SMS OTP daily provider limit reached",
    );

    throw new AppError(
      "SMS OTP daily provider limit reached for this user. Try again tomorrow or use static OTP in testing.",
      429,
    );
  }

  let responseData;

  try {
    logger.info(
      {
        provider: "apitxt",
        purpose,
        mobile: maskMobile(mobileNumber),
        dailyCount: nextCount,
        dailyLimit: env.apitxt.smsOtpDailyLimit,
      },
      "Sending SMS OTP through APITXT",
    );

    responseData = await apitxtService.sendSmsOtp({
      url: env.apitxt.smsOtpUrl,
      mobile: mobileNumber,
      otp: String(otp),
      channel: env.apitxt.smsOtpChannel,
      templateId: env.apitxt.smsOtpTemplateId,
      country: env.apitxt.smsOtpCountry,
      templateName: env.apitxt.smsOtpTemplateName,
      projectRefId: env.apitxt.smsOtpProjectRefId,
    });
  } catch (error) {
    logger.error(
      {
        err: error,
        provider: "apitxt",
        purpose,
        mobile: maskMobile(mobileNumber),
      },
      "APITXT SMS OTP send failed",
    );

    throw error;
  }

  logger.info(
    {
      provider: "apitxt",
      purpose,
      mobile: maskMobile(mobileNumber),
      requestId:
        responseData.requestId ||
        responseData.request_id ||
        responseData.id ||
        null,
      cost: responseData.cost || null,
    },
    "APITXT SMS OTP sent successfully",
  );

  return {
    success: true,

    requestId:
      responseData.requestId ||
      responseData.request_id ||
      responseData.id ||
      null,

    provider: "apitxt",
    providerResponse: responseData.providerResponse || responseData,
    purpose,
  };
};

module.exports = {
  sendSmsOtp,
};
