const PRODUCT_SEARCH_INDEX = "samglobal_products";

// Shared by full database-reset entry points. Keep mappings/settings intact and
// target only this application's product index, never other cluster indices.
async function resetSearchData({ client, enabled, logger = console } = {}) {
  if (enabled === undefined) {
    const search = require("../../src/shared/search/elasticsearch-client");
    enabled = search.isElasticsearchEnabled();
    client = client || search.elasticsearchClient;
  }
  if (!enabled) {
    logger.info("Elasticsearch reset skipped: Elasticsearch is disabled.");
    return { skipped: true, deleted: 0 };
  }
  try {
    const response = await client.deleteByQuery({
      index: PRODUCT_SEARCH_INDEX,
      query: { match_all: {} },
      // Immediate refresh requires the maintenance privilege, which the app
      // account intentionally does not have. Let normal index refresh expose
      // the deletions; wait_for_completion still waits for deletion to finish.
      refresh: false,
      wait_for_completion: true,
    });
    const result = response.body || response;
    if (result.timed_out || result.failures?.length || result.version_conflicts) {
      throw new Error("Elasticsearch product reset did not complete; refusing to reset database data.");
    }
    const deleted = Number(result.deleted || 0);
    logger.info(`Elasticsearch reset: cleared ${deleted} product documents from ${PRODUCT_SEARCH_INDEX}.`);
    return { skipped: false, deleted };
  } catch (error) {
    if (error?.meta?.statusCode === 404 && error?.meta?.body?.error?.type === "index_not_found_exception") {
      logger.info(`Elasticsearch reset: ${PRODUCT_SEARCH_INDEX} does not exist; nothing to clear.`);
      return { skipped: false, deleted: 0 };
    }
    throw error;
  }
}

module.exports = { resetSearchData, PRODUCT_SEARCH_INDEX };
