'use strict';

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const PRODUCT_COUNT = Math.max(10001, Number(process.env.SEED_PRODUCT_COUNT || 12000));
const BATCH_SIZE = Math.max(100, Number(process.env.SEED_PRODUCT_BATCH_SIZE || 400));
const COLORS = ['Midnight Black', 'Arctic White', 'Ocean Blue', 'Forest Green', 'Graphite Grey', 'Rose Gold'];
const SIZES = ['S', 'M', 'L', 'XL', 'XXL', '3XL'];
const SHOE_SIZES = ['6', '7', '8', '9', '10', '11'];
const STORAGE = ['128GB', '256GB', '512GB', '1TB', '2TB', '4TB'];
const CAPACITY = ['500 ml', '750 ml', '1 L', '1.5 L', '2 L', '3 L'];
const VOLUME = ['30 ml', '50 ml', '100 ml', '150 ml', '200 ml', '250 ml'];
const MODELS = ['Essential', 'Classic', 'Select', 'Prime', 'Pro', 'Signature', 'Elite', 'Everyday'];
const QUALITIES = ['Durable', 'Premium', 'Ergonomic', 'Lightweight', 'High Performance', 'Everyday'];
const ROOT_IMAGES = {
  electronics: 'photo-1498049794561-7780e7231661', computers: 'photo-1496181133206-80ce9b88a853',
  'home-kitchen': 'photo-1556911220-bff31c812dba', fashion: 'photo-1445205170230-053b83016050',
  'mens-fashion': 'photo-1617137968427-85924c800a22', 'womens-fashion': 'photo-1483985988355-763728e1935b',
  footwear: 'photo-1542291026-7eec264c27ff', beauty: 'photo-1596462502278-27bfdc403348',
  sports: 'photo-1517836357463-d25dfeac3438', furniture: 'photo-1555041469-a586c61ea9bc',
  'pet-supplies': 'photo-1601758228041-f3b2795255f1', 'garden-outdoors': 'photo-1416879595882-3373a0480b5b',
  'office-stationery': 'photo-1456324504439-367cee3b3c32', automotive: 'photo-1486262715619-67b85e0b08d3',
  grocery: 'photo-1542838132-92c53300491e', default: 'photo-1523275335684-37898b6baf30',
};

const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const seeded = (index, salt = 0) => {
  let value = (index + 1) * 2654435761 + salt * 1013904223;
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
};
const money = (value) => Math.max(49, Math.round(value / 10) * 10 - 1);
const choose = (items, index, salt = 0) => items[Math.floor(seeded(index, salt) * items.length) % items.length];
const imageUrl = (root, sequence) => `https://images.unsplash.com/${ROOT_IMAGES[root] || ROOT_IMAGES.default}?auto=format&fit=crop&w=1200&q=82&sig=${sequence}`;

function resolveRoot(category, byKey) {
  let cursor = category;
  while (cursor && cursor.parentKey) cursor = byKey.get(cursor.parentKey);
  return cursor?.categoryKey || category.categoryKey.split('-')[0];
}

function variantConfig(root, categoryText) {
  const text = `${root} ${categoryText}`.toLowerCase();
  if (/shoe|footwear|sandal|slipper/.test(text)) return { name: 'Shoe Size', slug: 'shoe-size', values: SHOE_SIZES };
  if (/fashion|apparel|shirt|dress|jean|clothing|kurta|wear/.test(text)) return { name: 'Size', slug: 'size', values: SIZES };
  if (/phone|computer|laptop|storage|drive|tablet/.test(text)) return { name: 'Storage', slug: 'storage', values: STORAGE };
  if (/beauty|skin|hair|fragrance|groom/.test(text)) return { name: 'Volume', slug: 'volume', values: VOLUME };
  if (/bottle|drinkware|cookware|container|grocery|food/.test(text)) return { name: 'Capacity', slug: 'capacity', values: CAPACITY };
  return { name: 'Color', slug: 'color', values: COLORS };
}

function priceRange(root) {
  if (/electronics|computer/.test(root)) return [799, 89999];
  if (/furniture|appliance/.test(root)) return [1499, 49999];
  if (/fashion|footwear|beauty/.test(root)) return [299, 6999];
  return [149, 14999];
}

class ProductsSeed {
  constructor() {
    this.logger = new SeedLogger('Products');
  }

  async execute() {
    const conn = mongoose.connection;
    const [categories, brands, sellers, options, optionValues, organizations] = await Promise.all([
      conn.collection('categorytrees').find({ active: true }).toArray(),
      conn.collection('platformbrands').find({ active: true }).toArray(),
      conn.collection('users').find({ role: 'seller', accountStatus: 'active' }, { projection: { sellerProfile: 1 } }).toArray(),
      conn.collection('platformproductoptions').find({ active: true }).toArray(),
      conn.collection('platformproductoptionvalues').find({ active: true }).toArray(),
      require('../../../src/infrastructure/postgres/postgres-client').knex('seller_organizations').where({ approval_status: 'approved' }),
    ]);
    if (!sellers.length || !organizations.length) throw new Error('Products seed requires approved sellers and seller organizations. Run seed:sellers first.');
    const leafCategories = categories.filter((category) => !categories.some((candidate) => candidate.parentKey === category.categoryKey));
    if (!leafCategories.length || !brands.length || !options.length) throw new Error('Products seed requires category, brand and option master seeds.');

    const categoryByKey = new Map(categories.map((category) => [category.categoryKey, category]));
    const sellerById = new Map(sellers.map((seller) => [String(seller._id), seller]));
    const sellerOrgs = organizations.filter((org) => sellerById.has(String(org.seller_id)));
    const optionBySlug = new Map(options.map((option) => [option.slug, option]));
    const valuesByOption = new Map();
    optionValues.forEach((value) => {
      const list = valuesByOption.get(String(value.optionId)) || [];
      list.push(value); valuesByOption.set(String(value.optionId), list);
    });

    await Promise.all([
      conn.collection('products').deleteMany({ 'metadata.seedManaged': true }),
      conn.collection('productvariants').deleteMany({ seedManaged: true }),
    ]);
    const productIds = Array.from({ length: PRODUCT_COUNT }, () => new mongoose.Types.ObjectId());
    let createdVariants = 0;

    for (let offset = 0; offset < PRODUCT_COUNT; offset += BATCH_SIZE) {
      const productDocs = [];
      const externalVariants = [];
      const end = Math.min(PRODUCT_COUNT, offset + BATCH_SIZE);
      for (let index = offset; index < end; index += 1) {
        const category = leafCategories[index % leafCategories.length];
        const root = resolveRoot(category, categoryByKey);
        const compatible = brands.filter((brand) => (brand.metadata?.categories || []).some((key) => root.includes(key) || key.includes(root)));
        const brand = choose(compatible.length ? compatible : brands, index, 2);
        const org = sellerOrgs[index % sellerOrgs.length];
        const seller = sellerById.get(String(org.seller_id));
        const model = choose(MODELS, index, 3);
        const quality = choose(QUALITIES, index, 4);
        const modelCode = `${root.slice(0, 3).toUpperCase()}-${String(index + 10001).padStart(5, '0')}`;
        const title = `${brand.name} ${model} ${category.title} ${modelCode}`;
        const slug = `${slugify(brand.name)}-${slugify(category.title)}-${modelCode.toLowerCase()}`;
        const [minPrice, maxPrice] = priceRange(root);
        const basePrice = money(minPrice + seeded(index, 5) * (maxPrice - minPrice));
        const mrp = money(basePrice * (1.12 + seeded(index, 6) * 0.28));
        const variantAxis = variantConfig(root, `${category.title} ${category.parentKey}`);
        const master = optionBySlug.get(variantAxis.slug) || optionBySlug.get('color') || options[0];
        const masterValues = valuesByOption.get(String(master._id)) || [];
        const availableNames = masterValues.length ? masterValues.map((value) => value.name) : variantAxis.values;
        const variantCount = index % 11 === 0 ? 8 : index % 5 === 0 ? 6 : 4;
        const selectedValues = Array.from({ length: variantCount }, (_, pos) => availableNames[(index + pos) % availableNames.length]);
        const commonImages = [imageUrl(root, index * 3), imageUrl(root, index * 3 + 1)];
        const variants = selectedValues.map((value, position) => {
          const variantPrice = money(basePrice * (1 + position * 0.025));
          const variantMrp = Math.max(variantPrice, money(mrp * (1 + position * 0.025)));
          const stock = 12 + Math.floor(seeded(index, 20 + position) * 190);
          const variantId = new mongoose.Types.ObjectId();
          const sku = `${modelCode}-${slugify(value).slice(0, 10).toUpperCase()}`;
          const attributes = { [master.slug || variantAxis.slug]: value };
          const variant = {
            _id: variantId, sku, title: value, description: `${title} in ${value}.`, shortDescription: `${quality} ${category.title.toLowerCase()} variant in ${value}.`,
            price: variantPrice, mrp: variantMrp, salePrice: variantPrice, gstRate: 18, stock, reservedStock: position % 3,
            barcode: `890${String(index + 100000).slice(-6)}${String(position).padStart(3, '0')}`, weight: Number((0.2 + seeded(index, position + 40) * 3).toFixed(2)), weightUnit: 'kg',
            dimensions: { length: 12 + position, width: 8 + position, height: 5 + position, unit: 'cm' }, attributes, specifications: { model: modelCode, variant: value },
            images: [imageUrl(root, index * 10 + position + 2)], status: 'active', isDefault: position === 0, sortOrder: position,
          };
          externalVariants.push({ _id: variantId, familyCode: `${root.toUpperCase()}-FAMILY`, productId: String(productIds[index]), sellerId: String(org.seller_id), sku, attributes, stock, reservedStock: position % 3, status: 'active', seedManaged: true, createdAt: new Date(), updatedAt: new Date() });
          return variant;
        });
        const stock = variants.reduce((sum, variant) => sum + variant.stock, 0);
        const related = [1, 2, 3].map((step) => String(productIds[(index + step) % PRODUCT_COUNT]));
        const sellerName = org.store_display_name || seller?.sellerProfile?.displayName || org.legal_business_name;
        productDocs.push({
          _id: productIds[index], sellerId: String(org.seller_id), organizationId: String(org.id), organizationSnapshot: { legalBusinessName: org.legal_business_name, storeDisplayName: sellerName, gstin: org.gstin },
          title, slug, description: `${title} is a ${quality.toLowerCase()} choice from ${sellerName}. It is selected for dependable everyday use, consistent quality, careful packaging and nationwide after-sales support. Every unit is quality checked before dispatch and includes clear care and usage guidance.`,
          shortDescription: `${quality} ${category.title.toLowerCase()} with verified specifications, secure packaging and dependable seller support.`,
          productType: 'variable', visibility: 'public', publishedAt: new Date(Date.now() - (index % 365) * 86400000), categoryId: String(category._id), category: category.categoryKey,
          brand: brand.name, productFamilyCode: `${root.toUpperCase()}-FAMILY`, tags: [slugify(category.title), root, slugify(quality), slugify(brand.name)],
          price: variants[0].salePrice, salePrice: variants[0].salePrice, mrp: variants[0].mrp, costPrice: money(variants[0].salePrice * 0.68), currency: 'INR', gstRate: 18, gstInclusive: true,
          hsnCode: /fashion|footwear/.test(root) ? '61091000' : /electronics|computer/.test(root) ? '85176290' : '39249090',
          complianceSnapshot: { hsnCode: /electronics|computer/.test(root) ? '85176290' : '39249090', gstRate: 18, cessRate: 0, taxType: 'GST', exempt: false, source: 'hsn_master', validatedAt: new Date() },
          sku: variants[0].sku, barcode: variants[0].barcode, color: variantAxis.slug === 'color' ? selectedValues[0] : undefined,
          attributes: { category: category.title, quality, model: modelCode, brand: brand.name }, variantAxes: [master.slug || variantAxis.slug], hasVariants: true,
          defaultVariantId: String(variants[0]._id), variants, options: [{ platformOptionId: String(master._id), name: master.name, slug: master.slug, values: selectedValues, valueCodes: Object.fromEntries(selectedValues.map((value) => [value, slugify(value)])), required: true, displayType: master.displayType || 'button', sortOrder: 0 }],
          specifications: { General: { Brand: brand.name, Model: modelCode, Category: category.title, CountryOfOrigin: 'India' }, Care: { Packaging: 'Recyclable protective packaging', QualityCheck: 'Multi-point inspection' } },
          images: commonImages, commonImages, videos: [], documents: [], dimensions: variants[0].dimensions, weight: variants[0].weight, weightUnit: 'kg', origin: { country: 'India', state: org.pickup_address?.state || 'Karnataka', city: org.pickup_address?.city || 'Bengaluru' },
          warranty: { period: /electronics|computer/.test(root) ? 12 : 6, periodUnit: 'months', type: 'seller', provider: sellerName, terms: 'Warranty covers manufacturing defects under normal use.', returnPolicy: { eligible: true, returnable: true, days: 7, returnWindowDays: 7, type: 'standard', resolution: 'refund_or_replacement', requiresImages: true, inspectionRequired: true, shippingPaidBy: 'seller', restockingFee: 0 }, serviceableCountries: ['India'] },
          stock, reservedStock: variants.reduce((sum, variant) => sum + variant.reservedStock, 0), inventorySettings: { trackInventory: true, allowBackorder: false, lowStockThreshold: 10, outOfStockMessage: 'Temporarily unavailable', manageVariantInventory: true },
          shipping: { freeShipping: basePrice >= 499, freeShippingMinOrder: 499, shippingClass: basePrice > 10000 ? 'secure' : 'standard', additionalCost: 0, handlingCharge: 0, processingDays: 1 + (index % 2), serviceabilityMode: 'all_pincodes', codAvailable: basePrice < 25000, estimatedDaysMin: 2, estimatedDaysMax: 7, shippingPartner: 'Marketplace Fulfilment Network', shippingMethod: 'standard', dangerousGoods: false, requiresColdChain: false },
          seo: { metaTitle: title.slice(0, 70), metaDescription: `Buy ${title} from ${sellerName}. Genuine product, verified specifications, secure delivery and seller warranty.`.slice(0, 160), keywords: [brand.name, category.title, modelCode, quality], canonicalUrl: `/products/${slug}`, ogTitle: title.slice(0, 70), ogDescription: `Shop ${title} with reliable delivery across India.` },
          relatedProducts: related, crossSellProducts: [related[1]], upSellProducts: [related[2]], frequentlyBoughtTogether: [related[0], related[1]], featuredProducts: index % 17 === 0 ? related : [], trendingProducts: index % 23 === 0 ? related : [], bestSellerProducts: index % 29 === 0 ? related : [], collectionIds: [],
          analytics: { views: 120 + Math.floor(seeded(index, 70) * 24000), uniqueViews: 90 + Math.floor(seeded(index, 71) * 18000), impressions: 500 + Math.floor(seeded(index, 72) * 60000), cartAdds: 15 + Math.floor(seeded(index, 73) * 900), wishlistAdds: 8 + Math.floor(seeded(index, 74) * 600), purchases: 5 + Math.floor(seeded(index, 75) * 350), revenue: 0, conversionRate: Number((1.2 + seeded(index, 76) * 6).toFixed(2)), lastViewedAt: new Date() },
          rating: Number((4 + seeded(index, 80)).toFixed(1)), reviewCount: 12 + Math.floor(seeded(index, 81) * 900), metadata: { seedManaged: true, catalogVersion: '2026.09', featured: index % 17 === 0, codAvailable: basePrice < 25000, manufacturerPartNumber: modelCode },
          status: 'active', approvalStatus: 'approved', moderation: { submittedAt: new Date(), reviewedAt: new Date(), reviewedBy: 'catalog-seed', checklist: { titleVerified: true, categoryVerified: true, complianceVerified: true, mediaVerified: true, pricingVerified: true, inventoryVerified: true }, notes: 'Catalog seed validation passed.', revisionCount: 0 },
          approvedBy: 'catalog-seed', approvedAt: new Date(), revisionStatus: 'none', statusHistory: [{ fromStatus: 'draft', toStatus: 'active', reason: 'Approved catalog import', actorId: 'catalog-seed', actorRole: 'super_admin', createdAt: new Date() }], createdBy: 'catalog-seed', lastUpdatedBy: 'catalog-seed', version: 1, createdAt: new Date(), updatedAt: new Date(),
        });
      }
      await conn.collection('products').insertMany(productDocs, { ordered: false });
      await conn.collection('productvariants').insertMany(externalVariants, { ordered: false });
      createdVariants += externalVariants.length;
      this.logger.recordBatch(productDocs.length);
    }

    this.logger.printStats();
    return { created: PRODUCT_COUNT + createdVariants, products: PRODUCT_COUNT, variants: createdVariants, minimumVariantsPerProduct: 4 };
  }
}

module.exports = ProductsSeed;
