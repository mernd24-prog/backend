const dotenv = require("dotenv");

dotenv.config();

const defaultMaxDocumentBytes = 5 * 1024 * 1024;
const maxDocumentBytes = Number(process.env.MAX_DOCUMENT_UPLOAD_BYTES);
const emailPort = Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 1025);
const emailSecureDefault = emailPort === 465 ? "true" : "false";
const isProductionMode = String(process.env.PRODUCTION || "false").trim() === "true";

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  appName: process.env.APP_NAME || "ecommerce",
  apiPrefix: process.env.API_PREFIX || "/api/v1",
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/ecommerce",
  postgresUrl:
    process.env.POSTGRES_URL || "postgresql://postgres:postgres@localhost:5432/ecommerce",
  sequelize: {
    logging: String(process.env.SEQUELIZE_LOGGING || "false") === "true",
  },
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  elasticsearchNode: process.env.ELASTICSEARCH_NODE || "http://localhost:9200",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "access-secret",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "refresh-secret",
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || "7d",
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: process.env.FIREBASE_PRIVATE_KEY || "",
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  },
  commerce: {
    businessState: process.env.BUSINESS_STATE || "KARNATAKA",
    gstinMarketplace: process.env.GSTIN_MARKETPLACE || "",
    referralReferrerBonus: Number(process.env.REFERRAL_REFERRER_BONUS || 100),
    referralRefereeBonus: Number(process.env.REFERRAL_REFEREE_BONUS || 50),
    maxWalletUsagePerOrderPercent: Number(process.env.MAX_WALLET_USAGE_PER_ORDER_PERCENT || 30),
  },
  socket: {
    corsOrigin: process.env.SOCKET_CORS_ORIGIN || "*",
  },
  smtp: {
    host: process.env.EMAIL_HOST || process.env.SMTP_HOST || "localhost",
    port: emailPort,
    secure: String(process.env.EMAIL_SECURE || process.env.SMTP_SECURE || emailSecureDefault) === "true",
    user: process.env.EMAIL_USER || process.env.SMTP_USER || "",
    pass: process.env.EMAIL_PASS || process.env.SMTP_PASS || "",
  },
  defaultFromEmail: process.env.EMAIL_FROM || process.env.DEFAULT_FROM_EMAIL || "no-reply@example.com",
  auth: {
    staticOtp: String(process.env.STATIC_OTP || process.env.DEV_OTP || "123456").trim(),
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  },
  upload: {
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || "10mb",
    maxDocumentBytes:
      Number.isFinite(maxDocumentBytes) && maxDocumentBytes > 0
        ? maxDocumentBytes
        : defaultMaxDocumentBytes,
  },
  enableCron: String(process.env.ENABLE_CRON || "true") === "true",
  production: isProductionMode,
};

module.exports = { env };
