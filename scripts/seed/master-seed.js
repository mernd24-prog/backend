#!/usr/bin/env node

/**
 * Master Seed Script - Enterprise Ecommerce Platform
 * Orchestrates complete database seeding with modular architecture
 * 
 * Usage:
 *   npm run seed:all                    # Full reset and seed
 *   npm run seed:locations              # Seed only locations
 *   npm run seed:products               # Seed only products
 *   npm run seed:append                 # Append to existing data
 */

const path = require('path');
const pino = require('pino');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConnection = require('./utils/db-connection');
const SeedLogger = require('./utils/seed-logger');

// Initialize master logger
const masterLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, singleLine: false },
  },
});

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'all';
const flags = args.slice(1);
const shouldReset = flags.includes('--reset') || flags.includes('-r');
const shouldAppend = flags.includes('--append') || flags.includes('-a');

// Module execution map
const seedModules = {
  locations: 'locations.seed.js',
  countries: 'countries.seed.js',
  categories: 'categories.seed.js',
  brands: 'brands.seed.js',
  attributes: 'attributes.seed.js',
  options: 'options.seed.js',
  families: 'families.seed.js',
  gst: 'gst.seed.js',
  hsn: 'hsn.seed.js',
  'tax-classes': 'tax-classes.seed.js',
  commissions: 'commissions.seed.js',
  'platform-fees': 'platform-fees.seed.js',
  badges: 'badges.seed.js',
  tags: 'tags.seed.js',
  collections: 'collections.seed.js',
  sellers: 'sellers.seed.js',
  warehouses: 'warehouses.seed.js',
  products: 'products.seed.js',
  variants: 'variants.seed.js',
  inventory: 'inventory.seed.js',
  customers: 'customers.seed.js',
  orders: 'orders.seed.js',
  reviews: 'reviews.seed.js',
  recommendations: 'recommendations.seed.js',
  analytics: 'analytics.seed.js',
  search: 'search.seed.js',
  notifications: 'notifications.seed.js',
};

// Full seed order (with dependencies)
const fullSeedOrder = [
  'countries',
  'locations',
  'categories',
  'brands',
  'attributes',
  'options',
  'families',
  'gst',
  'hsn',
  'tax-classes',
  'commissions',
  'platform-fees',
  'badges',
  'tags',
  'collections',
  'sellers',
  'warehouses',
  'products',
  'variants',
  'inventory',
  'customers',
  'orders',
  'reviews',
  'recommendations',
  'analytics',
  'search',
  'notifications',
];

class MasterSeed {
  constructor() {
    this.logger = masterLogger;
    this.results = {};
    this.startTime = Date.now();
  }

  async initialize() {
    try {
      this.logger.info('🚀 Master Seed Initialization');
      this.logger.info(`Command: ${command}`);
      this.logger.info(`Reset: ${shouldReset}, Append: ${shouldAppend}`);

      await dbConnection.connect();
      this.logger.info('✓ Database connections established');

      if (shouldReset && command === 'all') {
        await this.resetDatabase();
      }

      return true;
    } catch (error) {
      this.logger.error({ error }, '✗ Initialization failed');
      throw error;
    }
  }

  async resetDatabase() {
    try {
      this.logger.warn('⚠ Resetting database (truncating PostgreSQL, clearing MongoDB)');

      // PostgreSQL tables to truncate
      const pgTables = [
        'order_items', 'order_status_history', 'orders', 'payments', 'returns',
        'seller_commissions', 'seller_payouts',
        'tax_invoices', 'tax_ledger_entries',
        'wallet_transactions', 'wallets',
        'gst_filings', 'seller_kyc',
      ];

      // MongoDB collections to clear (using actual Mongoose collection names)
      const mongoCollections = [
        'products', 'productvariants', 'productfamilies', 'productreviews', 'productspecifications',
        'categorytrees',
        'platformbrands',
        'platformproductoptions', 'platformproductoptionvalues',
        'productattributes',
        'hsncodes', 'admintaxes', 'adminsubtaxes', 'admintaxrules', 'taxclasses', 'gstslabs',
        'admincountries', 'adminstates', 'admincities', 'adminzipcodes',
        'countries', 'geographies',
        'users', 'carts',
        'warehouses', 'inventorytransactions', 'inventoryreservations',
        'commissions', 'commissionrules',
        'platformfees',
        'badges', 'tags', 'collections',
        'recommendations',
        'analytics',
        'searchsynonyms', 'searchredirects', 'searchautocomplete', 'searchfacets', 'searchpopular',
        'notifications', 'notificationtemplates', 'notificationqueues',
      ];

      await dbConnection.truncate(pgTables);
      await dbConnection.dropMongoDB(mongoCollections);

      this.logger.info('✓ Database reset complete');
    } catch (error) {
      this.logger.error({ error }, 'Error resetting database');
      throw error;
    }
  }

  async executeModule(moduleName) {
    const moduleFile = seedModules[moduleName];
    if (!moduleFile) {
      this.logger.warn(`Module not found: ${moduleName}`);
      return { skipped: true };
    }

    const modulePath = path.join(__dirname, 'modules', moduleFile);

    if (!fs.existsSync(modulePath)) {
      this.logger.warn(`Module file not found: ${modulePath}`);
      return { skipped: true };
    }

    try {
      this.logger.info(`\n📦 Executing module: ${moduleName}`);
      const SeedModule = require(modulePath);
      const module = new SeedModule();
      
      const result = await module.execute();
      this.logger.info(`✓ ${moduleName} completed`, result);
      
      return result;
    } catch (error) {
      this.logger.error({ error }, `✗ Module failed: ${moduleName}`);
      throw error;
    }
  }

  async executeSeed() {
    try {
      if (command === 'all') {
        this.logger.info('🎯 Running FULL SEED');
        for (const moduleName of fullSeedOrder) {
          try {
            this.results[moduleName] = await this.executeModule(moduleName);
          } catch (error) {
            this.logger.error({ error }, `Failed to execute ${moduleName}`);
            if (args.includes('--stop-on-error')) {
              throw error;
            }
          }
        }
      } else {
        this.logger.info(`🎯 Running SELECTIVE SEED: ${command}`);
        this.results[command] = await this.executeModule(command);
      }

      return true;
    } catch (error) {
      this.logger.error({ error }, 'Seed execution failed');
      throw error;
    }
  }

  printSummary() {
    const duration = Date.now() - this.startTime;
    const durationSeconds = (duration / 1000).toFixed(2);

    console.log('\n' + '='.repeat(70));
    console.log('📊 SEED EXECUTION SUMMARY');
    console.log('='.repeat(70));

    let totalCreated = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const [module, result] of Object.entries(this.results)) {
      if (!result.skipped) {
        totalCreated += result.created || 0;
        totalSkipped += result.skipped || 0;
        totalFailed += result.failed || 0;
        console.log(`${module.padEnd(25)} | Created: ${(result.created || 0).toString().padStart(6)} | Skipped: ${(result.skipped || 0).toString().padStart(4)}`);
      }
    }

    console.log('-'.repeat(70));
    console.log(`Total Records Created: ${totalCreated.toString().padStart(40)}`);
    console.log(`Total Records Skipped: ${totalSkipped.toString().padStart(40)}`);
    console.log(`Total Failed: ${totalFailed.toString().padStart(50)}`);
    console.log(`Duration: ${durationSeconds}s`.padStart(68));
    console.log('='.repeat(70) + '\n');

    this.logger.info(`✓ Seed completed in ${durationSeconds}s`);
  }

  async run() {
    try {
      await this.initialize();
      await this.executeSeed();
      this.printSummary();
      await dbConnection.disconnect();
      process.exit(0);
    } catch (error) {
      this.logger.error({ error }, '✗ Master seed failed');
      await dbConnection.disconnect();
      process.exit(1);
    }
  }
}

// Execute
const seed = new MasterSeed();
seed.run();

module.exports = MasterSeed;
