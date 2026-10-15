// Read-only diagnostic. Loads credentials from this backend's environment.
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
const { elasticsearchClient, checkElasticsearchConnection } = require('../src/shared/search/elasticsearch-client');
(async () => {
  try {
    const result = await checkElasticsearchConnection();
    if (!result.enabled) {
      console.log('Elasticsearch disabled by environment configuration.');
      process.exitCode = 1;
    } else if (!result.connected) process.exitCode = 1;
  } finally {
    if (elasticsearchClient.close) await elasticsearchClient.close();
  }
})().catch(error => { console.error('Diagnostic failed:', error.code || error.name); process.exitCode = 1; });
