#!/usr/bin/env node

/**
 * Creates or refreshes one complete variable product for the complete seller.
 * Run `npm run db:create-complete-seller` first.
 *
 * Usage: npm run db:create-complete-test-product
 * Development/test only; blocked in production.
 */

const { v4: uuidv4 } = require("uuid");
const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { sequelize } = require("../../src/infrastructure/sequelize/sequelize-client");
const { UserModel } = require("../../src/modules/user/models/user.model");
const { ProductModel } = require("../../src/modules/product/models/product.model");
const { ProductVariantModel } = require("../../src/modules/platform/models/product-variant.model");
const { CategoryTreeModel } = require("../../src/modules/platform/models/category-tree.model");
const { PlatformBrandModel } = require("../../src/modules/platform/models/platform-brand.model");
const { WarehouseModel } = require("../../src/modules/inventory/models/warehouse.model");
const {
  AdminCountryModel,
  AdminStateModel,
  AdminCityModel,
  AdminZipCodeModel,
} = require("../../src/modules/admin/models/common-management.model");

const SELLER_EMAIL = "rahul@gmail.com";
const PRODUCT_SLUG = "urbantrail-atlas-multipurpose-backpack";
const PRODUCT_FAMILY_CODE = "BACKPACK-URBANTRAIL-ATLAS";
const SHIPPING_PROFILE_NAME = "Standard Backpack Delivery";

const COMMON_IMAGES = [
  "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1581605405669-fcdf81165afa?auto=format&fit=crop&w=1200&q=85",
];

const VARIANTS = [
  { capacity: "20 L", use: "Compact Daypack", sku: "UTA-BP-20L-BLK", barcode: "8906123400011", price: 1299, mrp: 1799, costPrice: 780, stock: 35, weight: 0.48, dimensions: [42, 29, 14], color: "Midnight Black" },
  { capacity: "25 L", use: "Everyday Commuter", sku: "UTA-BP-25L-NVY", barcode: "8906123400028", price: 1499, mrp: 2099, costPrice: 890, stock: 28, weight: 0.58, dimensions: [45, 31, 16], color: "Navy Blue" },
  { capacity: "30 L", use: "Laptop Backpack", sku: "UTA-BP-30L-GRY", barcode: "8906123400035", price: 1799, mrp: 2499, costPrice: 1050, stock: 42, weight: 0.72, dimensions: [48, 33, 18], color: "Charcoal Grey" },
  { capacity: "35 L", use: "Cabin Travel", sku: "UTA-BP-35L-OLV", barcode: "8906123400042", price: 2099, mrp: 2899, costPrice: 1240, stock: 20, weight: 0.86, dimensions: [51, 35, 20], color: "Olive Green" },
  { capacity: "40 L", use: "Adventure Travel", sku: "UTA-BP-40L-BLU", barcode: "8906123400059", price: 2399, mrp: 3299, costPrice: 1420, stock: 16, weight: 1.02, dimensions: [55, 37, 22], color: "Alpine Blue" },
];

function assertDevelopment() {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error("This test-product script cannot run in production");
  }
}

async function loadSellerContext() {
  const seller = await UserModel.findOne({ email: SELLER_EMAIL, role: "seller" });
  if (!seller) {
    throw new Error(`Seller ${SELLER_EMAIL} was not found. Run npm run db:create-complete-seller first.`);
  }
  const sellerId = String(seller._id);
  const [organizations] = await sequelize.query(
    `SELECT * FROM seller_organizations
     WHERE seller_id = :sellerId AND is_default = TRUE
     LIMIT 1`,
    { replacements: { sellerId } },
  );
  if (!organizations[0]) throw new Error("The complete seller has no default organization");
  return { seller, sellerId, organization: organizations[0] };
}

async function ensureCatalogReferences(sellerId) {
  const category = await CategoryTreeModel.findOneAndUpdate(
    { categoryKey: "backpacks" },
    {
      $setOnInsert: {
        title: "Backpacks",
        parentKey: "bags-luggage",
        level: 1,
        sortOrder: 10,
        bannerUrl: "",
        iconUrl: "",
        isDashboardVisible: true,
        attributeSchema: [
          { key: "capacity", label: "Capacity", type: "select", required: true, options: VARIANTS.map((item) => item.capacity), unit: "L", isVariantAttribute: true, isFilterable: true, isSearchable: true },
          { key: "color", label: "Color", type: "select", required: true, options: VARIANTS.map((item) => item.color), isVariantAttribute: true, isFilterable: true, isSearchable: true },
          { key: "material", label: "Material", type: "text", required: true, isVariantAttribute: false, isFilterable: true, isSearchable: true },
        ],
      },
      $set: { active: true },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  const brand = await PlatformBrandModel.findOneAndUpdate(
    { nameKey: "urbantrail" },
    {
      $set: {
        name: "UrbanTrail",
        nameKey: "urbantrail",
        slug: "urbantrail",
        description: "Travel and commuter bags designed for practical everyday use.",
        active: true,
        approvalStatus: "approved",
        reviewedAt: new Date(),
      },
      $setOnInsert: {
        logoUrl: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=300&q=80",
        sortOrder: 100,
        submittedBySellerId: sellerId,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  return { category, brand };
}

async function ensureGeographyAndWarehouse(sellerId) {
  const country = await AdminCountryModel.findOneAndUpdate(
    { code: "IN" },
    { $set: { name: "India", dialCode: "+91", active: true } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  const state = await AdminStateModel.findOneAndUpdate(
    { countryId: country._id, name: "Maharashtra" },
    { $set: { active: true } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  const city = await AdminCityModel.findOneAndUpdate(
    { stateId: state._id, name: "Mumbai" },
    { $set: { active: true } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  const zip = await AdminZipCodeModel.findOneAndUpdate(
    { cityId: city._id, zipCode: "400093" },
    {
      $set: {
        areaName: "MIDC Andheri East",
        countryId: country._id,
        stateId: state._id,
        serviceable: true,
        codAvailable: true,
        expressDelivery: true,
        deliveryCharge: 79,
        minOrderAmount: 0,
        estimatedDeliveryDays: 3,
        active: true,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return WarehouseModel.findOneAndUpdate(
    { code: "RIYA-MUM-01" },
    {
      $set: {
        name: "Riya Retail Mumbai Fulfilment Centre",
        managerName: "Warehouse Manager",
        managerPhone: "9876501234",
        managerEmail: "warehouse.complete.seller@example.com",
        addressLine1: "Warehouse 7, MIDC Industrial Area",
        addressLine2: "Gate 2, Andheri East",
        countryId: country._id,
        stateId: state._id,
        cityId: city._id,
        zipCodeId: zip._id,
        pincode: "400093",
        capacity: 5000,
        skuCount: VARIANTS.length,
        active: true,
        metadata: { sellerId, organizationSource: "complete-seller", fixture: true },
        createdBy: sellerId,
        updatedBy: sellerId,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

async function ensureShippingProfile(sellerId, organizationId) {
  return sequelize.transaction(async (transaction) => {
    const queryInterface = sequelize.getQueryInterface();
    const tableDefinition = await queryInterface.describeTable("shipping_profiles", { transaction });
    const availableColumns = new Set(Object.keys(tableDefinition));
    const onlyAvailableColumns = (record) => Object.fromEntries(
      Object.entries(record)
        .filter(([column]) => availableColumns.has(column))
        .map(([column, value]) => {
          const columnType = String(tableDefinition[column]?.type || "").toUpperCase();
          const isJsonColumn = columnType.includes("JSON");
          return [column, isJsonColumn && value !== null ? JSON.stringify(value) : value];
        }),
    );
    const archivedFilter = availableColumns.has("archived_at") ? " AND archived_at IS NULL" : "";
    const [existing] = await sequelize.query(
      `SELECT id FROM shipping_profiles
       WHERE seller_id = :sellerId AND organization_id = :organizationId
         AND name = :name${archivedFilter}
       LIMIT 1`,
      { replacements: { sellerId, organizationId, name: SHIPPING_PROFILE_NAME }, transaction },
    );
    const id = existing[0]?.id || uuidv4();
    if (availableColumns.has("is_default")) {
      const clearDefaultWhere = { seller_id: sellerId };
      if (availableColumns.has("organization_id")) clearDefaultWhere.organization_id = organizationId;
      await queryInterface.bulkUpdate(
        "shipping_profiles",
        onlyAvailableColumns({ is_default: false, updated_at: new Date() }),
        clearDefaultWhere,
        { transaction },
      );
    }

    const now = new Date();
    const profileRecord = onlyAvailableColumns({
      id,
      seller_id: sellerId,
      organization_id: organizationId,
      name: SHIPPING_PROFILE_NAME,
      description: "Standard all-India delivery for backpacks, with COD and free delivery from INR 1,499.",
      shipping_method: "standard",
      serviceability_mode: "all_india",
      allowed_states: [],
      allowed_cities: [],
      allowed_pincodes: [],
      blocked_pincodes: ["744301", "744302"],
      cod_available: true,
      shipping_charge: 79,
      free_shipping_threshold: 1499,
      eta_min: 3,
      eta_max: 6,
      is_default: true,
      active: true,
      source_template_id: null,
      source_template_version: null,
      template_snapshot: {},
      editable_fields: ["name", "description", "shippingMethod", "serviceabilityMode", "allowedPincodes", "codAvailable", "shippingCharge", "freeShippingThreshold", "etaMin", "etaMax", "isDefault", "active"],
      copied_from_template_at: null,
      archived_at: null,
      metadata: { fixture: true, packageType: "soft_bag", volumetricWeightApplied: true },
      created_by: sellerId,
      updated_by: sellerId,
      created_at: now,
      updated_at: now,
    });

    if (existing[0]) {
      const { id: ignoredId, created_at: ignoredCreatedAt, ...updateRecord } = profileRecord;
      void ignoredId;
      void ignoredCreatedAt;
      await queryInterface.bulkUpdate(
        "shipping_profiles",
        updateRecord,
        { id },
        { transaction },
      );
    } else {
      await queryInterface.bulkInsert("shipping_profiles", [profileRecord], { transaction });
    }
    return id;
  });
}

function buildVariant(item, index) {
  return {
    sku: item.sku,
    title: `UrbanTrail Atlas ${item.capacity} ${item.use} - ${item.color}`,
    description: `The ${item.capacity} ${item.use.toLowerCase()} version of the UrbanTrail Atlas in ${item.color}. It includes padded shoulder straps, a breathable back panel, reinforced zippers and a water-resistant polyester shell.`,
    shortDescription: `${item.capacity} ${item.use} in ${item.color}.`,
    price: item.price,
    mrp: item.mrp,
    salePrice: item.price,
    gstRate: 18,
    stock: item.stock,
    reservedStock: 0,
    barcode: item.barcode,
    weight: item.weight,
    weightUnit: "kg",
    dimensions: { length: item.dimensions[0], width: item.dimensions[1], height: item.dimensions[2], unit: "cm" },
    attributes: { capacity: item.capacity, color: item.color },
    specifications: {
      "Recommended Use": item.use,
      Capacity: item.capacity,
      Color: item.color,
      "Product Weight": `${item.weight} kg`,
      "External Dimensions": `${item.dimensions[0]} × ${item.dimensions[1]} × ${item.dimensions[2]} cm`,
    },
    images: [COMMON_IMAGES[index % COMMON_IMAGES.length]],
    status: "active",
    isDefault: index === 2,
    sortOrder: index,
  };
}

async function ensureProduct(context) {
  const { sellerId, organization, category, brand, warehouse, shippingProfileId } = context;
  const totalStock = VARIANTS.reduce((sum, item) => sum + item.stock, 0);
  const now = new Date();
  const payload = {
    sellerId,
    organizationId: String(organization.id),
    storeId: String(organization.id),
    warehouseId: String(warehouse._id),
    organizationSnapshot: {
      organizationId: organization.id,
      sellerId,
      legalBusinessName: organization.legal_business_name,
      storeDisplayName: organization.store_display_name,
      gstin: organization.gstin,
      pan: organization.pan,
      billingAddress: organization.billing_address,
      pickupAddress: organization.pickup_address,
    },
    title: "UrbanTrail Atlas Multipurpose Backpack",
    slug: PRODUCT_SLUG,
    description: "A durable water-resistant backpack family designed for daily commuting, laptop carry, cabin travel and weekend adventures. Each capacity has padded shoulder straps, breathable back support, reinforced zippers, organized compartments and a rain-resistant polyester shell.",
    shortDescription: "Water-resistant multipurpose backpack available in five practical capacities from 20 L to 40 L.",
    productType: "variable",
    visibility: "public",
    publishedAt: now,
    categoryId: String(category._id),
    category: category.categoryKey,
    brand: brand.name,
    productFamilyCode: PRODUCT_FAMILY_CODE,
    tags: ["backpack", "laptop bag", "travel backpack", "water resistant", "cabin luggage"],
    badges: [
      { type: "new", label: "New Arrival", color: "#166534", bgColor: "#DCFCE7", validFrom: now },
      { type: "featured", label: "Tested for Travel", color: "#1E3A8A", bgColor: "#DBEAFE", validFrom: now },
    ],
    price: 1299,
    mrp: 1799,
    salePrice: 1299,
    costPrice: 780,
    currency: "INR",
    gstRate: 18,
    gstInclusive: true,
    hsnCode: "42029200",
    complianceSnapshot: { hsnCode: "42029200", gstRate: 18, cessRate: 0, taxType: "GST", exempt: false, source: "test-fixture", validatedAt: now, validatedBy: sellerId },
    barcode: "8906123400004",
    attributes: { material: "Water-resistant polyester", closure: "Zipper", laptopCompatible: true, unisex: true, countryOfOrigin: "India" },
    variantAxes: ["capacity", "color"],
    hasVariants: true,
    variants: VARIANTS.map(buildVariant),
    options: [
      { name: "Capacity", slug: "capacity", values: VARIANTS.map((item) => item.capacity), required: true, displayType: "button", sortOrder: 0 },
      { name: "Color", slug: "color", values: VARIANTS.map((item) => item.color), required: true, displayType: "color_swatch", sortOrder: 1 },
    ],
    specifications: {
      General: { Brand: brand.name, Model: "Atlas", Material: "Water-resistant polyester", Gender: "Unisex", "Country of Origin": "India" },
      Features: { "Laptop Sleeve": "Up to 15.6 inch", "Bottle Pockets": 2, "Padded Straps": "Yes", "Rain Resistant": "Yes", "Number of Compartments": 3 },
      Care: { Instructions: "Wipe with a damp cloth. Do not machine wash or bleach." },
    },
    commonImages: COMMON_IMAGES,
    videos: [],
    dimensions: { length: 48, width: 33, height: 18, unit: "cm" },
    weight: 0.72,
    weightUnit: "kg",
    origin: { country: "India", state: "Maharashtra", city: "Mumbai" },
    warranty: {
      period: 12,
      periodUnit: "months",
      type: "manufacturer",
      provider: "UrbanTrail",
      terms: "Covers manufacturing defects in stitching, zippers and buckles. Physical misuse and normal wear are excluded.",
      returnPolicy: { eligible: true, returnable: true, days: 7, returnWindowDays: 7, type: "standard", resolution: "refund_or_replacement", requiresImages: true, inspectionRequired: true, shippingPaidBy: "seller", restockingFee: 0 },
      serviceableCountries: ["India"],
    },
    stock: totalStock,
    reservedStock: 0,
    inventorySettings: { trackInventory: true, allowBackorder: false, backorderLimit: 0, lowStockThreshold: 5, outOfStockMessage: "This capacity is temporarily unavailable", manageVariantInventory: true },
    shipping: {
      freeShipping: false,
      freeShippingMinOrder: 1499,
      shippingClass: "standard-parcel",
      additionalCost: 0,
      shippingCharge: 79,
      handlingCharge: 0,
      processingDays: 1,
      serviceabilityMode: "inherit",
      codAvailable: true,
      estimatedDaysMin: 3,
      estimatedDaysMax: 6,
      shippingPartner: "Platform Shipping",
      shippingMethod: "standard",
      dangerousGoods: false,
      requiresColdChain: false,
      shippingProfileId,
    },
    seo: {
      metaTitle: "UrbanTrail Atlas Backpack - 20 L to 40 L",
      metaDescription: "Shop the UrbanTrail Atlas water-resistant backpack in five sizes for commuting, laptops, cabin travel and weekend adventures.",
      keywords: ["backpack", "laptop backpack", "travel bag", "cabin backpack", "water resistant backpack"],
      canonicalUrl: `https://example.com/products/${PRODUCT_SLUG}`,
      ogTitle: "UrbanTrail Atlas Multipurpose Backpack",
      ogDescription: "Five practical capacities with laptop protection and travel-ready organization.",
      ogImage: COMMON_IMAGES[0],
      structuredData: { "@context": "https://schema.org", "@type": "Product", name: "UrbanTrail Atlas Multipurpose Backpack", brand: { "@type": "Brand", name: brand.name }, sku: VARIANTS[2].sku },
    },
    analytics: { views: 0, uniqueViews: 0, impressions: 0, cartAdds: 0, wishlistAdds: 0, purchases: 0, revenue: 0, conversionRate: 0 },
    rating: 0,
    reviewCount: 0,
    metadata: { fixture: true, source: "create-complete-test-product-script", packageContents: ["1 backpack", "1 warranty card", "1 care guide"], qualityChecked: true },
    status: "active",
    approvalStatus: "approved",
    moderation: {
      submittedAt: now, reviewedAt: now, reviewedBy: "test-script",
      checklist: { titleVerified: true, categoryVerified: true, complianceVerified: true, mediaVerified: true, pricingVerified: true, inventoryVerified: true },
      notes: "Approved complete-product fixture", revisionCount: 0,
    },
    approvedBy: "test-script",
    approvedAt: now,
    revisionStatus: "none",
    statusHistory: [{ fromStatus: "draft", toStatus: "active", reason: "Complete test fixture approved", actorId: sellerId, actorRole: "seller", changedFields: ["status", "approvalStatus"], createdAt: now }],
    createdBy: sellerId,
    lastUpdatedBy: sellerId,
    version: 1,
  };

  let product = await ProductModel.findOne({ slug: PRODUCT_SLUG });
  if (product && String(product.sellerId) !== sellerId) throw new Error("The test product slug belongs to another seller");
  if (product) {
    product.set(payload);
    await product.save();
  } else {
    product = await ProductModel.create(payload);
  }
  const defaultVariant = product.variants.find((variant) => variant.isDefault) || product.variants[0];
  product.defaultVariantId = String(defaultVariant._id);
  await product.save();
  return product;
}

async function syncVariantAndInventoryRecords(product, context) {
  const productId = String(product._id);
  const warehouseId = String(context.warehouse._id);
  const transaction = await sequelize.transaction();
  try {
    for (const item of VARIANTS) {
      await ProductVariantModel.findOneAndUpdate(
        { sellerId: context.sellerId, sku: item.sku },
        { $set: { familyCode: PRODUCT_FAMILY_CODE, productId, attributes: { capacity: item.capacity, color: item.color }, stock: item.stock, reservedStock: 0, status: "active" } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      );
      const [inventoryRows] = await sequelize.query(
        `SELECT id FROM product_inventory
         WHERE product_id = :productId AND variant_sku = :sku
           AND seller_id = :sellerId AND warehouse_id = :warehouseId LIMIT 1`,
        { replacements: { productId, sku: item.sku, sellerId: context.sellerId, warehouseId }, transaction },
      );
      const inventoryId = inventoryRows[0]?.id || uuidv4();
      await sequelize.query(
        `INSERT INTO product_inventory (
           id, product_id, variant_sku, seller_id, warehouse_id, available_qty,
           reserved_qty, damaged_qty, returned_qty, incoming_qty, reorder_level,
           reorder_qty, low_stock_alert_sent, metadata, created_at, updated_at
         ) VALUES (
           :id, :productId, :sku, :sellerId, :warehouseId, :stock,
           0, 0, 0, 0, 5, 20, FALSE, CAST(:metadata AS jsonb), NOW(), NOW()
         ) ON CONFLICT (id) DO UPDATE SET
           available_qty = EXCLUDED.available_qty, reserved_qty = 0,
           damaged_qty = 0, returned_qty = 0, incoming_qty = 0,
           reorder_level = 5, reorder_qty = 20, low_stock_alert_sent = FALSE,
           metadata = EXCLUDED.metadata, updated_at = NOW()`,
        { replacements: { id: inventoryId, productId, sku: item.sku, sellerId: context.sellerId, warehouseId, stock: item.stock, metadata: JSON.stringify({ fixture: true, organizationId: context.organization.id, barcode: item.barcode }) }, transaction },
      );
      await sequelize.query(
        `DELETE FROM inventory_transactions
         WHERE product_id = :productId AND variant_sku = :sku
           AND reference_type = 'fixture' AND reference_id = :referenceId`,
        { replacements: { productId, sku: item.sku, referenceId: PRODUCT_SLUG }, transaction },
      );
      await sequelize.query(
        `INSERT INTO inventory_transactions (
           id, product_id, variant_sku, seller_id, warehouse_id, transaction_type,
           quantity, balance_after, unit_cost, reference_id, reference_type,
           reason, performed_by, metadata, created_at
         ) VALUES (
           :id, :productId, :sku, :sellerId, :warehouseId, 'purchase', :stock,
           :stock, :costPrice, :referenceId, 'fixture',
           'Initial stock for complete product fixture', :sellerId,
           CAST(:metadata AS jsonb), NOW())`,
        { replacements: { id: uuidv4(), productId, sku: item.sku, sellerId: context.sellerId, warehouseId, stock: item.stock, costPrice: item.costPrice, referenceId: PRODUCT_SLUG, metadata: JSON.stringify({ fixture: true, organizationId: context.organization.id }) }, transaction },
      );
    }
    await sequelize.query(
      `DELETE FROM product_price_history
       WHERE product_id = :productId AND reason = 'Initial complete-product fixture price'`,
      { replacements: { productId }, transaction },
    );
    for (const item of VARIANTS) {
      await sequelize.query(
        `INSERT INTO product_price_history (
           id, product_id, variant_sku, seller_id, price_before, price_after,
           mrp_before, mrp_after, currency, reason, changed_by, created_at
         ) VALUES (
           :id, :productId, :sku, :sellerId, NULL, :price,
           NULL, :mrp, 'INR', 'Initial complete-product fixture price', :sellerId, NOW())`,
        { replacements: { id: uuidv4(), productId, sku: item.sku, sellerId: context.sellerId, price: item.price, mrp: item.mrp }, transaction },
      );
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function main() {
  assertDevelopment();
  await connectMongo();
  await sequelize.authenticate();
  const sellerContext = await loadSellerContext();
  const [{ category, brand }, warehouse, shippingProfileId] = await Promise.all([
    ensureCatalogReferences(sellerContext.sellerId),
    ensureGeographyAndWarehouse(sellerContext.sellerId),
    ensureShippingProfile(sellerContext.sellerId, sellerContext.organization.id),
  ]);
  const context = { ...sellerContext, category, brand, warehouse, shippingProfileId };
  const product = await ensureProduct(context);
  await syncVariantAndInventoryRecords(product, context);

  console.log("\nComplete test product created/updated");
  console.log(`  Product ID:       ${product._id}`);
  console.log(`  Product:          ${product.title}`);
  console.log(`  Seller:           ${SELLER_EMAIL}`);
  console.log(`  Organization ID:  ${sellerContext.organization.id}`);
  console.log(`  Warehouse:        ${warehouse.name} (${warehouse.code})`);
  console.log(`  Shipping profile: ${SHIPPING_PROFILE_NAME} (${shippingProfileId})`);
  console.log(`  Category / Brand: ${category.title} / ${brand.name}`);
  console.log(`  Variants:         ${VARIANTS.length}`);
  VARIANTS.forEach((item) => console.log(`    ${item.sku}: ${item.capacity}, ${item.color}, INR ${item.price}, stock ${item.stock}`));
}

main()
  .catch((error) => {
    console.error(`\nUnable to create complete test product: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
