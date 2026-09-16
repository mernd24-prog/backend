'use strict';

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

/**
 * Keeps the query-oriented ProductVariant collection in sync with the embedded
 * variants that are the source of truth for admin product create/edit flows.
 */
class VariantsSeed {
  constructor() {
    this.logger = new SeedLogger('Variants');
  }

  async execute() {
    const conn = mongoose.connection;
    const products = conn.collection('products');
    const variants = conn.collection('productvariants');
    await variants.deleteMany({ seedManaged: true });

    let created = 0;
    let operations = [];
    const cursor = products.find(
      { 'metadata.seedManaged': true, hasVariants: true },
      { projection: { sellerId: 1, productFamilyCode: 1, variants: 1 } },
    );

    for await (const product of cursor) {
      for (const variant of product.variants || []) {
        operations.push({
          insertOne: {
            document: {
              _id: variant._id || new mongoose.Types.ObjectId(),
              familyCode: product.productFamilyCode || 'GENERAL-FAMILY',
              productId: String(product._id), sellerId: String(product.sellerId), sku: variant.sku,
              attributes: variant.attributes || {}, stock: variant.stock || 0,
              reservedStock: variant.reservedStock || 0, status: variant.status || 'active',
              seedManaged: true, createdAt: new Date(), updatedAt: new Date(),
            },
          },
        });
        if (operations.length === 1000) {
          await variants.bulkWrite(operations, { ordered: false });
          created += operations.length; this.logger.recordBatch(operations.length); operations = [];
        }
      }
    }
    if (operations.length) {
      await variants.bulkWrite(operations, { ordered: false });
      created += operations.length; this.logger.recordBatch(operations.length);
    }
    this.logger.printStats();
    return { created, synchronizedFromEmbeddedVariants: true };
  }
}

module.exports = VariantsSeed;
