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
  const preset = imagePreset(keywords);
  const photoId = pick(IMAGE_POOLS[preset] || IMAGE_POOLS.fallback, seed);
  return `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=${width}&h=${height}&q=80`;
}

function brandLogoUrl(name, index) {
  const colors = ["111827", "1d4ed8", "7c2d12", "365314", "831843", "334155"];
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${pick(colors, index)}&color=fff&size=512&bold=true&format=png`;
}

function imagePreset(value = "") {
  const text = String(value).toLowerCase();

  const rules = [
    ["tShirts", /t-?shirts?|tees?/],
    ["shirts", /casual shirts?|shirts?/],
    ["denim", /jeans|denim/],
    ["trousers", /trousers?|pants?/],
    ["jackets", /jackets?|coats?/],
    ["dresses", /dresses?/],
    ["ethnicWear", /sarees?|kurtas?|ethnic/],
    ["tops", /tops?/],
    ["sneakers", /sneakers?|sports shoes?|trail shoes?|running shoes?/],
    ["heels", /heels?|sandals?|formal shoes?/],
    ["watches", /watches?/],
    ["eyewear", /sunglasses|eyewear/],
    ["bags", /handbags?|wallets?|belts?/],
    ["phones", /android phones?|iphones?|phone cases?|mobile accessories|mobiles?/],
    ["powerBanks", /power banks?/],
    ["laptops", /gaming laptops?|business laptops?|laptops?|tablets?/],
    ["monitors", /monitors?|keyboards?/],
    ["audio", /headphones?|earbuds?|speakers?|soundbars?|microphones?/],
    ["camera", /cameras?|lenses?|tripods?/],
    ["kitchenAppliance", /mixer grinders?|microwave ovens?|air fryers?|coffee makers?|induction cooktops?|kitchen appliance/],
    ["furniture", /sofas?|beds?|dining tables?|office chairs?|shoe racks?|furniture/],
    ["homeDecor", /wall decor|lighting|showpieces?|rugs?|curtains?|home decor/],
    ["skincare", /face wash|moisturizers?|sunscreen|serums?|body lotions?|skincare/],
    ["hairCare", /shampoo|conditioner|hair serum|hair oil|hair dryers?|hair care/],
    ["makeup", /lipsticks?|foundations?|eyeliners?|nail polish|makeup kits?|makeup/],
    ["yoga", /yoga mats?/],
    ["gym", /dumbbells?|resistance bands?|treadmills?|gym gloves?|fitness|training/],
    ["backpacks", /backpacks?/],
    ["camping", /camping tents?|tents?/],
    ["bottles", /water bottles?|bottles?/],
    ["cycling", /cycling gear|cycling|bicycle|bike/],
    ["outdoor", /outdoor/],
  ];

  const match = rules.find(([, pattern]) => pattern.test(text));
  if (match) return match[0];
  if (/fashion|clothing/.test(text)) return "fashion";
  if (/phone|laptop|audio|camera|electronics|gadget|keyboard|monitor|speaker|earbud|headphone/.test(text)) return "electronics";
  if (/home|kitchen|furniture|decor|sofa|bed|chair|lighting|curtain|rug|coffee|appliance/.test(text)) return "home";
  if (/beauty|skin|hair|makeup|serum|shampoo|cosmetic|sunscreen|lipstick|fragrance/.test(text)) return "beauty";
  if (/sport|fitness|yoga|gym|outdoor|trail|camping|cycling|dumbbell|treadmill/.test(text)) return "sports";
  return "fallback";
}

const IMAGE_POOLS = {
  tShirts: ["photo-1523381210434-271e8be1f52b", "photo-1503341504253-dff4815485f1", "photo-1583743814966-8936f37f4678"],
  shirts: ["photo-1596755094514-f87e34085b2c", "photo-1602810318383-e386cc2a3ccf", "photo-1598033129183-c4f50c736f10"],
  denim: ["photo-1541099649105-f69ad21f3246", "photo-1542272604-787c3835535d", "photo-1475178626620-a4d074967452"],
  trousers: ["photo-1473966968600-fa801b869a1a", "photo-1594633312681-425c7b97ccd1", "photo-1506629905607-d405d7d3b0d2"],
  jackets: ["photo-1551028719-00167b16eac5", "photo-1543076447-215ad9ba6923", "photo-1520975954732-35dd22299614"],
  dresses: ["photo-1496747611176-843222e1e57c", "photo-1515372039744-b8f02a3ae446", "photo-1568252542512-9fe8fe9c87bb"],
  ethnicWear: ["photo-1583391733956-6c78276477e2", "photo-1610030469983-98e550d6193c", "photo-1597983073493-88cd35cf93b0"],
  tops: ["photo-1503342217505-b0a15ec3261c", "photo-1544441893-675973e31985", "photo-1529139574466-a303027c1d8b"],
  sneakers: ["photo-1542291026-7eec264c27ff", "photo-1549298916-b41d501d3772", "photo-1460353581641-37baddab0fa2"],
  heels: ["photo-1543163521-1bf539c55dd2", "photo-1543163521-1bf539c55dd2", "photo-1515347619252-60a4bf4fff4f"],
  watches: ["photo-1524592094714-0f0654e20314", "photo-1523275335684-37898b6baf30", "photo-1434056886845-dac89ffe9b56"],
  eyewear: ["photo-1511499767150-a48a237f0083", "photo-1574258495973-f010dfbb5371", "photo-1509695507497-903c140c43b0"],
  bags: ["photo-1548036328-c9fa89d128fa", "photo-1590874103328-eac38a683ce7", "photo-1553062407-98eeb64c6a62"],
  phones: ["photo-1511707171634-5f897ff02aa9", "photo-1598327105666-5b89351aff97", "photo-1580910051074-3eb694886505"],
  powerBanks: ["photo-1609091839311-d5365f9ff1c5", "photo-1622957461168-2023e6c7e602", "photo-1609592806596-b43bada2f7c3"],
  laptops: ["photo-1496181133206-80ce9b88a853", "photo-1517336714731-489689fd1ca8", "photo-1588872657578-7efd1f1555ed"],
  monitors: ["photo-1527443224154-c4a3942d3acf", "photo-1547082299-de196ea013d6", "photo-1616763355548-1b606f439f86"],
  audio: ["photo-1505740420928-5e560c06d30e", "photo-1606220945770-b5b6c2c55bf1", "photo-1545454675-3531b543be5d"],
  camera: ["photo-1526170375885-4d8ecf77b99f", "photo-1502920917128-1aa500764cbd", "photo-1516035069371-29a1b244cc32"],
  kitchenAppliance: ["photo-1556911220-bff31c812dba", "photo-1585659722983-3a675dabf23d", "photo-1517668808822-9ebb02f2a0e6"],
  furniture: ["photo-1555041469-a586c61ea9bc", "photo-1505693416388-ac5ce068fe85", "photo-1493663284031-b7e3aefcae8e"],
  homeDecor: ["photo-1513506003901-1e6a229e2d15", "photo-1524758631624-e2822e304c36", "photo-1513519245088-0e12902e5a38"],
  skincare: ["photo-1571781926291-c477ebfd024b", "photo-1620916566398-39f1143ab7be", "photo-1596462502278-27bfdc403348"],
  hairCare: ["photo-1522335789203-aabd1fc54bc9", "photo-1527799820374-dcf8d9d4a388", "photo-1560066984-138dadb4c035"],
  makeup: ["photo-1526045478516-99145907023c", "photo-1596462502278-27bfdc403348", "photo-1583241800698-9f8f5d9bb47b"],
  yoga: ["photo-1518611012118-696072aa579a", "photo-1544367567-0f2fcb009e0b", "photo-1599901860904-17e6ed7083a0"],
  gym: ["photo-1517836357463-d25dfeac3438", "photo-1599058917212-d750089bc07e", "photo-1534438327276-14e5300c3a48"],
  backpacks: ["photo-1553062407-98eeb64c6a62", "photo-1622260614153-03223fb72052", "photo-1491637639811-60e2756cc1c7"],
  camping: ["photo-1504280390367-361c6d9f38f4", "photo-1478131143081-80f7f84ca84d", "photo-1537905569824-f89f14cceb68"],
  bottles: ["photo-1602143407151-7111542de6e8", "photo-1523362628745-0c100150b504", "photo-1526401485004-2aa9e7a8b042"],
  cycling: ["photo-1485965120184-e220f721d03e", "photo-1507035895480-2b3156c31fc8", "photo-1517649763962-0c623066013b"],
  outdoor: ["photo-1500530855697-b586d89ba3ee", "photo-1522163182402-834f871fd851", "photo-1504280390367-361c6d9f38f4"],
  fashion: [
    "photo-1483985988355-763728e1935b",
    "photo-1523381210434-271e8be1f52b",
    "photo-1496747611176-843222e1e57c",
    "photo-1515886657613-9f3515b0c78f",
    "photo-1516762689617-e1cffcef479d",
    "photo-1503342217505-b0a15ec3261c",
    "photo-1542291026-7eec264c27ff",
    "photo-1543163521-1bf539c55dd2",
  ],
  electronics: [
    "photo-1511707171634-5f897ff02aa9",
    "photo-1496181133206-80ce9b88a853",
    "photo-1505740420928-5e560c06d30e",
    "photo-1526170375885-4d8ecf77b99f",
    "photo-1588872657578-7efd1f1555ed",
    "photo-1546054454-aa26e2b734c7",
    "photo-1516321318423-f06f85e504b3",
    "photo-1517336714731-489689fd1ca8",
  ],
  home: [
    "photo-1556911220-bff31c812dba",
    "photo-1484154218962-a197022b5858",
    "photo-1493663284031-b7e3aefcae8e",
    "photo-1505693416388-ac5ce068fe85",
    "photo-1513506003901-1e6a229e2d15",
    "photo-1524758631624-e2822e304c36",
    "photo-1501045661006-fcebe0257c3f",
    "photo-1555041469-a586c61ea9bc",
  ],
  beauty: [
    "photo-1596462502278-27bfdc403348",
    "photo-1522335789203-aabd1fc54bc9",
    "photo-1571781926291-c477ebfd024b",
    "photo-1620916566398-39f1143ab7be",
    "photo-1526045478516-99145907023c",
    "photo-1608248597279-f99d160bfcbc",
    "photo-1612817288484-6f916006741a",
    "photo-1608571423902-eed4a5ad8108",
  ],
  sports: [
    "photo-1517836357463-d25dfeac3438",
    "photo-1518611012118-696072aa579a",
    "photo-1599058917212-d750089bc07e",
    "photo-1526401485004-2aa9e7a8b042",
    "photo-1530549387789-4c1017266635",
    "photo-1542291026-7eec264c27ff",
    "photo-1500530855697-b586d89ba3ee",
    "photo-1522163182402-834f871fd851",
  ],
  fallback: [
    "photo-1441986300917-64674bd600d8",
    "photo-1472851294608-062f824d29cc",
    "photo-1481437156560-3205f6a55735",
  ],
};

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
    logo: brandLogoUrl(name, index),
    logoUrl: brandLogoUrl(name, index),
    thumbnails: imageUrl(12000 + index, `${name} brand product`, 900, 500),
    imageUrl: imageUrl(12100 + index, `${name} brand product`, 900, 500),
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
      imageUrl(16000 + leafIndex * 100 + itemIndex, `${leaf.title} product detail`, 1200, 1200),
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
