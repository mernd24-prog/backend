'use strict';

/**
 * Tags Seed Module
 * Populates tags collection — product search/discovery tags
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const TAG_GROUPS = [
  { group: 'Electronics', tags: ['5G Phone','Gaming Phone','iPhone','Samsung Galaxy','OnePlus','Redmi','Realme','Budget Phone','Camera Phone','5G Laptop','Gaming Laptop','Ultrabook','MacBook','Windows 11','Smart TV','4K TV','OLED TV','Bluetooth Speaker','Noise Cancelling','TWS Earbuds','Smartwatch','Fitness Band','Action Camera','DSLR','Drone'] },
  { group: 'Fashion', tags: ['Casual Wear','Formal Wear','Party Wear','Wedding Wear','Ethnic Wear','Western Wear','Sports Wear','Summer Collection','Winter Collection','Linen Shirt','Denim Jeans','Slim Fit','Oversized','Cotton T-Shirt','Polo Shirt','Saree','Kurta','Lehenga','Salwar Kameez','Anarkali'] },
  { group: 'Beauty', tags: ['Skincare','Haircare','Makeup','Cruelty Free','Paraben Free','Sulphate Free','Natural','Organic','Vegan','Anti-Aging','Brightening','Moisturizing','SPF','Sunscreen','Face Serum','Vitamin C','Niacinamide','Hyaluronic Acid','Retinol','Salicylic Acid'] },
  { group: 'Health', tags: ['Protein Supplement','Whey Protein','Vegan Protein','Multivitamin','Omega-3','Probiotic','Ayurveda','Herbal','Sugar Free','Gluten Free','Keto Friendly','Diabetic Friendly','Blood Pressure','Heart Health','Immunity Booster','Sleep Aid'] },
  { group: 'Home', tags: ['Home Decor','Kitchen Essentials','Bedroom','Living Room','Dining Room','Bathroom','Garden','Outdoor','Minimalist','Bohemian','Modern','Classic','Wooden','Marble','Stainless Steel','Non-Stick','Cast Iron'] },
  { group: 'Sports', tags: ['Cricket','Football','Badminton','Tennis','Basketball','Running','Cycling','Yoga','Gym','Swimming','Hiking','Camping','Fitness','Weight Training','Cardio','Crossfit','Pilates'] },
  { group: 'Food', tags: ['Healthy Snacks','Organic','Vegan Food','Sugar Free','Low Calorie','High Protein','Gluten Free','Dairy Free','Indian Snacks','Breakfast','Tea & Coffee','Juices','Chocolates','Dry Fruits','Nuts & Seeds'] },
  { group: 'Deals', tags: ['Under 499','Under 999','Under 1999','Best Value','Budget Friendly','Premium','Luxury','Sale','Discounted','Clearance','Limited Edition','Combo Offer','Free Delivery','Same Day Delivery'] },
  { group: 'Occasions', tags: ['Diwali Gifts','Birthday Gift','Anniversary Gift','Wedding Gift','Housewarming Gift','Baby Shower','Valentine\'s Day','Mother\'s Day','Father\'s Day','New Year','Christmas','Eid','Navratri','Ganesh Chaturthi'] },
  { group: 'Trending', tags: ['Viral','TikTok Famous','Instagram Trending','Celebrity Endorsed','Award Winning','Editor\'s Choice','Customer Favourite','Staff Pick','Most Reviewed','Highly Rated'] },
];

class TagsSeed {
  constructor() {
    this.logger = new SeedLogger('Tags');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');

    const totalTags = TAG_GROUPS.reduce((a, g) => a + g.tags.length, 0);
    this.logger.info(`🏷️  Seeding Tags — ${totalTags} tags across ${TAG_GROUPS.length} groups`);

    await conn.collection('tags').deleteMany({});

    const seenSlugs = new Set();
    const docs = [];
    for (const group of TAG_GROUPS) {
      for (const tagName of group.tags) {
        const slug = slugify(tagName);
        if (seenSlugs.has(slug)) continue;
        seenSlugs.add(slug);
        docs.push({
          _id: new mongoose.Types.ObjectId(),
          name: tagName,
          slug,
          group: group.group,
          usageCount: Math.floor(Math.random() * 5000) + 10,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    const BATCH = 100;
    for (let i = 0; i < docs.length; i += BATCH) {
      await conn.collection('tags').insertMany(docs.slice(i, i + BATCH));
    }
    this.logger.recordBatch(docs.length);
    this.logger.printStats();
    return { created: docs.length };
  }
}

module.exports = TagsSeed;
