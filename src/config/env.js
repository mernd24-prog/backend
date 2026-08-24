const dotenv = require("dotenv");

dotenv.config();

const defaultMaxDocumentBytes = 10 * 1024 * 1024;
const maxDocumentBytes = Number(process.env.MAX_DOCUMENT_UPLOAD_BYTES || defaultMaxDocumentBytes);
const emailPort = Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 1025);
const emailSecureDefault = emailPort === 465 ? "true" : "false";
const isProductionMode = String(process.env.NODE_ENV || "").toLowerCase() === "production" ||
  parseBoolean(process.env.PRODUCTION, false);

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function cleanEnvValue(value) {
  return String(value || "").trim();
}

function hasEnvValue(value) {
  const text = cleanEnvValue(value);
  return Boolean(text) && !/[<>]/.test(text);
}

function parseBoolean(value, fallback = false) {
  const text = cleanEnvValue(value).toLowerCase();
  if (!text) return fallback;
  if (["true", "1", "yes", "y", "on"].includes(text)) return true;
  if (["false", "0", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function readBooleanFlag(names, fallback = false) {
  const flagNames = Array.isArray(names) ? names : [names];
  for (const name of flagNames) {
    if (process.env[name] !== undefined && cleanEnvValue(process.env[name]) !== "") {
      return parseBoolean(process.env[name], fallback);
    }
  }
  return fallback;
}

function findMissingConfig(entries) {
  return entries
    .filter((entry) => !hasEnvValue(entry.value))
    .map((entry) => entry.key);
}

const parseOriginList = (value, fallback = "*") => {
  const raw = String(value || fallback).trim();
  if (!raw || raw === "*") return "*";
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length ? origins : "*";
};

const emailHost = process.env.EMAIL_HOST || process.env.SMTP_HOST || "localhost";
const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER || "";
const emailPass = process.env.EMAIL_PASS || process.env.SMTP_PASS || "";
const defaultFromEmail = process.env.EMAIL_FROM || process.env.DEFAULT_FROM_EMAIL || "no-reply@example.com";
const smtpAuthPartial = hasEnvValue(emailUser) || hasEnvValue(emailPass);
const smtpAuthConfigured = hasEnvValue(emailUser) && hasEnvValue(emailPass);
const emailMissingKeys = [
  ...findMissingConfig([
    { key: "EMAIL_HOST or SMTP_HOST", value: process.env.EMAIL_HOST || process.env.SMTP_HOST },
    { key: "EMAIL_FROM or DEFAULT_FROM_EMAIL", value: defaultFromEmail },
  ]),
  ...(smtpAuthPartial
    ? findMissingConfig([
        { key: "EMAIL_USER or SMTP_USER", value: emailUser },
        { key: "EMAIL_PASS or SMTP_PASS", value: emailPass },
      ])
    : []),
];
const emailConfigured = emailMissingKeys.length === 0;
const emailLiveRequested = readBooleanFlag(["ENABLE_LIVE_EMAIL", "USE_LIVE_EMAIL"], isProductionMode);
const emailMockEnabled = readBooleanFlag(["ENABLE_EMAIL_MOCK", "USE_MOCK_EMAIL"], !emailLiveRequested);
const emailMode = emailLiveRequested && emailConfigured
  ? "live"
  : emailMockEnabled
    ? "mock"
    : "disabled";

const razorpayMissingKeys = findMissingConfig([
  { key: "RAZORPAY_KEY_ID", value: process.env.RAZORPAY_KEY_ID },
  { key: "RAZORPAY_KEY_SECRET", value: process.env.RAZORPAY_KEY_SECRET },
]);
const razorpayConfigured = razorpayMissingKeys.length === 0;
const razorpayLiveRequested = readBooleanFlag(["ENABLE_LIVE_RAZORPAY", "USE_LIVE_RAZORPAY"], isProductionMode);
const razorpayMockEnabled = readBooleanFlag(["ENABLE_RAZORPAY_MOCK", "USE_MOCK_RAZORPAY"], !razorpayLiveRequested);
const razorpayMode = razorpayLiveRequested && razorpayConfigured
  ? "live"
  : razorpayMockEnabled
    ? "mock"
    : "disabled";

const razorpayXMissingKeys = findMissingConfig([
  { key: "RAZORPAYX_KEY_ID", value: process.env.RAZORPAYX_KEY_ID || process.env.RAZORPAY_KEY_ID },
  { key: "RAZORPAYX_KEY_SECRET", value: process.env.RAZORPAYX_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET },
  { key: "RAZORPAYX_ACCOUNT_NUMBER", value: process.env.RAZORPAYX_ACCOUNT_NUMBER },
]);
const razorpayXConfigured = razorpayXMissingKeys.length === 0;
const razorpayXLiveRequested = readBooleanFlag(["ENABLE_RAZORPAYX_PAYOUTS", "USE_LIVE_RAZORPAYX"], false);
const razorpayXMockEnabled = readBooleanFlag(["ENABLE_RAZORPAYX_MOCK", "USE_MOCK_RAZORPAYX"], false);
const razorpayXKeyId = cleanEnvValue(process.env.RAZORPAYX_KEY_ID || process.env.RAZORPAY_KEY_ID);
const razorpayXTestKey = razorpayXKeyId.startsWith("rzp_test_");
const razorpayXMode = razorpayXLiveRequested && razorpayXConfigured
  ? (razorpayXTestKey ? "test" : "live")
  : razorpayXMockEnabled
    ? "mock"
    : "disabled";

const elasticsearchConfigured = hasEnvValue(process.env.ELASTICSEARCH_NODE);
const elasticsearchEnabled = readBooleanFlag(
  ["ENABLE_ELASTICSEARCH", "USE_ELASTICSEARCH"],
  isProductionMode,
) && elasticsearchConfigured;

const cloudinaryMissingKeys = findMissingConfig([
  { key: "CLOUDINARY_CLOUD_NAME", value: process.env.CLOUDINARY_CLOUD_NAME },
  { key: "CLOUDINARY_API_KEY", value: process.env.CLOUDINARY_API_KEY },
  { key: "CLOUDINARY_API_SECRET", value: process.env.CLOUDINARY_API_SECRET },
]);
const cloudinaryConfigured = cloudinaryMissingKeys.length === 0;
const cloudinaryLiveRequested = readBooleanFlag(["ENABLE_CLOUDINARY", "USE_CLOUDINARY"], isProductionMode);
const localUploadStorageEnabled = readBooleanFlag(
  ["ENABLE_LOCAL_UPLOAD_STORAGE", "USE_LOCAL_UPLOAD_STORAGE"],
  !cloudinaryLiveRequested,
);
const uploadStorageMode = cloudinaryLiveRequested && cloudinaryConfigured
  ? "cloudinary"
  : localUploadStorageEnabled
    ? "local"
    : "disabled";

const googleClientIds = (process.env.GOOGLE_CLIENT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(hasEnvValue);
const googleOAuthRedirectUris = (
  process.env.GOOGLE_OAUTH_REDIRECT_URIS ||
  [
    process.env.CUSTOMER_APP_BASE_URL,
    process.env.ADMIN_APP_BASE_URL,
    process.env.SELLER_APP_BASE_URL,
  ].filter(hasEnvValue).join(",")
)
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(hasEnvValue);
const firebaseConfigured = findMissingConfig([
  { key: "FIREBASE_PROJECT_ID", value: process.env.FIREBASE_PROJECT_ID },
  { key: "FIREBASE_CLIENT_EMAIL", value: process.env.FIREBASE_CLIENT_EMAIL },
  { key: "FIREBASE_PRIVATE_KEY", value: process.env.FIREBASE_PRIVATE_KEY },
]).length === 0;
const socialAuthLiveRequested = readBooleanFlag(
  ["ENABLE_LIVE_SOCIAL_AUTH", "USE_LIVE_SOCIAL_AUTH"],
  isProductionMode,
);
const staticSocialAuthEnabled = readBooleanFlag(
  ["ENABLE_STATIC_SOCIAL_AUTH", "USE_STATIC_SOCIAL_AUTH"],
  !socialAuthLiveRequested,
);
const socialAuthMode = socialAuthLiveRequested
  ? "live"
  : staticSocialAuthEnabled
    ? "static"
    : "disabled";

const normalizeOtpMode = (value) => {
  const mode = String(value || "").trim().toLowerCase();
  if (["static", "local", "test", "mock"].includes(mode)) return "static";
  if (["live", "provider", "sms"].includes(mode)) return "live";
  if (["disabled", "off", "false", "none"].includes(mode)) return "disabled";
  return "";
};

const configuredOtpMode = normalizeOtpMode(process.env.AUTH_OTP_MODE);
const liveOtpRequested = configuredOtpMode
  ? configuredOtpMode === "live"
  : readBooleanFlag(["ENABLE_LIVE_OTP", "USE_LIVE_OTP"], isProductionMode);
const staticOtpEnabled = configuredOtpMode
  ? configuredOtpMode === "static"
  : readBooleanFlag(["ENABLE_STATIC_OTP", "USE_STATIC_OTP"], !liveOtpRequested);
const otpMode = configuredOtpMode || (
  liveOtpRequested
    ? (emailMode === "live" ? "live" : "disabled")
    : (staticOtpEnabled ? "static" : "disabled")
);
const publicBaseUrl = process.env.PUBLIC_API_BASE_URL ||
  process.env.BACKEND_PUBLIC_URL ||
  process.env.API_BASE_URL ||
  "";

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  appName: process.env.APP_NAME || "ecommerce",
  apiPrefix: process.env.API_PREFIX || "/api/v1",
  publicBaseUrl: hasEnvValue(publicBaseUrl) ? cleanEnvValue(publicBaseUrl).replace(/\/+$/, "") : "",
  cors: {
    origin: parseOriginList(process.env.CORS_ORIGIN || process.env.CORS_ORIGINS),
  },
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/ecommerce",
  postgresUrl:
    process.env.POSTGRES_URL || "postgresql://postgres:postgres@localhost:5432/ecommerce",
  postgres: {
    poolMax: parsePositiveInteger(process.env.POSTGRES_POOL_MAX, 5),
    connectionTimeoutMillis: parsePositiveInteger(process.env.POSTGRES_CONNECTION_TIMEOUT_MS, 30000),
    idleTimeoutMillis: parsePositiveInteger(process.env.POSTGRES_IDLE_TIMEOUT_MS, 30000),
  },
  knex: {
    poolMin: Number.isFinite(Number(process.env.KNEX_POOL_MIN)) && Number(process.env.KNEX_POOL_MIN) >= 0
      ? Math.floor(Number(process.env.KNEX_POOL_MIN))
      : 0,
    poolMax: parsePositiveInteger(process.env.KNEX_POOL_MAX, 5),
    acquireTimeoutMillis: parsePositiveInteger(process.env.KNEX_ACQUIRE_TIMEOUT_MS, 30000),
    createTimeoutMillis: parsePositiveInteger(process.env.KNEX_CREATE_TIMEOUT_MS, 30000),
    idleTimeoutMillis: parsePositiveInteger(process.env.KNEX_IDLE_TIMEOUT_MS, 30000),
  },
  sequelize: {
    logging: String(process.env.SEQUELIZE_LOGGING || "false") === "true",
    poolMin: Number.isFinite(Number(process.env.SEQUELIZE_POOL_MIN)) && Number(process.env.SEQUELIZE_POOL_MIN) >= 0
      ? Math.floor(Number(process.env.SEQUELIZE_POOL_MIN))
      : 0,
    poolMax: parsePositiveInteger(process.env.SEQUELIZE_POOL_MAX, 5),
    acquireMillis: parsePositiveInteger(process.env.SEQUELIZE_ACQUIRE_MS, 30000),
    idleMillis: parsePositiveInteger(process.env.SEQUELIZE_IDLE_MS, 10000),
  },
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  elasticsearchNode: process.env.ELASTICSEARCH_NODE || "http://localhost:9200",
  elasticsearch: {
    enabled: elasticsearchEnabled,
    configured: elasticsearchConfigured,
    mode: elasticsearchEnabled ? "live" : "mongo_fallback",
  },
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "access-secret",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "refresh-secret",
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || "7d",
  googleClientIds,
  googleOAuth: {
    clientSecret: cleanEnvValue(process.env.GOOGLE_CLIENT_SECRET),
    redirectUris: googleOAuthRedirectUris,
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: process.env.FIREBASE_PRIVATE_KEY || "",
    configured: firebaseConfigured,
  },
  razorpay: {
    keyId: cleanEnvValue(process.env.RAZORPAY_KEY_ID),
    keySecret: cleanEnvValue(process.env.RAZORPAY_KEY_SECRET),
    webhookSecret: cleanEnvValue(process.env.RAZORPAY_WEBHOOK_SECRET),
    configured: razorpayConfigured,
    live: razorpayMode === "live",
    mock: razorpayMode === "mock",
    enabled: razorpayMode !== "disabled",
    mode: razorpayMode,
    liveRequested: razorpayLiveRequested,
    missingKeys: razorpayMissingKeys,
    mockAutoCapture: readBooleanFlag(["RAZORPAY_MOCK_AUTO_CAPTURE"], true),
    timeoutMs: parsePositiveInteger(process.env.RAZORPAY_TIMEOUT_MS, 10000),
  },
  razorpayX: {
    keyId: razorpayXKeyId,
    keySecret: cleanEnvValue(process.env.RAZORPAYX_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET),
    accountNumber: cleanEnvValue(process.env.RAZORPAYX_ACCOUNT_NUMBER),
    webhookSecret: cleanEnvValue(process.env.RAZORPAYX_WEBHOOK_SECRET),
    configured: razorpayXConfigured,
    live: razorpayXMode === "live",
    test: razorpayXMode === "test",
    mock: razorpayXMode === "mock",
    enabled: razorpayXMode !== "disabled",
    mode: razorpayXMode,
    liveRequested: razorpayXLiveRequested,
    missingKeys: razorpayXMissingKeys,
  },
  apitxt: {
    baseUrl: process.env.APITXT_BASE_URL || "",
    apiKey: process.env.APITXT_API_KEY || "",
    authKey: process.env.APITXT_AUTH_KEY || process.env.APITXT_API_KEY || "",
    panVerifyUrl: process.env.APITXT_PAN_VERIFY_URL || "",
    smsOtpUrl: process.env.APITXT_SMS_OTP_URL || process.env.APITXT_OTP_URL || "https://apitxt.com/api/sendOTP",
    smsOtpEnabled: readBooleanFlag(["APITXT_SMS_OTP_ENABLED", "ENABLE_APITXT_SMS_OTP"], false),
    smsOtpDailyLimit: parsePositiveInteger(process.env.APITXT_SMS_OTP_DAILY_LIMIT, 1),
    smsOtpChannel: process.env.APITXT_SMS_OTP_CHANNEL || process.env.APITXT_CHANNEL || "",
    smsOtpTemplateId: process.env.APITXT_SMS_OTP_TEMPLATE_ID || process.env.APITXT_TEMPLATE_ID || "",
    smsOtpTemplateName: process.env.APITXT_SMS_OTP_TEMPLATE_NAME || process.env.APITXT_TEMPLATE_NAME || "",
    smsOtpCountry: process.env.APITXT_SMS_OTP_COUNTRY || process.env.APITXT_COUNTRY || "91",
    smsOtpProjectRefId: process.env.APITXT_SMS_OTP_PROJECT_REF_ID || process.env.APITXT_PROJECT_REF_ID || "",
    whatsappOtpUrl: process.env.APITXT_WHATSAPP_OTP_URL || process.env.APITXT_SMS_OTP_URL || process.env.APITXT_OTP_URL || "https://apitxt.com/api/sendOTP",
    whatsappOtpEnabled: readBooleanFlag(["APITXT_WHATSAPP_OTP_ENABLED", "ENABLE_APITXT_WHATSAPP_OTP"], false),
    whatsappOtpDailyLimit: parsePositiveInteger(process.env.APITXT_WHATSAPP_OTP_DAILY_LIMIT, 2),
    whatsappOtpChannel: process.env.APITXT_WHATSAPP_OTP_CHANNEL || "whatsapp",
    whatsappOtpTemplateId: process.env.APITXT_WHATSAPP_OTP_TEMPLATE_ID || process.env.APITXT_SMS_OTP_TEMPLATE_ID || process.env.APITXT_TEMPLATE_ID || "",
    whatsappOtpTemplateName: process.env.APITXT_WHATSAPP_OTP_TEMPLATE_NAME || process.env.APITXT_SMS_OTP_TEMPLATE_NAME || process.env.APITXT_TEMPLATE_NAME || "",
    whatsappOtpCountry: process.env.APITXT_WHATSAPP_OTP_COUNTRY || process.env.APITXT_SMS_OTP_COUNTRY || process.env.APITXT_COUNTRY || "91",
    whatsappOtpProjectRefId: process.env.APITXT_WHATSAPP_OTP_PROJECT_REF_ID || process.env.APITXT_SMS_OTP_PROJECT_REF_ID || process.env.APITXT_PROJECT_REF_ID || "",
    providerDailyLimit: parsePositiveInteger(process.env.APITXT_PROVIDER_DAILY_LIMIT, 1),
    timeoutMs: parsePositiveInteger(process.env.APITXT_TIMEOUT_MS, 5000),
    retries: parsePositiveInteger(process.env.APITXT_RETRIES, 2),
    enabled: readBooleanFlag(["ENABLE_APITXT", "USE_APITXT"], false),
    verifyAadhaar: readBooleanFlag(["APITXT_VERIFY_AADHAAR"], false),
    verifyPan: readBooleanFlag(["APITXT_VERIFY_PAN"], true),
    verifyGst: readBooleanFlag(["APITXT_VERIFY_GST"], false),
  },
  delivery: {
    webhookSecret: process.env.DELIVERY_WEBHOOK_SECRET || "",
    requireWebhookSignature: readBooleanFlag(
      ["REQUIRE_DELIVERY_WEBHOOK_SIGNATURE"],
      isProductionMode,
    ),
  },
  commerce: {
    businessState: process.env.BUSINESS_STATE || "KARNATAKA",
    gstinMarketplace: process.env.GSTIN_MARKETPLACE || "",
    platformCommissionSacCode: process.env.PLATFORM_COMMISSION_SAC_CODE || "998599",
    platformCustomerFeeSacCode:
      process.env.PLATFORM_CUSTOMER_FEE_SAC_CODE ||
      process.env.PLATFORM_COMMISSION_SAC_CODE ||
      "998599",
    shippingSacCode: process.env.PLATFORM_SHIPPING_SAC_CODE || process.env.SHIPPING_SAC_CODE || "996812",
    referralReferrerBonus: Number(process.env.REFERRAL_REFERRER_BONUS || 100),
    referralRefereeBonus: Number(process.env.REFERRAL_REFEREE_BONUS || 50),
    maxWalletUsagePerOrderPercent: Number(process.env.MAX_WALLET_USAGE_PER_ORDER_PERCENT || 30),
  },
  socket: {
    corsOrigin: parseOriginList(
      process.env.SOCKET_CORS_ORIGIN || process.env.CORS_ORIGIN || process.env.CORS_ORIGINS,
    ),
  },
  smtp: {
    host: emailHost,
    port: emailPort,
    secure: String(process.env.EMAIL_SECURE || process.env.SMTP_SECURE || emailSecureDefault) === "true",
    user: emailUser,
    pass: emailPass,
    authConfigured: smtpAuthConfigured,
    configured: emailConfigured,
    live: emailMode === "live",
    mock: emailMode === "mock",
    enabled: emailMode !== "disabled",
    mode: emailMode,
    liveRequested: emailLiveRequested,
    missingKeys: emailMissingKeys,
    queue: {
      concurrency: parsePositiveInteger(process.env.EMAIL_QUEUE_CONCURRENCY, 1),
      intervalMs: parsePositiveInteger(process.env.EMAIL_QUEUE_INTERVAL_MS, 30000),
      maxPerInterval: parsePositiveInteger(process.env.EMAIL_QUEUE_MAX_PER_INTERVAL, 1),
    },
  },
  defaultFromEmail,
  auth: {
    staticOtp: String(process.env.AUTH_STATIC_OTP || process.env.STATIC_OTP || process.env.DEV_OTP || "123456").trim(),
    otpMode,
    liveOtpRequested,
    staticOtpEnabled,
    exposeStaticOtp: readBooleanFlag(["AUTH_EXPOSE_STATIC_OTP", "EXPOSE_STATIC_OTP", "SHOW_STATIC_OTP"], !isProductionMode),
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
    configured: cloudinaryConfigured,
    enabled: uploadStorageMode === "cloudinary",
    mode: uploadStorageMode,
    liveRequested: cloudinaryLiveRequested,
    missingKeys: cloudinaryMissingKeys,
  },
  upload: {
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || "1mb",
    maxDocumentBytes:
      Number.isFinite(maxDocumentBytes) && maxDocumentBytes > 0
        ? maxDocumentBytes
        : defaultMaxDocumentBytes,
    storageMode: uploadStorageMode,
    localStorageEnabled: uploadStorageMode === "local",
  },
  socialAuth: {
    mode: socialAuthMode,
    live: socialAuthMode === "live",
    static: socialAuthMode === "static",
    enabled: socialAuthMode !== "disabled",
    liveRequested: socialAuthLiveRequested,
    providers: {
      google: googleClientIds.length > 0,
      firebase: firebaseConfigured,
    },
  },
  enableCron: String(process.env.ENABLE_CRON || "true") === "true",
  production: isProductionMode,
};

function assertProductionEnvironment() {
  if (!isProductionMode) return;
  const errors = [];
  const accessSecret = cleanEnvValue(process.env.JWT_ACCESS_SECRET);
  const refreshSecret = cleanEnvValue(process.env.JWT_REFRESH_SECRET);
  if (accessSecret.length < 32 || accessSecret === "access-secret") errors.push("JWT_ACCESS_SECRET must be a unique secret of at least 32 characters");
  if (refreshSecret.length < 32 || refreshSecret === "refresh-secret") errors.push("JWT_REFRESH_SECRET must be a unique secret of at least 32 characters");
  if (accessSecret && accessSecret === refreshSecret) errors.push("JWT access and refresh secrets must be different");
  for (const [key, value] of [["MONGO_URI", process.env.MONGO_URI], ["POSTGRES_URL", process.env.POSTGRES_URL], ["REDIS_URL", process.env.REDIS_URL]]) {
    if (!hasEnvValue(value)) errors.push(`${key} is required in production`);
  }
  if (env.cors.origin === "*") errors.push("CORS_ORIGIN must be an explicit allowlist in production");
  if (env.auth.otpMode === "static" || env.auth.exposeStaticOtp) errors.push("Static or exposed OTP is forbidden in production");
  if (env.upload.localStorageEnabled) errors.push("Local upload storage is not supported in production; configure Cloudinary");
  if (env.razorpay.live && !env.razorpay.webhookSecret) errors.push("RAZORPAY_WEBHOOK_SECRET is required for live Razorpay");
  if (errors.length) {
    const error = new Error(`Invalid production environment:\n- ${errors.join("\n- ")}`);
    error.code = "INVALID_PRODUCTION_ENVIRONMENT";
    throw error;
  }
}

assertProductionEnvironment();

module.exports = { env };
