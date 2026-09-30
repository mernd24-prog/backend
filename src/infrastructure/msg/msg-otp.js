const {
  AppError,
} = require("../../shared/errors/app-error");
const { env } = require("../../config/env");
const { apitxtService } = require("../../integrations/apitxt");
const { smsService, SMS_TEMPLATE_KEYS } = require("./sms");
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
  `apitxt:sms-otp:daily:v2:${purpose}:${mobile}`;

const rollbackProviderQuota = async (redis, key) => {
  try {
    const next = await redis.decr(key);
    if (next <= 0) await redis.del(key);
  } catch {
    // Best effort only; never hide the original provider error.
  }
};

const makeWhatsappDailyLimitKey = (mobile, purpose) =>
  `apitxt:whatsapp-otp:daily:${purpose}:${mobile}`;

const sendSmsOtp = async ({
  mobile,
  otp,
  purpose = "buyer_auth",
  template,
  validityMinutes = 5,
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

  if (!env.sms.enabled) {
    if (env.auth.otpMode === "live") {
      throw new AppError(
        "APITXT SMS OTP is disabled. Enable APITXT_SMS_OTP_ENABLED or change the OTP channel.",
        503,
      );
    }

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

  if (!env.sms.apiKey) {
    logger.warn(
      {
        provider: "apitxt",
        purpose,
        mobile: maskMobile(mobileNumber),
        smsEnabled: env.sms.enabled,
        hasAuthKey: Boolean(env.sms.apiKey),
      },
      "APITXT SMS OTP provider is not configured. Set a valid APITXT auth key.",
    );

    throw new AppError(
      "APITXT SMS OTP requires a valid auth key",
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
    await rollbackProviderQuota(redis, limitKey);
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

    const purposeTemplates = {
      buyer_auth: SMS_TEMPLATE_KEYS.LOGIN_OTP,
      login: SMS_TEMPLATE_KEYS.LOGIN_OTP,
      registration: SMS_TEMPLATE_KEYS.REGISTER_OTP,
      forgot_password: SMS_TEMPLATE_KEYS.FORGOT_PASSWORD_OTP,
      reset_password: SMS_TEMPLATE_KEYS.RESET_PASSWORD_OTP,
      verify_mobile: SMS_TEMPLATE_KEYS.VERIFY_MOBILE_OTP,
      change_mobile: SMS_TEMPLATE_KEYS.CHANGE_MOBILE_OTP,
      account_recovery: SMS_TEMPLATE_KEYS.ACCOUNT_RECOVERY_OTP,
    };
    responseData = await smsService.sendTemplate({
      template: template || purposeTemplates[purpose] || SMS_TEMPLATE_KEYS.ACCOUNT_RECOVERY_OTP,
      mobile: mobileNumber,
      variables: { otp: String(otp), validityMinutes },
    });
  } catch (error) {
    await rollbackProviderQuota(redis, limitKey);
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

const sendWhatsappOtp = async ({
  mobile,
  otp,
  purpose = "seller_registration",
} = {}) => {
  const mobileNumber = normalizeMobile(mobile);

  if (!mobileNumber) {
    throw new AppError("Mobile number is required for WhatsApp OTP", 400);
  }

  if (!env.apitxt.whatsappOtpEnabled) {
    logger.info(
      {
        provider: "static",
        purpose,
        mobile: maskMobile(mobileNumber),
        reason: "apitxt_whatsapp_otp_disabled",
      },
      "APITXT WhatsApp OTP disabled; OTP will be verified from local store",
    );

    return {
      success: true,
      skipped: true,
      testMode: true,
      provider: "static",
      requestId: null,
      providerResponse: {
        status: "skipped",
        reason: "apitxt_whatsapp_otp_disabled",
        message: "APITXT WhatsApp OTP is disabled. OTP is stored locally for testing.",
      },
      purpose,
    };
  }

  if (!env.apitxt.enabled || !env.apitxt.authKey) {
    logger.warn(
      {
        provider: "apitxt",
        channel: "whatsapp",
        purpose,
        mobile: maskMobile(mobileNumber),
        apitxtEnabled: env.apitxt.enabled,
        hasAuthKey: Boolean(env.apitxt.authKey),
      },
      "APITXT WhatsApp OTP provider is not configured",
    );

    throw new AppError("APITXT WhatsApp OTP provider is not configured", 503);
  }

  const { redis } = require("../redis/redis-client");
  const limitKey = makeWhatsappDailyLimitKey(mobileNumber, purpose);
  const nextCount = await redis.incr(limitKey);
  if (nextCount === 1) {
    await redis.expire(limitKey, DAILY_TTL_SECONDS);
  }
  if (nextCount > env.apitxt.whatsappOtpDailyLimit) {
    logger.warn(
      {
        provider: "apitxt",
        channel: "whatsapp",
        purpose,
        mobile: maskMobile(mobileNumber),
        nextCount,
        limit: env.apitxt.whatsappOtpDailyLimit,
      },
      "APITXT WhatsApp OTP daily provider limit reached",
    );

    throw new AppError(
      "WhatsApp OTP daily provider limit reached for this user. Try again tomorrow.",
      429,
    );
  }

  let responseData;

  try {
    logger.info(
      {
        provider: "apitxt",
        channel: "whatsapp",
        purpose,
        mobile: maskMobile(mobileNumber),
        dailyCount: nextCount,
        dailyLimit: env.apitxt.whatsappOtpDailyLimit,
      },
      "Sending WhatsApp OTP through APITXT",
    );

    responseData = await apitxtService.sendSmsOtp({
      url: env.apitxt.whatsappOtpUrl,
      mobile: mobileNumber,
      otp: String(otp),
      channel: env.apitxt.whatsappOtpChannel,
      templateId: env.apitxt.whatsappOtpTemplateId,
      country: env.apitxt.whatsappOtpCountry,
      templateName: env.apitxt.whatsappOtpTemplateName,
      projectRefId: env.apitxt.whatsappOtpProjectRefId,
    });
  } catch (error) {
    logger.error(
      {
        err: error,
        provider: "apitxt",
        channel: "whatsapp",
        purpose,
        mobile: maskMobile(mobileNumber),
      },
      "APITXT WhatsApp OTP send failed",
    );

    throw error;
  }

  logger.info(
    {
      provider: "apitxt",
      channel: "whatsapp",
      purpose,
      mobile: maskMobile(mobileNumber),
      requestId:
        responseData.requestId ||
        responseData.request_id ||
        responseData.id ||
        null,
      cost: responseData.cost || null,
    },
    "APITXT WhatsApp OTP sent successfully",
  );

  return {
    success: true,
    requestId:
      responseData.requestId ||
      responseData.request_id ||
      responseData.id ||
      null,
    provider: "apitxt",
    channel: "whatsapp",
    providerResponse: responseData.providerResponse || responseData,
    purpose,
  };
};

module.exports = {
  sendSmsOtp,
  sendWhatsappOtp,
};
