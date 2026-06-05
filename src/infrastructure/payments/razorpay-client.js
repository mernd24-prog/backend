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

  return expectedSignature === signature;
}

function verifyRazorpayWebhookSignature(rawBody, signature) {
  if (!env.razorpay.webhookSecret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", env.razorpay.webhookSecret)
    .update(rawBody)
    .digest("hex");

  return expectedSignature === signature;
}

module.exports = {
  getRazorpayClient,
  verifyRazorpaySignature,
  verifyRazorpayWebhookSignature,
};
