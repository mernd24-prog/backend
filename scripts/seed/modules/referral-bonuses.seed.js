'use strict';

const SeedLogger = require('../utils/seed-logger');
const {
  InfluencerBonusRuleModel,
} = require('../../../src/modules/referral/models/referral.model');

const SEED_TAG = 'master-seed-referral-bonuses-v1';

const bonusRules = [
  {
    seedKey: 'test-first-order',
    ruleName: 'Test: First Referral Order',
    period: 'monthly',
    targetType: 'order_count',
    targetValue: 1,
    bonusType: 'fixed_coins',
    bonusValue: 25,
    applyTo: 'code_owner',
    resetCycle: 'monthly',
    releaseRule: 'instantly_available',
  },
  {
    seedKey: 'test-sales-500',
    ruleName: 'Test: INR 500 Referral Sales',
    period: 'monthly',
    targetType: 'order_value',
    targetValue: 500,
    bonusType: 'fixed_coins',
    bonusValue: 50,
    applyTo: 'all_eligible_influencers',
    resetCycle: 'monthly',
    releaseRule: 'instantly_available',
  },
  {
    seedKey: 'monthly-sales-starter',
    ruleName: 'Monthly Sales Starter',
    period: 'monthly',
    targetType: 'order_value',
    targetValue: 25000,
    bonusType: 'fixed_coins',
    bonusValue: 500,
    applyTo: 'code_owner',
    resetCycle: 'monthly',
    releaseRule: 'locked_until_all_related_orders_fulfilled',
  },
  {
    seedKey: 'monthly-order-sprint',
    ruleName: 'Monthly Order Sprint',
    period: 'monthly',
    targetType: 'order_count',
    targetValue: 20,
    bonusType: 'fixed_coins',
    bonusValue: 250,
    applyTo: 'code_owner',
    resetCycle: 'monthly',
    releaseRule: 'locked_until_period_ends',
  },
  {
    seedKey: 'quarterly-parent-growth',
    ruleName: 'Quarterly Parent Growth',
    period: 'quarterly',
    targetType: 'active_children',
    targetValue: 3,
    bonusType: 'fixed_coins',
    bonusValue: 1000,
    applyTo: 'parent',
    resetCycle: 'quarterly',
    releaseRule: 'locked_until_period_ends',
  },
  {
    seedKey: 'yearly-customer-reach',
    ruleName: 'Yearly Customer Reach',
    period: 'yearly',
    targetType: 'customer_count',
    targetValue: 100,
    bonusType: 'percentage_extra_coins',
    bonusValue: 5,
    applyTo: 'all_eligible_influencers',
    resetCycle: 'yearly',
    releaseRule: 'locked_until_period_ends',
  },
];

class ReferralBonusesSeed {
  constructor() {
    this.logger = new SeedLogger('ReferralBonuses');
  }

  async execute() {
    this.logger.info('Seeding referral bonus rules');
    const now = new Date();
    const seedKeys = bonusRules.map((rule) => rule.seedKey);

    await InfluencerBonusRuleModel.deleteMany({
      'metadata.seedTag': SEED_TAG,
      'metadata.seedKey': { $nin: seedKeys },
    });

    const result = await InfluencerBonusRuleModel.bulkWrite(
      bonusRules.map(({ seedKey, ...rule }) => ({
        updateOne: {
          filter: {
            'metadata.seedTag': SEED_TAG,
            'metadata.seedKey': seedKey,
          },
          update: {
            $set: {
              ...rule,
              status: 'active',
              metadata: {
                seedTag: SEED_TAG,
                seedKey,
                purpose: 'development-testing',
                testingRule: seedKey.startsWith('test-'),
              },
              updatedAt: now,
            },
            $setOnInsert: {
              createdAt: now,
              createdBy: 'master-seed',
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    this.logger.recordBatch(bonusRules.length);
    this.logger.printStats();
    return {
      created: Number(result.upsertedCount || 0),
      updated: Number(result.modifiedCount || 0),
      total: bonusRules.length,
    };
  }
}

module.exports = ReferralBonusesSeed;
