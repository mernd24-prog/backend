"use strict";

const https = require("https");
const { env } = require("../../../config/env");
const { AppError } = require("../../../shared/errors/app-error");
const { logger } = require("../../../shared/logger/logger");

class RazorpayXPayoutProvider {
  request(path, method = "GET", body = null) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = https.request({
        hostname: "api.razorpay.com",
        path,
        method,
        auth: `${env.razorpayX.keyId}:${env.razorpayX.keySecret}`,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          let parsed = {};
          try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { raw: data }; }
          if (res.statusCode >= 400) {
            logger.error({
              provider: "razorpayx",
              method,
              path,
              statusCode: res.statusCode,
              errorCode: parsed.error?.code || parsed.code || null,
              errorDescription: parsed.error?.description || parsed.message || null,
              field: parsed.error?.field || null,
            }, "RazorpayX API request failed");
            return reject(new AppError(parsed.error?.description || parsed.message || "RazorpayX payout request failed", res.statusCode));
          }
          logger.warn({
            provider: "razorpayx",
            method,
            path,
            statusCode: res.statusCode,
            entityId: parsed.id || null,
            entityStatus: parsed.status || null,
          }, "RazorpayX API request completed");
          return resolve(parsed);
        });
      });
      req.on("error", (error) => {
        logger.error({ err: error, provider: "razorpayx", method, path }, "RazorpayX API request errored");
        reject(error);
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  mockId(prefix) {
    return `${prefix}_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async createContact({ name, email, contact, referenceId, notes = {} }) {
    if (env.razorpayX.mock || !env.razorpayX.live) {
      return { id: this.mockId("cont"), name, email, contact, reference_id: referenceId, notes, mock: true };
    }
    logger.warn({ referenceId, hasEmail: Boolean(email), hasContact: Boolean(contact) }, "Creating RazorpayX contact for seller payout");
    return this.request("/v1/contacts", "POST", {
      name,
      email,
      contact,
      type: "vendor",
      reference_id: referenceId,
    });
  }

  async createFundAccount({ contactId, accountHolderName, accountNumber, ifsc, notes = {} }) {
    if (env.razorpayX.mock || !env.razorpayX.live) {
      return { id: this.mockId("fa"), contact_id: contactId, account_type: "bank_account", mock: true };
    }
    logger.warn({
      contactId,
      accountHolderName,
      accountNumberLast4: String(accountNumber || "").slice(-4),
      ifsc,
    }, "Creating RazorpayX fund account for seller payout");
    return this.request("/v1/fund_accounts", "POST", {
      contact_id: contactId,
      account_type: "bank_account",
      bank_account: {
        name: accountHolderName,
        ifsc,
        account_number: accountNumber,
      },
    });
  }

  async createPayout({ fundAccountId, amount, currency = "INR", referenceId, narration, notes = {} }) {
    if (!fundAccountId) throw new AppError("RazorpayX fund account is required", 400);
    if (Number(amount || 0) <= 0) throw new AppError("Payout amount must be greater than zero", 400);
    if (env.razorpayX.mock || !env.razorpayX.live) {
      return {
        id: this.mockId("pout"),
        status: "processed",
        amount: Math.round(Number(amount) * 100),
        currency,
        reference_id: referenceId,
        mock: true,
      };
    }
    logger.warn({
      fundAccountId,
      amount,
      currency,
      referenceId,
      mode: "IMPS",
      accountNumberConfigured: Boolean(env.razorpayX.accountNumber),
    }, "Creating RazorpayX payout");
    return this.request("/v1/payouts", "POST", {
      account_number: env.razorpayX.accountNumber,
      fund_account_id: fundAccountId,
      amount: Math.round(Number(amount) * 100),
      currency,
      mode: "IMPS",
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: referenceId,
      narration: String(narration || "Seller payout").slice(0, 30),
    });
  }

  async fetchPayout(payoutId) {
    if (!payoutId) throw new AppError("RazorpayX payout ID is required", 400);
    if (env.razorpayX.mock || !env.razorpayX.live || String(payoutId).includes("_mock_")) {
      return { id: payoutId, status: "processed", mock: true };
    }
    logger.warn({ payoutId }, "Fetching RazorpayX payout status");
    return this.request(`/v1/payouts/${encodeURIComponent(payoutId)}`, "GET");
  }
}

module.exports = { RazorpayXPayoutProvider };
