'use strict';

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');
const { elasticsearchClient, isElasticsearchEnabled } = require('../../../src/shared/search/elasticsearch-client');
const { buildProductSearchDocument } = require('../../../src/shared/search/product-search-document');

class SearchSeed {
  constructor() {
    this.logger = new SeedLogger('Search');
  }

  async execute() {
    if (!isElasticsearchEnabled()) {
      this.logger.info('Elasticsearch is disabled; MongoDB fallback remains available.');
      return { created: 0, skipped: true, source: 'mongo_fallback' };
    }

    const index = 'samglobal_products';
    const exists = await elasticsearchClient.indices.exists({ index });
    if (!exists) {
      await elasticsearchClient.indices.create({
        index,
        mappings: { dynamic: true, properties: {
          title: { type: 'text', fields: { keyword: { type: 'keyword' } } }, description: { type: 'text' },
          category: { type: 'keyword' }, categoryId: { type: 'keyword' }, brand: { type: 'keyword' }, sku: { type: 'keyword' },
          sellerId: { type: 'keyword' }, organizationId: { type: 'keyword' }, status: { type: 'keyword' }, approvalStatus: { type: 'keyword' },
          visibility: { type: 'keyword' }, price: { type: 'double' }, salePrice: { type: 'double' }, rating: { type: 'float' },
          stock: { type: 'integer' }, availableStock: { type: 'integer' }, publishedAt: { type: 'date' }, createdAt: { type: 'date' }, updatedAt: { type: 'date' },
          tags: { type: 'keyword' }, attributes: { type: 'flattened' }, variants: { type: 'object', enabled: true },
        } },
      });
    }

    let created = 0;
    let actions = [];
    const cursor = mongoose.connection.collection('products').find({ status: 'active', approvalStatus: 'approved', visibility: 'public' });
    for await (const product of cursor) {
      actions.push({ index: { _index: index, _id: String(product._id) } }, buildProductSearchDocument(product));
      if (actions.length >= 1000) {
        const response = await elasticsearchClient.bulk({ operations: actions, refresh: false });
        if (response.errors) throw new Error('Elasticsearch bulk indexing returned item errors.');
        created += actions.length / 2; this.logger.recordBatch(actions.length / 2); actions = [];
      }
    }
    if (actions.length) {
      const response = await elasticsearchClient.bulk({ operations: actions, refresh: false });
      if (response.errors) throw new Error('Elasticsearch bulk indexing returned item errors.');
      created += actions.length / 2; this.logger.recordBatch(actions.length / 2);
    }
    await elasticsearchClient.indices.refresh({ index });
    this.logger.printStats();
    return { created, indexedProducts: created, index };
  }
}

module.exports = SearchSeed;
