"use strict";

const { postgresPool } = require("../../src/infrastructure/postgres/postgres-client");
const {
  connectMongo,
  mongoose,
} = require("../../src/infrastructure/mongo/mongo-client");
const { ProductModel } = require("../../src/modules/product/models/product.model");
const {
  InventoryReservationModel,
} = require("../../src/modules/inventory/models/inventory-reservation.model");
const {
  InventoryTransactionModel,
} = require("../../src/modules/inventory/models/inventory-transaction.model");
const { WarehouseModel } = require("../../src/modules/inventory/models/warehouse.model");
const { UserModel } = require("../../src/modules/user/models/user.model");
const { ReturnModel } = require("../../src/modules/returns/models/return.model");
const { v4: uuidv4 } = require("uuid");

async function ensureLegacySellerOrganizations() {
  const users = await UserModel.find({ role: "seller" })
    .select("email phone accountStatus sellerProfile")
    .lean();
  let created = 0;
  for (const user of users) {
    const sellerId = String(user._id);
    const existing = await postgresPool.query(
      "SELECT id FROM seller_organizations WHERE seller_id = $1 LIMIT 1",
      [sellerId],
    );
    if (existing.rows.length) continue;

    const profile = user.sellerProfile || {};
    const legalBusinessName =
      profile.legalBusinessName ||
      profile.businessName ||
      profile.displayName ||
      user.email ||
      `Seller ${sellerId}`;
    const isLive =
      user.accountStatus === "active" &&
      profile.kycStatus === "verified" &&
      profile.bankVerificationStatus === "verified" &&
      profile.goLiveStatus === "live";
    const organizationId = uuidv4();
    await postgresPool.query(
      `INSERT INTO seller_organizations (
        id, seller_id, legal_business_name, store_display_name, business_type,
        gstin, pan, kyc_status, bank_verification_status, approval_status,
        bank_details, billing_address, pickup_address, return_address,
        tax_settings, invoice_settings, payout_settings, metadata,
        is_default, go_live_status, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
        $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb,
        TRUE, $19, $2, $2
      )`,
      [
        organizationId,
        sellerId,
        legalBusinessName,
        profile.displayName || profile.businessName || legalBusinessName,
        profile.businessType || null,
        profile.gstNumber || null,
        profile.panNumber || null,
        profile.kycStatus || (isLive ? "verified" : "not_submitted"),
        profile.bankVerificationStatus || (isLive ? "verified" : "not_submitted"),
        isLive ? "approved" : "draft",
        JSON.stringify(profile.bankDetails || {}),
        JSON.stringify(profile.businessAddress || {}),
        JSON.stringify(profile.pickupAddress || {}),
        JSON.stringify(profile.returnAddress || {}),
        JSON.stringify({
          gstin: profile.gstNumber || null,
          pan: profile.panNumber || null,
          state:
            profile.businessAddress?.state ||
            profile.pickupAddress?.state ||
            "",
        }),
        JSON.stringify({ invoicePrefix: "INV" }),
        JSON.stringify({ payoutSchedule: "weekly" }),
        JSON.stringify({ source: "legacy_seller_compatibility_backfill" }),
        isLive ? "live" : "pending",
      ],
    );
    created += 1;
  }
  return created;
}

async function loadDefaultOrganizations() {
  const { rows } = await postgresPool.query(`
    SELECT DISTINCT ON (seller_id)
      seller_id,
      id::text AS organization_id
    FROM seller_organizations
    ORDER BY seller_id, is_default DESC, created_at ASC
  `);
  return new Map(
    rows.map((row) => [String(row.seller_id), String(row.organization_id)]),
  );
}

async function backfillProducts(defaultOrganizations) {
  const products = await ProductModel.find({
    $or: [
      { organizationId: { $exists: false } },
      { organizationId: "" },
      { organizationId: null },
    ],
  })
    .select("_id sellerId")
    .lean();
  const operations = products
    .map((product) => {
      const organizationId = defaultOrganizations.get(String(product.sellerId || ""));
      if (!organizationId) return null;
      return {
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { organizationId } },
        },
      };
    })
    .filter(Boolean);
  if (operations.length) await ProductModel.bulkWrite(operations);
  return operations.length;
}

async function loadProductOwnership() {
  const products = await ProductModel.find({
    organizationId: { $exists: true, $nin: ["", null] },
  })
    .select("_id sellerId organizationId")
    .lean();
  return new Map(
    products.map((product) => [
      String(product._id),
      {
        sellerId: String(product.sellerId || ""),
        organizationId: String(product.organizationId || ""),
      },
    ]),
  );
}

async function backfillReservations(productOwnership, defaultOrganizations) {
  const reservations = await InventoryReservationModel.find({
    "items.0": { $exists: true },
  });
  let changed = 0;
  for (const reservation of reservations) {
    let dirty = false;
    reservation.items.forEach((item) => {
      if (item.organizationId) return;
      const ownership = productOwnership.get(String(item.productId || ""));
      const organizationId =
        ownership?.organizationId ||
        defaultOrganizations.get(String(item.sellerId || ""));
      if (organizationId) {
        item.organizationId = organizationId;
        dirty = true;
      }
    });
    if (dirty) {
      await reservation.save();
      changed += 1;
    }
  }
  return changed;
}

async function backfillTransactions(productOwnership, defaultOrganizations) {
  const transactions = await InventoryTransactionModel.find({
    $or: [
      { organizationId: { $exists: false } },
      { organizationId: "" },
      { organizationId: null },
    ],
  })
    .select("_id productId sellerId")
    .lean();
  const operations = transactions
    .map((transaction) => {
      const ownership = productOwnership.get(String(transaction.productId || ""));
      const organizationId =
        ownership?.organizationId ||
        defaultOrganizations.get(String(transaction.sellerId || ""));
      if (!organizationId) return null;
      return {
        updateOne: {
          filter: { _id: transaction._id },
          update: { $set: { organizationId } },
        },
      };
    })
    .filter(Boolean);
  if (operations.length) await InventoryTransactionModel.bulkWrite(operations);
  return operations.length;
}

async function backfillWarehouses(defaultOrganizations) {
  const warehouses = await WarehouseModel.find({
    sellerId: { $exists: true, $nin: ["", null] },
    $or: [
      { organizationId: { $exists: false } },
      { organizationId: "" },
      { organizationId: null },
    ],
  })
    .select("_id sellerId")
    .lean();
  const operations = warehouses
    .map((warehouse) => {
      const organizationId = defaultOrganizations.get(String(warehouse.sellerId || ""));
      if (!organizationId) return null;
      return {
        updateOne: {
          filter: { _id: warehouse._id },
          update: { $set: { organizationId } },
        },
      };
    })
    .filter(Boolean);
  if (operations.length) await WarehouseModel.bulkWrite(operations);
  return operations.length;
}

async function backfillReturns(productOwnership, defaultOrganizations) {
  const returns = await ReturnModel.find({ "items.0": { $exists: true } });
  let changed = 0;
  for (const returnRequest of returns) {
    let dirty = false;
    returnRequest.items.forEach((item) => {
      if (item.organizationId) return;
      const ownership = productOwnership.get(String(item.productId || ""));
      const organizationId =
        ownership?.organizationId ||
        defaultOrganizations.get(String(item.sellerId || returnRequest.sellerId || ""));
      if (organizationId) {
        item.organizationId = organizationId;
        dirty = true;
      }
    });
    if (!returnRequest.organizationId) {
      const organizationId =
        returnRequest.items.find((item) => item.organizationId)?.organizationId ||
        defaultOrganizations.get(String(returnRequest.sellerId || ""));
      if (organizationId) {
        returnRequest.organizationId = organizationId;
        dirty = true;
      }
    }
    if (dirty) {
      await returnRequest.save();
      changed += 1;
    }
  }
  return changed;
}

async function backfillPostgresOwnership() {
  await postgresPool.query(`
    UPDATE order_items oi
    SET organization_id = so.id,
        organization_snapshot = CASE
          WHEN COALESCE(oi.organization_snapshot, '{}'::jsonb) = '{}'::jsonb
          THEN jsonb_build_object(
            'organizationId', so.id,
            'sellerId', so.seller_id,
            'legalBusinessName', so.legal_business_name,
            'storeDisplayName', so.store_display_name,
            'gstin', so.gstin,
            'pan', so.pan,
            'billingAddress', so.billing_address,
            'pickupAddress', so.pickup_address,
            'taxSettings', so.tax_settings,
            'invoiceSettings', so.invoice_settings,
            'payoutSettings', so.payout_settings,
            'source', 'organization_ownership_backfill'
          )
          ELSE oi.organization_snapshot
        END
    FROM seller_organizations so
    WHERE oi.seller_id = so.seller_id
      AND so.is_default = TRUE
      AND oi.organization_id IS NULL
  `);
  await postgresPool.query(`
    UPDATE shipments s
    SET organization_id = grouped.organization_id,
        organization_snapshot = grouped.organization_snapshot
    FROM (
      SELECT DISTINCT ON (order_id, seller_id)
        order_id, seller_id, organization_id, organization_snapshot
      FROM order_items
      WHERE organization_id IS NOT NULL
      ORDER BY order_id, seller_id, id
    ) grouped
    WHERE s.order_id = grouped.order_id
      AND s.seller_id = grouped.seller_id
      AND s.organization_id IS NULL
  `);
  await postgresPool.query(`
    UPDATE tax_invoices ti
    SET organization_id = grouped.organization_id,
        organization_snapshot = grouped.organization_snapshot
    FROM (
      SELECT DISTINCT ON (order_id, seller_id)
        order_id, seller_id, organization_id, organization_snapshot
      FROM order_items
      WHERE organization_id IS NOT NULL
      ORDER BY order_id, seller_id, id
    ) grouped
    WHERE ti.order_id = grouped.order_id
      AND ti.seller_id = grouped.seller_id
      AND ti.organization_id IS NULL
  `).catch(() => {});
  await postgresPool.query(`
    UPDATE seller_commissions sc
    SET organization_id = grouped.organization_id,
        organization_snapshot = grouped.organization_snapshot
    FROM (
      SELECT DISTINCT ON (order_id, seller_id)
        order_id, seller_id, organization_id, organization_snapshot
      FROM order_items
      WHERE organization_id IS NOT NULL
      ORDER BY order_id, seller_id, id
    ) grouped
    WHERE sc.order_id = grouped.order_id
      AND sc.seller_id = grouped.seller_id
      AND sc.organization_id IS NULL
  `).catch(() => {});
}

async function backfillCancellations() {
  const { rows } = await postgresPool.query(`
    SELECT id, items
    FROM order_cancellations
    WHERE jsonb_typeof(items) = 'array'
  `).catch(() => ({ rows: [] }));
  let changed = 0;
  for (const row of rows) {
    const items = Array.isArray(row.items) ? row.items : [];
    let dirty = false;
    for (const item of items) {
      if (item.organizationId) continue;
      const orderItemId = item.orderItemId || item.order_item_id;
      if (!orderItemId) continue;
      const result = await postgresPool.query(
        "SELECT organization_id::text FROM order_items WHERE id = $1 LIMIT 1",
        [orderItemId],
      );
      const organizationId = result.rows[0]?.organization_id;
      if (organizationId) {
        item.organizationId = organizationId;
        dirty = true;
      }
    }
    if (dirty) {
      await postgresPool.query(
        "UPDATE order_cancellations SET items = $2::jsonb, updated_at = NOW() WHERE id = $1",
        [row.id, JSON.stringify(items)],
      );
      changed += 1;
    }
  }
  return changed;
}

async function main() {
  await connectMongo();
  const organizationsCreated = await ensureLegacySellerOrganizations();
  const defaultOrganizations = await loadDefaultOrganizations();
  await backfillPostgresOwnership();
  const cancellations = await backfillCancellations();
  const products = await backfillProducts(defaultOrganizations);
  const productOwnership = await loadProductOwnership();
  const reservations = await backfillReservations(
    productOwnership,
    defaultOrganizations,
  );
  const transactions = await backfillTransactions(
    productOwnership,
    defaultOrganizations,
  );
  const warehouses = await backfillWarehouses(defaultOrganizations);
  const returns = await backfillReturns(productOwnership, defaultOrganizations);
  process.stdout.write(
    `${JSON.stringify({
      organizationsCreated,
      products,
      reservations,
      transactions,
      warehouses,
      returns,
      cancellations,
    })}\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await postgresPool.end().catch(() => {});
    await mongoose.connection.close().catch(() => {});
  });
