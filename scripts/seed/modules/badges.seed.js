'use strict';

/**
 * Badges Seed Module
 * Populates badges collection — product and seller badges
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const BADGES = [
  { name: 'Best Seller',        code: 'BEST_SELLER',       type: 'product', color: '#FF6B35', bgColor: '#FFF3EE', icon: '🏆', description: 'Top selling product in its category', autoAssign: true, priority: 1 },
  { name: 'Top Rated',          code: 'TOP_RATED',         type: 'product', color: '#FFA500', bgColor: '#FFF8ED', icon: '⭐', description: 'Product with 4.5+ average rating', autoAssign: true, priority: 2 },
  { name: 'New Arrival',        code: 'NEW_ARRIVAL',       type: 'product', color: '#00B4D8', bgColor: '#E8F9FC', icon: '✨', description: 'Recently added product', autoAssign: true, priority: 3 },
  { name: 'Trending',           code: 'TRENDING',          type: 'product', color: '#9B5DE5', bgColor: '#F4EDFF', icon: '📈', description: 'Currently trending product', autoAssign: true, priority: 4 },
  { name: 'Limited Stock',      code: 'LIMITED_STOCK',     type: 'product', color: '#EF233C', bgColor: '#FEECEE', icon: '⚠️', description: 'Only few items left', autoAssign: true, priority: 5 },
  { name: 'Deal of the Day',    code: 'DEAL_OF_DAY',       type: 'product', color: '#E63946', bgColor: '#FEECEE', icon: '🔥', description: 'Special daily deal', autoAssign: false, priority: 6 },
  { name: 'Flat 50% Off',       code: 'FLAT_50_OFF',       type: 'product', color: '#E63946', bgColor: '#FEECEE', icon: '💥', description: 'Flat 50% discount', autoAssign: false, priority: 7 },
  { name: 'Bank Offer',         code: 'BANK_OFFER',        type: 'product', color: '#2A9D8F', bgColor: '#E8FAF8', icon: '💳', description: 'Extra discount with bank cards', autoAssign: false, priority: 8 },
  { name: 'Free Delivery',      code: 'FREE_DELIVERY',     type: 'product', color: '#06D6A0', bgColor: '#E8FEFA', icon: '🚚', description: 'Free shipping available', autoAssign: true, priority: 9 },
  { name: 'Assured',            code: 'ASSURED',           type: 'product', color: '#0077B6', bgColor: '#E6F4FA', icon: '✅', description: 'Quality assured by platform', autoAssign: false, priority: 10 },
  { name: 'Authentic',          code: 'AUTHENTIC',         type: 'product', color: '#2B9348', bgColor: '#EAF7EC', icon: '🔒', description: 'Guaranteed authentic product', autoAssign: false, priority: 11 },
  { name: 'Exchange Available', code: 'EXCHANGE',          type: 'product', color: '#4361EE', bgColor: '#EAF0FE', icon: '🔄', description: 'Old for new exchange available', autoAssign: false, priority: 12 },
  { name: 'EMI Available',      code: 'EMI_AVAILABLE',     type: 'product', color: '#4CC9F0', bgColor: '#EAF9FE', icon: '📆', description: 'No-cost EMI available', autoAssign: false, priority: 13 },
  { name: 'Combo Deal',         code: 'COMBO_DEAL',        type: 'product', color: '#F72585', bgColor: '#FEE8F3', icon: '🎁', description: 'Buy as a combo for extra savings', autoAssign: false, priority: 14 },
  { name: 'Eco Friendly',       code: 'ECO_FRIENDLY',      type: 'product', color: '#38B000', bgColor: '#EAF7E5', icon: '🌿', description: 'Environmentally friendly product', autoAssign: false, priority: 15 },
  { name: 'Handcrafted',        code: 'HANDCRAFTED',       type: 'product', color: '#C77DFF', bgColor: '#F5EBFF', icon: '🤝', description: 'Handmade / artisanal product', autoAssign: false, priority: 16 },
  { name: 'Certified Organic',  code: 'CERTIFIED_ORGANIC', type: 'product', color: '#38B000', bgColor: '#EAF7E5', icon: '🌱', description: 'Certified organic product', autoAssign: false, priority: 17 },
  { name: 'Imported',           code: 'IMPORTED',          type: 'product', color: '#3A86FF', bgColor: '#EAF2FF', icon: '✈️', description: 'Original imported product', autoAssign: false, priority: 18 },
  { name: 'Made in India',      code: 'MADE_IN_INDIA',     type: 'product', color: '#FF9500', bgColor: '#FFF4E6', icon: '🇮🇳', description: 'Made in India product', autoAssign: false, priority: 19 },
  { name: 'Festive Special',    code: 'FESTIVE_SPECIAL',   type: 'product', color: '#FF6B35', bgColor: '#FFF3EE', icon: '🪔', description: 'Special festive collection', autoAssign: false, priority: 20 },
  { name: 'Flash Sale',         code: 'FLASH_SALE',        type: 'product', color: '#E63946', bgColor: '#FEECEE', icon: '⚡', description: 'Limited time flash sale price', autoAssign: false, priority: 21 },
  { name: 'Clearance',          code: 'CLEARANCE',         type: 'product', color: '#6C757D', bgColor: '#F2F2F2', icon: '🏷️', description: 'Clearance sale item', autoAssign: false, priority: 22 },
  { name: 'Exclusive',          code: 'EXCLUSIVE',         type: 'product', color: '#9B5DE5', bgColor: '#F4EDFF', icon: '💎', description: 'Platform exclusive product', autoAssign: false, priority: 23 },
  // Seller badges
  { name: 'Verified Seller',    code: 'VERIFIED_SELLER',   type: 'seller',  color: '#0077B6', bgColor: '#E6F4FA', icon: '✅', description: 'KYC verified seller', autoAssign: true, priority: 1 },
  { name: 'Top Seller',         code: 'TOP_SELLER',        type: 'seller',  color: '#FF6B35', bgColor: '#FFF3EE', icon: '🏆', description: 'Consistently high performance', autoAssign: true, priority: 2 },
  { name: 'Fast Dispatcher',    code: 'FAST_DISPATCHER',   type: 'seller',  color: '#06D6A0', bgColor: '#E8FEFA', icon: '⚡', description: 'Ships within 24 hours', autoAssign: true, priority: 3 },
  { name: 'Brand Authorized',   code: 'BRAND_AUTHORIZED',  type: 'seller',  color: '#2B9348', bgColor: '#EAF7EC', icon: '🔐', description: 'Authorized brand reseller', autoAssign: false, priority: 4 },
  { name: 'GST Invoice',        code: 'GST_INVOICE',       type: 'seller',  color: '#4361EE', bgColor: '#EAF0FE', icon: '📄', description: 'Provides GST invoice', autoAssign: true, priority: 5 },
];

class BadgesSeed {
  constructor() {
    this.logger = new SeedLogger('Badges');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info(`🏅 Seeding Badges — ${BADGES.length} badges`);

    await conn.collection('badges').deleteMany({});

    const docs = BADGES.map(b => ({
      _id: new mongoose.Types.ObjectId(),
      ...b,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await conn.collection('badges').insertMany(docs);
    this.logger.recordBatch(docs.length);
    this.logger.printStats();
    return { created: docs.length };
  }
}

module.exports = BadgesSeed;
