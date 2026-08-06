const { env } = require("../../../config/env");
const { createOrder } = require("../cashfree-client");
const { AppError } = require("../../../shared/errors/app-error");

class CashfreeProvider {
  constructor() {}

  async createOrder(payload = {}) {
    console.log("\n================ CASHFREE PROVIDER START ================\n");

    if (!env.cashfree.configured) {
      throw new AppError("Cashfree is not configured", 503);
    }

    const amount = Number(payload.amount || 0);
    const currency = payload.currency || "INR";

    const receipt =
      payload.receipt ||
      payload.notes?.orderId ||
      `cf_${Date.now()}`;

    console.log("Incoming Payload:");
    console.log(JSON.stringify(payload, null, 2));

    try {
      const resp = await createOrder({
        amount,
        currency,
        orderId: receipt,

        customer: {
          id:
            payload.customer?.id ||
            payload.notes?.buyerId ||
            payload.notes?.customerId,

          name:
            payload.customer?.name ||
            payload.notes?.buyerName ||
            payload.notes?.customerName ||
            "Customer",

          email:
            payload.customer?.email ||
            payload.notes?.buyerEmail ||
            payload.notes?.customerEmail ||
            "customer@example.com",

          phone:
            payload.customer?.phone ||
            payload.notes?.buyerPhone ||
            payload.notes?.customerPhone ||
            "9999999999",
        },

        notes: payload.notes || {},
      });

      console.log("\n============= CASHFREE CLIENT RESPONSE =============");
      console.log(JSON.stringify(resp, null, 2));

      if (resp.statusCode >= 400) {
        console.error("Cashfree returned error response.");

        return {
          providerOrderId: null,
          providerPaymentId: null,

          metadata: {
            statusCode: resp.statusCode,
            response: resp.body,
            rawResponse: resp.rawData,
          },

          autoCapture: false,

          checkout: null,
        };
      }

      const normalizedResponse = resp.resp || {};

      const paymentSessionId =
        normalizedResponse.payment_session_id ||
        normalizedResponse.paymentSessionId ||
        resp.body?.payment_session_id ||
        resp.body?.paymentSessionId ||
        null;

      const orderToken =
        normalizedResponse.order_token ||
        normalizedResponse.cftoken ||
        resp.body?.order_token ||
        resp.body?.cftoken ||
        null;

      const providerOrderId =
        normalizedResponse.order_id ||
        normalizedResponse.orderId ||
        resp.body?.order_id ||
        resp.body?.orderId ||
        receipt;

      console.log("\n============= EXTRACTED VALUES =============");
      console.log({
        paymentSessionId,
        orderToken,
        providerOrderId,
      });

      const checkout = {
        provider: "cashfree",

        appId: env.cashfree.appId,

        paymentSessionId,

        orderToken,

        orderId: providerOrderId,

        amount,

        currency,

        mode: env.cashfree.env || "sandbox",
      };

      console.log("\n============= CHECKOUT OBJECT =============");
      console.log(JSON.stringify(checkout, null, 2));

      console.log("\n============= RETURNING RESPONSE =============");

      return {
        providerOrderId,

        providerPaymentId: null,

        metadata: {
          cfOrderId: resp.body?.cf_order_id || null,

          orderStatus: resp.body?.order_status || null,

          response: resp.body,
        },

        autoCapture: false,

        checkout,
      };
    } catch (error) {
      console.error("\n============= CASHFREE PROVIDER ERROR =============");
      console.error(error);

      return {
        providerOrderId: null,

        providerPaymentId: null,

        metadata: {
          error: error.message,
          stack: error.stack,
        },

        autoCapture: false,

        checkout: null,
      };
    }
  }

  async verifyPayment(payload = {}) {
    console.log("\n============= VERIFY PAYMENT =============");
    console.log(JSON.stringify(payload, null, 2));

    return {
      status: "unknown",
      providerPaymentId: payload.providerPaymentId || null,
      providerOrderId: payload.providerOrderId || null,
    };
  }
}

module.exports = {
  CashfreeProvider,
};
