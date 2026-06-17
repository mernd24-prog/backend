'use strict';

const SeedLogger = require('../utils/seed-logger');
const { AnalyticsModel } = require('../../../src/modules/analytics/models/analytics.model');
const { UserModel } = require('../../../src/modules/user/models/user.model');
const { ProductModel } = require('../../../src/modules/product/models/product.model');
const { ROLES } = require('../../../src/shared/constants/roles');

const SEED_TAG = 'master-seed-analytics-v1';

class AnalyticsSeed {
  constructor() {
    this.logger = new SeedLogger('Analytics');
  }

  async execute() {
    this.logger.info('Seeding product, checkout, order, and refund analytics events');

    const [buyers, products, sellers] = await Promise.all([
      UserModel.find({ role: ROLES.BUYER }).limit(50),
      ProductModel.find({ status: 'active' }).limit(50),
      UserModel.find({ role: ROLES.SELLER }).limit(20),
    ]);

    if (!buyers.length || !products.length) {
      this.logger.warn('Customers or products not found. Run seed:customers and seed:products first.');
      return { created: 0, skipped: 1 };
    }

    await AnalyticsModel.deleteMany({ 'metadata.seedTag': SEED_TAG });

    const events = [];
    const eventNames = [
      'product_viewed',
      'product_added_to_cart',
      'checkout_started',
      'payment_succeeded',
      'order_delivered',
      'return_requested',
      'refund_completed',
      'invoice_downloaded',
      'seller_dashboard_viewed',
    ];

    for (let index = 0; index < 200; index += 1) {
      const buyer = buyers[index % buyers.length];
      const product = products[index % products.length];
      const eventName = eventNames[index % eventNames.length];
      events.push({
        eventName,
        actorId: eventName.startsWith('seller') && sellers.length
          ? String(sellers[index % sellers.length]._id)
          : String(buyer._id),
        metadata: {
          seedTag: SEED_TAG,
          productId: String(product._id),
          sellerId: product.sellerId,
          category: product.category,
          amount: product.salePrice || product.price || 0,
          channel: index % 3 === 0 ? 'admin' : index % 3 === 1 ? 'seller' : 'customer',
          occurredDaysAgo: index % 30,
        },
        createdAt: daysAgo(index % 30),
        updatedAt: new Date(),
      });
    }

    await AnalyticsModel.insertMany(events, { ordered: false });
    this.logger.recordBatch(events.length);
    this.logger.printStats();
    return { created: events.length };
  }
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

module.exports = AnalyticsSeed;
