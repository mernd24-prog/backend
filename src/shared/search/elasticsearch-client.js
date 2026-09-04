const { Client } = require("@elastic/elasticsearch");
const { env } = require("../../config/env");

function makeDisabledResponse(operation) {
  return {
    acknowledged: true,
    disabled: true,
    operation,
    reason: "Elasticsearch is disabled by environment configuration.",
  };
}

function createDisabledElasticsearchClient() {
  return {
    search() {
      const error = new Error("Elasticsearch is disabled by environment configuration.");
      error.code = "ELASTICSEARCH_DISABLED";
      error.disabled = true;
      return Promise.reject(error);
    },
    index() {
      return Promise.resolve(makeDisabledResponse("index"));
    },
    update() {
      return Promise.resolve(makeDisabledResponse("update"));
    },
    delete() {
      return Promise.resolve(makeDisabledResponse("delete"));
    },
    indices: {
      delete() {
        return Promise.resolve(makeDisabledResponse("indices.delete"));
      },
    },
  };
}

const elasticsearchClient = env.elasticsearch.enabled
  ? new Client({
      node: env.elasticsearchUrl,
      auth: {
        username: env.elasticsearchUsername,
        password: env.elasticsearchPassword,
      },
      maxRetries: 0,
      requestTimeout: 5000,
      tls: { rejectUnauthorized: false }, // temporary for local testing; use CA cert in production
    })
  : createDisabledElasticsearchClient();

function isElasticsearchEnabled() {
  return env.elasticsearch.enabled;
}

console.log("\n========================================");
console.log("ELASTICSEARCH CONFIG");
console.log("========================================");
console.log("Enabled       :", env.elasticsearch.enabled ? "Yes" : "No");
console.log("Node URL      :", env.elasticsearchUrl || "Not set");
console.log("Username      :", env.elasticsearchUsername ? "Loaded" : "Missing");
console.log("Password      :", env.elasticsearchPassword ? "Loaded" : "Missing");
console.log("Mode          :", env.elasticsearch.mode);
console.log("Index         :", "samglobal_products");
console.log("Timeout (ms)  :", 5000);
console.log("========================================\n");

module.exports = { elasticsearchClient, isElasticsearchEnabled };
