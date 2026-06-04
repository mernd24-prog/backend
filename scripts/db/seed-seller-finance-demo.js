#!/usr/bin/env node
"use strict";

const { v4: uuidv4 } = require("uuid");
const { knex } = require("../../src/infrastructure/postgres/postgres-client");
const { CommissionService } = require("../../src/modules/seller/services/commission.service");

const DELIVERED_STATUSES = ["delivered", "fulfilled"];

async function getTableColumns(tableName) {
  const rows = await knex("information_schema.columns")
    .where({ table_schema: "public", table_name: tableName })
    .select("column_name");
  return new Set(rows.map((row) => row.column_name));
}

function pickColumns(payload, columns) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => columns.has(key)),
  );
}

async function assertFinanceTables() {
  const rows = await knex("information_schema.tables")
    .where({ table_schema: "public" })
    .whereIn("table_name", ["seller_commissions", "seller_payouts", "seller_settlements"])
    .select("table_name");
  const found = new Set(rows.map((row) => row.table_name));
  const missing = ["seller_commissions", "seller_payouts", "seller_settlements"].filter((table) => !found.has(table));
  if (missing.length) {
    throw new Error(`Missing finance tables: ${missing.join(", ")}. Run npm run db:migrate first.`);
  }
}

async function findOrdersForFinance(limit = 20) {
  const query = () => knex("orders as o")
    .whereExists(function existsOrderItem() {
      this.select(knex.raw("1"))
        .from("order_items as oi")
        .whereRaw("oi.order_id = o.id")
        .whereNotNull("oi.seller_id");
    })
    .select("o.id", "o.status", "o.buyer_id", "o.total_amount", "o.created_at")
    .orderBy("o.created_at", "desc")
    .limit(limit);

  let orders = await query().whereIn("o.status", DELIVERED_STATUSES);
  if (orders.length) return orders;

  const candidates = await query();
  if (!candidates.length) {
    return [await createDemoOrderWithItem()];
  }

  const ids = candidates.map((order) => order.id);
  await knex("orders")
    .whereIn("id", ids)
    .update({
      status: "delivered",
      payment_status: "captured",
      delivery_status: "delivered",
      updated_at: knex.fn.now(),
    });

  return candidates.map((order) => ({ ...order, status: "delivered" }));
}

async function createDemoOrderWithItem() {
  const orderColumns = await getTableColumns("orders");
  const itemColumns = await getTableColumns("order_items");
  const orderId = uuidv4();
  const itemId = uuidv4();
  const sellerId = "seed-seller-finance-demo";
  const buyerId = "seed-buyer-finance-demo";
  const subtotal = 1999;
  const productGst = 0;
  const platformCommission = 239.88;
  const orderPayload = pickColumns({
    id: orderId,
    order_number: `ORD-SEED-${Date.now()}`,
    buyer_id: buyerId,
    status: "delivered",
    payment_status: "captured",
    delivery_status: "delivered",
    currency: "INR",
    subtotal_amount: subtotal,
    discount_amount: 0,
    tax_amount: productGst,
    total_amount: subtotal + productGst,
    shipping_address: JSON.stringify({
      name: "Seed Buyer",
      city: "Demo City",
      state: "Demo State",
      postalCode: "000000",
      country: "IN",
    }),
    coupon_code: null,
    wallet_discount_amount: 0,
    payable_amount: subtotal + productGst,
    tax_breakup: JSON.stringify({ totalTaxAmount: productGst, taxIncludedAmount: productGst }),
    platform_fee_amount: platformCommission,
    platform_fee_breakup: JSON.stringify([{ sellerId, amount: platformCommission }]),
    payment_provider: "manual_seed",
    cod_charge_amount: 0,
    metadata: JSON.stringify({ source: "seller_finance_demo_seed" }),
    created_by: buyerId,
    updated_by: "seed-seller-finance-demo",
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  }, orderColumns);
  const itemPayload = pickColumns({
    id: itemId,
    order_id: orderId,
    product_id: "seed-product-finance-demo",
    product_title: "Seed Finance Demo Product",
    product_slug: "seed-finance-demo-product",
    product_sku: "SEED-FINANCE-DEMO",
    product_image: null,
    brand: "Seed Brand",
    category: "Seed Category",
    hsn_code: "0000",
    gst_rate: 0,
    variant_id: null,
    variant_sku: null,
    variant_title: null,
    attributes: JSON.stringify({}),
    seller_id: sellerId,
    seller_snapshot: JSON.stringify({ sellerId, displayName: "Seed Seller Finance Demo" }),
    quantity: 1,
    unit_price: subtotal,
    discount_amount: 0,
    tax_amount: productGst,
    tax_breakup: JSON.stringify({}),
    platform_fee_amount: platformCommission,
    pricing_snapshot: JSON.stringify({
      commissionPercent: 12,
      commissionFee: platformCommission,
    }),
    product_snapshot: JSON.stringify({ title: "Seed Finance Demo Product" }),
    line_total: subtotal,
    created_at: knex.fn.now(),
  }, itemColumns);

  await knex.transaction(async (trx) => {
    await trx("orders").insert(orderPayload);
    await trx("order_items").insert(itemPayload);
  });

  return {
    id: orderId,
    status: "delivered",
    buyer_id: buyerId,
    total_amount: subtotal + productGst,
    created_at: new Date(),
  };
}

async function seedCommissions(orders) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const order of orders) {
    const result = await CommissionService.calculateCommission(order.id, {
      sourceStatus: order.status,
      actor: { userId: "seed-seller-finance-demo", role: "system" },
    });
    created += Number(result.created || 0);
    updated += Number(result.updated || 0);
    skipped += Number(result.skipped || 0);
  }
  return { created, updated, skipped };
}

async function seedPayouts() {
  const sellers = await knex("seller_commissions")
    .distinct("seller_id")
    .where("status", "pending")
    .whereNull("payout_id")
    .orderBy("seller_id", "asc");

  const processed = [];
  for (const [index, row] of sellers.entries()) {
    if (index % 2 !== 0) continue;
    try {
      const payout = await CommissionService.processBatchPayouts(row.seller_id, {
        source: "seller_finance_demo_seed",
        paymentReference: `seed_payout_${Date.now()}_${index}`,
        paymentMethod: "manual_seed",
        actor: { userId: "seed-seller-finance-demo", role: "system" },
      });
      processed.push(payout.id || payout.payout_id || payout);
    } catch (error) {
      if (!/No commissions to payout|Invalid payout amount/.test(error.message)) {
        throw error;
      }
    }
  }
  return processed;
}

async function ensureWallet(userId) {
  const [wallet] = await knex("wallets")
    .insert({
      id: uuidv4(),
      user_id: userId,
      available_balance: 0,
      locked_balance: 0,
    })
    .onConflict("user_id")
    .merge({ user_id: userId })
    .returning("*");
  return wallet;
}

async function seedRefundWalletTransactions(orders) {
  let inserted = 0;
  for (const order of orders.slice(0, 5)) {
    if (!order.buyer_id) continue;
    const referenceId = `seed_refund_${order.id}`;
    const existing = await knex("wallet_transactions")
      .where({ reference_type: "return_refund", reference_id: referenceId })
      .first();
    if (existing) continue;

    const amount = Math.max(1, Math.min(Number(order.total_amount || 0) * 0.1, 500));
    await ensureWallet(order.buyer_id);
    await knex.transaction(async (trx) => {
      await trx("wallets").where("user_id", order.buyer_id).increment("available_balance", amount);
      await trx("wallet_transactions").insert({
        id: uuidv4(),
        user_id: order.buyer_id,
        type: "credit",
        status: "completed",
        amount: Number(amount.toFixed(2)),
        reference_type: "return_refund",
        reference_id: referenceId,
        metadata: JSON.stringify({
          orderId: order.id,
          reason: "seed_return_refund",
          method: "wallet",
        }),
      });
    });
    inserted += 1;
  }
  return inserted;
}

async function main() {
  await assertFinanceTables();
  const orders = await findOrdersForFinance();
  if (!orders.length) {
    process.stdout.write("No orders with order_items were found. Seed orders/products first, then rerun this script.\n");
    return;
  }

  const commissions = await seedCommissions(orders);
  const payouts = await seedPayouts();
  const refundTransactions = await seedRefundWalletTransactions(orders);

  process.stdout.write(JSON.stringify({
    ordersUsed: orders.length,
    commissions,
    payoutsProcessed: payouts.length,
    refundTransactionsInserted: refundTransactions,
  }, null, 2));
  process.stdout.write("\nSeller finance demo seed completed\n");
}

main()
  .catch((error) => {
    process.stderr.write(`Seller finance seed failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await knex.destroy();
  });
