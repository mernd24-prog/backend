const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");
const { ApitxtClient } = require("./apitxt.client");
const { ApitxtService } = require("./apitxt.service");

console.log("\n========================================");
console.log("APITXT CONFIG");
console.log("========================================");
console.log("Base URL      :", env.apitxt.baseUrl);
console.log("API Key       :", env.apitxt.apiKey ? "Loaded" : "Missing");
console.log("Auth Key      :", env.apitxt.authKey ? "Loaded" : "Missing");
console.log("PAN URL       :", env.apitxt.panVerifyUrl);
console.log("Timeout (ms)  :", env.apitxt.timeoutMs);
console.log("Retries       :", env.apitxt.retries);
console.log("========================================\n");

const apitxtClient = new ApitxtClient({
  baseUrl: env.apitxt.baseUrl,
  apiKey: env.apitxt.apiKey,
  timeoutMs: env.apitxt.timeoutMs,
  retries: env.apitxt.retries,
  logger,
});

const apitxtService = new ApitxtService({
  client: apitxtClient,
  authKey: env.apitxt.authKey,
  panVerifyUrl: env.apitxt.panVerifyUrl,
});

module.exports = {
  ApitxtClient,
  ApitxtService,
  apitxtClient,
  apitxtService,
};