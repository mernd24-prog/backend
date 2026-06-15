const dotenv = require("dotenv");

dotenv.config();

const defaultMaxDocumentBytes = 5 * 1024 * 1024;
const maxDocumentBytes = Number(process.env.MAX_DOCUMENT_UPLOAD_BYTES||500*1024*1024);
const emailPort = Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 1025);
const emailSecureDefault = emailPort === 465 ? "true" : "false";
const isProductionMode = parseBoolean(process.env.PRODUCTION, false);

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

const liveOtpRequested = readBooleanFlag(["ENABLE_LIVE_OTP", "USE_LIVE_OTP"], isProductionMode);
const staticOtpEnabled = readBooleanFlag(["ENABLE_STATIC_OTP", "USE_STATIC_OTP"], !liveOtpRequested);
const otpMode = liveOtpRequested
  ? (emailMode === "live" ? "live" : "disabled")
  : (staticOtpEnabled ? "static" : "disabled");
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
  sequelize: {
    logging: String(process.env.SEQUELIZE_LOGGING || "false") === "true",
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
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || "7d",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || "7d",
  googleClientIds,
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: process.env.FIREBASE_PRIVATE_KEY || "",
    configured: firebaseConfigured,
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
    configured: razorpayConfigured,
    live: razorpayMode === "live",
    mock: razorpayMode === "mock",
    enabled: razorpayMode !== "disabled",
    mode: razorpayMode,
    liveRequested: razorpayLiveRequested,
    missingKeys: razorpayMissingKeys,
    mockAutoCapture: readBooleanFlag(["RAZORPAY_MOCK_AUTO_CAPTURE"], true),
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
  },
  defaultFromEmail,
  auth: {
    staticOtp: String(process.env.STATIC_OTP || process.env.DEV_OTP || "123456").trim(),
    otpMode,
    liveOtpRequested,
    staticOtpEnabled,
    exposeStaticOtp: readBooleanFlag(["EXPOSE_STATIC_OTP", "SHOW_STATIC_OTP"], !isProductionMode),
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
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || "50mb",
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

module.exports = { env };
