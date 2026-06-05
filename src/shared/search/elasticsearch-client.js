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
      node: env.elasticsearchNode,
    })
  : createDisabledElasticsearchClient();

function isElasticsearchEnabled() {
  return env.elasticsearch.enabled;
}

module.exports = { elasticsearchClient, isElasticsearchEnabled };
