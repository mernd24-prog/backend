#!/usr/bin/env node
"use strict";

const { randomUUID } = require("crypto");
const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { postgresPool } = require("../../src/infrastructure/postgres/postgres-client");
const { UserModel } = require("../../src/modules/user/models/user.model");
const { ProductModel } = require("../../src/modules/product/models/product.model");
const { PlatformBrandModel } = require("../../src/modules/platform/models/platform-brand.model");
const { CategoryTreeModel } = require("../../src/modules/platform/models/category-tree.model");
const { ProductFamilyModel } = require("../../src/modules/platform/models/product-family.model");
const { ROLES } = require("../../src/shared/constants/roles");
const {
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
} = require("../../src/shared/domain/commerce-constants");
const { hashText } = require("../../src/shared/tools/hash");

const SEED_TAG = "order-management-test-product-v1";
const PASSWORD = process.env.SEED_PASSWORD || "Password@123";

const ids = {
  wallet: "90000000-0000-4000-8000-000000000001",
  platformFee: "90000000-0000-4000-8000-000000000002",
};

const fixtures = {
  adminEmail: "order.admin@example.com",
  buyerEmail: "order.buyer@example.com",
  sellerEmail: "order.seller@example.com",
  categoryKey: "order-test-electronics",
  categoryTitle: "Order Test Electronics",
  brandName: "Order Test Brand",
  brandSlug: "order-test-brand",
  familyCode: "ORDER_TEST_PHONE",
  productSlug: "order-management-test-phone",
  productSku: "OMT-PHONE-001",
};

const log = (message) => process.stdout.write(`${message}\n`);
const oid = (doc) => String(doc?._id || doc?.id || "");

async function tableExists(tableName) {
  const { rows } = await postgresPool.query("SELECT to_regclass($1) AS table_name", [tableName]);
  return Boolean(rows[0]?.table_name);
}

async function upsertUser(email, payload) {
  const passwordHash = await hashText(PASSWORD);
  return UserModel.findOneAndUpdate(
    { email },
    {
      $set: {
        ...payload,
        email,
        passwordHash,
        emailVerified: true,
        accountStatus: "active",
      },
      $setOnInsert: { refreshSessions: [], authProviders: [] },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function seedUsers() {
  const admin = await upsertUser(fixtures.adminEmail, {
    phone: "9200000001",
    role: ROLES.ADMIN,
    profile: { firstName: "Order", lastName: "Admin" },
  });

  const buyer = await upsertUser(fixtures.buyerEmail, {
    phone: "9200000002",
    role: ROLES.BUYER,
    profile: { firstName: "Order", lastName: "Buyer" },
    addresses: [
      {
        label: "home",
        fullName: "Order Buyer",
        phone: "9200000002",
        line1: "101 Test Checkout Road",
        line2: "Order Management Block",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560001",
        isDefault: true,
      },
    ],
  });

  const seller = await upsertUser(fixtures.sellerEmail, {
    phone: "9200000003",
    role: ROLES.SELLER,
    profile: { firstName: "Order", lastName: "Seller" },
    sellerProfile: {
      displayName: "Order Test Seller",
      legalBusinessName: "Order Test Seller Pvt Ltd",
      businessName: "Order Test Seller",
      description: "Seller fixture for order management checkout tests.",
      supportEmail: fixtures.sellerEmail,
      supportPhone: "9200000003",
      businessType: "private_limited",
      gstNumber: "29OMTST1234A1Z5",
      panNumber: "OMTST1234A",
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
        accountHolderName: "Order Test Seller Pvt Ltd",
        accountNumber: "50100999900001",
        ifscCode: "HDFC0009999",
        bankName: "HDFC Bank",
        branchName: "Bengaluru Test",
      },
      businessAddress: {
        line1: "Order Test Warehouse",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560001",
      },
      pickupAddress: {
        line1: "Order Test Warehouse",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560001",
      },
    },
    sellerSettings: {
      autoAcceptOrders: true,
      handlingTimeHours: 24,
      returnWindowDays: 10,
      shippingModes: ["standard"],
    },
  });

  return { admin, buyer, seller };
}

async function seedCatalog(seller) {
  const category = await CategoryTreeModel.findOneAndUpdate(
    { categoryKey: fixtures.categoryKey },
    {
      $set: {
        title: fixtures.categoryTitle,
        level: 0,
        parentKey: null,
        active: true,
        sortOrder: 1,
        isDashboardVisible: true,
        imageUrl: "/image/png/Electronics.png",
        attributeSchema: [
          {
            key: "storage",
            label: "Storage",
            type: "select",
            required: false,
            options: ["128 GB", "256 GB"],
            isVariantAttribute: false,
            isFilterable: true,
            isSearchable: true,
          },
          {
            key: "color",
            label: "Color",
            type: "select",
            required: false,
            options: ["Graphite"],
            isVariantAttribute: false,
            isFilterable: true,
            isSearchable: true,
          },
        ],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const brand = await PlatformBrandModel.findOneAndUpdate(
    { name: fixtures.brandName },
    {
      $set: {
        slug: fixtures.brandSlug,
        description: "Brand fixture for order management checkout tests.",
        logoUrl: "/image/png/logo.png",
        imageUrl: "/image/png/Electronics.png",
        thumbnails: "/image/png/Electronics.png",
        active: true,
        sortOrder: 1,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const family = await ProductFamilyModel.findOneAndUpdate(
    { familyCode: fixtures.familyCode },
    {
      $set: {
        sellerId: oid(seller),
        title: "Order Test Phone Family",
        category: fixtures.categoryKey,
        baseAttributes: { category: fixtures.categoryKey, brand: fixtures.brandName },
        variantAxes: [],
        status: "active",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return { category, brand, family };
}

async function seedProduct({ admin, seller, category, family }) {
  const product = await ProductModel.findOneAndUpdate(
    { slug: fixtures.productSlug },
    {
      $set: {
        sellerId: oid(seller),
        title: "Order Management Test Phone",
        slug: fixtures.productSlug,
        description:
          "Stable checkout fixture with matching seller, category, brand, stock, tax, warranty, and shipping data for order management testing.",
        shortDescription: "Checkout-ready test product for order management.",
        productType: PRODUCT_TYPE.SIMPLE,
        visibility: PRODUCT_VISIBILITY.PUBLIC,
        categoryId: oid(category),
        category: fixtures.categoryKey,
        brand: fixtures.brandName,
        productFamilyCode: oid(family) ? fixtures.familyCode : undefined,
        tags: ["order-test", "checkout-test", "electronics"],
        badges: [{ type: "qa", label: "Order Test", color: "#2E2E2E", bgColor: "#FAF6EE" }],
        price: 999,
        mrp: 1299,
        salePrice: 999,
        costPrice: 700,
        currency: "INR",
        gstRate: 18,
        gstInclusive: false,
        hsnCode: "85171300",
        sku: fixtures.productSku,
        barcode: "8900000009991",
        color: "Graphite",
        attributes: {
          color: "Graphite",
          storage: "128 GB",
          model: "OMT-001",
        },
        hasVariants: false,
        variants: [],
        options: [],
        specifications: {
          General: {
            Brand: fixtures.brandName,
            Model: "OMT-001",
            Color: "Graphite",
          },
          Warranty: {
            Coverage: "Manufacturer warranty",
            Period: "12 months",
          },
        },
        images: [
          "/image/jpg/mainProduct.jpg",
          "/image/jpg/productImg1.jpg",
          "/image/jpg/productImg2.jpg",
        ],
        dimensions: { length: 16, width: 8, height: 4, unit: "cm" },
        weight: 0.45,
        weightUnit: "kg",
        origin: { country: "India", state: "Karnataka", city: "Bengaluru" },
        warranty: {
          period: 12,
          periodUnit: "months",
          type: "manufacturer",
          provider: fixtures.brandName,
          terms: "Standard test product warranty.",
          returnPolicy: { eligible: true, days: 10, type: "standard", restockingFee: 0 },
          serviceableCountries: ["India"],
        },
        stock: 100,
        reservedStock: 0,
        inventorySettings: {
          trackInventory: true,
          allowBackorder: false,
          lowStockThreshold: 5,
          manageVariantInventory: false,
        },
        shipping: {
          freeShipping: true,
          freeShippingMinOrder: 0,
          shippingClass: "standard",
          additionalCost: 0,
          processingDays: 1,
          dangerousGoods: false,
          requiresColdChain: false,
        },
        seo: {
          metaTitle: "Order Management Test Phone",
          metaDescription: "Checkout-ready test product for order management QA.",
          keywords: ["order management", "checkout", "test product"],
        },
        analytics: { views: 0, cartAdds: 0, purchases: 0, revenue: 0 },
        rating: 4.8,
        reviewCount: 12,
        metadata: { seedTag: SEED_TAG, purpose: "order-management-checkout-test" },
        status: PRODUCT_STATUS.ACTIVE,
        moderation: {
          submittedAt: new Date(),
          reviewedAt: new Date(),
          reviewedBy: oid(admin),
          checklist: {
            titleVerified: true,
            categoryVerified: true,
            complianceVerified: true,
            mediaVerified: true,
            pricingVerified: true,
            inventoryVerified: true,
          },
          notes: "Seeded and approved for order management testing.",
        },
        approvedBy: oid(admin),
        approvedAt: new Date(),
        publishedAt: new Date(),
        createdBy: oid(seller),
        lastUpdatedBy: oid(admin),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return product;
}

async function seedPostgres(buyer) {
  if (await tableExists("platform_fee_config")) {
    await postgresPool.query(
      `
      INSERT INTO platform_fee_config (
        id, category, commission_percent, fixed_fee_amount, closing_fee_amount,
        active, effective_from, created_at, updated_at
      )
      SELECT $1::uuid, $2::varchar, 0, 0, 0, true, NOW(), NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM platform_fee_config WHERE LOWER(category) = LOWER($2::varchar) AND active = true
      )
      `,
      [ids.platformFee, fixtures.categoryKey],
    );
  }

  if (await tableExists("payment_method_configs")) {
    await postgresPool.query(
      `
      INSERT INTO payment_method_configs (
        method, enabled, charge_amount, min_order_amount, max_order_amount,
        currency, metadata, created_at, updated_at
      )
      VALUES ('cod', true, 0, 0, 50000, 'INR', $1, NOW(), NOW())
      ON CONFLICT (method) DO UPDATE SET
        enabled = true,
        charge_amount = 0,
        min_order_amount = 0,
        max_order_amount = 50000,
        currency = 'INR',
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      `,
      [{ seedTag: SEED_TAG }],
    );
  }

  if (await tableExists("wallets")) {
    await postgresPool.query(
      `
      INSERT INTO wallets (id, user_id, available_balance, locked_balance, created_at, updated_at)
      VALUES ($1, $2, 0, 0, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
      `,
      [ids.wallet, oid(buyer)],
    );
  }

  if (await tableExists("wallet_transactions")) {
    await postgresPool.query(
      `
      INSERT INTO wallet_transactions (
        id, user_id, type, status, amount, reference_type, reference_id, metadata, created_at
      )
      VALUES ($1, $2, 'credit', 'completed', 0, 'seed', $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata
      `,
      [randomUUID(), oid(buyer), SEED_TAG, { seedTag: SEED_TAG, note: "Wallet initialized for order test buyer" }],
    ).catch(() => {});
  }
}

async function main() {
  await connectMongo();

  const users = await seedUsers();
  const catalog = await seedCatalog(users.seller);
  const product = await seedProduct({ ...users, ...catalog });
  await seedPostgres(users.buyer);

  log("Order management test product is ready.");
  log(`Product: ${product.title}`);
  log(`Product ID: ${oid(product)}`);
  log(`Product slug: ${product.slug}`);
  log(`Buyer login: ${fixtures.buyerEmail} / ${PASSWORD}`);
  log(`Seller login: ${fixtures.sellerEmail} / ${PASSWORD}`);
  log(`Admin login: ${fixtures.adminEmail} / ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await postgresPool.end().catch(() => {});
    await mongoose.connection.close().catch(() => {});
  });
