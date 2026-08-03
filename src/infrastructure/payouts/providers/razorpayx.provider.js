"use strict";

const https = require("https");
const { env } = require("../../../config/env");
const { AppError } = require("../../../shared/errors/app-error");

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
            return reject(new AppError(parsed.error?.description || parsed.message || "RazorpayX payout request failed", res.statusCode));
          }
          return resolve(parsed);
        });
      });
      req.on("error", reject);
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
    return this.request("/v1/contacts", "POST", {
      name,
      email,
      contact,
      type: "vendor",
      reference_id: referenceId,
      notes,
    });
  }

  async createFundAccount({ contactId, accountHolderName, accountNumber, ifsc, notes = {} }) {
    if (env.razorpayX.mock || !env.razorpayX.live) {
      return { id: this.mockId("fa"), contact_id: contactId, account_type: "bank_account", mock: true };
    }
    return this.request("/v1/fund_accounts", "POST", {
      contact_id: contactId,
      account_type: "bank_account",
      bank_account: {
        name: accountHolderName,
        ifsc,
        account_number: accountNumber,
      },
      notes,
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
        notes,
      };
    }
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
      notes,
    });
  }

  async fetchPayout(payoutId) {
    if (!payoutId) throw new AppError("RazorpayX payout ID is required", 400);
    if (env.razorpayX.mock || !env.razorpayX.live || String(payoutId).includes("_mock_")) {
      return { id: payoutId, status: "processed", mock: true };
    }
    return this.request(`/v1/payouts/${encodeURIComponent(payoutId)}`, "GET");
  }
}

module.exports = { RazorpayXPayoutProvider };
