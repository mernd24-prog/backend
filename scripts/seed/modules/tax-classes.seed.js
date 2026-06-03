'use strict';

/**
 * Tax Classes Seed Module
 * Populates taxclasses collection — standalone tax class definitions
 * Used in product management dropdowns for tax class selection
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const TAX_CLASSES = [
  { name: 'Zero Rated / Exempt', code: 'ZERO_RATED', gstRate: 0, cessRate: 0,
    description: 'Books, unprocessed food, medicines — fully exempt',
    applicableCategories: ['books', 'food-basic', 'medicines', 'agriculture'],
    examples: ['Printed books', 'Fresh vegetables', 'Essential drugs'] },
  { name: 'GST 3% (Precious Metals)', code: 'GST_3', gstRate: 3, cessRate: 0,
    description: 'Gold, silver, diamond, precious stones jewelry',
    applicableCategories: ['jewelry', 'fashion-jewelry'],
    examples: ['Gold jewelry', 'Diamond rings', 'Silver bangles'] },
  { name: 'GST 5% (Essential)', code: 'GST_5', gstRate: 5, cessRate: 0,
    description: 'Essential goods — packaged food, medicines, cheap garments',
    applicableCategories: ['food-processed', 'healthcare', 'textile-cheap', 'footwear-cheap'],
    examples: ['Sugar', 'Packed food', 'Medicines under ₹1000'] },
  { name: 'GST 12% (Standard)', code: 'GST_12', gstRate: 12, cessRate: 0,
    description: 'Standard rate — computers, furniture, appliances, sports goods',
    applicableCategories: ['computers', 'furniture', 'sports', 'toys'],
    examples: ['Laptops', 'Furniture', 'Bicycles', 'Toys'] },
  { name: 'GST 18% (Standard+)', code: 'GST_18', gstRate: 18, cessRate: 0,
    description: 'Most electronics, fashion, beauty, automotive accessories',
    applicableCategories: ['electronics', 'fashion', 'beauty', 'home', 'automotive'],
    examples: ['Smartphones', 'Clothing > ₹1000', 'Cosmetics'] },
  { name: 'GST 28% (Luxury)', code: 'GST_28', gstRate: 28, cessRate: 0,
    description: 'Luxury goods — premium cars, gaming, ACs, dishwashers',
    applicableCategories: ['gaming', 'luxury', 'premium-appliances'],
    examples: ['Gaming consoles', 'Air conditioners', 'Luxury cars'] },
  { name: 'GST 28% + Cess (Demerit)', code: 'GST_28_CESS', gstRate: 28, cessRate: 22,
    description: 'Demerit goods — tobacco, aerated drinks, luxury vehicles',
    applicableCategories: ['tobacco', 'aerated-drinks', 'luxury-vehicles'],
    examples: ['Cigarettes', 'Aerated water', 'SUVs > 4m'] },
];

class TaxClassesSeed {
  constructor() {
    this.logger = new SeedLogger('TaxClasses');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info(`📑 Seeding Tax Classes — ${TAX_CLASSES.length} classes`);

    await conn.collection('taxclasses').deleteMany({});

    const docs = TAX_CLASSES.map((tc, i) => ({
      _id: new mongoose.Types.ObjectId(),
      name: tc.name,
      code: tc.code,
      gstRate: tc.gstRate,
      cessRate: tc.cessRate,
      description: tc.description,
      applicableCategories: tc.applicableCategories,
      examples: tc.examples,
      sortOrder: i + 1,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await conn.collection('taxclasses').insertMany(docs);
    this.logger.recordBatch(docs.length);

    this.logger.printStats();
    return { created: docs.length };
  }
}

module.exports = TaxClassesSeed;
