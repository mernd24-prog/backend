'use strict';

/**
 * Attributes Seed Module
 * Populates productattributes collection — standalone attribute library
 * These are global attribute definitions referenced by categories
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// [name, type, unit, isVariant, isFilterable, isSearchable, category_hint, options]
const ATTRIBUTES = [
  // ── DEVICE / ELECTRONICS ─────────────────────────────────────────────────
  ['RAM', 'select', 'GB', true, true, true, 'electronics', ['2GB','3GB','4GB','6GB','8GB','12GB','16GB','24GB','32GB','64GB']],
  ['Internal Storage', 'select', 'GB', true, true, true, 'electronics', ['16GB','32GB','64GB','128GB','256GB','512GB','1TB','2TB']],
  ['Processor', 'select', null, false, true, true, 'electronics', ['Intel Core i3','Intel Core i5','Intel Core i7','Intel Core i9','AMD Ryzen 5','AMD Ryzen 7','Apple M1','Apple M2','Apple M3','Snapdragon 8 Gen 3','MediaTek Dimensity 9200']],
  ['Display Size', 'number', 'inches', false, true, true, 'electronics', []],
  ['Screen Resolution', 'select', null, false, true, true, 'electronics', ['HD','Full HD (1080p)','2K (1440p)','4K (2160p)','8K']],
  ['Battery Capacity', 'number', 'mAh', false, true, false, 'electronics', []],
  ['Camera Resolution', 'number', 'MP', false, true, true, 'electronics', []],
  ['Operating System', 'select', null, false, true, true, 'electronics', ['Android 14','Android 13','iOS 17','Windows 11','macOS Sonoma','Chrome OS']],
  ['Refresh Rate', 'select', 'Hz', false, true, false, 'electronics', ['60Hz','90Hz','120Hz','144Hz','165Hz','240Hz']],
  ['Network Generation', 'select', null, true, true, true, 'electronics', ['5G','4G LTE','3G','2G']],
  ['Connectivity', 'multi_select', null, false, false, false, 'electronics', ['Wi-Fi','Bluetooth 5.0','NFC','USB-C','Thunderbolt','HDMI']],
  ['Rear Camera Setup', 'select', null, false, true, true, 'electronics', ['Single','Dual','Triple','Quad','Penta']],
  ['Front Camera', 'number', 'MP', false, true, false, 'electronics', []],
  ['Charging Speed', 'select', 'W', false, true, false, 'electronics', ['18W','25W','33W','45W','65W','67W','120W','150W']],
  ['SIM Type', 'select', null, false, true, false, 'electronics', ['Single SIM','Dual SIM','Nano SIM','eSIM + Nano SIM']],
  ['Water Resistance', 'select', null, false, true, false, 'electronics', ['IP67','IP68','IP69K','No Rating','Splash Resistant']],
  ['Graphics Card', 'select', null, false, true, true, 'computers', ['NVIDIA GeForce RTX 4060','NVIDIA GeForce RTX 4070','NVIDIA GeForce RTX 4090','AMD Radeon RX 7600','Intel Iris Xe','Integrated Graphics']],
  ['Laptop Weight', 'number', 'kg', false, true, false, 'computers', []],
  ['Backlit Keyboard', 'boolean', null, false, true, false, 'computers', []],
  ['Touch Screen', 'boolean', null, false, true, false, 'computers', []],
  // ── FASHION ───────────────────────────────────────────────────────────────
  ['Fabric / Material', 'select', null, false, true, true, 'fashion', ['Cotton','Polyester','Silk','Linen','Wool','Denim','Viscose','Rayon','Chiffon','Georgette','Satin','Crepe','Nylon','Spandex','Modal']],
  ['Fit Type', 'select', null, true, true, false, 'fashion', ['Slim Fit','Regular Fit','Relaxed Fit','Loose Fit','Oversized','Skinny','Straight','Bootcut']],
  ['Sleeve Length', 'select', null, true, true, false, 'fashion', ['Full Sleeve','Half Sleeve','3/4 Sleeve','Sleeveless','Cap Sleeve','Bell Sleeve']],
  ['Collar / Neckline', 'select', null, false, true, false, 'fashion', ['Round Neck','V-Neck','Polo','Mandarin','Hooded','Square Neck','Off-Shoulder','Cowl Neck','Turtle Neck']],
  ['Occasion', 'multi_select', null, false, true, true, 'fashion', ['Casual','Formal','Party','Ethnic','Wedding','Sports','Office','Festive']],
  ['Pattern', 'select', null, true, true, true, 'fashion', ['Solid','Striped','Checked','Printed','Floral','Abstract','Geometric','Embroidered','Block Print']],
  ['Wash Care', 'select', null, false, false, false, 'fashion', ['Machine Wash','Hand Wash','Dry Clean Only','Do Not Wash','Spot Clean']],
  ['Number of Pockets', 'number', null, false, false, false, 'fashion', []],
  ['Waist Rise', 'select', null, false, true, false, 'fashion', ['Low Rise','Mid Rise','High Rise']],
  ['Leg Opening', 'select', null, false, true, false, 'fashion', ['Straight','Bootcut','Flared','Tapered','Wide Leg']],
  // ── FOOTWEAR ──────────────────────────────────────────────────────────────
  ['Sole Material', 'select', null, false, true, false, 'footwear', ['Rubber','EVA','PVC','TPU','Leather','Synthetic','Cork']],
  ['Upper Material', 'select', null, false, true, false, 'footwear', ['Leather','Mesh','Canvas','Synthetic','Suede','Knit','Patent Leather']],
  ['Closure Type', 'select', null, false, true, false, 'footwear', ['Lace-Up','Slip-On','Buckle','Velcro','Zipper','Hook & Loop']],
  ['Heel Height', 'select', 'inches', false, true, false, 'footwear', ['Flat (0-0.5")','Low (0.5-1")','Medium (1-2")','High (2-3")','Very High (3"+)']],
  ['Toe Shape', 'select', null, false, true, false, 'footwear', ['Round Toe','Pointed Toe','Square Toe','Almond Toe','Open Toe']],
  // ── APPLIANCES ────────────────────────────────────────────────────────────
  ['Capacity (Liters)', 'number', 'L', true, true, true, 'appliances', []],
  ['Energy Rating', 'select', null, false, true, true, 'appliances', ['1 Star','2 Star','3 Star','4 Star','5 Star']],
  ['Wattage', 'number', 'W', false, true, false, 'appliances', []],
  ['Voltage', 'select', 'V', false, false, false, 'appliances', ['110V','220V','240V']],
  ['Inverter Technology', 'boolean', null, false, true, false, 'appliances', []],
  ['Washing Programs', 'number', null, false, true, false, 'appliances', []],
  ['RPM (Washing Machine)', 'select', 'RPM', false, true, false, 'appliances', ['800 RPM','1000 RPM','1200 RPM','1400 RPM','1600 RPM']],
  ['Refrigerator Type', 'select', null, false, true, true, 'appliances', ['Single Door','Double Door','Side-by-Side','French Door','Multi-Door']],
  ['Cooling Technology', 'select', null, false, true, false, 'appliances', ['Direct Cool','Frost Free','Auto-Defrost']],
  ['Compressor Type', 'select', null, false, true, false, 'appliances', ['Rotary','Reciprocating','Digital Inverter','Linear Inverter']],
  ['Air Conditioner Tonnage', 'select', 'Ton', true, true, true, 'appliances', ['0.75 Ton','1 Ton','1.5 Ton','2 Ton','2.5 Ton']],
  ['Cooking Mode (Microwave)', 'multi_select', null, false, true, false, 'appliances', ['Microwave','Grill','Convection','Steam','Air Fry']],
  // ── FURNITURE ─────────────────────────────────────────────────────────────
  ['Furniture Material', 'select', null, false, true, true, 'furniture', ['Solid Wood','Engineered Wood','MDF','Plywood','Steel','Aluminium','Wrought Iron','Glass','Marble','Rattan','Bamboo']],
  ['Finish Type', 'select', null, true, true, false, 'furniture', ['Matte','Glossy','Satin','Lacquered','Natural','Walnut','Teak','Wenge','Oak']],
  ['Width (cm)', 'number', 'cm', false, true, false, 'furniture', []],
  ['Height (cm)', 'number', 'cm', false, true, false, 'furniture', []],
  ['Depth (cm)', 'number', 'cm', false, true, false, 'furniture', []],
  ['Weight Capacity (kg)', 'number', 'kg', false, true, false, 'furniture', []],
  ['Assembly Required', 'boolean', null, false, true, false, 'furniture', []],
  ['Number of Seats', 'select', null, false, true, true, 'furniture', ['1','2','3','4','5','6','7','8']],
  ['Mattress Type', 'select', null, false, true, true, 'furniture', ['Memory Foam','Bonded Foam','Spring','Latex','Orthopedic','Hybrid']],
  ['Mattress Thickness', 'select', 'inches', false, true, false, 'furniture', ['4"','5"','6"','7"','8"']],
  // ── BEAUTY ────────────────────────────────────────────────────────────────
  ['Skin Type Suitability', 'multi_select', null, false, true, true, 'beauty', ['All Skin Types','Normal','Dry','Oily','Combination','Sensitive','Acne-Prone']],
  ['Skin Concern', 'multi_select', null, false, true, true, 'beauty', ['Anti-Aging','Brightening','Moisturizing','Acne Control','Pore Minimizing','Sun Protection','Hydration']],
  ['SPF Rating', 'select', null, false, true, false, 'beauty', ['SPF 15','SPF 20','SPF 30','SPF 50','SPF 50+','SPF 100','No SPF']],
  ['Volume (ml)', 'select', 'ml', true, true, true, 'beauty', ['5ml','10ml','15ml','20ml','30ml','50ml','75ml','100ml','150ml','200ml','250ml','500ml']],
  ['Formulation', 'select', null, false, true, false, 'beauty', ['Cream','Gel','Serum','Oil','Lotion','Balm','Foam','Powder','Mist','Spray','Mousse']],
  ['Key Ingredient', 'multi_select', null, false, true, true, 'beauty', ['Hyaluronic Acid','Vitamin C','Retinol','Niacinamide','Salicylic Acid','Glycolic Acid','Ceramides','Peptides','Collagen','Kojic Acid','Turmeric','Aloe Vera']],
  ['Finish (Makeup)', 'select', null, false, true, false, 'beauty', ['Matte','Dewy','Natural','Satin','Luminous','Full Coverage','Medium Coverage']],
  ['Fragrance', 'select', null, false, true, false, 'beauty', ['Fragrance-Free','Lightly Fragranced','Floral','Citrus','Woody','Musky','Fruity','Oriental']],
  ['Hair Type', 'multi_select', null, false, true, true, 'beauty', ['All Hair Types','Normal','Dry','Oily','Curly','Frizzy','Color-Treated','Dandruff-Prone']],
  // ── FOOD ──────────────────────────────────────────────────────────────────
  ['Food Type', 'select', null, false, true, true, 'food', ['Vegetarian','Non-Vegetarian','Vegan','Eggitarian']],
  ['Shelf Life', 'number', 'months', false, true, false, 'food', []],
  ['Net Weight', 'select', null, true, true, true, 'food', ['50g','100g','200g','250g','500g','1kg','2kg','5kg']],
  ['Brand Flavor', 'select', null, true, true, true, 'food', ['Chocolate','Vanilla','Strawberry','Mango','Mixed Fruit','Unflavored','Masala','Salt & Pepper']],
  ['Calorie Count', 'number', 'kcal/100g', false, false, false, 'food', []],
  ['Organic Certified', 'boolean', null, false, true, true, 'food', []],
  ['Allergen Info', 'multi_select', null, false, true, true, 'food', ['Contains Gluten','Contains Nuts','Contains Dairy','Contains Eggs','Contains Soy','Contains Fish']],
  // ── BOOKS ─────────────────────────────────────────────────────────────────
  ['Language', 'select', null, false, true, true, 'books', ['English','Hindi','Bengali','Telugu','Marathi','Tamil','Gujarati','Kannada','Malayalam']],
  ['Book Format', 'select', null, true, true, false, 'books', ['Paperback','Hardcover','E-book','Audiobook','Board Book','Spiral Bound']],
  ['Number of Pages', 'number', null, false, false, false, 'books', []],
  ['Edition', 'text', null, false, false, false, 'books', []],
  ['Publisher', 'text', null, false, false, true, 'books', []],
  ['ISBN', 'text', null, false, false, false, 'books', []],
  // ── JEWELRY ───────────────────────────────────────────────────────────────
  ['Metal Type', 'select', null, true, true, true, 'jewelry', ['Gold 22K','Gold 18K','Gold 14K','Silver 92.5%','Platinum','Rose Gold','White Gold','Stainless Steel']],
  ['Stone Type', 'select', null, false, true, true, 'jewelry', ['Diamond','Ruby','Emerald','Sapphire','Pearl','Topaz','Amethyst','Garnet','American Diamond','No Stone']],
  ['Purity (Karat)', 'select', null, false, true, true, 'jewelry', ['14K','18K','22K','24K','925 Silver','950 Platinum']],
  ['Jewelry Weight (grams)', 'number', 'g', false, true, false, 'jewelry', []],
  ['Hallmark Certified', 'boolean', null, false, true, true, 'jewelry', []],
  // ── SPORTS ────────────────────────────────────────────────────────────────
  ['Sport Category', 'select', null, false, true, true, 'sports', ['Cricket','Football','Badminton','Tennis','Basketball','Gym','Yoga','Cycling','Running','Swimming','Golf']],
  ['Player Level', 'select', null, false, true, false, 'sports', ['Beginner','Intermediate','Advanced','Professional']],
  ['Weight (Sports)', 'number', 'g', false, true, false, 'sports', []],
  // ── AUTOMOTIVE ────────────────────────────────────────────────────────────
  ['Compatible Vehicle Type', 'select', null, false, true, true, 'automotive', ['Hatchback','Sedan','SUV','MUV','Bike 100-150cc','Bike 150-250cc','Bike 250cc+','Commercial Vehicle','Truck']],
  ['Compatible Fuel', 'select', null, false, true, false, 'automotive', ['Petrol','Diesel','CNG','Electric','Hybrid']],
  ['Tyre Width', 'select', null, false, true, false, 'automotive', ['145','155','165','175','185','195','205','215','225','235','245','255','265','275']],
  ['Tyre Rim Size', 'select', 'inches', false, true, false, 'automotive', ['12"','13"','14"','15"','16"','17"','18"','19"','20"']],
  // ── COMMON ────────────────────────────────────────────────────────────────
  ['Brand', 'text', null, false, true, true, 'common', []],
  ['Model Number', 'text', null, false, false, true, 'common', []],
  ['Country of Origin', 'select', null, false, true, true, 'common', ['India','China','USA','South Korea','Japan','Germany','Bangladesh','Vietnam','Taiwan','Thailand','Malaysia']],
  ['Warranty Period', 'select', null, false, true, false, 'common', ['No Warranty','3 Months','6 Months','1 Year','2 Years','3 Years','5 Years','Lifetime']],
  ['Certification', 'multi_select', null, false, true, false, 'common', ['BIS','ISI','CE','RoHS','ISO 9001','FDA','FSSAI','Ayush']],
  ['In-Box Items', 'text', null, false, false, false, 'common', []],
  ['Color', 'select', null, true, true, true, 'common', ['Black','White','Blue','Red','Green','Yellow','Grey','Brown','Pink','Navy','Gold','Silver']],
];

class AttributesSeed {
  constructor() {
    this.logger = new SeedLogger('Attributes');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info(`⚙️  Seeding Product Attributes — ${ATTRIBUTES.length} attributes`);

    await conn.collection('productattributes').deleteMany({});

    const docs = ATTRIBUTES.map(([name, type, unit, isVariant, isFilterable, isSearchable, categoryHint, options]) => ({
      _id: new mongoose.Types.ObjectId(),
      name,
      slug: slugify(name),
      type,
      unit: unit || null,
      isVariantAttribute: isVariant,
      isFilterable,
      isSearchable,
      categoryHint,
      options: options || [],
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const BATCH = 100;
    for (let i = 0; i < docs.length; i += BATCH) {
      await conn.collection('productattributes').insertMany(docs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, docs.length - i));
    }

    this.logger.printStats();
    return { created: docs.length };
  }
}

module.exports = AttributesSeed;
