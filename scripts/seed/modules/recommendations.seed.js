'use strict';

/**
 * Recommendations Seed Module
 * Generates product recommendation records per customer
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const REASONS = [
  'popular_with_cohort',
  'frequently_bought_together',
  'trending',
  'similar_to_viewed',
  'based_on_history',
  'new_arrival_in_category',
  'best_seller_in_category',
  'price_drop_alert',
];

class RecommendationsSeed {
  constructor() {
    this.logger = new SeedLogger('Recommendations');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info('🎯 Seeding Recommendations');

    await conn.collection('recommendations').deleteMany({});

    const customers = await conn.collection('users')
      .find({ role: 'buyer' }, { projection: { _id: 1 } })
      .limit(5000).toArray();
    const products = await conn.collection('products')
      .find({ status: 'active' }, { projection: { _id: 1, category: 1, rating: 1 } })
      .limit(5000).toArray();

    if (!customers.length || !products.length) {
      this.logger.warn('Not enough data for recommendations');
      return { created: 0 };
    }

    const topProducts = products.sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 200);
    const recDocs = [];
    const now = new Date();

    // Per-user recommendations (sample 2000 customers)
    const sampleCustomers = customers.slice(0, 2000);
    for (const customer of sampleCustomers) {
      const recommended = [];
      const pool = [...products].sort(() => Math.random() - 0.5).slice(0, 20);
      for (const prod of pool) {
        recommended.push({
          productId: prod._id.toString(),
          score: parseFloat((Math.random() * 0.5 + 0.5).toFixed(3)),
          reason: rand(REASONS),
          categoryContext: prod.category,
        });
      }

      recDocs.push({
        _id: new mongoose.Types.ObjectId(),
        userId: customer._id.toString(),
        type: 'personalized',
        recommendedProducts: recommended,
        trending: topProducts.slice(0, 10).map(p => p._id.toString()),
        lastUpdated: new Date(now.getTime() - randNum(0, 7) * 86400000),
        expiresAt: new Date(now.getTime() + 7 * 86400000),
        createdAt: now,
        updatedAt: now,
      });
    }

    // Global recommendation sets
    const globalSets = [
      { type: 'trending', label: 'Trending Now', reason: 'trending' },
      { type: 'best_sellers', label: 'Best Sellers', reason: 'popular_with_cohort' },
      { type: 'new_arrivals', label: 'New Arrivals', reason: 'new_arrival_in_category' },
      { type: 'top_rated', label: 'Top Rated', reason: 'popular_with_cohort' },
    ];
    for (const gs of globalSets) {
      const pool = [...products].sort(() => Math.random() - 0.5).slice(0, 50);
      recDocs.push({
        _id: new mongoose.Types.ObjectId(),
        userId: null,
        type: gs.type,
        label: gs.label,
        recommendedProducts: pool.map(p => ({
          productId: p._id.toString(),
          score: parseFloat((Math.random() * 0.5 + 0.5).toFixed(3)),
          reason: gs.reason,
        })),
        trending: [],
        lastUpdated: now,
        expiresAt: new Date(now.getTime() + 24 * 3600000),
        createdAt: now,
        updatedAt: now,
      });
    }

    const BATCH = 500;
    for (let i = 0; i < recDocs.length; i += BATCH) {
      await conn.collection('recommendations').insertMany(recDocs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, recDocs.length - i));
    }

    this.logger.printStats();
    return { created: recDocs.length };
  }
}

module.exports = RecommendationsSeed;
