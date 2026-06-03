'use strict';

/**
 * Collections Seed Module
 * Populates collections — curated product collections for homepage/marketing
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const COLLECTIONS = [
  // ── SEASONAL & FESTIVE ────────────────────────────────────────────────────
  { name: 'Diwali 2024 Collection', type: 'festive', description: 'Celebrate Diwali with our curated festive collection', categories: ['ethnic-traditional','home-decor','jewelry'], tags: ['Diwali','Festive'], sortOrder: 1, featured: true },
  { name: 'Navratri Garba Wear', type: 'festive', description: 'Dance the night away in stunning Navratri outfits', categories: ['ethnic-traditional','footwear'], tags: ['Navratri','Festive'], sortOrder: 2, featured: true },
  { name: 'Summer Collection 2024', type: 'seasonal', description: 'Beat the heat with our summer essentials', categories: ['mens-fashion','womens-fashion','footwear'], tags: ['Summer','Casual'], sortOrder: 3, featured: true },
  { name: 'Winter Warmth Essentials', type: 'seasonal', description: 'Stay cozy this winter', categories: ['mens-fashion','womens-fashion'], tags: ['Winter'], sortOrder: 4, featured: false },
  { name: 'Monsoon Must-Haves', type: 'seasonal', description: 'Be prepared for the rainy season', categories: ['footwear','bags-luggage'], tags: ['Monsoon'], sortOrder: 5, featured: false },
  // ── TRENDING ─────────────────────────────────────────────────────────────
  { name: 'Trending Now', type: 'trending', description: 'Most popular products this week', categories: ['electronics','fashion','beauty'], tags: ['Trending'], sortOrder: 6, featured: true },
  { name: 'New Arrivals', type: 'new_arrivals', description: 'Freshest products just added', categories: [], tags: ['New Arrival'], sortOrder: 7, featured: true },
  { name: 'Best Sellers', type: 'best_sellers', description: 'Our most loved products', categories: [], tags: ['Best Seller'], sortOrder: 8, featured: true },
  { name: 'Top Rated Products', type: 'top_rated', description: 'Highest rated by our customers', categories: [], tags: ['Top Rated'], sortOrder: 9, featured: true },
  // ── DEALS & OFFERS ────────────────────────────────────────────────────────
  { name: 'Great Indian Sale', type: 'sale', description: 'Biggest sale of the year — up to 80% off', categories: ['electronics','fashion','appliances'], tags: ['Sale','Discounted'], sortOrder: 10, featured: true },
  { name: 'Flash Sale', type: 'flash_sale', description: 'Limited time deals — grab before they are gone', categories: [], tags: ['Flash Sale'], sortOrder: 11, featured: true },
  { name: 'Under ₹499', type: 'budget', description: 'Great finds under ₹499', categories: ['food-beverages','beauty','home-kitchen'], tags: ['Under 499','Budget Friendly'], sortOrder: 12, featured: false },
  { name: 'Under ₹999', type: 'budget', description: 'Value picks under ₹999', categories: ['fashion','toys'], tags: ['Under 999'], sortOrder: 13, featured: false },
  { name: 'Premium Selection', type: 'premium', description: 'Luxury products for the discerning buyer', categories: ['jewelry','watches','electronics'], tags: ['Premium','Luxury'], sortOrder: 14, featured: false },
  // ── LIFESTYLE ─────────────────────────────────────────────────────────────
  { name: 'Work From Home Essentials', type: 'lifestyle', description: 'Everything you need for the perfect home office', categories: ['computers','furniture','appliances'], tags: [], sortOrder: 15, featured: false },
  { name: 'Home Makeover', type: 'lifestyle', description: 'Transform your home with our top picks', categories: ['furniture','home-kitchen'], tags: ['Home Decor'], sortOrder: 16, featured: false },
  { name: 'Fitness First', type: 'lifestyle', description: 'Start your fitness journey today', categories: ['sports','health-wellness'], tags: ['Fitness','Yoga','Gym'], sortOrder: 17, featured: false },
  { name: 'Organic & Natural', type: 'lifestyle', description: 'Clean, green, and natural products', categories: ['beauty','health-wellness','food-beverages'], tags: ['Organic','Natural','Eco Friendly'], sortOrder: 18, featured: false },
  { name: 'Gifting Guide', type: 'gifting', description: 'Find the perfect gift for your loved ones', categories: ['jewelry','electronics','beauty'], tags: ['Birthday Gift','Anniversary Gift'], sortOrder: 19, featured: false },
  { name: 'Baby & Kids Essentials', type: 'lifestyle', description: 'Everything for your little ones', categories: ['toys','kids-fashion'], tags: [], sortOrder: 20, featured: false },
  // ── CATEGORY SPOTLIGHTS ───────────────────────────────────────────────────
  { name: '5G Smartphones', type: 'category_spotlight', description: 'Explore the latest 5G phones', categories: ['smartphones'], tags: ['5G Phone'], sortOrder: 21, featured: false },
  { name: 'Gaming Zone', type: 'category_spotlight', description: 'Level up your gaming setup', categories: ['gaming','computers'], tags: ['Gaming Phone','Gaming Laptop'], sortOrder: 22, featured: false },
  { name: 'Ethnic Wear for Her', type: 'category_spotlight', description: 'Curated ethnic fashion for women', categories: ['sarees','kurtas-suits','lehengas'], tags: ['Ethnic Wear'], sortOrder: 23, featured: false },
  { name: 'Skincare Routine', type: 'category_spotlight', description: 'Build your perfect skincare routine', categories: ['skincare'], tags: ['Skincare','SPF'], sortOrder: 24, featured: false },
  { name: 'Furniture Under ₹10000', type: 'category_spotlight', description: 'Stylish and affordable furniture', categories: ['furniture'], tags: ['Budget Friendly'], sortOrder: 25, featured: false },
  // ── BRAND SPOTLIGHTS ─────────────────────────────────────────────────────
  { name: 'Apple Store', type: 'brand_spotlight', description: 'Official Apple products', categories: ['electronics','computers','smartwatches'], tags: ['iPhone','MacBook'], sortOrder: 26, featured: false, brandKey: 'apple' },
  { name: 'Samsung Universe', type: 'brand_spotlight', description: 'Samsung smartphones, TVs & appliances', categories: ['electronics','tv-audio','appliances'], tags: ['Samsung Galaxy'], sortOrder: 27, featured: false, brandKey: 'samsung' },
  { name: 'Nike & Adidas', type: 'brand_spotlight', description: 'Premium sports brands', categories: ['sports','footwear'], tags: ['Sports Wear'], sortOrder: 28, featured: false },
  { name: 'Mamaearth Natural Beauty', type: 'brand_spotlight', description: 'Natural, toxin-free skincare', categories: ['beauty'], tags: ['Natural','Organic'], sortOrder: 29, featured: false, brandKey: 'mamaearth' },
  { name: 'boAt Audio', type: 'brand_spotlight', description: 'Premium audio by boAt', categories: ['earphones','smartwatches'], tags: ['TWS Earbuds'], sortOrder: 30, featured: false, brandKey: 'boat' },
];

class CollectionsSeed {
  constructor() {
    this.logger = new SeedLogger('Collections');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info(`📦 Seeding Collections — ${COLLECTIONS.length} collections`);

    await conn.collection('collections').deleteMany({});

    const docs = COLLECTIONS.map(c => ({
      _id: new mongoose.Types.ObjectId(),
      name: c.name,
      slug: slugify(c.name),
      type: c.type,
      description: c.description,
      categories: c.categories || [],
      tags: c.tags || [],
      brandKey: c.brandKey || null,
      sortOrder: c.sortOrder,
      featured: c.featured,
      isActive: true,
      productCount: 0,
      bannerImage: `https://images.unsplash.com/photo-${1472851294608 + c.sortOrder}-062f824d29cc?w=1200`,
      thumbnailImage: `https://images.unsplash.com/photo-${1472851294608 + c.sortOrder}-062f824d29cc?w=400`,
      startsAt: new Date(),
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    await conn.collection('collections').insertMany(docs);
    this.logger.recordBatch(docs.length);
    this.logger.printStats();
    return { created: docs.length };
  }
}

module.exports = CollectionsSeed;
