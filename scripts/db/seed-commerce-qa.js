#!/usr/bin/env node
"use strict";

const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { randomUUID } = require("crypto");
const { postgresPool } = require("../../src/infrastructure/postgres/postgres-client");
const { UserModel } = require("../../src/modules/user/models/user.model");
const { ProductModel } = require("../../src/modules/product/models/product.model");
const { ReturnModel } = require("../../src/modules/returns/models/return.model");
const { ContentPageModel } = require("../../src/modules/platform/models/content-page.model");
const { InventoryReservationModel } = require("../../src/modules/inventory/models/inventory-reservation.model");
const { InventoryTransactionModel } = require("../../src/modules/inventory/models/inventory-transaction.model");
const { ROLES } = require("../../src/shared/constants/roles");
const { PRODUCT_STATUS, PRODUCT_TYPE, PRODUCT_VISIBILITY } = require("../../src/shared/domain/commerce-constants");
const { hashText } = require("../../src/shared/tools/hash");

const SEED_TAG = "commerce-qa-v1";
const RESET = process.argv.includes("--reset");
const PASSWORD = process.env.SEED_PASSWORD || "Password@123";

const ids = {
  deliveredOrder: "10000000-0000-4000-8000-000000000001",
  manualOrder: "10000000-0000-4000-8000-000000000002",
  codOrder: "10000000-0000-4000-8000-000000000003",
  returnApprovedOrder: "10000000-0000-4000-8000-000000000004",
  returnPickupOrder: "10000000-0000-4000-8000-000000000005",
  returnReceivedOrder: "10000000-0000-4000-8000-000000000006",
  returnQcFailedOrder: "10000000-0000-4000-8000-000000000007",
  returnRefundedWalletOrder: "10000000-0000-4000-8000-000000000008",
  returnRefundedOriginalOrder: "10000000-0000-4000-8000-000000000009",
  returnRejectedOrder: "10000000-0000-4000-8000-000000000010",
  returnReplacedOrder: "10000000-0000-4000-8000-000000000011",
  returnClosedOrder: "10000000-0000-4000-8000-000000000012",
  deliveredItem: "20000000-0000-4000-8000-000000000001",
  manualItem: "20000000-0000-4000-8000-000000000002",
  codItem: "20000000-0000-4000-8000-000000000003",
  returnApprovedItem: "20000000-0000-4000-8000-000000000004",
  returnPickupItem: "20000000-0000-4000-8000-000000000005",
  returnReceivedItem: "20000000-0000-4000-8000-000000000006",
  returnQcFailedItem: "20000000-0000-4000-8000-000000000007",
  returnRefundedWalletItem: "20000000-0000-4000-8000-000000000008",
  returnRefundedOriginalItem: "20000000-0000-4000-8000-000000000009",
  returnRejectedItem: "20000000-0000-4000-8000-000000000010",
  returnReplacedItem: "20000000-0000-4000-8000-000000000011",
  returnClosedItem: "20000000-0000-4000-8000-000000000012",
  paymentCaptured: "30000000-0000-4000-8000-000000000001",
  paymentManual: "30000000-0000-4000-8000-000000000002",
  paymentCod: "30000000-0000-4000-8000-000000000003",
  returnApprovedPayment: "30000000-0000-4000-8000-000000000004",
  returnPickupPayment: "30000000-0000-4000-8000-000000000005",
  returnReceivedPayment: "30000000-0000-4000-8000-000000000006",
  returnQcFailedPayment: "30000000-0000-4000-8000-000000000007",
  returnRefundedWalletPayment: "30000000-0000-4000-8000-000000000008",
  returnRefundedOriginalPayment: "30000000-0000-4000-8000-000000000009",
  returnRejectedPayment: "30000000-0000-4000-8000-000000000010",
  returnReplacedPayment: "30000000-0000-4000-8000-000000000011",
  returnClosedPayment: "30000000-0000-4000-8000-000000000012",
  wallet: "40000000-0000-4000-8000-000000000001",
  walletTxn: "40000000-0000-4000-8000-000000000002",
  walletTxnDebitHeld: "40000000-0000-4000-8000-000000000003",
  walletTxnDebitCaptured: "40000000-0000-4000-8000-000000000004",
  walletTxnRefundWallet: "40000000-0000-4000-8000-000000000005",
  walletTxnRefundOriginal: "40000000-0000-4000-8000-000000000006",
  walletTxnRelease: "40000000-0000-4000-8000-000000000007",
  invoice: "50000000-0000-4000-8000-000000000001",
  creditNote: "50000000-0000-4000-8000-000000000002",
  taxLedgerCgst: "50000000-0000-4000-8000-000000000003",
  taxLedgerSgst: "50000000-0000-4000-8000-000000000004",
  shipment: "60000000-0000-4000-8000-000000000001",
  trackingCreated: "60000000-0000-4000-8000-000000000002",
  trackingDelivered: "60000000-0000-4000-8000-000000000003",
  manifest: "60000000-0000-4000-8000-000000000004",
  webhook: "70000000-0000-4000-8000-000000000001",
};

const qaOrderIds = [
  ids.deliveredOrder,
  ids.manualOrder,
  ids.codOrder,
  ids.returnApprovedOrder,
  ids.returnPickupOrder,
  ids.returnReceivedOrder,
  ids.returnQcFailedOrder,
  ids.returnRefundedWalletOrder,
  ids.returnRefundedOriginalOrder,
  ids.returnRejectedOrder,
  ids.returnReplacedOrder,
  ids.returnClosedOrder,
];

const qaItemRows = [
  [ids.deliveredItem, ids.deliveredOrder],
  [ids.manualItem, ids.manualOrder],
  [ids.codItem, ids.codOrder],
  [ids.returnApprovedItem, ids.returnApprovedOrder],
  [ids.returnPickupItem, ids.returnPickupOrder],
  [ids.returnReceivedItem, ids.returnReceivedOrder],
  [ids.returnQcFailedItem, ids.returnQcFailedOrder],
  [ids.returnRefundedWalletItem, ids.returnRefundedWalletOrder],
  [ids.returnRefundedOriginalItem, ids.returnRefundedOriginalOrder],
  [ids.returnRejectedItem, ids.returnRejectedOrder],
  [ids.returnReplacedItem, ids.returnReplacedOrder],
  [ids.returnClosedItem, ids.returnClosedOrder],
];

const qaWalletTxnIds = [
  ids.walletTxn,
  ids.walletTxnDebitHeld,
  ids.walletTxnDebitCaptured,
  ids.walletTxnRefundWallet,
  ids.walletTxnRefundOriginal,
  ids.walletTxnRelease,
];

const qaPaymentIds = [
  ids.paymentCaptured,
  ids.paymentManual,
  ids.paymentCod,
  ids.returnApprovedPayment,
  ids.returnPickupPayment,
  ids.returnReceivedPayment,
  ids.returnQcFailedPayment,
  ids.returnRefundedWalletPayment,
  ids.returnRefundedOriginalPayment,
  ids.returnRejectedPayment,
  ids.returnReplacedPayment,
  ids.returnClosedPayment,
];

const requiredTables = [
  "orders",
  "order_items",
  "order_status_history",
  "order_notes",
  "payments",
  "payment_webhook_events",
  "wallets",
  "wallet_transactions",
  "tax_invoices",
  "tax_credit_notes",
  "tax_ledger_entries",
  "shipments",
  "shipment_tracking_events",
  "shipment_manifests",
];

const log = (message) => process.stdout.write(`${message}\n`);
const oid = (doc) => String(doc?._id || doc?.id || "");
const nowIso = () => new Date().toISOString();

async function tableExists(tableName) {
  const { rows } = await postgresPool.query("SELECT to_regclass($1) AS table_name", [tableName]);
  return Boolean(rows[0]?.table_name);
}

async function requireTables() {
  const missing = [];
  for (const tableName of requiredTables) {
    if (!(await tableExists(tableName))) missing.push(tableName);
  }
  if (missing.length) {
    throw new Error(`Missing PostgreSQL tables: ${missing.join(", ")}. Run npm run db:migrate first.`);
  }
}

async function upsertUser(email, payload) {
  const passwordHash = await hashText(PASSWORD);
  return UserModel.findOneAndUpdate(
    { email },
    {
      $set: { ...payload, email, passwordHash, emailVerified: true, accountStatus: "active" },
      $setOnInsert: { refreshSessions: [], authProviders: [] },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function seedMongo() {
  const admin = await upsertUser("qa.admin@example.com", {
    phone: "9100000001",
    role: ROLES.ADMIN,
    profile: { firstName: "QA", lastName: "Admin" },
    metadata: { seedTag: SEED_TAG },
  });

  const buyer = await upsertUser("qa.buyer@example.com", {
    phone: "9100000002",
    role: ROLES.BUYER,
    profile: { firstName: "QA", lastName: "Buyer" },
    metadata: { seedTag: SEED_TAG },
  });

  const seller = await upsertUser("qa.seller@example.com", {
    phone: "9100000003",
    role: ROLES.SELLER,
    profile: { firstName: "QA", lastName: "Seller" },
    sellerProfile: {
      displayName: "QA Seller",
      businessName: "QA Seller Pvt Ltd",
      legalBusinessName: "QA Seller Pvt Ltd",
      gstNumber: "29QAABC1234Q1Z5",
      profileCompleted: true,
      kycStatus: "verified",
      bankVerificationStatus: "verified",
      goLiveStatus: "live",
      pickupAddress: {
        line1: "QA Warehouse",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560001",
      },
    },
    metadata: { seedTag: SEED_TAG },
  });

  const product = await ProductModel.findOneAndUpdate(
    { slug: "qa-returnable-phone" },
    {
      $set: {
        sellerId: oid(seller),
        title: "QA Returnable Phone",
        slug: "qa-returnable-phone",
        description: "Seed product for order, payment, tax, shipment, and return QA flows.",
        shortDescription: "QA fixture product",
        productType: PRODUCT_TYPE.SIMPLE,
        visibility: PRODUCT_VISIBILITY.PUBLIC,
        category: "electronics",
        brand: "QA Brand",
        price: 10000,
        mrp: 12000,
        currency: "INR",
        gstRate: 18,
        hsnCode: "8517",
        sku: "QA-PHONE-001",
        stock: 50,
        reservedStock: 0,
        origin: { country: "India", state: "Karnataka", city: "Bengaluru" },
        warranty: { returnPolicy: { eligible: true, days: 10, type: "standard" } },
        status: PRODUCT_STATUS.ACTIVE,
        approvedBy: oid(admin),
        approvedAt: new Date(),
        publishedAt: new Date(),
        createdBy: oid(seller),
        lastUpdatedBy: oid(admin),
        metadata: { seedTag: SEED_TAG },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return { admin, buyer, seller, product };
}

async function resetQaData() {
  log("Resetting QA seed records");
  await ReturnModel.deleteMany({ "timeline.metadata.seedTag": SEED_TAG });
  await ContentPageModel.deleteMany({ pageType: "user_transaction", "metadata.seedTag": SEED_TAG });
  await InventoryReservationModel.deleteMany({ "metadata.seedTag": SEED_TAG });
  await InventoryTransactionModel.deleteMany({ "metadata.seedTag": SEED_TAG });
  await ProductModel.deleteOne({ slug: "qa-returnable-phone" });
  await UserModel.deleteMany({ email: { $in: ["qa.admin@example.com", "qa.buyer@example.com", "qa.seller@example.com"] } });

  await postgresPool.query("DELETE FROM payment_webhook_events WHERE id = $1", [ids.webhook]);
  await postgresPool.query("DELETE FROM shipment_tracking_events WHERE shipment_id = $1", [ids.shipment]);
  await postgresPool.query("DELETE FROM shipments WHERE id = $1", [ids.shipment]);
  await postgresPool.query("DELETE FROM shipment_manifests WHERE id = $1", [ids.manifest]);
  await postgresPool.query("DELETE FROM tax_credit_notes WHERE id = $1", [ids.creditNote]);
  await postgresPool.query("DELETE FROM tax_ledger_entries WHERE id IN ($1, $2)", [ids.taxLedgerCgst, ids.taxLedgerSgst]);
  await postgresPool.query("DELETE FROM tax_invoices WHERE id = $1", [ids.invoice]);
  await postgresPool.query("DELETE FROM wallet_transactions WHERE id = ANY($1::uuid[]) OR metadata->>'seedTag' = $2", [qaWalletTxnIds, SEED_TAG]);
  await postgresPool.query("DELETE FROM wallets WHERE id = $1", [ids.wallet]);
  await postgresPool.query("DELETE FROM payments WHERE id = ANY($1::uuid[])", [qaPaymentIds]);
  await postgresPool.query("DELETE FROM order_notes WHERE order_id = ANY($1::uuid[])", [qaOrderIds]);
  await postgresPool.query("DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])", [qaOrderIds]);
  await postgresPool.query("DELETE FROM order_items WHERE order_id = ANY($1::uuid[])", [qaOrderIds]);
  await postgresPool.query("DELETE FROM orders WHERE id = ANY($1::uuid[])", [qaOrderIds]);
}

async function seedOrders({ admin, buyer, seller, product }) {
  const buyerId = oid(buyer);
  const sellerId = oid(seller);
  const productId = oid(product);
  const shippingAddress = {
    name: "QA Buyer",
    phone: "9100000002",
    line1: "QA Test Street",
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    postalCode: "560001",
  };
  const sellerSnapshot = {
    sellerId,
    displayName: seller.sellerProfile?.displayName || "QA Seller",
    gstNumber: seller.sellerProfile?.gstNumber,
  };
  const productSnapshot = {
    productId,
    title: product.title,
    sku: product.sku,
    hsnCode: product.hsnCode,
    gstRate: product.gstRate,
  };

  const orders = [
    [ids.deliveredOrder, "ORD-QA-DELIVERED", "delivered", "captured", "delivered", 10000, 1800, 11800, 11800],
    [ids.manualOrder, "ORD-QA-MANUAL", "pending_payment", "initiated", "pending", 10000, 1800, 11800, 11800],
    [ids.codOrder, "ORD-QA-COD", "confirmed", "authorized", "packed", 10000, 1800, 11800, 11800],
    [ids.returnApprovedOrder, "ORD-QA-RET-APPROVED", "delivered", "captured", "delivered", 10000, 1800, 11800, 11800],
    [ids.returnPickupOrder, "ORD-QA-RET-PICKUP", "delivered", "captured", "delivered", 10000, 1800, 11800, 11800],
    [ids.returnReceivedOrder, "ORD-QA-RET-RECEIVED", "delivered", "captured", "delivered", 10000, 1800, 11800, 11800],
    [ids.returnQcFailedOrder, "ORD-QA-RET-QC-FAILED", "delivered", "captured", "delivered", 10000, 1800, 11800, 11800],
    [ids.returnRefundedWalletOrder, "ORD-QA-RET-WALLET-REFUND", "returned", "refunded", "returned", 10000, 1800, 11800, 11800],
    [ids.returnRefundedOriginalOrder, "ORD-QA-RET-ORIGINAL-REFUND", "returned", "refunded", "returned", 10000, 1800, 11800, 11800],
    [ids.returnRejectedOrder, "ORD-QA-RET-REJECTED", "delivered", "captured", "delivered", 10000, 1800, 11800, 11800],
    [ids.returnReplacedOrder, "ORD-QA-RET-REPLACED", "fulfilled", "captured", "delivered", 10000, 1800, 11800, 11800],
    [ids.returnClosedOrder, "ORD-QA-RET-CLOSED", "delivered", "captured", "delivered", 10000, 1800, 11800, 11800],
  ];

  for (const order of orders) {
    await postgresPool.query(
      `
      INSERT INTO orders (
        id, buyer_id, status, currency, subtotal_amount, discount_amount, tax_amount, total_amount,
        shipping_address, payable_amount, tax_breakup, platform_fee_amount, platform_fee_breakup,
        order_number, payment_status, delivery_status, metadata, created_by, updated_by
      )
      VALUES ($1,$2,$3,'INR',$6,0,$7,$8,$10,$9,$11,0,$12,$4,$5,$13,$14,$15,$15)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        payment_status = EXCLUDED.payment_status,
        delivery_status = EXCLUDED.delivery_status,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      `,
      [
        order[0],
        buyerId,
        order[2],
        order[1],
        order[3],
        order[5],
        order[6],
        order[7],
        order[8],
        shippingAddress,
        { cgst: 900, sgst: 900, igst: 0 },
        {},
        order[4],
        { seedTag: SEED_TAG, qaScenario: order[1] },
        oid(admin),
      ],
    );
  }

  for (const [itemId, orderId] of qaItemRows) {
    await postgresPool.query(
      `
      INSERT INTO order_items (
        id, order_id, product_id, seller_id, quantity, unit_price, line_total, product_title,
        product_slug, product_sku, brand, category, hsn_code, gst_rate, seller_snapshot,
        discount_amount, tax_amount, tax_breakup, platform_fee_amount, pricing_snapshot, product_snapshot
      )
      VALUES ($1,$2,$3,$4,1,10000,10000,$5,$6,$7,$8,$9,$10,18,$11,0,1800,$12,0,$13,$14)
      ON CONFLICT (id) DO UPDATE SET product_title = EXCLUDED.product_title
      `,
      [
        itemId,
        orderId,
        productId,
        sellerId,
        product.title,
        product.slug,
        product.sku,
        product.brand,
        product.category,
        product.hsnCode,
        sellerSnapshot,
        { cgst: 900, sgst: 900 },
        { seedTag: SEED_TAG, unitPrice: 10000, taxInclusive: false },
        productSnapshot,
      ],
    );
  }

  await postgresPool.query("DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])", [qaOrderIds]);
  await postgresPool.query("DELETE FROM order_notes WHERE order_id = ANY($1::uuid[])", [qaOrderIds]);

  const deliveredFlow = ["created", "confirmed", "packed", "shipped", "delivered"];
  const orderTimelineMap = new Map([
    [ids.deliveredOrder, deliveredFlow],
    [ids.manualOrder, ["created", "pending_payment"]],
    [ids.codOrder, ["created", "confirmed", "packed"]],
    [ids.returnApprovedOrder, [...deliveredFlow, "return_requested"]],
    [ids.returnPickupOrder, [...deliveredFlow, "return_requested", "return_pickup_scheduled"]],
    [ids.returnReceivedOrder, [...deliveredFlow, "return_requested", "return_received"]],
    [ids.returnQcFailedOrder, [...deliveredFlow, "return_requested", "return_received", "return_qc_failed"]],
    [ids.returnRefundedWalletOrder, [...deliveredFlow, "return_requested", "returned"]],
    [ids.returnRefundedOriginalOrder, [...deliveredFlow, "return_requested", "returned"]],
    [ids.returnRejectedOrder, [...deliveredFlow, "return_requested", "return_rejected"]],
    [ids.returnReplacedOrder, [...deliveredFlow, "return_requested", "replacement_created", "fulfilled"]],
    [ids.returnClosedOrder, [...deliveredFlow, "return_requested", "return_closed"]],
  ]);

  for (const orderId of qaOrderIds) {
    let previousStatus = null;
    for (const status of orderTimelineMap.get(orderId) || ["created"]) {
      await postgresPool.query(
        "INSERT INTO order_status_history (id, order_id, from_status, to_status, actor_id, actor_role, note, metadata) VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7)",
        [
          randomUUID(),
          orderId,
          previousStatus,
          status,
          oid(admin),
          `QA ${status.replace(/_/g, " ")} step for order management testing`,
          { seedTag: SEED_TAG, source: "qa-order-management-seed" },
        ],
      );
      previousStatus = status;
    }

    await postgresPool.query(
      "INSERT INTO order_notes (id, order_id, actor_id, actor_role, visibility, note) VALUES ($1, $2, $3, 'admin', 'internal', $4)",
      [
        randomUUID(),
        orderId,
        oid(admin),
        "QA order management seed: order, payment, shipment, return/refund, and transaction data connected.",
      ],
    );
  }
}

async function seedPaymentsAndTax({ admin, buyer }) {
  const buyerId = oid(buyer);
  const payments = [
    [ids.paymentCaptured, ids.deliveredOrder, "razorpay", "captured", "QA-RZP-CAPTURED", "order_qa_delivered", "pay_qa_delivered", null, nowIso()],
    [ids.paymentManual, ids.manualOrder, "manual_bank_transfer", "initiated", "QA-MANUAL-PENDING", null, null, null, null],
    [ids.paymentCod, ids.codOrder, "cod", "authorized", "QA-COD-AUTH", null, null, oid(admin), nowIso()],
    [ids.returnApprovedPayment, ids.returnApprovedOrder, "razorpay", "captured", "QA-RET-APPROVED-PAY", "order_qa_ret_approved", "pay_qa_ret_approved", null, nowIso()],
    [ids.returnPickupPayment, ids.returnPickupOrder, "razorpay", "captured", "QA-RET-PICKUP-PAY", "order_qa_ret_pickup", "pay_qa_ret_pickup", null, nowIso()],
    [ids.returnReceivedPayment, ids.returnReceivedOrder, "manual_upi", "captured", "QA-RET-RECEIVED-MANUAL", null, "upi_qa_ret_received", oid(admin), nowIso()],
    [ids.returnQcFailedPayment, ids.returnQcFailedOrder, "razorpay", "captured", "QA-RET-QC-FAILED-PAY", "order_qa_ret_qc_failed", "pay_qa_ret_qc_failed", null, nowIso()],
    [ids.returnRefundedWalletPayment, ids.returnRefundedWalletOrder, "wallet_only", "refunded", "QA-RET-WALLET-REFUNDED", null, "wallet_refund_qa_001", oid(admin), nowIso()],
    [ids.returnRefundedOriginalPayment, ids.returnRefundedOriginalOrder, "razorpay", "refunded", "QA-RET-ORIGINAL-REFUNDED", "order_qa_ret_original", "rfnd_qa_original_001", null, nowIso()],
    [ids.returnRejectedPayment, ids.returnRejectedOrder, "cod", "captured", "QA-RET-REJECTED-COD", null, "cod_qa_ret_rejected", oid(admin), nowIso()],
    [ids.returnReplacedPayment, ids.returnReplacedOrder, "razorpay", "captured", "QA-RET-REPLACED-PAY", "order_qa_ret_replaced", "pay_qa_ret_replaced", null, nowIso()],
    [ids.returnClosedPayment, ids.returnClosedOrder, "manual_bank_transfer", "captured", "QA-RET-CLOSED-BANK", null, "bank_qa_ret_closed", oid(admin), nowIso()],
  ];
  for (const row of payments) {
    await postgresPool.query(
      `
      INSERT INTO payments (
        id, order_id, buyer_id, provider, status, amount, currency, transaction_reference,
        provider_order_id, provider_payment_id, verification_method, metadata, verified_at,
        idempotency_key, approved_by, approved_at
      )
      VALUES ($1,$2,$3,$4,$5,11800,'INR',$6,$7,$8,'manual',$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = NOW()
      `,
      [row[0], row[1], buyerId, row[2], row[3], row[4], row[5], row[6], { seedTag: SEED_TAG }, row[8], `${SEED_TAG}:${row[0]}`, row[7], row[8]],
    );
  }

  await postgresPool.query(
    `
    INSERT INTO payment_webhook_events (id, provider, provider_event_id, event_type, payment_id, order_id, payload)
    VALUES ($1, 'razorpay', 'evt_qa_payment_captured', 'payment.captured', $2, $3, $4)
    ON CONFLICT (provider, provider_event_id) DO UPDATE SET payload = EXCLUDED.payload
    `,
    [ids.webhook, ids.paymentCaptured, ids.deliveredOrder, { seedTag: SEED_TAG }],
  );

  await postgresPool.query(
    `
    INSERT INTO wallets (id, user_id, available_balance, locked_balance)
    VALUES ($1, $2, 5000, 0)
    ON CONFLICT (user_id) DO UPDATE SET available_balance = EXCLUDED.available_balance, updated_at = NOW()
    `,
    [ids.wallet, buyerId],
  );
  await postgresPool.query(
    `
    INSERT INTO wallet_transactions (id, user_id, type, status, amount, reference_type, reference_id, metadata)
    VALUES ($1, $2, 'credit', 'completed', 5000, 'qa_seed', $3, $4)
    ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, metadata = EXCLUDED.metadata
    `,
    [ids.walletTxn, buyerId, SEED_TAG, { seedTag: SEED_TAG }],
  );
  const walletTransactions = [
    [ids.walletTxnDebitHeld, "debit", "held", 1500, "order", ids.manualOrder, "Wallet hold for pending manual order"],
    [ids.walletTxnDebitCaptured, "debit", "completed", 2000, "order", ids.deliveredOrder, "Wallet debit captured for delivered order"],
    [ids.walletTxnRefundWallet, "credit", "completed", 11800, "return_refund", "qa-wallet-refund-001", "Wallet fallback return refund"],
    [ids.walletTxnRefundOriginal, "credit", "completed", 11800, "return_refund", "qa-original-refund-001", "Original payment refund mirrored in wallet ledger"],
    [ids.walletTxnRelease, "credit", "released", 1500, "order", ids.manualOrder, "Wallet hold released after payment change"],
  ];
  for (const tx of walletTransactions) {
    await postgresPool.query(
      `
      INSERT INTO wallet_transactions (id, user_id, type, status, amount, reference_type, reference_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, amount = EXCLUDED.amount, metadata = EXCLUDED.metadata
      `,
      [tx[0], buyerId, tx[1], tx[2], tx[3], tx[4], tx[5], { seedTag: SEED_TAG, description: tx[6] }],
    );
  }

  await postgresPool.query(
    `
    INSERT INTO tax_invoices (
      id, invoice_number, order_id, buyer_id, taxable_amount, tax_amount, cgst_amount,
      sgst_amount, igst_amount, tcs_amount, total_amount, currency, tax_mode,
      gstin_marketplace, gstin_seller, place_of_supply, issued_at, metadata
    )
    VALUES ($1, 'INV-QA-0001', $2, $3, 10000, 1800, 900, 900, 0, 0, 11800, 'INR', 'intra_state', '29MARKET0001Z5', '29QAABC1234Q1Z5', 'Karnataka', NOW(), $4)
    ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = NOW()
    `,
    [ids.invoice, ids.deliveredOrder, buyerId, { seedTag: SEED_TAG }],
  );
  await postgresPool.query("DELETE FROM tax_ledger_entries WHERE id IN ($1, $2)", [ids.taxLedgerCgst, ids.taxLedgerSgst]);
  await postgresPool.query(
    "INSERT INTO tax_ledger_entries (id, order_id, invoice_id, entry_type, tax_component, amount, reference_type, reference_id) VALUES ($1,$2,$3,'invoice','cgst',900,'invoice',$5), ($4,$2,$3,'invoice','sgst',900,'invoice',$5)",
    [ids.taxLedgerCgst, ids.deliveredOrder, ids.invoice, ids.taxLedgerSgst, ids.invoice],
  );
  await postgresPool.query(
    `
    INSERT INTO tax_credit_notes (
      id, credit_note_number, invoice_id, order_id, buyer_id, reference_type, reference_id,
      taxable_amount, tax_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
      reason, metadata
    )
    VALUES ($1, 'CN-QA-0001', $2, $3, $4, 'return', 'qa-return-refund', 10000, 1800, 900, 900, 0, 11800, 'defective', $5)
    ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = NOW()
    `,
    [ids.creditNote, ids.invoice, ids.deliveredOrder, buyerId, { seedTag: SEED_TAG }],
  );
}

async function seedShipment({ admin, buyer, seller }) {
  const shipTo = {
    name: buyer.profile?.firstName || "QA Buyer",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
    country: "India",
  };
  await postgresPool.query(
    `
    INSERT INTO shipment_manifests (id, manifest_number, courier_name, shipment_ids, status, metadata, created_by)
    VALUES ($1, 'MNF-QA-0001', 'QA Courier', $2::jsonb, 'created', $3, $4)
    ON CONFLICT (id) DO UPDATE SET shipment_ids = EXCLUDED.shipment_ids, metadata = EXCLUDED.metadata, updated_at = NOW()
    `,
    [ids.manifest, JSON.stringify([ids.shipment]), { seedTag: SEED_TAG }, oid(admin)],
  );
  await postgresPool.query(
    `
    INSERT INTO shipments (
      id, order_id, seller_id, provider, courier_name, awb_number, tracking_number, status,
      shipping_mode, cod, package_snapshot, pickup_address_snapshot, ship_to_snapshot,
      rate_snapshot, manifest_id, expected_delivery_at, idempotency_key, metadata, created_by, updated_by
    )
    VALUES ($1,$2,$3,'manual','QA Courier','AWBQA0001','TRKQA0001','delivered','standard',false,$4,$5,$6,$7,$8,NOW() + INTERVAL '2 days',$9,$10,$11,$11)
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = NOW()
    `,
    [
      ids.shipment,
      ids.deliveredOrder,
      oid(seller),
      { weight: 0.5, length: 18, width: 10, height: 6 },
      seller.sellerProfile?.pickupAddress || {},
      shipTo,
      { amount: 80, currency: "INR", provider: "manual" },
      ids.manifest,
      `${SEED_TAG}:shipment`,
      { seedTag: SEED_TAG },
      oid(admin),
    ],
  );
  await postgresPool.query("DELETE FROM shipment_tracking_events WHERE shipment_id = $1", [ids.shipment]);
  await postgresPool.query(
    `
    INSERT INTO shipment_tracking_events (id, shipment_id, order_id, status, location, note, source, raw_payload, actor_id)
    VALUES
      ($1, $3, $4, 'created', 'Bengaluru', 'QA shipment created', 'manual', $5, $6),
      ($2, $3, $4, 'delivered', 'Bengaluru', 'QA shipment delivered', 'manual', $5, $6)
    `,
    [ids.trackingCreated, ids.trackingDelivered, ids.shipment, ids.deliveredOrder, { seedTag: SEED_TAG }, oid(admin)],
  );
}

async function seedReturns({ admin, buyer, product }) {
  const buyerId = oid(buyer);
  const adminId = oid(admin);
  const productId = oid(product);
  await ReturnModel.deleteMany({ "timeline.metadata.seedTag": SEED_TAG });

  const baseItem = {
    productId,
    quantity: 1,
    unitPrice: 10000,
    lineTotal: 10000,
    taxAmount: 1800,
    refundAmount: 11800,
    condition: "opened",
    photos: [],
  };
  const timeline = (statuses) =>
    statuses.map((status) => ({
      status,
      actorId: status === "requested" ? buyerId : adminId,
      actorRole: status === "requested" ? "buyer" : "admin",
      note: `QA ${status} return step`,
      metadata: { seedTag: SEED_TAG },
      at: new Date(),
    }));
  await ReturnModel.insertMany([
    {
      orderId: ids.deliveredOrder,
      buyerId,
      reason: "defective",
      description: "QA requested return waiting for approval.",
      items: [baseItem],
      status: "requested",
      refundAmount: 11800,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, totalRefundAmount: 11800 },
      timeline: timeline(["requested"]),
    },
    {
      orderId: ids.returnApprovedOrder,
      buyerId,
      reason: "changed_mind",
      description: "QA approved return waiting for pickup decision.",
      items: [baseItem],
      status: "approved",
      refundAmount: 11800,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, totalRefundAmount: 11800 },
      approvedAt: new Date(),
      timeline: timeline(["requested", "approved"]),
    },
    {
      orderId: ids.returnPickupOrder,
      buyerId,
      reason: "defective",
      description: "QA reverse pickup scheduled with tracking.",
      items: [baseItem],
      status: "reverse_pickup_scheduled",
      refundAmount: 11800,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, totalRefundAmount: 11800 },
      approvedAt: new Date(),
      trackingNumber: "RPU-QA-0001",
      timeline: timeline(["requested", "approved", "reverse_pickup_scheduled"]),
    },
    {
      orderId: ids.returnReceivedOrder,
      buyerId,
      reason: "not_as_described",
      description: "QA return received and waiting for QC.",
      items: [baseItem],
      status: "received",
      refundAmount: 11800,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, totalRefundAmount: 11800 },
      approvedAt: new Date(),
      receivedAt: new Date(),
      trackingNumber: "RPU-QA-0002",
      timeline: timeline(["requested", "approved", "reverse_pickup_scheduled", "received"]),
    },
    {
      orderId: ids.returnQcFailedOrder,
      buyerId,
      reason: "other",
      description: "QA return failed QC due to damaged item.",
      items: [{ ...baseItem, condition: "damaged" }],
      status: "qc_failed",
      refundAmount: 0,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, totalRefundAmount: 0, qcDeduction: 11800 },
      approvedAt: new Date(),
      receivedAt: new Date(),
      qcAt: new Date(),
      notes: "Screen broken after delivery window.",
      timeline: timeline(["requested", "approved", "received", "qc_failed"]),
    },
    {
      orderId: ids.returnRefundedWalletOrder,
      buyerId,
      reason: "defective",
      description: "QA return refunded to wallet fallback.",
      items: [{ ...baseItem, condition: "sellable" }],
      status: "refunded",
      refundAmount: 11800,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, walletRefundAmount: 11800, originalPaymentRefundAmount: 0, totalRefundAmount: 11800 },
      refundReferenceId: "qa-wallet-refund-001",
      refundMethod: "wallet_fallback",
      approvedAt: new Date(),
      receivedAt: new Date(),
      qcAt: new Date(),
      refundedAt: new Date(),
      timeline: timeline(["requested", "approved", "received", "qc_passed", "refunded"]),
    },
    {
      orderId: ids.returnRefundedOriginalOrder,
      buyerId,
      reason: "not_as_described",
      description: "QA return refunded to original payment method.",
      items: [{ ...baseItem, condition: "sellable" }],
      status: "refunded",
      refundAmount: 11800,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, walletRefundAmount: 0, originalPaymentRefundAmount: 11800, totalRefundAmount: 11800 },
      refundReferenceId: "qa-original-refund-001",
      refundMethod: "razorpay_refund",
      approvedAt: new Date(),
      receivedAt: new Date(),
      qcAt: new Date(),
      refundedAt: new Date(),
      timeline: timeline(["requested", "approved", "received", "qc_passed", "refunded"]),
    },
    {
      orderId: ids.returnRejectedOrder,
      buyerId,
      reason: "changed_mind",
      description: "QA return rejected because window expired.",
      items: [baseItem],
      status: "rejected",
      refundAmount: 0,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, totalRefundAmount: 0 },
      rejectedAt: new Date(),
      notes: "Return window expired.",
      timeline: timeline(["requested", "rejected"]),
    },
    {
      orderId: ids.returnReplacedOrder,
      buyerId,
      reason: "defective",
      description: "QA return completed as replacement order.",
      items: [{ ...baseItem, condition: "sellable" }],
      status: "replaced",
      refundAmount: 0,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, totalRefundAmount: 0 },
      replacementOrderId: "ORD-QA-REPLACEMENT-0001",
      replacementShipmentId: "SHIP-QA-REPLACEMENT-0001",
      approvedAt: new Date(),
      receivedAt: new Date(),
      qcAt: new Date(),
      timeline: timeline(["requested", "approved", "received", "qc_passed", "replaced"]),
    },
    {
      orderId: ids.returnClosedOrder,
      buyerId,
      reason: "other",
      description: "QA return closed after manual support resolution.",
      items: [{ ...baseItem, condition: "opened" }],
      status: "closed",
      refundAmount: 0,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, totalRefundAmount: 0 },
      closedAt: new Date(),
      notes: "Closed by admin after manual support resolution.",
      timeline: timeline(["requested", "approved", "closed"]),
    },
    {
      orderId: ids.codOrder,
      buyerId,
      reason: "not_as_described",
      description: "QA return already passed QC and ready to refund.",
      items: [{ ...baseItem, condition: "sellable" }],
      status: "qc_passed",
      refundAmount: 11800,
      refundBreakup: { itemSubtotal: 10000, taxReversal: 1800, totalRefundAmount: 11800 },
      receivedAt: new Date(),
      qcAt: new Date(),
      timeline: [
        ...timeline(["requested", "approved", "received", "qc_passed"]),
      ],
    },
  ]);
}

async function seedInventoryFulfillment({ buyer, seller, product }) {
  const buyerId = oid(buyer);
  const sellerId = oid(seller);
  const productId = oid(product);
  const item = {
    productId,
    variantId: "",
    variantSku: "",
    variantTitle: "",
    attributes: {},
    sellerId,
    quantity: 1,
    unitPrice: 10000,
  };

  const reservationStatus = new Map([
    [ids.manualOrder, "reserved"],
    [ids.returnRefundedWalletOrder, "restocked"],
    [ids.returnRefundedOriginalOrder, "restocked"],
    [ids.returnQcFailedOrder, "committed"],
    [ids.returnReplacedOrder, "restocked"],
  ]);

  for (const orderId of qaOrderIds) {
    await InventoryReservationModel.findOneAndUpdate(
      { orderId },
      {
        $set: {
          buyerId,
          status: reservationStatus.get(orderId) || "committed",
          items: [item],
          expiresAt: null,
          metadata: { seedTag: SEED_TAG },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  const txRows = [];
  for (const orderId of qaOrderIds) {
    txRows.push(["reservation", orderId, orderId, "order", orderId, "completed"]);
    if (orderId !== ids.manualOrder) txRows.push(["sale", orderId, orderId, "order", orderId, "completed"]);
  }
  txRows.push(["damage", ids.returnQcFailedOrder, "qa-damage-qc-failed", "return", "qa-return-qc-failed", "completed"]);
  txRows.push(["return", ids.returnRefundedWalletOrder, "qa-return-wallet-restock", "return", "qa-wallet-refund-001", "completed"]);
  txRows.push(["return", ids.returnRefundedOriginalOrder, "qa-return-original-restock", "return", "qa-original-refund-001", "completed"]);
  txRows.push(["return", ids.returnReplacedOrder, "qa-return-replaced-restock", "return", "qa-replaced-001", "completed"]);

  for (const [type, orderId, referenceId, referenceType, idempotencySuffix, status] of txRows) {
    await InventoryTransactionModel.findOneAndUpdate(
      { idempotencyKey: `${SEED_TAG}:${type}:${idempotencySuffix}` },
      {
        $setOnInsert: {
          type,
          status,
          productId,
          variantId: "",
          variantSku: "",
          sellerId,
          quantity: 1,
          orderId,
          returnId: referenceType === "return" ? referenceId : "",
          shipmentId: "",
          referenceType,
          referenceId,
          idempotencyKey: `${SEED_TAG}:${type}:${idempotencySuffix}`,
          metadata: { seedTag: SEED_TAG },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}

async function seedTransactionContent({ buyer }) {
  const buyerId = oid(buyer);
  const userLabel = `QA Buyer (${buyer.email})`;
  const rows = [
    ["qa-tx-wallet-opening", "TN-QA-OPENING", "credit", 5000, "Opening QA wallet balance", "Transaction Completed"],
    ["qa-tx-wallet-hold", "TN-QA-HOLD", "debit", 1500, "Wallet amount held for pending order", "Transaction Held"],
    ["qa-tx-wallet-capture", "TN-QA-CAPTURE", "debit", 2000, "Wallet amount captured for delivered order", "Transaction Completed"],
    ["qa-tx-refund-wallet", "TN-QA-REF-WALLET", "credit", 11800, "Return refund credited to wallet fallback", "Refund Completed"],
    ["qa-tx-refund-original", "TN-QA-REF-ORIGINAL", "credit", 11800, "Original payment refund recorded", "Refund Completed"],
    ["qa-tx-release", "TN-QA-RELEASE", "credit", 1500, "Held wallet balance released", "Transaction Released"],
    ["qa-tx-cod-payment", "TN-QA-COD", "debit", 11800, "COD payment reconciled", "Payment Captured"],
    ["qa-tx-manual-bank", "TN-QA-BANK", "debit", 11800, "Manual bank transfer reconciled", "Payment Captured"],
  ];

  for (const [slug, transactionId, type, amount, description, status] of rows) {
    await ContentPageModel.findOneAndUpdate(
      { slug },
      {
        $set: {
          title: "QA Buyer",
          pageType: "user_transaction",
          status: "published",
          published: true,
          publishedAt: new Date(),
          language: "en",
          metadata: {
            seedTag: SEED_TAG,
            transactionId,
            userId: buyerId,
            userLabel,
            type,
            amount,
            description,
            status,
          },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}

async function main() {
  await connectMongo();
  await requireTables();
  if (RESET) await resetQaData();

  const docs = await seedMongo();
  await seedOrders(docs);
  await seedPaymentsAndTax(docs);
  await seedShipment(docs);
  await seedReturns(docs);
  await seedInventoryFulfillment(docs);
  await seedTransactionContent(docs);

  log("QA commerce seed complete");
  log(`Admin: qa.admin@example.com / ${PASSWORD}`);
  log(`Buyer: qa.buyer@example.com / ${PASSWORD}`);
  log(`Seller: qa.seller@example.com / ${PASSWORD}`);
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
