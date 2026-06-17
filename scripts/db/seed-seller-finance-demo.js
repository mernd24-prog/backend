#!/usr/bin/env node
'use strict';

const { v4: uuidv4 } = require('uuid');
const { knex } = require('../../src/infrastructure/postgres/postgres-client');
const { CommissionService } = require('../../src/modules/seller/services/commission.service');

const DELIVERED_STATUSES = ['delivered', 'fulfilled'];

async function main() {
  await assertTables(['orders', 'order_items', 'seller_commissions', 'seller_payouts', 'wallets', 'wallet_transactions']);
  const orders = await findFinanceOrders();
  const commissions = await seedCommissions(orders);
  const payouts = await seedPayouts();
  const refundWalletRows = await seedRefundWalletTransactions(orders);

  process.stdout.write(JSON.stringify({
    ordersUsed: orders.length,
    commissions,
    payoutsProcessed: payouts.length,
    refundWalletRows,
  }, null, 2));
  process.stdout.write('\nSeller finance demo seed completed.\n');
}

async function assertTables(tableNames) {
  const rows = await knex('information_schema.tables')
    .where({ table_schema: 'public' })
    .whereIn('table_name', tableNames)
    .select('table_name');
  const found = new Set(rows.map((row) => row.table_name));
  const missing = tableNames.filter((tableName) => !found.has(tableName));
  if (missing.length) {
    throw new Error(`Missing tables: ${missing.join(', ')}. Run npm run db:migrate first.`);
  }
}

async function findFinanceOrders() {
  const rows = await knex('orders as o')
    .whereIn('o.status', DELIVERED_STATUSES)
    .whereExists(function existsItems() {
      this.select(knex.raw('1'))
        .from('order_items as oi')
        .whereRaw('oi.order_id = o.id')
        .whereNotNull('oi.seller_id');
    })
    .select('o.id', 'o.status', 'o.buyer_id', 'o.total_amount', 'o.created_at')
    .orderBy('o.created_at', 'desc')
    .limit(20);

  if (rows.length) return rows;
  return [await createFinanceDemoOrder()];
}

async function createFinanceDemoOrder() {
  const orderId = uuidv4();
  const sellerId = 'seed-seller-finance-demo';
  const buyerId = 'seed-buyer-finance-demo';
  const subtotal = 1999;
  const platformFee = 239.88;

  await knex.transaction(async (trx) => {
    await trx('orders').insert({
      id: orderId,
      order_number: `ORD-SEED-${Date.now()}`,
      buyer_id: buyerId,
      status: 'delivered',
      payment_status: 'captured',
      delivery_status: 'delivered',
      currency: 'INR',
      subtotal_amount: subtotal,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: subtotal,
      payable_amount: subtotal,
      shipping_address: {
        name: 'Seed Buyer',
        city: 'Demo City',
        state: 'Demo State',
        country: 'India',
        postalCode: '000000',
      },
      platform_fee_amount: platformFee,
      platform_fee_breakup: [{ sellerId, amount: platformFee }],
      metadata: { source: 'seller_finance_demo_seed' },
      created_by: buyerId,
      updated_by: 'seed-seller-finance-demo',
    });

    await trx('order_items').insert({
      id: uuidv4(),
      order_id: orderId,
      product_id: 'seed-product-finance-demo',
      product_title: 'Seed Finance Demo Product',
      product_slug: 'seed-finance-demo-product',
      product_sku: 'SEED-FINANCE-DEMO',
      brand: 'Seed Brand',
      category: 'Seed Category',
      hsn_code: '0000',
      gst_rate: 0,
      seller_id: sellerId,
      seller_snapshot: { sellerId, displayName: 'Seed Seller Finance Demo' },
      quantity: 1,
      unit_price: subtotal,
      discount_amount: 0,
      tax_amount: 0,
      tax_breakup: {},
      platform_fee_amount: platformFee,
      pricing_snapshot: {
        commissionPercent: 12,
        commissionFee: platformFee,
      },
      product_snapshot: { title: 'Seed Finance Demo Product' },
      line_total: subtotal,
    });
  });

  return {
    id: orderId,
    status: 'delivered',
    buyer_id: buyerId,
    total_amount: subtotal,
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
      actor: { userId: 'seed-seller-finance-demo', role: 'system' },
    });
    created += Number(result.created || 0);
    updated += Number(result.updated || 0);
    skipped += Number(result.skipped || 0);
  }

  return { created, updated, skipped };
}

async function seedPayouts() {
  const sellers = await knex('seller_commissions')
    .distinct('seller_id')
    .where('status', 'pending')
    .whereNull('payout_id')
    .orderBy('seller_id', 'asc');

  const processed = [];
  for (const [index, row] of sellers.entries()) {
    if (index % 2 !== 0) continue;
    try {
      const payout = await CommissionService.processBatchPayouts(row.seller_id, {
        source: 'seller_finance_demo_seed',
        paymentReference: `seed_payout_${Date.now()}_${index}`,
        paymentMethod: 'manual_seed',
        actor: { userId: 'seed-seller-finance-demo', role: 'system' },
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

async function seedRefundWalletTransactions(orders) {
  let inserted = 0;
  for (const order of orders.slice(0, 5)) {
    if (!order.buyer_id) continue;
    const referenceId = `seed_refund_${order.id}`;
    const existing = await knex('wallet_transactions')
      .where({ reference_type: 'return_refund', reference_id: referenceId })
      .first();
    if (existing) continue;

    const amount = Number(Math.max(1, Math.min(Number(order.total_amount || 0) * 0.1, 500)).toFixed(2));
    await knex.transaction(async (trx) => {
      await trx('wallets')
        .insert({
          id: uuidv4(),
          user_id: order.buyer_id,
          available_balance: amount,
          locked_balance: 0,
        })
        .onConflict('user_id')
        .merge({
          available_balance: knex.raw('wallets.available_balance + EXCLUDED.available_balance'),
          updated_at: knex.fn.now(),
        });

      await trx('wallet_transactions').insert({
        id: uuidv4(),
        user_id: order.buyer_id,
        type: 'credit',
        status: 'completed',
        amount,
        reference_type: 'return_refund',
        reference_id: referenceId,
        metadata: {
          orderId: order.id,
          reason: 'seed_return_refund',
          method: 'wallet',
        },
      });
    });
    inserted += 1;
  }
  return inserted;
}

main()
  .catch((error) => {
    process.stderr.write(`Seller finance seed failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await knex.destroy();
  });
