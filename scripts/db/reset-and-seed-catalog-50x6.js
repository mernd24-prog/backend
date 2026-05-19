#!/usr/bin/env node
"use strict";

const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { ProductModel } = require("../../src/modules/product/models/product.model");
const { CategoryTreeModel } = require("../../src/modules/platform/models/category-tree.model");
const { PlatformBrandModel } = require("../../src/modules/platform/models/platform-brand.model");
const { ProductFamilyModel } = require("../../src/modules/platform/models/product-family.model");
const { ProductVariantModel } = require("../../src/modules/platform/models/product-variant.model");
const { PlatformProductOptionModel } = require("../../src/modules/platform/models/platform-product-option.model");
const { PlatformProductOptionValueModel } = require("../../src/modules/platform/models/platform-product-option-value.model");

const SELLER_ID = "static-catalog-seller";
const PRODUCTS_PER_LEAF_CATEGORY = 50;

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function imageUrl(seed, keywords, width = 1200, height = 1200) {
  return `https://loremflickr.com/${width}/${height}/${encodeURIComponent(keywords)}?lock=${seed}`;
}

const CATEGORY_TREE = [
  {
    title: "Fashion",
    groups: [
      ["Men's Clothing", ["T-Shirts", "Casual Shirts", "Jeans", "Trousers", "Jackets"]],
      ["Women's Clothing", ["Dresses", "Tops", "Sarees", "Kurtas", "Jeans"]],
      ["Footwear", ["Men's Sneakers", "Women's Heels", "Sports Shoes", "Sandals", "Formal Shoes"]],
      ["Fashion Accessories", ["Watches", "Sunglasses", "Handbags", "Wallets", "Belts"]],
    ],
  },
  {
    title: "Electronics",
    groups: [
      ["Mobiles", ["Android Phones", "iPhones", "Mobile Accessories", "Power Banks", "Phone Cases"]],
      ["Computers", ["Gaming Laptops", "Business Laptops", "Tablets", "Monitors", "Keyboards"]],
      ["Audio", ["Headphones", "Earbuds", "Bluetooth Speakers", "Soundbars", "Microphones"]],
      ["Cameras", ["Mirrorless Cameras", "Action Cameras", "Security Cameras", "Camera Lenses", "Tripods"]],
    ],
  },
  {
    title: "Home & Kitchen",
    groups: [
      ["Kitchen Appliances", ["Mixer Grinders", "Microwave Ovens", "Air Fryers", "Coffee Makers", "Induction Cooktops"]],
      ["Furniture", ["Sofas", "Beds", "Dining Tables", "Office Chairs", "Shoe Racks"]],
      ["Home Decor", ["Wall Decor", "Lighting", "Showpieces", "Rugs", "Curtains"]],
    ],
  },
  {
    title: "Beauty & Personal Care",
    groups: [
      ["Skincare", ["Face Wash", "Moisturizers", "Sunscreen", "Serums", "Body Lotions"]],
      ["Hair Care", ["Shampoo", "Conditioner", "Hair Serum", "Hair Oil", "Hair Dryers"]],
      ["Makeup", ["Lipsticks", "Foundations", "Eyeliners", "Nail Polish", "Makeup Kits"]],
    ],
  },
  {
    title: "Sports & Outdoors",
    groups: [
      ["Fitness", ["Yoga Mats", "Dumbbells", "Resistance Bands", "Treadmills", "Gym Gloves"]],
      ["Outdoor", ["Backpacks", "Camping Tents", "Water Bottles", "Cycling Gear", "Trail Shoes"]],
    ],
  },
];

const BRANDS = [
  "Aster Mode", "Urban Loom", "NorthPeak", "Velora", "StrideX", "ModaCore",
  "TechPulse", "ByteNest", "SoundArc", "VoltEdge", "PixelPro", "OmniGear",
  "HomeHaven", "CookCraft", "LumaLiving", "Oak & Aura", "Nestory", "Decora",
  "GlowTheory", "PureBloom", "HairKind", "MuseMakeup", "DermaLeaf", "Scentra",
  "FitForge", "TrailMint", "Flexora", "HydroWay", "ActiveRoot", "PeakMotion",
];

const CATEGORY_PRESETS = {
  fashion: {
    schema: [
      ["size", "Size", "select", ["XS", "S", "M", "L", "XL", "XXL"], true],
      ["color", "Color", "select", ["Black", "Blue", "White", "Red", "Green", "Beige"], true],
      ["material", "Material", "select", ["Cotton", "Denim", "Linen", "Polyester", "Leather"], false],
      ["fit", "Fit", "select", ["Slim", "Regular", "Relaxed", "Oversized"], false],
    ],
    brands: ["Aster Mode", "Urban Loom", "NorthPeak", "Velora", "StrideX", "ModaCore"],
    families: ["Everyday Essentials", "Premium Edit", "Occasion Wear"],
    keywords: "fashion clothing product",
  },
  electronics: {
    schema: [
      ["storage", "Storage", "select", ["64GB", "128GB", "256GB", "512GB", "1TB"], true],
      ["color", "Color", "select", ["Black", "Silver", "Blue", "White", "Graphite"], true],
      ["connectivity", "Connectivity", "select", ["Bluetooth", "Wi-Fi", "5G", "USB-C"], false],
      ["warranty", "Warranty", "select", ["6 Months", "1 Year", "2 Years"], false],
    ],
    brands: ["TechPulse", "ByteNest", "SoundArc", "VoltEdge", "PixelPro", "OmniGear"],
    families: ["Pro Series", "Lite Series", "Max Series"],
    keywords: "electronics gadget product",
  },
  home: {
    schema: [
      ["material", "Material", "select", ["Wood", "Steel", "Glass", "Fabric", "Ceramic"], true],
      ["color", "Color", "select", ["Walnut", "White", "Black", "Grey", "Gold"], true],
      ["room", "Room", "select", ["Kitchen", "Living Room", "Bedroom", "Office"], false],
      ["finish", "Finish", "select", ["Matte", "Glossy", "Textured", "Natural"], false],
    ],
    brands: ["HomeHaven", "CookCraft", "LumaLiving", "Oak & Aura", "Nestory", "Decora"],
    families: ["Modern Home", "Classic Home", "Compact Living"],
    keywords: "home kitchen decor product",
  },
  beauty: {
    schema: [
      ["skinType", "Skin Type", "select", ["All", "Dry", "Oily", "Combination", "Sensitive"], false],
      ["shade", "Shade", "select", ["Nude", "Rose", "Berry", "Coral", "Brown"], true],
      ["concern", "Concern", "select", ["Hydration", "Glow", "Repair", "Oil Control"], false],
      ["finish", "Finish", "select", ["Matte", "Dewy", "Natural", "Gloss"], false],
    ],
    brands: ["GlowTheory", "PureBloom", "HairKind", "MuseMakeup", "DermaLeaf", "Scentra"],
    families: ["Daily Care", "Salon Pro", "Clean Beauty"],
    keywords: "beauty cosmetic skincare product",
  },
  sports: {
    schema: [
      ["size", "Size", "select", ["S", "M", "L", "XL", "Free Size"], true],
      ["color", "Color", "select", ["Black", "Blue", "Red", "Grey", "Green"], true],
      ["sport", "Sport", "select", ["Training", "Running", "Yoga", "Cycling", "Outdoor"], false],
      ["material", "Material", "select", ["Rubber", "Foam", "Steel", "Polyester"], false],
    ],
    brands: ["FitForge", "TrailMint", "Flexora", "HydroWay", "ActiveRoot", "PeakMotion"],
    families: ["Training Gear", "Outdoor Pro", "Active Basics"],
    keywords: "sports fitness product",
  },
};

function rootType(rootTitle) {
  if (rootTitle === "Fashion") return "fashion";
  if (rootTitle === "Electronics") return "electronics";
  if (rootTitle === "Home & Kitchen") return "home";
  if (rootTitle === "Beauty & Personal Care") return "beauty";
  return "sports";
}

function attributeSchema(type) {
  return CATEGORY_PRESETS[type].schema.map(([key, label, fieldType, options, variant]) => ({
    key,
    label,
    type: fieldType,
    required: false,
    options,
    unit: null,
    isVariantAttribute: Boolean(variant),
    isFilterable: true,
    isSearchable: true,
  }));
}

function pick(list, index) {
  return list[index % list.length];
}

function makeCategoryDocs() {
  const docs = [];
  let rootOrder = 1;
  for (const root of CATEGORY_TREE) {
    const type = rootType(root.title);
    const rootKey = slugify(root.title);
    docs.push({
      categoryKey: rootKey,
      title: root.title,
      parentKey: null,
      level: 0,
      active: true,
      sortOrder: rootOrder++,
      imageUrl: imageUrl(1000 + docs.length, `${root.title} shopping`, 800, 800),
      bannerUrl: imageUrl(2000 + docs.length, `${root.title} banner`, 1600, 600),
      iconUrl: imageUrl(3000 + docs.length, `${root.title} icon`, 300, 300),
      isDashboardVisible: true,
      attributesSchema: {},
      attributeSchema: attributeSchema(type),
    });

    root.groups.forEach(([groupTitle, leaves], groupIndex) => {
      const groupKey = slugify(groupTitle);
      docs.push({
        categoryKey: groupKey,
        title: groupTitle,
        parentKey: rootKey,
        level: 1,
        active: true,
        sortOrder: groupIndex + 1,
        imageUrl: imageUrl(4000 + docs.length, `${groupTitle} category`, 800, 800),
        bannerUrl: imageUrl(5000 + docs.length, `${groupTitle} products`, 1600, 600),
        iconUrl: imageUrl(6000 + docs.length, `${groupTitle} icon`, 300, 300),
        attributesSchema: {},
        attributeSchema: attributeSchema(type),
      });

      leaves.forEach((leafTitle, leafIndex) => {
        const leafKey = `${groupKey}-${slugify(leafTitle)}`;
        docs.push({
          categoryKey: leafKey,
          title: leafTitle,
          parentKey: groupKey,
          level: 2,
          active: true,
          sortOrder: leafIndex + 1,
          imageUrl: imageUrl(7000 + docs.length, `${leafTitle} product`, 800, 800),
          bannerUrl: imageUrl(8000 + docs.length, `${leafTitle} shopping`, 1600, 600),
          iconUrl: imageUrl(9000 + docs.length, `${leafTitle} icon`, 300, 300),
          attributesSchema: {},
          attributeSchema: attributeSchema(type),
          metadata: { rootKey, groupKey, catalogType: type },
        });
      });
    });
  }
  return docs;
}

function makeBrands() {
  return BRANDS.map((name, index) => ({
    name,
    logo: imageUrl(11000 + index, `${name} logo`, 500, 500),
    thumbnails: imageUrl(12000 + index, `${name} brand product`, 900, 500),
    active: true,
    sortOrder: index + 1,
  }));
}

function makeProduct(leaf, leafIndex, itemIndex, familyCode, brand, preset) {
  const price = 499 + (leafIndex % 12) * 150 + itemIndex * 17;
  const mrp = price + 250 + (itemIndex % 5) * 80;
  const schema = attributeSchema(preset);
  const attributes = {};
  schema.forEach((field, fieldIndex) => {
    attributes[field.key] = pick(field.options, itemIndex + fieldIndex + leafIndex);
  });
  const titlePrefix = leaf.title.replace(/'s/g, "s");
  const title = `${brand} ${titlePrefix} ${pick(["Classic", "Prime", "Elite", "Daily", "Signature"], itemIndex)} ${itemIndex}`;
  const slug = `${leaf.categoryKey}-${slugify(brand)}-${itemIndex}`;
  const size = attributes.size || attributes.storage || attributes.shade || "Standard";
  const color = attributes.color || attributes.shade || "Black";
  const variants = [0, 1, 2].map((offset) => ({
    sku: `VAR-${slug.toUpperCase()}-${offset + 1}`,
    title: `${title} - ${pick([size, "Plus", "Pro"], offset)} / ${pick([color, "Black", "Blue"], offset)}`,
    price: price + offset * 60,
    mrp: mrp + offset * 80,
    salePrice: price + offset * 60,
    stock: 20 + offset * 5 + (itemIndex % 9),
    attributes: {
      ...attributes,
      size: attributes.size ? pick(["S", "M", "L", "XL"], itemIndex + offset) : attributes.size,
      color: attributes.color ? pick(["Black", "Blue", "White", "Red"], itemIndex + offset) : attributes.color,
    },
    images: [imageUrl(13000 + leafIndex * 100 + itemIndex * 3 + offset, `${leaf.title} ${brand}`, 1200, 1200)],
    status: "active",
    isDefault: offset === 0,
    sortOrder: offset + 1,
  }));

  return {
    sellerId: SELLER_ID,
    title,
    slug,
    description: `${title} for ${leaf.title}, curated with reliable quality, current styling, and fast everyday usability.`,
    shortDescription: `${brand} ${leaf.title} with ${Object.values(attributes).slice(0, 3).join(", ")}.`,
    productType: "variable",
    visibility: "public",
    publishedAt: new Date(),
    categoryId: leaf.categoryKey,
    category: leaf.categoryKey,
    brand,
    productFamilyCode: familyCode,
    tags: [leaf.categoryKey, leaf.parentKey, slugify(brand), preset, "static-catalog"],
    price,
    mrp,
    salePrice: price,
    costPrice: Math.round(price * 0.7),
    currency: "INR",
    gstRate: preset === "beauty" ? 12 : 18,
    gstInclusive: true,
    hsnCode: preset === "electronics" ? "8517" : preset === "fashion" ? "6204" : "3926",
    sku: `SKU-${slug.toUpperCase()}`,
    barcode: `890${String(leafIndex).padStart(3, "0")}${String(itemIndex).padStart(4, "0")}`,
    color,
    attributes,
    variantAxes: schema.filter((f) => f.isVariantAttribute).map((f) => f.key),
    hasVariants: true,
    variants,
    options: schema
      .filter((f) => f.isVariantAttribute)
      .map((f, idx) => ({
        name: f.label,
        slug: f.key,
        values: f.options,
        required: true,
        displayType: f.key === "color" || f.key === "shade" ? "color_swatch" : "button",
        sortOrder: idx + 1,
      })),
    specifications: {
      General: { Brand: brand, Category: leaf.title, Family: familyCode },
      Attributes: attributes,
    },
    images: [
      imageUrl(14000 + leafIndex * 100 + itemIndex, `${leaf.title} ${brand}`, 1200, 1200),
      imageUrl(15000 + leafIndex * 100 + itemIndex, `${leaf.title} ecommerce`, 1200, 1200),
      imageUrl(16000 + leafIndex * 100 + itemIndex, `${preset} product detail`, 1200, 1200),
    ],
    origin: { country: "India", state: "Maharashtra", city: "Mumbai" },
    warranty: {
      period: preset === "electronics" ? 12 : 6,
      periodUnit: "months",
      type: "manufacturer",
      provider: brand,
      returnPolicy: { eligible: true, days: 7, type: "standard", restockingFee: 0 },
      serviceableCountries: ["India"],
    },
    stock: 40 + (itemIndex % 20),
    reservedStock: 0,
    inventorySettings: { trackInventory: true, allowBackorder: false, lowStockThreshold: 5, manageVariantInventory: true },
    shipping: { freeShipping: itemIndex % 3 === 0, processingDays: 1 + (itemIndex % 3), shippingClass: preset },
    seo: {
      metaTitle: `${title} Online`,
      metaDescription: `Buy ${title} in ${leaf.title} from ${brand}.`,
      keywords: [leaf.title, brand, preset],
      ogImage: imageUrl(17000 + leafIndex * 100 + itemIndex, `${leaf.title} ${brand}`, 1200, 630),
    },
    analytics: {
      views: 100 + itemIndex * 13,
      uniqueViews: 75 + itemIndex * 7,
      impressions: 500 + itemIndex * 31,
      cartAdds: itemIndex * 2,
      wishlistAdds: itemIndex,
      purchases: itemIndex % 17,
      revenue: price * (itemIndex % 17),
      conversionRate: 1.5 + (itemIndex % 8) / 10,
    },
    rating: 3.6 + ((itemIndex + leafIndex) % 14) / 10,
    reviewCount: 5 + ((itemIndex + leafIndex) % 80),
    metadata: { seed: "static-catalog-50x6", rootKey: leaf.rootKey, groupKey: leaf.parentKey, preset },
    status: "active",
    moderation: {
      submittedAt: new Date(),
      reviewedAt: new Date(),
      reviewedBy: "seed",
      checklist: {
        titleVerified: true,
        categoryVerified: true,
        complianceVerified: true,
        mediaVerified: true,
        pricingVerified: true,
        inventoryVerified: true,
      },
      notes: "Static seed product",
    },
    approvedBy: "seed",
    approvedAt: new Date(),
    createdBy: "seed",
    lastUpdatedBy: "seed",
  };
}

async function main() {
  console.log("Resetting catalog: categories, brands, families, variants, options, and products...");
  await connectMongo();

  await Promise.all([
    ProductModel.deleteMany({}),
    CategoryTreeModel.deleteMany({}),
    PlatformBrandModel.deleteMany({}),
    ProductFamilyModel.deleteMany({}),
    ProductVariantModel.deleteMany({}),
    PlatformProductOptionModel.deleteMany({}),
    PlatformProductOptionValueModel.deleteMany({}),
  ]);

  const categories = makeCategoryDocs();
  await CategoryTreeModel.insertMany(categories, { ordered: true });

  const brands = makeBrands();
  await PlatformBrandModel.insertMany(brands, { ordered: true });

  const leaves = categories.filter((category) => category.level === 2);
  const familyDocs = [];
  const products = [];
  const variantDocs = [];

  leaves.forEach((leaf, leafIndex) => {
    const root = categories.find((category) => category.categoryKey === leaf.metadata.rootKey);
    const preset = rootType(root?.title || "Fashion");
    const config = CATEGORY_PRESETS[preset];
    const familyCodes = config.families.map((familyTitle, index) => {
      const familyCode = `${leaf.categoryKey}-${slugify(familyTitle)}`;
      familyDocs.push({
        familyCode,
        sellerId: SELLER_ID,
        title: `${leaf.title} ${familyTitle}`,
        category: leaf.categoryKey,
        baseAttributes: { category: leaf.title, catalogType: preset },
        variantAxes: attributeSchema(preset).filter((f) => f.isVariantAttribute).map((f) => f.key),
        status: "active",
      });
      return familyCode;
    });

    for (let index = 1; index <= PRODUCTS_PER_LEAF_CATEGORY; index += 1) {
      const brand = pick(config.brands, leafIndex + index);
      const familyCode = pick(familyCodes, index);
      const product = makeProduct(leaf, leafIndex, index, familyCode, brand, preset);
      products.push(product);
    }
  });

  await insertInBatches(ProductFamilyModel, familyDocs, 100);
  const insertedProducts = await insertInBatches(ProductModel, products, 100);
  insertedProducts.forEach((product) => {
    (product.variants || []).forEach((variant) => {
      variantDocs.push({
        familyCode: product.productFamilyCode,
        productId: String(product._id),
        sellerId: product.sellerId,
        sku: variant.sku,
        attributes: variant.attributes || {},
        stock: variant.stock || 0,
        reservedStock: 0,
        status: "active",
      });
    });
  });
  await insertInBatches(ProductVariantModel, variantDocs, 300);

  console.log(`Categories created: ${categories.length} (${leaves.length} leaf sub-sub categories)`);
  console.log(`Brands created: ${brands.length}`);
  console.log(`Families created: ${familyDocs.length}`);
  console.log(`Products created: ${products.length} (${PRODUCTS_PER_LEAF_CATEGORY} per leaf category)`);
  console.log(`Variant records created: ${variantDocs.length}`);
  await mongoose.connection.close();
}

async function insertInBatches(model, docs, batchSize) {
  const inserted = [];
  for (let index = 0; index < docs.length; index += batchSize) {
    const batch = docs.slice(index, index + batchSize);
    const result = await model.insertMany(batch, { ordered: false });
    inserted.push(...result);
  }
  return inserted;
}

main().catch(async (error) => {
  console.error("Failed to reset/seed catalog:", error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
