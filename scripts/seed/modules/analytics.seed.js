'use strict';

/**
 * Analytics Seed Module
 * Generates product/category/seller analytics events
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const EVENT_TYPES = ['product_view','product_click','add_to_wishlist','add_to_cart','purchase','search_click','banner_click','category_view','seller_view'];
const SOURCES = ['organic','google','facebook','instagram','email','push','direct','referral'];
const DEVICES = ['mobile','tablet','desktop'];
const PLATFORMS = ['android','ios','web'];

class AnalyticsSeed {
  constructor() {
    this.logger = new SeedLogger('Analytics');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info('📊 Seeding Analytics Events — 200,000 events');

    await conn.collection('analytics').deleteMany({});

    const products = await conn.collection('products')
      .find({ status: 'ACTIVE' }, { projection: { _id: 1, sellerId: 1, category: 1, parentCategory: 1 } })
      .limit(3000).toArray();
    const customers = await conn.collection('users')
      .find({ role: 'BUYER' }, { projection: { _id: 1 } })
      .limit(3000).toArray();

    if (!products.length) {
      this.logger.warn('No products for analytics');
      return { created: 0 };
    }

    const now = new Date();
    const totalEvents = 200000;
    const analyticsDocs = [];

    for (let i = 0; i < totalEvents; i++) {
      const product = products[i % products.length];
      const eventName = rand(EVENT_TYPES);
      const daysAgo = randNum(0, 365);
      const customer = customers.length ? rand(customers) : null;

      analyticsDocs.push({
        _id: new mongoose.Types.ObjectId(),
        eventName,
        actorId: customer ? customer._id.toString() : null,
        sessionId: Math.random().toString(36).substring(2, 18),
        metadata: {
          productId: product._id.toString(),
          sellerId: product.sellerId,
          category: product.category,
          parentCategory: product.parentCategory,
          source: rand(SOURCES),
          device: rand(DEVICES),
          platform: rand(PLATFORMS),
          value: eventName === 'purchase' ? randNum(100, 50000) : null,
          quantity: eventName === 'purchase' || eventName === 'add_to_cart' ? randNum(1, 3) : null,
        },
        ipAddress: `${randNum(1,255)}.${randNum(0,255)}.${randNum(0,255)}.${randNum(0,255)}`,
        userAgent: 'Mozilla/5.0 (compatible; seed)',
        createdAt: new Date(now.getTime() - daysAgo * 86400000),
        updatedAt: new Date(),
      });
    }

    const BATCH = 1000;
    for (let i = 0; i < analyticsDocs.length; i += BATCH) {
      await conn.collection('analytics').insertMany(analyticsDocs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, analyticsDocs.length - i));
    }

    this.logger.printStats();
    return { created: analyticsDocs.length };
  }
}

module.exports = AnalyticsSeed;
