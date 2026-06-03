'use strict';

/**
 * GST Seed Module
 * Populates AdminTax, AdminSubTax, AdminTaxRule (MongoDB)
 * Complete India GST structure: 0%, 5%, 12%, 18%, 28% slabs
 * CGST + SGST + IGST for each slab
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

class GSTSeed {
  constructor() {
    this.logger = new SeedLogger('GST');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info('💰 Seeding GST — AdminTax, AdminSubTax, AdminTaxRule');

    await conn.collection('admintaxes').deleteMany({});
    await conn.collection('adminsubtaxes').deleteMany({});
    await conn.collection('admintaxrules').deleteMany({});

    // Get India's countryId
    const india = await conn.collection('admincountries').findOne({ code: 'IN' });
    if (!india) throw new Error('India record not found — run countries seed first');
    const indiaId = india._id;

    // ── Create AdminTax entries per GST slab ───────────────────────────────
    const slabs = [
      { name: 'GST 0%', rate: 0,   description: 'Exempt / Zero-rated goods', code: 'GST_0' },
      { name: 'GST 5%', rate: 5,   description: 'Essential goods and services', code: 'GST_5' },
      { name: 'GST 12%',rate: 12,  description: 'Standard rate — intermediate goods', code: 'GST_12' },
      { name: 'GST 18%',rate: 18,  description: 'Standard rate — most goods/services', code: 'GST_18' },
      { name: 'GST 28%',rate: 28,  description: 'Luxury goods / demerit goods', code: 'GST_28' },
    ];

    const taxDocs = slabs.map(s => ({
      _id: new mongoose.Types.ObjectId(),
      name: s.name,
      countryId: indiaId,
      code: s.code,
      rate: s.rate,
      description: s.description,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await conn.collection('admintaxes').insertMany(taxDocs);
    this.logger.recordBatch(taxDocs.length);

    // ── Create AdminSubTax (CGST, SGST, IGST for each slab) ───────────────
    const subtaxDocs = [];
    for (const taxDoc of taxDocs) {
      const rate = taxDoc.rate;
      const halfRate = rate / 2;
      // CGST
      subtaxDocs.push({
        _id: new mongoose.Types.ObjectId(),
        name: `CGST ${halfRate}%`,
        percentage: halfRate,
        taxId: taxDoc._id,
        description: `Central GST — intra-state component @ ${halfRate}%`,
        taxType: 'CGST',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // SGST
      subtaxDocs.push({
        _id: new mongoose.Types.ObjectId(),
        name: `SGST ${halfRate}%`,
        percentage: halfRate,
        taxId: taxDoc._id,
        description: `State GST — intra-state component @ ${halfRate}%`,
        taxType: 'SGST',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // IGST (inter-state: full rate)
      subtaxDocs.push({
        _id: new mongoose.Types.ObjectId(),
        name: `IGST ${rate}%`,
        percentage: rate,
        taxId: taxDoc._id,
        description: `Integrated GST — inter-state component @ ${rate}%`,
        taxType: 'IGST',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    if (subtaxDocs.length) {
      await conn.collection('adminsubtaxes').insertMany(subtaxDocs);
      this.logger.recordBatch(subtaxDocs.length);
    }

    // ── Create AdminTaxRule mappings by category ───────────────────────────
    const ruleMappings = [
      { category: 'books',             taxCode: 'GST_0',  description: 'Books, newspapers, maps — GST exempted' },
      { category: 'food-basic',        taxCode: 'GST_0',  description: 'Fresh fruits, vegetables, salt, bread — exempt' },
      { category: 'medicines',         taxCode: 'GST_0',  description: 'Essential medicines — exempt' },
      { category: 'food-processed',    taxCode: 'GST_5',  description: 'Packed food, edible oils — 5%' },
      { category: 'healthcare',        taxCode: 'GST_5',  description: 'Medical devices, diagnostics — 5%' },
      { category: 'textile-cheap',     taxCode: 'GST_5',  description: 'Fabrics & garments < ₹1000 — 5%' },
      { category: 'footwear-cheap',    taxCode: 'GST_5',  description: 'Footwear < ₹1000 — 5%' },
      { category: 'furniture',         taxCode: 'GST_12', description: 'Furniture, mattresses — 12%' },
      { category: 'appliances',        taxCode: 'GST_12', description: 'Major appliances — 12%' },
      { category: 'computers',         taxCode: 'GST_12', description: 'Laptops, computers — 12%' },
      { category: 'fashion',           taxCode: 'GST_12', description: 'Garments ≥ ₹1000 — 12%' },
      { category: 'toys',              taxCode: 'GST_12', description: 'Toys and games — 12%' },
      { category: 'sports',            taxCode: 'GST_12', description: 'Sports goods — 12%' },
      { category: 'electronics',       taxCode: 'GST_18', description: 'Electronics, smartphones, TVs — 18%' },
      { category: 'beauty',            taxCode: 'GST_18', description: 'Cosmetics, personal care — 18%' },
      { category: 'home',              taxCode: 'GST_18', description: 'Home goods, kitchenware — 18%' },
      { category: 'automotive',        taxCode: 'GST_18', description: 'Auto accessories, tyres — 18%' },
      { category: 'jewelry',           taxCode: 'GST_3',  description: 'Gold, silver jewelry — 3% (special)' },
      { category: 'bags-luggage',      taxCode: 'GST_18', description: 'Bags, suitcases — 18%' },
      { category: 'gaming',            taxCode: 'GST_28', description: 'Gaming consoles — 28%' },
      { category: 'luxury-vehicles',   taxCode: 'GST_28', description: 'Luxury vehicles, motor cycles > 350cc — 28%' },
      { category: 'aerated-drinks',    taxCode: 'GST_28', description: 'Aerated water, soft drinks — 28%' },
      { category: 'tobacco',           taxCode: 'GST_28', description: 'Tobacco products + cess — 28%' },
      { category: 'alcohol-industrial',taxCode: 'GST_18', description: 'Industrial alcohol — 18%' },
    ];

    const taxByCode = {};
    taxDocs.forEach(t => { taxByCode[t.code] = t._id; });

    // Add special 3% slab for gold
    const gold3Tax = {
      _id: new mongoose.Types.ObjectId(),
      name: 'GST 3%',
      countryId: indiaId,
      code: 'GST_3',
      rate: 3,
      description: 'Gold, silver, precious metals — 3%',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await conn.collection('admintaxes').insertOne(gold3Tax);
    taxByCode['GST_3'] = gold3Tax._id;
    // Add subtaxes for 3%
    const gold3Subtaxes = [
      { name: 'CGST 1.5%', percentage: 1.5, taxId: gold3Tax._id, taxType: 'CGST' },
      { name: 'SGST 1.5%', percentage: 1.5, taxId: gold3Tax._id, taxType: 'SGST' },
      { name: 'IGST 3%',   percentage: 3,   taxId: gold3Tax._id, taxType: 'IGST' },
    ].map(s => ({
      _id: new mongoose.Types.ObjectId(), ...s,
      description: `${s.taxType} for gold/precious metals`,
      active: true, createdAt: new Date(), updatedAt: new Date(),
    }));
    await conn.collection('adminsubtaxes').insertMany(gold3Subtaxes);

    const ruleDocs = ruleMappings
      .filter(r => taxByCode[r.taxCode])
      .map(r => {
        const taxId = taxByCode[r.taxCode];
        const relatedSubtaxes = subtaxDocs.filter(s => s.taxId.equals(taxId)).map(s => s._id);
        return {
          _id: new mongoose.Types.ObjectId(),
          description: r.description,
          taxId,
          subTaxIds: relatedSubtaxes,
          category: r.category,
          active: true,
          metadata: { taxCode: r.taxCode },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });
    if (ruleDocs.length) {
      await conn.collection('admintaxrules').insertMany(ruleDocs);
      this.logger.recordBatch(ruleDocs.length);
    }

    // ── GST Slabs collection (for product management dropdowns) ─────────────
    await conn.collection('gstslabs').deleteMany({});
    const gstSlabDocs = [
      { rate: 0,  code: 'GST_0',  label: '0% (Exempt)',  description: 'Zero-rated / Exempt goods', cessRate: 0 },
      { rate: 3,  code: 'GST_3',  label: '3% (Gold)',    description: 'Gold, silver and precious metals', cessRate: 0 },
      { rate: 5,  code: 'GST_5',  label: '5%',           description: 'Essential goods', cessRate: 0 },
      { rate: 12, code: 'GST_12', label: '12%',          description: 'Standard intermediate goods', cessRate: 0 },
      { rate: 18, code: 'GST_18', label: '18%',          description: 'Standard rate', cessRate: 0 },
      { rate: 28, code: 'GST_28', label: '28%',          description: 'Luxury goods + cess', cessRate: 22 },
    ].map(s => ({
      _id: new mongoose.Types.ObjectId(),
      ...s,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await conn.collection('gstslabs').insertMany(gstSlabDocs);

    this.logger.printStats();
    return {
      created: taxDocs.length + 1 + subtaxDocs.length + gold3Subtaxes.length + ruleDocs.length + gstSlabDocs.length,
      taxes: taxDocs.length + 1,
      subtaxes: subtaxDocs.length + gold3Subtaxes.length,
      rules: ruleDocs.length,
      slabs: gstSlabDocs.length,
    };
  }
}

module.exports = GSTSeed;
