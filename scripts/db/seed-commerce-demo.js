#!/usr/bin/env node
"use strict";

const { v4: uuidv4 } = require("uuid");
const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { postgresPool } = require("../../src/infrastructure/postgres/postgres-client");
const { UserModel } = require("../../src/modules/user/models/user.model");
const { ProductModel } = require("../../src/modules/product/models/product.model");
const { CouponModel } = require("../../src/modules/pricing/models/coupon.model");
const { DynamicPricingModel } = require("../../src/modules/pricing/models/dynamic-pricing.model");
const { RecommendationModel } = require("../../src/modules/recommendation/models/recommendation.model");
const { LoyaltyModel } = require("../../src/modules/loyalty/models/loyalty.model");
const { ContentPageModel } = require("../../src/modules/platform/models/content-page.model");
const {
  ReferralModel,
  InfluencerProfileModel,
  ReferralCodeModel,
  ReferralOrderModel,
  ReferralCommissionLedgerModel,
  InfluencerWalletModel,
  ReferralCommissionRuleModel,
} = require("../../src/modules/referral/models/referral.model");
const { ROLES } = require("../../src/shared/constants/roles");
const {
  COUPON_TYPE,
  ORDER_STATUS,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
} = require("../../src/shared/domain/commerce-constants");
const { hashText } = require("../../src/shared/tools/hash");

const SEED_TAG = "commerce-demo-v1";
const RESET = process.argv.includes("--reset");
const PASSWORD = process.env.SEED_PASSWORD || "Password@123";

const demoEmails = {
  techSeller: "demo.techseller@example.com",
  styleSeller: "demo.styleseller@example.com",
  buyer: "demo.buyer@example.com",
  influencer: "demo.influencer@example.com",
};

const log = (message) => process.stdout.write(`${message}\n`);

function idOf(doc) {
  return String(doc?._id || doc?.id || "");
}

function toSlug(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

async function tableExists(tableName) {
  const { rows } = await postgresPool.query("SELECT to_regclass($1) AS table_name", [tableName]);
  return Boolean(rows[0]?.table_name);
}

async function requireTables(tableNames = []) {
  const missing = [];
  for (const tableName of tableNames) {
    if (!(await tableExists(tableName))) {
      missing.push(tableName);
    }
  }
  if (missing.length) {
    throw new Error(
      `Missing PostgreSQL tables: ${missing.join(", ")}. Run npm run db:migrate before this seed.`,
    );
  }
}

async function resetCommerceData() {
  log("Resetting product, order, and marketing data");

  await Promise.all([
    ProductModel.deleteMany({}),
    CouponModel.deleteMany({}),
    DynamicPricingModel.deleteMany({}),
    RecommendationModel.deleteMany({}),
    LoyaltyModel.deleteMany({}),
    ReferralModel.deleteMany({}),
    InfluencerProfileModel.deleteMany({}),
    ReferralCodeModel.deleteMany({}),
    ReferralOrderModel.deleteMany({}),
    ReferralCommissionLedgerModel.deleteMany({}),
    InfluencerWalletModel.deleteMany({}),
    ReferralCommissionRuleModel.deleteMany({}),
    ContentPageModel.deleteMany({ "metadata.seedTag": SEED_TAG }),
  ]);

  await postgresPool.query("DELETE FROM payments");
  await postgresPool.query("DELETE FROM order_items");
  await postgresPool.query("DELETE FROM orders");

  if (await tableExists("platform_fee_config")) {
    await postgresPool.query("DELETE FROM platform_fee_config WHERE category IN ($1, $2, $3)", [
      "default",
      "electronics",
      "apparel",
    ]);
  }
}

async function upsertUser(email, payload) {
  return UserModel.findOneAndUpdate(
    { email },
    {
      $set: payload,
      $setOnInsert: {
        refreshSessions: [],
        authProviders: [],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function seedUsers() {
  const passwordHash = await hashText(PASSWORD);

  const techSeller = await upsertUser(demoEmails.techSeller, {
    email: demoEmails.techSeller,
    phone: "9001001001",
    passwordHash,
    role: ROLES.SELLER,
    accountStatus: "active",
    emailVerified: true,
    profile: { firstName: "Aarav", lastName: "Kapoor" },
    referralCode: "TECHDEMO",
    sellerProfile: {
      displayName: "Tech Seller Demo",
      legalBusinessName: "Tech Seller Demo Pvt Ltd",
      businessName: "Tech Seller Demo",
      description: "Demo electronics seller for product and order management.",
      supportEmail: demoEmails.techSeller,
      supportPhone: "9001001001",
      businessType: "private_limited",
      gstNumber: "29ABCDE1234F1Z5",
      panNumber: "ABCDE1234F",
      profileCompleted: true,
      kycStatus: "verified",
      bankVerificationStatus: "verified",
      goLiveStatus: "live",
      onboardingStatus: "live",
      onboardingChecklist: {
        profileCompleted: true,
        kycSubmitted: true,
        gstVerified: true,
        bankLinked: true,
        firstProductPublished: true,
      },
      bankDetails: {
        accountHolderName: "Tech Seller Demo Pvt Ltd",
        accountNumber: "50100100100100",
        ifscCode: "HDFC0001001",
        bankName: "HDFC Bank",
        branchName: "Bengaluru Main",
      },
      businessAddress: {
        line1: "Tech Park, Block A",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560001",
      },
      pickupAddress: {
        line1: "Tech Park Warehouse",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560001",
      },
    },
  });

  const styleSeller = await upsertUser(demoEmails.styleSeller, {
    email: demoEmails.styleSeller,
    phone: "9001001002",
    passwordHash,
    role: ROLES.SELLER,
    accountStatus: "active",
    emailVerified: true,
    profile: { firstName: "Isha", lastName: "Mehra" },
    referralCode: "STYLEDEMO",
    sellerProfile: {
      displayName: "Style Seller Demo",
      legalBusinessName: "Style Seller Demo LLP",
      businessName: "Style Seller Demo",
      description: "Demo apparel seller for seller-linked product fixtures.",
      supportEmail: demoEmails.styleSeller,
      supportPhone: "9001001002",
      businessType: "llp",
      gstNumber: "29PQRSX5678L1Z2",
      panNumber: "PQRSX5678L",
      profileCompleted: true,
      kycStatus: "verified",
      bankVerificationStatus: "verified",
      goLiveStatus: "live",
      onboardingStatus: "live",
      onboardingChecklist: {
        profileCompleted: true,
        kycSubmitted: true,
        gstVerified: true,
        bankLinked: true,
        firstProductPublished: true,
      },
      bankDetails: {
        accountHolderName: "Style Seller Demo LLP",
        accountNumber: "50200200200200",
        ifscCode: "ICIC0002002",
        bankName: "ICICI Bank",
        branchName: "Indiranagar",
      },
      businessAddress: {
        line1: "Fashion Street Studio",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560038",
      },
      pickupAddress: {
        line1: "Fashion Street Dispatch",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560038",
      },
    },
  });

  const buyer = await upsertUser(demoEmails.buyer, {
    email: demoEmails.buyer,
    phone: "9001002001",
    passwordHash,
    role: ROLES.BUYER,
    accountStatus: "active",
    emailVerified: true,
    profile: { firstName: "Neha", lastName: "Rao" },
    referralCode: "BUYERDEMO",
    addresses: [
      {
        label: "home",
        fullName: "Neha Rao",
        phone: "9001002001",
        line1: "42 Market Road",
        line2: "Near Metro Station",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560001",
        isDefault: true,
      },
    ],
  });

  const influencer = await upsertUser(demoEmails.influencer, {
    email: demoEmails.influencer,
    phone: "9001003001",
    passwordHash,
    role: ROLES.BUYER,
    accountStatus: "active",
    emailVerified: true,
    profile: { firstName: "Rohan", lastName: "Creator" },
    referralCode: "ROHANDEMO",
  });

  log("Seeded demo users");
  return { techSeller, styleSeller, buyer, influencer };
}

function productPayload({
  seller,
  title,
  category,
  brand,
  price,
  mrp,
  stock,
  tags,
  sku,
  color,
  variants = [],
}) {
  const slug = toSlug(title);
  const now = new Date();
  return {
    sellerId: idOf(seller),
    title,
    slug,
    description: `${title} seeded for product management, seller product ownership, and order flows.`,
    shortDescription: `Demo ${category} product owned by ${seller.sellerProfile?.displayName || seller.email}.`,
    productType: variants.length ? PRODUCT_TYPE.VARIABLE : PRODUCT_TYPE.SIMPLE,
    visibility: PRODUCT_VISIBILITY.PUBLIC,
    publishedAt: now,
    category,
    categoryId: category,
    brand,
    tags,
    badges: [{ type: "featured", label: "Demo", color: "#1d4ed8", bgColor: "#dbeafe" }],
    price,
    mrp,
    salePrice: price,
    costPrice: Math.round(price * 0.72),
    gstRate: 18,
    hsnCode: "DEMO-HSN",
    sku,
    barcode: `BAR-${sku}`,
    color,
    stock,
    reservedStock: 0,
    hasVariants: variants.length > 0,
    variantAxes: variants.length ? ["size"] : [],
    variants,
    images: [
      `https://placehold.co/900x900/png?text=${encodeURIComponent(title)}`,
      `https://placehold.co/900x900/png?text=${encodeURIComponent(brand)}`,
    ],
    dimensions: { length: 20, width: 15, height: 8, unit: "cm" },
    weight: 0.8,
    weightUnit: "kg",
    origin: { country: "India", state: "Karnataka", city: "Bengaluru" },
    warranty: {
      period: 12,
      periodUnit: "months",
      type: "seller",
      provider: seller.sellerProfile?.displayName || seller.email,
      returnPolicy: { eligible: true, days: 7, type: "standard", restockingFee: 0 },
    },
    inventorySettings: {
      trackInventory: true,
      allowBackorder: false,
      lowStockThreshold: 5,
      manageVariantInventory: variants.length > 0,
    },
    shipping: { freeShipping: true, processingDays: 1, shippingClass: "standard" },
    analytics: {
      views: 120,
      impressions: 850,
      cartAdds: 26,
      purchases: 8,
      revenue: price * 8,
      conversionRate: 3.1,
      lastViewedAt: now,
    },
    rating: 4.4,
    reviewCount: 18,
    status: PRODUCT_STATUS.ACTIVE,
    moderation: {
      submittedAt: now,
      reviewedAt: now,
      reviewedBy: "seed-script",
      checklist: {
        titleVerified: true,
        categoryVerified: true,
        complianceVerified: true,
        mediaVerified: true,
        pricingVerified: true,
        inventoryVerified: true,
      },
      notes: "Approved by commerce demo seed.",
    },
    approvedBy: "seed-script",
    approvedAt: now,
    createdBy: idOf(seller),
    lastUpdatedBy: idOf(seller),
    metadata: { seedTag: SEED_TAG, sellerEmail: seller.email },
  };
}

async function upsertProduct(payload) {
  return ProductModel.findOneAndUpdate(
    { slug: payload.slug },
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function seedProducts(users) {
  const products = await Promise.all([
    upsertProduct(
      productPayload({
        seller: users.techSeller,
        title: "Demo Galaxy A55 5G",
        category: "electronics",
        brand: "Samsung",
        price: 36999,
        mrp: 42999,
        stock: 48,
        tags: ["smartphone", "5g", "electronics"],
        sku: "DEMO-GALAXY-A55",
        color: "Awesome Navy",
      }),
    ),
    upsertProduct(
      productPayload({
        seller: users.techSeller,
        title: "Demo Noise Pro Smartwatch",
        category: "electronics",
        brand: "Noise",
        price: 4999,
        mrp: 7999,
        stock: 120,
        tags: ["wearable", "watch", "fitness"],
        sku: "DEMO-NOISE-PRO",
        color: "Jet Black",
      }),
    ),
    upsertProduct(
      productPayload({
        seller: users.styleSeller,
        title: "Demo Linen Casual Shirt",
        category: "apparel",
        brand: "Urban Loom",
        price: 1499,
        mrp: 2499,
        stock: 72,
        tags: ["shirt", "linen", "men"],
        sku: "DEMO-LINEN-SHIRT",
        color: "Olive",
        variants: [
          {
            sku: "DEMO-LINEN-SHIRT-M",
            title: "Medium",
            price: 1499,
            mrp: 2499,
            salePrice: 1499,
            stock: 24,
            attributes: { size: "M" },
            status: "active",
            isDefault: true,
          },
          {
            sku: "DEMO-LINEN-SHIRT-L",
            title: "Large",
            price: 1499,
            mrp: 2499,
            salePrice: 1499,
            stock: 24,
            attributes: { size: "L" },
            status: "active",
          },
        ],
      }),
    ),
    upsertProduct(
      productPayload({
        seller: users.styleSeller,
        title: "Demo Canvas Market Tote",
        category: "apparel",
        brand: "Daily Carry",
        price: 799,
        mrp: 1299,
        stock: 150,
        tags: ["bag", "canvas", "eco"],
        sku: "DEMO-CANVAS-TOTE",
        color: "Natural",
      }),
    ),
  ]);

  const ids = products.map(idOf);
  await Promise.all(
    products.map((product, index) =>
      ProductModel.findByIdAndUpdate(product._id, {
        relatedProducts: ids.filter((id) => id !== idOf(product)).slice(0, 2),
        crossSellProducts: [ids[(index + 1) % ids.length]],
        upSellProducts: [ids[(index + 2) % ids.length]],
      }),
    ),
  );

  log("Seeded seller-linked products");
  return products;
}

async function insertOrder({ id, buyer, status, couponCode, items, shippingAddress, createdAt }) {
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const discount = couponCode ? Math.round(subtotal * 0.1) : 0;
  const tax = Math.round((subtotal - discount) * 0.18);
  const platformFee = Math.round(subtotal * 0.03);
  const total = subtotal - discount + tax + platformFee;

  await postgresPool.query(
    `INSERT INTO orders (
      id, buyer_id, status, currency, subtotal_amount, discount_amount, tax_amount,
      total_amount, shipping_address, coupon_code, wallet_discount_amount,
      payable_amount, tax_breakup, platform_fee_amount, platform_fee_breakup,
      created_at, updated_at
    )
    VALUES ($1,$2,$3,'INR',$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$14)`,
    [
      id,
      idOf(buyer),
      status,
      subtotal,
      discount,
      tax,
      total,
      JSON.stringify(shippingAddress),
      couponCode,
      total,
      JSON.stringify({ totalTaxAmount: tax, taxMode: "cgst_sgst" }),
      platformFee,
      JSON.stringify({ seedTag: SEED_TAG, totalFeeAmount: platformFee }),
      createdAt,
    ],
  );

  for (const item of items) {
    await postgresPool.query(
      `INSERT INTO order_items (
        id, order_id, product_id, variant_id, variant_sku, variant_title,
        attributes, seller_id, quantity, unit_price, line_total, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        uuidv4(),
        id,
        item.productId,
        item.variantId || null,
        item.variantSku || null,
        item.variantTitle || null,
        JSON.stringify(item.attributes || {}),
        item.sellerId,
        item.quantity,
        item.unitPrice,
        item.lineTotal,
        createdAt,
      ],
    );
  }

  await postgresPool.query(
    `INSERT INTO payments (
      id, order_id, buyer_id, provider, status, amount, currency,
      transaction_reference, provider_order_id, provider_payment_id,
      verification_method, metadata, verified_at, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,'INR',$7,$8,$9,'seed',$10,$11,$12,$12)`,
    [
      uuidv4(),
      id,
      idOf(buyer),
      PAYMENT_PROVIDER.COD,
      status === ORDER_STATUS.PENDING_PAYMENT ? PAYMENT_STATUS.INITIATED : PAYMENT_STATUS.CAPTURED,
      total,
      `SEED-${id.slice(0, 8)}`,
      `order_${id.slice(0, 12)}`,
      status === ORDER_STATUS.PENDING_PAYMENT ? null : `pay_${id.slice(0, 12)}`,
      JSON.stringify({ seedTag: SEED_TAG }),
      status === ORDER_STATUS.PENDING_PAYMENT ? null : createdAt,
      createdAt,
    ],
  );

  return { id, subtotal, discount, tax, platformFee, total };
}

async function seedOrders(users, products) {
  const [phone, watch, shirt, tote] = products;
  const shirtVariant = shirt.variants?.[0];
  const shippingAddress = users.buyer.addresses?.[0] || {
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    postalCode: "560001",
  };

  const orders = await Promise.all([
    insertOrder({
      id: uuidv4(),
      buyer: users.buyer,
      status: ORDER_STATUS.CONFIRMED,
      couponCode: "COMMERCE10",
      createdAt: daysFromNow(-4),
      shippingAddress,
      items: [
        {
          productId: idOf(phone),
          sellerId: phone.sellerId,
          quantity: 1,
          unitPrice: phone.price,
          lineTotal: phone.price,
        },
        {
          productId: idOf(shirt),
          variantId: idOf(shirtVariant),
          variantSku: shirtVariant?.sku,
          variantTitle: shirtVariant?.title,
          attributes: { size: "M" },
          sellerId: shirt.sellerId,
          quantity: 2,
          unitPrice: shirt.price,
          lineTotal: shirt.price * 2,
        },
      ],
    }),
    insertOrder({
      id: uuidv4(),
      buyer: users.buyer,
      status: ORDER_STATUS.PENDING_PAYMENT,
      couponCode: null,
      createdAt: daysFromNow(-2),
      shippingAddress,
      items: [
        {
          productId: idOf(watch),
          sellerId: watch.sellerId,
          quantity: 1,
          unitPrice: watch.price,
          lineTotal: watch.price,
        },
      ],
    }),
    insertOrder({
      id: uuidv4(),
      buyer: users.buyer,
      status: ORDER_STATUS.DELIVERED,
      couponCode: "STYLE15",
      createdAt: daysFromNow(-10),
      shippingAddress,
      items: [
        {
          productId: idOf(tote),
          sellerId: tote.sellerId,
          quantity: 3,
          unitPrice: tote.price,
          lineTotal: tote.price * 3,
        },
      ],
    }),
  ]);

  log("Seeded orders, order items, and payments");
  return orders;
}

async function seedPlatformFees() {
  if (!(await tableExists("platform_fee_config"))) {
    log("Skipped platform_fee_config seed because table is not available");
    return [];
  }

  const rows = [
    { category: "default", commission: 5, fixed: 0, closing: 15 },
    { category: "electronics", commission: 4.5, fixed: 10, closing: 20 },
    { category: "apparel", commission: 7.5, fixed: 5, closing: 12 },
  ];

  for (const row of rows) {
    await postgresPool.query(
      `INSERT INTO platform_fee_config (
        id, category, commission_percent, fixed_fee_amount, closing_fee_amount,
        active, effective_from, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,true,NOW(),NOW(),NOW())`,
      [uuidv4(), row.category, row.commission, row.fixed, row.closing],
    );
  }

  log("Seeded platform fee config");
  return rows;
}

async function seedMarketing(users, products, orders) {
  const [phone, watch, shirt, tote] = products;
  const previousInfluencer = await InfluencerProfileModel.findOne({ userId: idOf(users.influencer) });
  await Promise.all([
    CouponModel.deleteMany({ code: { $in: ["COMMERCE10", "TECH500", "STYLE15"] } }),
    DynamicPricingModel.deleteMany({ productId: { $in: products.map(idOf) } }),
    RecommendationModel.deleteMany({ userId: idOf(users.buyer) }),
    LoyaltyModel.deleteMany({ userId: idOf(users.buyer) }),
    ReferralOrderModel.deleteMany({ "metadata.seedTag": SEED_TAG }),
    ReferralCommissionLedgerModel.deleteMany({ "metadata.seedTag": SEED_TAG }),
    ReferralCodeModel.deleteMany({ code: "ROHAN10" }),
    InfluencerProfileModel.deleteMany({ userId: idOf(users.influencer) }),
    previousInfluencer
      ? InfluencerWalletModel.deleteMany({ influencerId: idOf(previousInfluencer) })
      : Promise.resolve(),
    ReferralCommissionRuleModel.deleteMany({ "metadata.seedTag": SEED_TAG }),
    ContentPageModel.deleteMany({
      slug: { $in: ["demo-commerce-home-hero", "demo-style-week"] },
    }),
  ]);

  const coupons = await CouponModel.insertMany([
    {
      code: "COMMERCE10",
      title: "Commerce Demo 10%",
      description: "Platform-wide demo coupon.",
      type: COUPON_TYPE.PERCENTAGE,
      value: 10,
      minOrderAmount: 999,
      maxDiscountAmount: 5000,
      active: true,
      usageLimit: 1000,
      usesPerCustomer: 5,
      usedCount: 1,
      startsAt: daysFromNow(-30),
      expiresAt: daysFromNow(60),
    },
    {
      code: "TECH500",
      sellerId: idOf(users.techSeller),
      createdBy: idOf(users.techSeller),
      title: "Tech Seller 500 Off",
      description: "Seller-specific electronics coupon.",
      type: COUPON_TYPE.FIXED,
      value: 500,
      minOrderAmount: 5000,
      active: true,
      usageLimit: 250,
      usesPerCustomer: 2,
      startsAt: daysFromNow(-7),
      expiresAt: daysFromNow(45),
    },
    {
      code: "STYLE15",
      sellerId: idOf(users.styleSeller),
      createdBy: idOf(users.styleSeller),
      title: "Style Seller 15%",
      description: "Seller-specific apparel coupon.",
      type: COUPON_TYPE.PERCENTAGE,
      value: 15,
      minOrderAmount: 799,
      maxDiscountAmount: 1500,
      active: true,
      usageLimit: 250,
      usedCount: 1,
      startsAt: daysFromNow(-7),
      expiresAt: daysFromNow(45),
    },
  ]);

  await DynamicPricingModel.insertMany([
    {
      productId: idOf(phone),
      basePriceUSD: 445,
      currentPrice: phone.price,
      demandScore: 0.82,
      lastAdjustedAt: new Date(),
      rules: [
        {
          type: "demand_based",
          condition: { minDemandScore: 0.75 },
          priceModifier: 1.02,
          priority: 1,
          active: true,
        },
      ],
      priceHistory: [{ price: phone.price, reason: "seed_initial_price" }],
    },
    {
      productId: idOf(shirt),
      basePriceUSD: 18,
      currentPrice: shirt.price,
      demandScore: 0.64,
      lastAdjustedAt: new Date(),
      rules: [
        {
          type: "seasonal",
          condition: { season: "summer" },
          priceModifier: 0.9,
          priority: 1,
          active: true,
        },
      ],
      priceHistory: [{ price: shirt.price, reason: "seed_initial_price" }],
    },
  ]);

  await RecommendationModel.create({
    userId: idOf(users.buyer),
    recommendedProducts: [
      { productId: idOf(phone), score: 94, reason: "popular_with_your_cohort" },
      { productId: idOf(watch), score: 88, reason: "frequently_bought_together" },
      { productId: idOf(tote), score: 72, reason: "trending" },
    ],
    trending: [
      { productId: idOf(phone), category: phone.category, trendScore: 97, period: "week" },
      { productId: idOf(shirt), category: shirt.category, trendScore: 81, period: "week" },
    ],
  });

  await LoyaltyModel.create({
    userId: idOf(users.buyer),
    totalPoints: 620,
    tier: "silver",
    totalSpent: orders.reduce((sum, order) => sum + order.total, 0),
    pointsHistory: [
      {
        transactionId: orders[0].id,
        points: 420,
        reason: "purchase",
        expiresAt: daysFromNow(365),
      },
      {
        transactionId: orders[2].id,
        points: 200,
        reason: "purchase",
        expiresAt: daysFromNow(365),
      },
    ],
    tierHistory: [{ tier: "silver", pointsRequired: 500 }],
  });

  const influencer = await InfluencerProfileModel.create({
    userId: idOf(users.influencer),
    influencerType: "parent",
    parentInfluencerId: null,
    rootInfluencerId: null,
    level: 1,
    path: [],
    status: "active",
    canCreateChildren: true,
    promotedAt: daysFromNow(-20),
    onboardingStatus: "approved",
    kycStatus: "verified",
    payoutProfileStatus: "verified",
    yearlySalesAmount: orders[0].total,
    metadata: { seedTag: SEED_TAG },
  });
  await InfluencerProfileModel.findByIdAndUpdate(influencer._id, {
    rootInfluencerId: idOf(influencer),
    path: [idOf(influencer)],
  });

  const referralCode = await ReferralCodeModel.create({
    influencerId: idOf(influencer),
    userId: idOf(users.influencer),
    code: "ROHAN10",
    discountPercent: 10,
    maxDiscountAmount: 1000,
    status: "active",
    startsAt: daysFromNow(-10),
    expiresAt: daysFromNow(90),
    usageLimit: 500,
    usageCount: 1,
    metadata: { seedTag: SEED_TAG },
  });

  const referralOrder = await ReferralOrderModel.create({
    orderId: orders[0].id,
    customerId: idOf(users.buyer),
    referralCodeId: idOf(referralCode),
    code: referralCode.code,
    codeOwnerInfluencerId: idOf(influencer),
    eligibleAmount: orders[0].subtotal,
    discountAmount: orders[0].discount,
    status: "completed",
    orderStatus: ORDER_STATUS.CONFIRMED,
    paymentStatus: PAYMENT_STATUS.CAPTURED,
    completedAt: daysFromNow(-4),
    metadata: { seedTag: SEED_TAG },
  });

  await ReferralCommissionLedgerModel.create({
    referralOrderId: idOf(referralOrder),
    orderId: orders[0].id,
    influencerId: idOf(influencer),
    commissionType: "code_owner_base",
    basisAmount: orders[0].subtotal,
    percent: 3,
    amount: Number((orders[0].subtotal * 0.03).toFixed(2)),
    status: "available",
    releaseAt: daysFromNow(-1),
    metadata: { seedTag: SEED_TAG },
  });

  await InfluencerWalletModel.create({
    influencerId: idOf(influencer),
    pendingBalance: 0,
    availableBalance: Number((orders[0].subtotal * 0.03).toFixed(2)),
    paidBalance: 0,
    reversedBalance: 0,
  });

  await ReferralCommissionRuleModel.create({
    customerDiscountPercent: 10,
    codeOwnerBasePercent: 3,
    directParentPercent: 1,
    lifetimeOverridePercent: 0.5,
    releaseDelayDays: 7,
    yearlyPromotionThreshold: 1000000,
    active: true,
    effectiveFrom: daysFromNow(-30),
    metadata: { seedTag: SEED_TAG },
  });

  await ContentPageModel.insertMany([
    {
      slug: "demo-commerce-home-hero",
      title: "Demo Commerce Hero Banner",
      pageType: "promotion_banner",
      status: "published",
      published: true,
      publishedAt: new Date(),
      description: "Seeded marketing hero banner for commerce demo.",
      category: "marketing",
      image: {
        url: "https://placehold.co/1600x640/png?text=Commerce+Demo+Sale",
        alt: "Commerce demo sale",
      },
      cta: { label: "Shop Demo Products", url: "/products", target: "_self" },
      sortOrder: 1,
      metadata: { seedTag: SEED_TAG },
    },
    {
      slug: "demo-style-week",
      title: "Demo Style Week Banner",
      pageType: "promotion_banner",
      status: "published",
      published: true,
      publishedAt: new Date(),
      description: "Seeded marketing banner for style products.",
      category: "marketing",
      image: {
        url: "https://placehold.co/1600x640/png?text=Style+Week",
        alt: "Style week promotion",
      },
      cta: { label: "Explore Apparel", url: "/products?category=apparel", target: "_self" },
      sortOrder: 2,
      metadata: { seedTag: SEED_TAG },
    },
  ]);

  log(`Seeded marketing data (${coupons.length} coupons plus pricing, recommendation, loyalty, referral, banners)`);
}

async function main() {
  await connectMongo();
  await requireTables(["orders", "order_items", "payments"]);

  if (RESET) {
    await resetCommerceData();
  }

  const users = await seedUsers();
  const products = await seedProducts(users);
  await seedPlatformFees();
  const orders = await seedOrders(users, products);
  await seedMarketing(users, products, orders);

  log("");
  log("Commerce demo seed complete");
  log(`Password for demo users: ${PASSWORD}`);
  log(`Seller product relation: product.sellerId = ${idOf(users.techSeller)} or ${idOf(users.styleSeller)}`);
  log("Seeded areas: product management, order management, marketing");
  log("Excluded areas: RBAC, tax management, location management");
}

main()
  .catch((error) => {
    process.stderr.write(`Commerce seed failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    await postgresPool.end().catch(() => {});
  });
