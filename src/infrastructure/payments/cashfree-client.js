const https = require("https");
const crypto = require("crypto");
const { env } = require("../../config/env");

/**
 * ==========================================================
 * CASHFREE REQUEST
 * ==========================================================
 */
function cashfreeRequest(path, method = "POST", body = null, headers = {}) {
  const cashfreeEnv = String(env.cashfree.env || "sandbox")
    .trim()
    .toLowerCase();

  const host =
    cashfreeEnv === "production" || cashfreeEnv === "live"
      ? "api.cashfree.com"
      : "sandbox.cashfree.com";

  const options = {
    hostname: host,
    port: 443,
    path,
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
  };

  console.log("\n================ CASHFREE REQUEST ================\n");

  console.log("Host:", host);
  console.log("Method:", method);
  console.log("Path:", path);

  console.log("\nHeaders:");
  console.log({
    ...options.headers,
    "x-client-secret": "***************",
  });

  if (body) {
    console.log("\nPayload:");
    console.log(JSON.stringify(body, null, 2));
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let response = "";

      res.on("data", (chunk) => {
        response += chunk;
      });

      res.on("end", () => {
        let parsed = {};

        try {
          parsed = response ? JSON.parse(response) : {};
        } catch (e) {
          parsed = {};
        }

        console.log("\n================ CASHFREE RESPONSE ================\n");

        console.log("Status:", res.statusCode);

        console.log("\nHeaders:");
        console.log(res.headers);

        console.log("\nBody:");
        console.log(JSON.stringify(parsed, null, 2));

        console.log("\n===================================================\n");

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed,
          rawData: response,
        });
      });
    });

    req.on("error", (err) => {
      console.error("\n============== CASHFREE REQUEST ERROR ==============");
      console.error(err);

      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * ==========================================================
 * CREATE ORDER
 * ==========================================================
 */

async function createOrder({
  amount,
  currency = "INR",
  orderId,
  customer = {},
  notes = {},
} = {}) {
  const headers = {
    "x-client-id": env.cashfree.appId,
    "x-client-secret": env.cashfree.secretKey,
    "x-api-version": "2022-09-01",
  };

  const orderMeta = {};
  const platformOrderId = notes.orderId || notes.order_id || orderId;

  if (notes.returnUrl || notes.return_url) {
    orderMeta.return_url =
      notes.returnUrl || notes.return_url;
  } else if (env.customerAppBaseUrl) {
    orderMeta.return_url = `${env.customerAppBaseUrl}/payment/success?orderId=${encodeURIComponent(platformOrderId)}`;
  }

  if (notes.notifyUrl || notes.notify_url) {
    orderMeta.notify_url =
      notes.notifyUrl || notes.notify_url;
  } else if (env.publicBaseUrl) {
    orderMeta.notify_url = `${env.publicBaseUrl}${env.apiPrefix}/payments/webhooks/cashfree`;
  }

  const body = {
    order_id: String(orderId || `order_${Date.now()}`),

    order_amount: Number(amount || 0),

    order_currency: currency,

    customer_details: {
      customer_id:
        customer.id ||
        notes.buyerId ||
        notes.customerId ||
        String(orderId),

      customer_name:
        customer.name ||
        notes.buyerName ||
        notes.customerName ||
        "Customer",

      customer_email:
        customer.email ||
        notes.buyerEmail ||
        notes.customerEmail ||
        "customer@example.com",

      customer_phone:
        customer.phone ||
        notes.buyerPhone ||
        notes.customerPhone ||
        "9999999999",
    },

    order_meta: orderMeta,

    order_note:
      notes.orderNote ||
      notes.note ||
      undefined,
  };

  console.log("\n============== CREATE CASHFREE ORDER ==============\n");

  console.log(JSON.stringify(body, null, 2));

  try {
    const result = await cashfreeRequest(
      "/pg/orders",
      "POST",
      body,
      headers
    );

        if (result.statusCode >= 400) {
      console.error("\n============= CASHFREE API ERROR =============");

      console.error("Status Code:", result.statusCode);

      console.error("Response:");
      console.error(JSON.stringify(result.body, null, 2));

      return {
        statusCode: result.statusCode,
        body: result.body,
        rawData: result.rawData,
      };
    }

    const paymentSessionId =
      result.body?.payment_session_id ||
      result.body?.paymentSessionId ||
      null;

    const orderToken =
      result.body?.order_token ||
      result.body?.cftoken ||
      null;

    const providerOrderId =
      result.body?.order_id ||
      result.body?.orderId ||
      body.order_id;

    console.log("\n================ CASHFREE SUCCESS ================\n");

    console.log("Provider Order ID:");
    console.log(providerOrderId);

    console.log("\nPayment Session ID:");
    console.log(paymentSessionId);

    console.log("\nOrder Token:");
    console.log(orderToken);

    console.log("\nCF Order ID:");
    console.log(result.body?.cf_order_id);

    console.log("\nOrder Status:");
    console.log(result.body?.order_status);

    console.log("\n=================================================\n");

    return {
      statusCode: result.statusCode,

      resp: {
        payment_session_id: paymentSessionId,
        paymentSessionId,

        order_token: orderToken,
        cftoken: orderToken,

        order_id: providerOrderId,
        orderId: providerOrderId,

        ...result.body,
      },

      body: result.body,

      rawData: result.rawData,
    };
  } catch (error) {
    console.error("\n================ CASHFREE EXCEPTION ================\n");

    console.error("Message:");
    console.error(error.message);

    console.error("\nStack:");
    console.error(error.stack);

    console.error("\n====================================================\n");

    throw error;
  }
}

async function getOrderPayments(providerOrderId) {
  const headers = {
    "x-client-id": env.cashfree.appId,
    "x-client-secret": env.cashfree.secretKey,
    "x-api-version": "2022-09-01",
  };

  return cashfreeRequest(
    `/pg/orders/${encodeURIComponent(providerOrderId)}/payments`,
    "GET",
    null,
    headers
  );
}

/**
 * ==========================================================
 * VERIFY WEBHOOK SIGNATURE
 * ==========================================================
 */

function verifyWebhookSignature(
  rawBody,
  signature,
  secret = env.cashfree.webhookSecret
) {
  if (!secret) {
    console.error("Cashfree webhook secret missing.");
    return false;
  }

  try {
    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("base64");

    console.log("\n============= CASHFREE WEBHOOK =============");

    console.log("Received Signature:");
    console.log(signature);

    console.log("Generated Signature:");
    console.log(generatedSignature);

    const verified = generatedSignature === signature;

    console.log("Verified:", verified);

    console.log("===========================================\n");

    return verified;
  } catch (err) {
    console.error("Webhook Signature Error:");
    console.error(err);

    return false;
  }
}

module.exports = {
  createOrder,
  getOrderPayments,
  verifyWebhookSignature,
  cashfreeRequest,
};
