'use strict';

/**
 * Commissions Seed Module
 * Populates commissions collection — category/brand commission rules
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

class CommissionsSeed {
  constructor() {
    this.logger = new SeedLogger('Commissions');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');

    await conn.collection('commissions').deleteMany({});
    await conn.collection('commissionrules').deleteMany({});

    // Category commission rates (matching Indian marketplace norms)
    const categoryCommissions = [
      { category: 'electronics',      categoryKey: 'electronics',       rate: 5.0,  minFee: 10,  maxFee: 500,  description: 'Electronics (phones, laptops, TVs)' },
      { category: 'computers',        categoryKey: 'computers',         rate: 5.0,  minFee: 20,  maxFee: 1000, description: 'Computers and peripherals' },
      { category: 'tv-audio',         categoryKey: 'tv-audio',          rate: 5.0,  minFee: 30,  maxFee: 800,  description: 'TV, Home Audio' },
      { category: 'appliances',       categoryKey: 'appliances',        rate: 8.0,  minFee: 50,  maxFee: 1500, description: 'Home Appliances' },
      { category: 'mens-fashion',     categoryKey: 'mens-fashion',      rate: 15.0, minFee: 10,  maxFee: 500,  description: "Men's Fashion" },
      { category: 'womens-fashion',   categoryKey: 'womens-fashion',    rate: 15.0, minFee: 10,  maxFee: 500,  description: "Women's Fashion" },
      { category: 'kids-fashion',     categoryKey: 'kids-fashion',      rate: 15.0, minFee: 8,   maxFee: 400,  description: "Kids' Fashion" },
      { category: 'footwear',         categoryKey: 'footwear',          rate: 12.0, minFee: 10,  maxFee: 400,  description: 'Footwear' },
      { category: 'beauty',           categoryKey: 'beauty',            rate: 18.0, minFee: 10,  maxFee: 300,  description: 'Beauty & Personal Care' },
      { category: 'health-wellness',  categoryKey: 'health-wellness',   rate: 10.0, minFee: 5,   maxFee: 200,  description: 'Health & Wellness' },
      { category: 'home-kitchen',     categoryKey: 'home-kitchen',      rate: 12.0, minFee: 15,  maxFee: 400,  description: 'Home & Kitchen' },
      { category: 'furniture',        categoryKey: 'furniture',         rate: 12.0, minFee: 100, maxFee: 3000, description: 'Furniture' },
      { category: 'books',            categoryKey: 'books',             rate: 6.0,  minFee: 5,   maxFee: 100,  description: 'Books & Media' },
      { category: 'sports',           categoryKey: 'sports',            rate: 10.0, minFee: 10,  maxFee: 500,  description: 'Sports & Fitness' },
      { category: 'toys',             categoryKey: 'toys',              rate: 12.0, minFee: 10,  maxFee: 300,  description: 'Toys & Baby Products' },
      { category: 'automotive',       categoryKey: 'automotive',        rate: 8.0,  minFee: 20,  maxFee: 500,  description: 'Automotive & Bikes' },
      { category: 'jewelry',          categoryKey: 'jewelry',           rate: 5.0,  minFee: 50,  maxFee: 2000, description: 'Gold & Diamond Jewellery' },
      { category: 'watches',          categoryKey: 'watches',           rate: 8.0,  minFee: 20,  maxFee: 1000, description: 'Watches' },
      { category: 'bags-luggage',     categoryKey: 'bags-luggage',      rate: 15.0, minFee: 20,  maxFee: 600,  description: 'Bags & Luggage' },
      { category: 'food-beverages',   categoryKey: 'food-beverages',    rate: 5.0,  minFee: 5,   maxFee: 100,  description: 'Food & Beverages' },
      { category: 'gaming',           categoryKey: 'gaming',            rate: 5.0,  minFee: 50,  maxFee: 2000, description: 'Gaming & Consoles' },
      { category: 'pet-supplies',     categoryKey: 'pet-supplies',      rate: 10.0, minFee: 10,  maxFee: 300,  description: 'Pet Supplies' },
      { category: 'industrial',       categoryKey: 'industrial',        rate: 6.0,  minFee: 20,  maxFee: 500,  description: 'Industrial & Tools' },
      { category: 'musical-instruments', categoryKey: 'musical-instruments', rate: 10.0, minFee: 20, maxFee: 500, description: 'Musical Instruments' },
      { category: 'garden-outdoors',  categoryKey: 'garden-outdoors',   rate: 10.0, minFee: 15,  maxFee: 400,  description: 'Garden & Outdoors' },
      { category: 'cameras-photo',    categoryKey: 'cameras-photo',     rate: 5.0,  minFee: 50,  maxFee: 1500, description: 'Cameras & Photography' },
      { category: 'office-stationery',categoryKey: 'office-stationery', rate: 10.0, minFee: 5,   maxFee: 200,  description: 'Office & Stationery' },
      { category: 'ethnic-traditional',categoryKey: 'ethnic-traditional',rate: 15.0, minFee: 20, maxFee: 800,  description: 'Ethnic & Traditional Wear' },
    ];

    const commissionDocs = categoryCommissions.map((c, i) => ({
      _id: new mongoose.Types.ObjectId(),
      type: 'category',
      name: c.description,
      categoryKey: c.categoryKey,
      category: c.category,
      commissionRate: c.rate,
      minimumFee: c.minFee,
      maximumFee: c.maxFee,
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null,
      active: true,
      sortOrder: i + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await conn.collection('commissions').insertMany(commissionDocs);
    this.logger.recordBatch(commissionDocs.length);

    // Seller tier commission rules
    const sellerTierRules = [
      { tier: 'Platinum', discount: 2.0,  requirement: 'Monthly GMV > ₹50L',  description: 'Platinum seller — 2% commission discount' },
      { tier: 'Gold',     discount: 1.5,  requirement: 'Monthly GMV > ₹20L',  description: 'Gold seller — 1.5% commission discount' },
      { tier: 'Silver',   discount: 1.0,  requirement: 'Monthly GMV > ₹5L',   description: 'Silver seller — 1% commission discount' },
      { tier: 'Standard', discount: 0.0,  requirement: 'Standard seller',       description: 'Standard seller — no discount' },
    ];

    const tierRuleDocs = sellerTierRules.map(r => ({
      _id: new mongoose.Types.ObjectId(),
      type: 'seller_tier',
      tier: r.tier,
      discountPercent: r.discount,
      requirement: r.requirement,
      description: r.description,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await conn.collection('commissionrules').insertMany(tierRuleDocs);
    this.logger.recordBatch(tierRuleDocs.length);

    this.logger.printStats();
    return { created: commissionDocs.length + tierRuleDocs.length, categories: commissionDocs.length, tiers: tierRuleDocs.length };
  }
}

module.exports = CommissionsSeed;
