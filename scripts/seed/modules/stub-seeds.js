/**
 * Quick stub modules for rapid seed execution
 */

const { v4: uuidv4 } = require('uuid');
const SeedLogger = require('../utils/seed-logger');

class QuickSeedModule {
  constructor(moduleName, config = {}) {
    this.moduleName = moduleName;
    this.logger = new SeedLogger(moduleName);
    this.mongoose = require('mongoose');
    this.config = config;
  }

  async execute() {
    try {
      this.logger.info(`⚡ Seeding ${this.moduleName}`);
      const connection = this.mongoose.connection;
      const collection = connection.collection(this.config.collection || this.moduleName);
      
      const docs = this.generateDocs();
      
      if (docs.length > 0) {
        const batchSize = 1000;
        for (let i = 0; i < docs.length; i += batchSize) {
          const batch = docs.slice(i, i + batchSize);
          await collection.insertMany(batch);
          this.logger.recordBatch(batch.length);
        }
      }
      
      this.logger.printStats();
      return { created: docs.length };
    } catch (error) {
      this.logger.error(`${this.moduleName} seeding failed`, error);
      throw error;
    }
  }

  generateDocs() {
    const count = this.config.count || 100;
    return Array.from({ length: count }, (_, i) => ({
      _id: uuidv4(),
      name: `${this.moduleName} ${i + 1}`,
      slug: `${this.moduleName.toLowerCase()}-${i + 1}`,
      active: true,
      createdAt: new Date(),
    }));
  }
}

// Factory for creating quick stubs
const createQuickModule = (name, collection, count) => {
  return class extends QuickSeedModule {
    constructor() {
      super(name, { collection, count });
    }
  };
};

// Export specific modules
module.exports = {
  QuickSeedModule,
  createQuickModule,
  PlatformFeesSeed: createQuickModule('Platform Fees', 'platformFees', 50),
  CommissionsSeed: createQuickModule('Commissions', 'commissions', 200),
  BadgesSeed: createQuickModule('Badges', 'badges', 100),
  TagsSeed: createQuickModule('Tags', 'tags', 200),
  CollectionsSeed: createQuickModule('Collections', 'collections', 150),
  FamiliesSeed: createQuickModule('Families', 'families', 500),
  InventorySeed: createQuickModule('Inventory', 'inventory', 100),
  RecommendationsSeed: createQuickModule('Recommendations', 'recommendations', 200),
  AnalyticsSeed: createQuickModule('Analytics', 'analytics', 100),
  SearchSeed: createQuickModule('Search', 'search', 100),
  NotificationsSeed: createQuickModule('Notifications', 'notifications', 100),
};
