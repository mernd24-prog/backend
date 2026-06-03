'use strict';

/**
 * Inventory Seed Module
 * Creates InventoryTransaction records (stock-in events) for products
 * Establishes warehouse inventory allocation
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

class InventorySeed {
  constructor() {
    this.logger = new SeedLogger('Inventory');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info('📊 Seeding Inventory Transactions');

    await conn.collection('inventorytransactions').deleteMany({});

    // Load products and warehouses
    const products = await conn.collection('products')
      .find({ status: 'ACTIVE' }, { projection: { _id: 1, sellerId: 1, sku: 1, stock: 1 } })
      .limit(5000)
      .toArray();

    const warehouses = await conn.collection('warehouses')
      .find({ type: { $in: ['fulfillment','mega'] } }, { projection: { _id: 1, code: 1 } })
      .toArray();

    if (!warehouses.length) {
      this.logger.warn('No warehouses found');
      return { created: 0 };
    }

    this.logger.info(`  Found ${products.length} products, ${warehouses.length} warehouses`);

    const txDocs = [];
    const idempotencyKeys = new Set();
    const now = new Date();

    const genKey = (productId, whCode, type) => {
      let key, tries = 0;
      do {
        key = `${productId}-${whCode}-${type}-${Math.random().toString(36).substring(2, 8)}`;
        tries++;
      } while (idempotencyKeys.has(key) && tries < 5);
      idempotencyKeys.add(key);
      return key;
    };

    for (const product of products) {
      // Assign to 1-3 warehouses
      const assignedWHs = warehouses.slice(0, randNum(1, 3));
      const totalStock = product.stock || randNum(10, 200);
      const stockPerWH = Math.ceil(totalStock / assignedWHs.length);

      for (const wh of assignedWHs) {
        const qty = Math.min(stockPerWH + randNum(-5, 20), stockPerWH + 20);
        if (qty <= 0) continue;

        // Initial stock-in transaction
        txDocs.push({
          _id: new mongoose.Types.ObjectId(),
          type: 'stock_in',
          productId: product._id.toString(),
          variantId: null,
          variantSku: null,
          sellerId: product.sellerId,
          warehouseId: wh._id.toString(),
          warehouseCode: wh.code,
          quantity: qty,
          runningBalance: qty,
          reason: 'initial_stock',
          referenceType: 'purchase_order',
          referenceId: `PO-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
          idempotencyKey: genKey(product._id.toString(), wh.code, 'stock_in'),
          notes: 'Initial inventory setup',
          metadata: { source: 'seed' },
          createdAt: new Date(now.getTime() - randNum(30, 365) * 86400000),
          updatedAt: new Date(),
        });

        // Occasional adjustment transactions (simulate real inventory movements)
        if (Math.random() < 0.3) {
          const adjustQty = randNum(-10, 20);
          txDocs.push({
            _id: new mongoose.Types.ObjectId(),
            type: adjustQty >= 0 ? 'adjustment_in' : 'adjustment_out',
            productId: product._id.toString(),
            variantId: null,
            variantSku: null,
            sellerId: product.sellerId,
            warehouseId: wh._id.toString(),
            warehouseCode: wh.code,
            quantity: Math.abs(adjustQty),
            runningBalance: qty + adjustQty,
            reason: 'physical_count_adjustment',
            referenceType: 'adjustment',
            referenceId: `ADJ-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
            idempotencyKey: genKey(product._id.toString(), wh.code, 'adj'),
            notes: 'Physical count adjustment',
            metadata: { source: 'seed' },
            createdAt: new Date(now.getTime() - randNum(1, 30) * 86400000),
            updatedAt: new Date(),
          });
        }
      }
    }

    const BATCH = 500;
    for (let i = 0; i < txDocs.length; i += BATCH) {
      await conn.collection('inventorytransactions').insertMany(txDocs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, txDocs.length - i));
    }

    this.logger.printStats();
    return { created: txDocs.length };
  }
}

module.exports = InventorySeed;
