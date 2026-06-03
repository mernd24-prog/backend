'use strict';

/**
 * Variants Seed Module
 * Generates ProductVariant records for variable products
 * Uses PlatformProductOptionValue references
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Variant configs per category
const VARIANT_CONFIGS = {
  smartphones:    { axes: ['color','storage'],   colors: ['Black','Blue','White','Green','Gold'],           values2: ['128GB','256GB','512GB'] },
  laptops:        { axes: ['color','storage'],   colors: ['Silver','Space Grey','Black','Blue'],             values2: ['256GB','512GB','1TB'] },
  earphones:      { axes: ['color'],             colors: ['Black','White','Blue','Pink','Green'],            values2: [] },
  smartwatches:   { axes: ['color'],             colors: ['Black','Silver','Rose Gold','Blue','Green'],      values2: [] },
  televisions:    { axes: ['screen-size'],       colors: ['32 Inch','43 Inch','50 Inch','55 Inch','65 Inch'],values2: [] },
  fashion:        { axes: ['color','size'],      colors: ['Black','White','Navy','Red','Green','Grey','Blue'],values2: ['S','M','L','XL','XXL'] },
  footwear:       { axes: ['color','shoe-size'], colors: ['Black','White','Blue','Red','Brown'],             values2: ['6','7','8','9','10','11'] },
  beauty:         { axes: ['volume'],            colors: ['30ml','50ml','100ml','150ml','200ml'],            values2: [] },
  appliances:     { axes: ['color'],             colors: ['White','Black','Silver','Grey'],                  values2: [] },
  furniture:      { axes: ['color','finish'],    colors: ['Brown','Walnut','White','Black','Grey'],          values2: ['Matte','Glossy','Natural'] },
  jewelry:        { axes: ['metal'],             colors: ['Gold 22K','Silver 92.5%','Rose Gold'],            values2: [] },
  luggage:        { axes: ['color'],             colors: ['Black','Blue','Red','Green','Grey','Navy'],       values2: [] },
};

const MAP_CAT = (cat) => {
  if (['mens-tshirts','mens-shirts','mens-jeans','mens-ethnic','mens-jackets','mens-activewear','womens-fashion','kurtas-suits','sarees','lehengas','dresses','kids-fashion','boys-clothing','girls-clothing'].includes(cat)) return 'fashion';
  if (['mens-shoes','womens-shoes','kids-shoes','slippers','sports-outdoor-shoes'].includes(cat)) return 'footwear';
  if (['skincare','haircare','makeup','bodycare','fragrances','mens-grooming'].includes(cat)) return 'beauty';
  if (['washing-machines','refrigerators','air-conditioners','microwave-ovens','fans-coolers','small-appliances','geysers','water-purifiers','kitchen-chimneys'].includes(cat)) return 'appliances';
  if (['bedroom-furniture','living-room-furniture','dining-furniture','office-study-furniture'].includes(cat)) return 'furniture';
  if (['gold-jewelry','diamond-jewelry','silver-jewelry','fashion-jewelry'].includes(cat)) return 'jewelry';
  if (['handbags','backpacks','luggage','wallets'].includes(cat)) return 'luggage';
  return cat;
};

class VariantsSeed {
  constructor() {
    this.logger = new SeedLogger('Variants');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info('📦 Seeding Product Variants for variable products');

    await conn.collection('productvariants').deleteMany({});

    // Load variable products
    const variableProducts = await conn.collection('products')
      .find({ hasVariants: true, status: { $in: ['ACTIVE','SUBMITTED'] } }, {
        projection: { _id: 1, sellerId: 1, category: 1, salePrice: 1, mrp: 1, sku: 1, hsnCode: 1 }
      })
      .limit(3000)
      .toArray();

    this.logger.info(`  Found ${variableProducts.length} variable products`);

    const skuSet = new Set();
    const genSKU = (base) => {
      let sku, tries = 0;
      do {
        sku = `${base}-V${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        tries++;
      } while (skuSet.has(sku) && tries < 10);
      skuSet.add(sku);
      return sku;
    };

    const variantDocs = [];
    for (const product of variableProducts) {
      const catType = MAP_CAT(product.category);
      const config = VARIANT_CONFIGS[catType] || VARIANT_CONFIGS.fashion;
      const { axes, colors, values2 } = config;

      const combos = [];
      if (axes.length === 1) {
        colors.slice(0, randNum(3, Math.min(5, colors.length))).forEach(c => combos.push([c]));
      } else {
        const colorSubset = colors.slice(0, randNum(2, Math.min(4, colors.length)));
        const val2Subset = values2.slice(0, randNum(2, Math.min(3, values2.length)));
        colorSubset.forEach(c => val2Subset.forEach(v => combos.push([c, v])));
      }

      for (const combo of combos) {
        const priceAdj = (0.9 + Math.random() * 0.2);
        const varPrice = Math.round(product.salePrice * priceAdj);
        const varMrp   = Math.round(product.mrp * priceAdj);
        const variantTitle = combo.join(' / ');
        const sku = genSKU(product.sku);

        const attributes = {};
        axes.forEach((axis, idx) => { if (combo[idx]) attributes[axis] = combo[idx]; });

        variantDocs.push({
          _id: new mongoose.Types.ObjectId(),
          productId: product._id.toString(),
          sellerId: product.sellerId,
          familyCode: null,
          sku,
          title: variantTitle,
          attributes,
          price: varMrp,
          mrp: varMrp,
          salePrice: varPrice,
          costPrice: Math.round(varPrice * 0.65),
          stock: randNum(0, 200),
          reservedStock: randNum(0, 10),
          status: 'active',
          images: [],
          weight: null,
          dimensions: null,
          hsnCode: product.hsnCode,
          isDefault: variantDocs.filter(v => v.productId === product._id.toString()).length === 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    const BATCH = 500;
    for (let i = 0; i < variantDocs.length; i += BATCH) {
      await conn.collection('productvariants').insertMany(variantDocs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, variantDocs.length - i));
    }

    this.logger.printStats();
    return { created: variantDocs.length };
  }
}

module.exports = VariantsSeed;
