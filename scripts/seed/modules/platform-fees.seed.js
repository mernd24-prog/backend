'use strict';

/**
 * Platform Fees Seed Module
 * Populates platformfees collection — fixed + % fees by category
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

class PlatformFeesSeed {
  constructor() {
    this.logger = new SeedLogger('PlatformFees');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');

    await conn.collection('platformfees').deleteMany({});

    const fees = [
      // Category-wise platform fees (Indian marketplace structure)
      { name: 'Electronics Platform Fee',      categoryKey: 'electronics',     feeType: 'percentage', value: 2.0,  fixedFee: 0,   minFee: 10,  maxFee: 200, currency: 'INR' },
      { name: 'Fashion Platform Fee',          categoryKey: 'mens-fashion',    feeType: 'percentage', value: 3.0,  fixedFee: 0,   minFee: 5,   maxFee: 100, currency: 'INR' },
      { name: 'Beauty Platform Fee',           categoryKey: 'beauty',          feeType: 'percentage', value: 3.0,  fixedFee: 0,   minFee: 5,   maxFee: 100, currency: 'INR' },
      { name: 'Appliances Platform Fee',       categoryKey: 'appliances',      feeType: 'percentage', value: 2.0,  fixedFee: 0,   minFee: 20,  maxFee: 500, currency: 'INR' },
      { name: 'Furniture Platform Fee',        categoryKey: 'furniture',       feeType: 'percentage', value: 2.5,  fixedFee: 0,   minFee: 50,  maxFee: 1000,currency: 'INR' },
      { name: 'Books Platform Fee',            categoryKey: 'books',           feeType: 'percentage', value: 1.5,  fixedFee: 0,   minFee: 2,   maxFee: 50,  currency: 'INR' },
      { name: 'Food & Grocery Platform Fee',   categoryKey: 'food-beverages',  feeType: 'percentage', value: 1.0,  fixedFee: 0,   minFee: 2,   maxFee: 30,  currency: 'INR' },
      { name: 'Jewelry Platform Fee',          categoryKey: 'jewelry',         feeType: 'percentage', value: 1.5,  fixedFee: 0,   minFee: 20,  maxFee: 500, currency: 'INR' },
      { name: 'Sports & Fitness Platform Fee', categoryKey: 'sports',          feeType: 'percentage', value: 2.5,  fixedFee: 0,   minFee: 5,   maxFee: 200, currency: 'INR' },
      { name: 'Toys Platform Fee',             categoryKey: 'toys',            feeType: 'percentage', value: 3.0,  fixedFee: 0,   minFee: 5,   maxFee: 150, currency: 'INR' },
      { name: 'Automotive Platform Fee',       categoryKey: 'automotive',      feeType: 'percentage', value: 2.0,  fixedFee: 0,   minFee: 10,  maxFee: 300, currency: 'INR' },
      // Fixed collection/closing fees
      { name: 'Standard Closing Fee (Low)',    categoryKey: null,              feeType: 'fixed',      value: 0,    fixedFee: 10,  minFee: 10,  maxFee: 10,  currency: 'INR', applicableRange: { min: 0, max: 499 } },
      { name: 'Standard Closing Fee (Medium)', categoryKey: null,             feeType: 'fixed',      value: 0,    fixedFee: 20,  minFee: 20,  maxFee: 20,  currency: 'INR', applicableRange: { min: 500, max: 999 } },
      { name: 'Standard Closing Fee (High)',   categoryKey: null,             feeType: 'fixed',      value: 0,    fixedFee: 50,  minFee: 50,  maxFee: 50,  currency: 'INR', applicableRange: { min: 1000, max: 4999 } },
      { name: 'Standard Closing Fee (Premium)',categoryKey: null,             feeType: 'fixed',      value: 0,    fixedFee: 100, minFee: 100, maxFee: 100, currency: 'INR', applicableRange: { min: 5000, max: null } },
      // Shipping contribution (seller to pay)
      { name: 'Shipping Fee Standard',         categoryKey: null,             feeType: 'fixed',      value: 0,    fixedFee: 40,  minFee: 40,  maxFee: 40,  currency: 'INR', feeContext: 'shipping', note: 'Per shipment ≤500g' },
      { name: 'Shipping Fee Heavy',            categoryKey: null,             feeType: 'fixed',      value: 0,    fixedFee: 80,  minFee: 80,  maxFee: 80,  currency: 'INR', feeContext: 'shipping', note: 'Per shipment >500g-1kg' },
      { name: 'Shipping Fee Oversized',        categoryKey: null,             feeType: 'fixed',      value: 0,    fixedFee: 150, minFee: 150, maxFee: 150, currency: 'INR', feeContext: 'shipping', note: 'Per shipment >1kg' },
      // Return handling
      { name: 'Return Handling Fee',           categoryKey: null,             feeType: 'fixed',      value: 0,    fixedFee: 50,  minFee: 50,  maxFee: 50,  currency: 'INR', feeContext: 'return' },
    ];

    const docs = fees.map((f, i) => ({
      _id: new mongoose.Types.ObjectId(),
      name: f.name,
      categoryKey: f.categoryKey || null,
      feeType: f.feeType,
      percentageValue: f.feeType === 'percentage' ? f.value : null,
      fixedFee: f.fixedFee || 0,
      minimumFee: f.minFee,
      maximumFee: f.maxFee,
      currency: f.currency || 'INR',
      applicableRange: f.applicableRange || null,
      feeContext: f.feeContext || 'transaction',
      note: f.note || null,
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null,
      active: true,
      sortOrder: i + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await conn.collection('platformfees').insertMany(docs);
    this.logger.recordBatch(docs.length);

    this.logger.printStats();
    return { created: docs.length };
  }
}

module.exports = PlatformFeesSeed;
