'use strict';

/**
 * Search Seed Module
 * Populates search synonyms, redirects, autocomplete, pinned products
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const SYNONYMS = [
  { from: 'mobile', to: ['smartphone','phone','cellphone','handset'], bidirectional: true },
  { from: 'smartphone', to: ['mobile phone','cell phone','android phone'], bidirectional: true },
  { from: 'tv', to: ['television','smart tv','led tv','4k tv'], bidirectional: true },
  { from: 'laptop', to: ['notebook','computer','pc laptop'], bidirectional: true },
  { from: 'shoe', to: ['footwear','sneakers','boots','sandals'], bidirectional: true },
  { from: 'headphone', to: ['earphone','earbuds','headset','tws'], bidirectional: true },
  { from: 'fridge', to: ['refrigerator','cool box','freezer'], bidirectional: true },
  { from: 'ac', to: ['air conditioner','split ac','window ac','air conditioning'], bidirectional: true },
  { from: 'mixer', to: ['mixer grinder','blender','juicer'], bidirectional: true },
  { from: 'kurta', to: ['kurti','ethnic top','traditional top','salwar kameez'], bidirectional: true },
  { from: 'saree', to: ['sari','silk saree','cotton saree'], bidirectional: true },
  { from: 'dupatta', to: ['stole','scarf','chunni'], bidirectional: true },
  { from: 'watch', to: ['wristwatch','timepiece','smartwatch'], bidirectional: true },
  { from: 'bag', to: ['handbag','purse','backpack','tote'], bidirectional: true },
  { from: 'camera', to: ['dslr','mirrorless camera','digital camera'], bidirectional: true },
  { from: 'sofa', to: ['couch','settee','loveseat','divan'], bidirectional: true },
  { from: 'mattress', to: ['bed mattress','sleeping mattress','foam mattress'], bidirectional: true },
  { from: 'cricket bat', to: ['willow bat','english willow','kashmir willow'], bidirectional: true },
  { from: 'protein', to: ['whey protein','protein powder','mass gainer'], bidirectional: true },
  { from: 'sunscreen', to: ['sunblock','spf cream','uv protection','sun lotion'], bidirectional: true },
  { from: 'moisturizer', to: ['lotion','face cream','skin cream','body cream'], bidirectional: true },
  { from: 'serum', to: ['face serum','vitamin c serum','skin serum'], bidirectional: true },
  { from: 'kajal', to: ['kohl','eye liner','eye pencil'], bidirectional: true },
  { from: 'press cooker', to: ['pressure cooker','cooker'], bidirectional: true },
  { from: 'oven', to: ['microwave','otg','convection oven'], bidirectional: true },
  { from: 'iphone', to: ['apple phone','ios phone','apple smartphone'], bidirectional: false },
  { from: 'airpods', to: ['apple earbuds','apple earphones','wireless earbuds apple'], bidirectional: false },
  { from: 'redmi', to: ['xiaomi redmi','mi phone','poco'], bidirectional: true },
  { from: 'oneplus', to: ['one plus phone','oxygen os phone'], bidirectional: true },
  { from: 'galaxy', to: ['samsung galaxy','samsung phone'], bidirectional: false },
];

const REDIRECTS = [
  { query: 'iphone 15', targetUrl: '/search?q=Apple+iPhone+15&brand=apple&category=smartphones' },
  { query: 'samsung s24', targetUrl: '/search?q=Samsung+Galaxy+S24&brand=samsung&category=smartphones' },
  { query: 'oneplus 12', targetUrl: '/search?q=OnePlus+12&brand=oneplus&category=smartphones' },
  { query: 'macbook air', targetUrl: '/search?q=MacBook+Air+M2&brand=apple&category=laptops' },
  { query: 'ps5', targetUrl: '/search?q=PlayStation+5&brand=sony&category=consoles' },
  { query: 'airpods pro', targetUrl: '/search?q=AirPods+Pro&brand=apple&category=earphones' },
  { query: 'diwali gifts', targetUrl: '/collections/diwali-2024-collection' },
  { query: 'navratri outfit', targetUrl: '/collections/navratri-garba-wear' },
  { query: 'summer sale', targetUrl: '/collections/great-indian-sale' },
  { query: 'flash sale today', targetUrl: '/collections/flash-sale' },
];

const AUTOCOMPLETE_TERMS = [
  // Electronics
  'Samsung Galaxy A54','Samsung Galaxy S24','OnePlus 12','OnePlus Nord','Realme 11 Pro','iPhone 15','iPhone 15 Pro Max','Xiaomi 13','Redmi Note 13','OPPO Reno 11','Nothing Phone 2','Google Pixel 8','Motorola Edge 40',
  'Dell XPS 15','HP Pavilion','Lenovo IdeaPad','Asus ROG Strix','MacBook Air M2','MacBook Pro M3',
  'Samsung 55 inch TV','Sony Bravia 4K','LG OLED TV','TCL QLED TV',
  'boAt Airdopes','Sony WH-1000XM5','JBL Tune 760','Apple AirPods Pro',
  // Fashion
  'Manyavar Kurta Set','Allen Solly Shirt','Van Heusen Shirt',"Levi's Jeans","H&M T-Shirt",
  'W Kurta','Biba Anarkali','Banarasi Silk Saree','Kanchipuram Saree','Bridal Lehenga',
  'Nike Running Shoes','Adidas Ultraboost','Bata Formal Shoes','Metro Heels','Crocs Classic',
  // Beauty
  'Lakme Foundation','Maybelline Lipstick','Mamaearth Face Wash','Minimalist Serum','The Ordinary Niacinamide',
  'WOW Shampoo','Plum Face Wash','Biotique Face Cream','Himalaya Moisturizer','Forest Essentials',
  // Appliances
  'Samsung Washing Machine','LG Refrigerator','Voltas AC','IFB Microwave','Havells Fan',
  'Prestige Pressure Cooker','Pigeon Mixer Grinder','Bajaj Kettle',
  // Furniture
  'Wakefit Mattress','Sleepwell Mattress','Nilkamal Sofa','Royal Oak Wardrobe','Green Soul Chair',
  // Food
  'Amul Milk','Haldirams Namkeen','Cadbury Dairy Milk','Nescafe Instant Coffee','MDH Masala',
];

const FACETS = [
  { category: 'smartphones',  facets: ['brand','ram','storage','display_size','battery','os','network','price'] },
  { category: 'laptops',      facets: ['brand','processor','ram','storage','display_size','os','graphics_card','price'] },
  { category: 'televisions',  facets: ['brand','display_size','resolution','refresh_rate','smart_tv','price'] },
  { category: 'mens-fashion', facets: ['brand','size','color','material','fit','occasion','price'] },
  { category: 'footwear',     facets: ['brand','shoe_size','color','material','occasion','price'] },
  { category: 'beauty',       facets: ['brand','skin_type','concern','spf','volume','price'] },
  { category: 'appliances',   facets: ['brand','capacity','energy_rating','inverter','price'] },
  { category: 'furniture',    facets: ['brand','material','color','finish','assembly_required','price'] },
  { category: 'sports',       facets: ['brand','sport','player_level','color','price'] },
  { category: 'jewelry',      facets: ['brand','metal_type','stone_type','purity','price'] },
];

class SearchSeed {
  constructor() {
    this.logger = new SeedLogger('Search');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info('🔍 Seeding Search Data — synonyms, redirects, autocomplete, facets');

    await conn.collection('searchsynonyms').deleteMany({});
    await conn.collection('searchredirects').deleteMany({});
    await conn.collection('searchautocomplete').deleteMany({});
    await conn.collection('searchfacets').deleteMany({});
    await conn.collection('searchpopular').deleteMany({});

    // Synonyms
    const synonymDocs = SYNONYMS.map(s => ({
      _id: new mongoose.Types.ObjectId(),
      from: s.from,
      to: s.to,
      bidirectional: s.bidirectional,
      active: true,
      createdAt: new Date(),
    }));
    await conn.collection('searchsynonyms').insertMany(synonymDocs);
    this.logger.recordBatch(synonymDocs.length);

    // Redirects
    const redirectDocs = REDIRECTS.map(r => ({
      _id: new mongoose.Types.ObjectId(),
      query: r.query,
      queryNormalized: r.query.toLowerCase().trim(),
      targetUrl: r.targetUrl,
      active: true,
      usageCount: Math.floor(Math.random() * 10000),
      createdAt: new Date(),
    }));
    await conn.collection('searchredirects').insertMany(redirectDocs);
    this.logger.recordBatch(redirectDocs.length);

    // Autocomplete
    const autocompleteDocs = AUTOCOMPLETE_TERMS.map((term, i) => ({
      _id: new mongoose.Types.ObjectId(),
      term,
      termNormalized: term.toLowerCase(),
      searchCount: Math.floor(Math.random() * 100000) + 1000,
      clickCount: Math.floor(Math.random() * 50000),
      conversionCount: Math.floor(Math.random() * 10000),
      sortOrder: i,
      active: true,
      createdAt: new Date(),
    }));
    await conn.collection('searchautocomplete').insertMany(autocompleteDocs);
    this.logger.recordBatch(autocompleteDocs.length);

    // Facets
    const facetDocs = FACETS.map(f => ({
      _id: new mongoose.Types.ObjectId(),
      categoryKey: f.category,
      facets: f.facets,
      active: true,
      createdAt: new Date(),
    }));
    await conn.collection('searchfacets').insertMany(facetDocs);
    this.logger.recordBatch(facetDocs.length);

    // Popular searches
    const popularTerms = [
      'Samsung Galaxy','iPhone','OnePlus','Laptop','Smartwatch','Headphones','Saree','Kurta','Running Shoes','Face Serum',
      'Refrigerator','Washing Machine','Air Conditioner','Sofa','Mattress','Cricket Bat','Yoga Mat','Protein Powder',
      'Diwali Gifts','Birthday Gift','Samsung TV','AirPods','Nike Shoes','Adidas','boAt Earbuds',
    ];
    const popularDocs = popularTerms.map((term, i) => ({
      _id: new mongoose.Types.ObjectId(),
      term,
      searchCount: Math.floor(Math.random() * 500000) + 50000,
      trend: ['up','up','stable','down'][Math.floor(i / 6)],
      period: 'weekly',
      active: true,
      createdAt: new Date(),
    }));
    await conn.collection('searchpopular').insertMany(popularDocs);
    this.logger.recordBatch(popularDocs.length);

    this.logger.printStats();
    return {
      created: synonymDocs.length + redirectDocs.length + autocompleteDocs.length + facetDocs.length + popularDocs.length,
      synonyms: synonymDocs.length, redirects: redirectDocs.length,
      autocomplete: autocompleteDocs.length, facets: facetDocs.length, popular: popularDocs.length,
    };
  }
}

module.exports = SearchSeed;
