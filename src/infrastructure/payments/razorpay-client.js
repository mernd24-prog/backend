const Razorpay = require("razorpay");
const crypto = require("crypto");
const { env } = require("../../config/env");
const { AppError } = require("../../shared/errors/app-error");

let razorpayClient = null;

function getRazorpayClient() {
  if (razorpayClient) {
    return razorpayClient;
  }

  if (!env.razorpay.live) {
    throw new AppError("Razorpay live mode is disabled by environment configuration", 503);
  }

  if (!env.razorpay.keyId || !env.razorpay.keySecret) {
    throw new AppError("Razorpay live credentials are not configured", 503, {
      missingKeys: env.razorpay.missingKeys,
    });
  }

  razorpayClient = new Razorpay({
    key_id: env.razorpay.keyId,
    key_secret: env.razorpay.keySecret,
  });
  // The SDK does not expose timeout in its constructor, but its HTTP client is
  // Axios. Set a finite deadline so provider degradation cannot pin requests.
  if (razorpayClient.api?.rq?.defaults) {
    razorpayClient.api.rq.defaults.timeout = env.razorpay.timeoutMs;
  }

  return razorpayClient;
}

function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  if (!env.razorpay.keySecret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", env.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const received = Buffer.from(String(signature || ""), "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function verifyRazorpayWebhookSignature(rawBody, signature, secret = env.razorpay.webhookSecret) {
  if (!secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const received = Buffer.from(String(signature || ""), "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

module.exports = {
  getRazorpayClient,
  verifyRazorpaySignature,
  verifyRazorpayWebhookSignature,
};
