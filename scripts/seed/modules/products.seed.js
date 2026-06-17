'use strict';

const SeedLogger = require('../utils/seed-logger');
const { UserModel } = require('../../../src/modules/user/models/user.model');
const { ProductModel } = require('../../../src/modules/product/models/product.model');
const { ROLES } = require('../../../src/shared/constants/roles');
const {
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
} = require('../../../src/shared/domain/commerce-constants');

const SEED_TAG = 'master-seed-products-v1';

const catalog = [
  ['Demo Galaxy A55 5G', 'electronics', 'Samsung', 36999, 42999, 18, '8517', 'smartphone'],
  ['Demo Noise Pro Smartwatch', 'electronics', 'Noise', 4999, 7999, 18, '8517', 'wearable'],
  ['Demo Linen Casual Shirt', 'fashion', 'Urban Loom', 1499, 2499, 12, '6205', 'shirt'],
  ['Demo Canvas Market Tote', 'fashion', 'Daily Carry', 799, 1299, 12, '4202', 'bag'],
  ['Demo Ceramic Dinner Set', 'home-kitchen', 'HomeCraft', 2299, 3499, 18, '6912', 'dinnerware'],
  ['Demo Hydrating Face Serum', 'beauty', 'GlowGrid', 899, 1399, 18, '3304', 'serum'],
  ['Demo Running Shoes', 'sports', 'SprintBox', 2999, 4999, 12, '6404', 'shoes'],
  ['Demo Productivity Notebook', 'books-stationery', 'PageMint', 349, 599, 5, '4820', 'notebook'],
];

class ProductsSeed {
  constructor() {
    this.logger = new SeedLogger('Products');
  }

  async execute() {
    this.logger.info('Seeding seller-owned marketplace products');

    const sellers = await UserModel.find({
      role: ROLES.SELLER,
      'sellerProfile.goLiveStatus': 'live',
    }).limit(20);

    if (!sellers.length) {
      this.logger.warn('No live sellers found. Run npm run seed:sellers first.');
      return { created: 0, skipped: 1 };
    }

    const now = new Date();
    const operations = catalog.map((row, index) => {
      const seller = sellers[index % sellers.length];
      const [title, category, brand, price, mrp, gstRate, hsnCode, tag] = row;
      const slug = toSlug(`${title}-${seller.sellerProfile?.displayName || seller.email}`);
      const sku = `SEED-${tag.toUpperCase()}-${String(index + 1).padStart(3, '0')}`;

      return {
        updateOne: {
          filter: { slug },
          update: {
            $set: {
              sellerId: String(seller._id),
              title,
              slug,
              description: `${title} seeded for seller catalog, pricing, GST, inventory, checkout, invoice, payout, and analytics flows.`,
              shortDescription: `Seeded ${category} product by ${seller.sellerProfile?.displayName || seller.email}.`,
              productType: index === 2 ? PRODUCT_TYPE.VARIABLE : PRODUCT_TYPE.SIMPLE,
              visibility: PRODUCT_VISIBILITY.PUBLIC,
              publishedAt: now,
              category,
              categoryId: category,
              brand,
              tags: [tag, category, 'seed'],
              badges: [{ type: 'featured', label: 'Seed Demo', color: '#0f766e', bgColor: '#ccfbf1' }],
              price,
              mrp,
              salePrice: price,
              costPrice: Math.round(price * 0.7),
              currency: 'INR',
              gstRate,
              gstInclusive: true,
              hsnCode,
              complianceSnapshot: {
                hsnCode,
                gstRate,
                cessRate: 0,
                taxType: 'gst',
                exempt: false,
                source: 'seed',
                validatedAt: now,
                validatedBy: 'master-seed',
              },
              sku,
              barcode: `BAR-${sku}`,
              color: index % 2 === 0 ? 'Black' : 'Natural',
              stock: 50 + index * 7,
              reservedStock: 0,
              hasVariants: index === 2,
              variantAxes: index === 2 ? ['size'] : [],
              variants: index === 2 ? shirtVariants(price, mrp, gstRate, sku) : [],
              images: [
                `https://placehold.co/900x900/png?text=${encodeURIComponent(title)}`,
                `https://placehold.co/900x900/png?text=${encodeURIComponent(brand)}`,
              ],
              dimensions: { length: 20, width: 15, height: 8, unit: 'cm' },
              weight: 0.8,
              weightUnit: 'kg',
              origin: { country: 'India', state: 'Karnataka', city: 'Bengaluru' },
              warranty: {
                period: 12,
                periodUnit: 'months',
                type: 'seller',
                provider: seller.sellerProfile?.displayName || seller.email,
                returnPolicy: { eligible: true, days: 7, type: 'standard', restockingFee: 0 },
              },
              inventorySettings: {
                trackInventory: true,
                allowBackorder: false,
                lowStockThreshold: 5,
                manageVariantInventory: index === 2,
              },
              shipping: {
                freeShipping: price >= 999,
                freeShippingMinOrder: 999,
                shippingClass: 'standard',
                processingDays: 1,
              },
              analytics: {
                views: 100 + index * 30,
                uniqueViews: 80 + index * 20,
                impressions: 500 + index * 75,
                cartAdds: 20 + index * 3,
                purchases: 5 + index,
                revenue: price * (5 + index),
                conversionRate: 2.5 + index * 0.2,
                lastViewedAt: now,
              },
              rating: Number((4.1 + (index % 5) * 0.15).toFixed(1)),
              reviewCount: 10 + index * 2,
              status: PRODUCT_STATUS.ACTIVE,
              moderation: {
                submittedAt: now,
                reviewedAt: now,
                reviewedBy: 'master-seed',
                checklist: {
                  titleVerified: true,
                  categoryVerified: true,
                  complianceVerified: true,
                  mediaVerified: true,
                  pricingVerified: true,
                  inventoryVerified: true,
                },
                notes: 'Approved by master seed.',
              },
              approvedBy: 'master-seed',
              approvedAt: now,
              createdBy: String(seller._id),
              lastUpdatedBy: 'master-seed',
              metadata: {
                seedTag: SEED_TAG,
                sellerEmail: seller.email,
              },
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      };
    });

    await ProductModel.bulkWrite(operations, { ordered: false });
    await linkProducts();
    this.logger.recordBatch(operations.length);
    this.logger.printStats();
    return { created: operations.length };
  }
}

function shirtVariants(price, mrp, gstRate, baseSku) {
  return ['M', 'L', 'XL'].map((size, index) => ({
    sku: `${baseSku}-${size}`,
    title: `Size ${size}`,
    price,
    mrp,
    salePrice: price,
    gstRate,
    stock: 20 + index * 5,
    reservedStock: 0,
    attributes: { size },
    status: 'active',
    isDefault: index === 0,
    sortOrder: index,
  }));
}

async function linkProducts() {
  const products = await ProductModel.find({ 'metadata.seedTag': SEED_TAG }).select('_id slug');
  const ids = products.map((product) => String(product._id));
  if (ids.length < 2) return;

  await Promise.all(products.map((product, index) => {
    const related = ids.filter((id) => id !== String(product._id)).slice(0, 3);
    return ProductModel.findByIdAndUpdate(product._id, {
      relatedProducts: related,
      crossSellProducts: [ids[(index + 1) % ids.length]],
      upSellProducts: [ids[(index + 2) % ids.length]],
      frequentlyBoughtTogether: [ids[(index + 3) % ids.length]],
    });
  }));
}

function toSlug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = ProductsSeed;
