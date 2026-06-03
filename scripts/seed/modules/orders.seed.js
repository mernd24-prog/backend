'use strict';

/**
 * Orders Seed Module
 * Generates 50,000 orders across PostgreSQL (orders + order_items tables)
 */

const { v4: uuidv4 } = require('uuid');
const SeedLogger = require('../utils/seed-logger');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max, dp = 2) => parseFloat((Math.random() * (max - min) + min).toFixed(dp));

const ORDER_STATUSES = ['pending','confirmed','packed','shipped','out_for_delivery','delivered','cancelled','returned','refunded'];
const STATUS_WEIGHTS = [0.05, 0.08, 0.05, 0.10, 0.07, 0.45, 0.10, 0.05, 0.05];
const PAYMENT_METHODS = ['UPI','CREDIT_CARD','DEBIT_CARD','NET_BANKING','COD','WALLET','EMI'];
const PAYMENT_STATUSES = ['paid','paid','paid','paid','failed','refunded','paid','pending'];
const CURRENCIES = ['INR'];

function pickWeighted(items, weights) {
  const r = Math.random();
  let cum = 0;
  for (let i = 0; i < items.length; i++) {
    cum += weights[i];
    if (r < cum) return items[i];
  }
  return items[items.length - 1];
}

const CITIES_STATES = [
  ['Mumbai','MH','400001'], ['Delhi','DL','110001'], ['Bengaluru','KA','560001'],
  ['Chennai','TN','600001'], ['Hyderabad','TG','500001'], ['Pune','MH','411001'],
  ['Ahmedabad','GJ','380001'], ['Kolkata','WB','700001'], ['Jaipur','RJ','302001'],
  ['Surat','GJ','395001'], ['Lucknow','UP','226001'], ['Nagpur','MH','440001'],
  ['Bhopal','MP','462001'], ['Indore','MP','452001'], ['Coimbatore','TN','641001'],
];
const FIRSTNAMES = ['Rahul','Priya','Amit','Divya','Vikram','Sneha','Arjun','Pooja','Harsh','Neha'];
const LASTNAMES = ['Kumar','Sharma','Patel','Singh','Gupta','Verma','Mehta','Joshi','Iyer','Nair'];

class OrdersSeed {
  constructor() {
    this.logger = new SeedLogger('Orders');
    this.sequelize = require('../../../src/infrastructure/sequelize/sequelize-client').sequelize;
  }

  async execute() {
    const { DataTypes, QueryInterface } = require('sequelize');
    this.logger.info('📋 Seeding Orders — 50,000 orders + items');

    // Truncate existing
    try {
      await this.sequelize.query('TRUNCATE TABLE order_items, order_status_history, orders CASCADE;');
    } catch (e) {
      this.logger.warn(`Truncate warning: ${e.message}`);
    }

    // We need product/seller IDs — fetch from MongoDB
    const mongoose = require('mongoose');
    const conn = mongoose.connection;
    const productDocs = await conn.collection('products')
      .find({ status: 'ACTIVE' }, { projection: { _id: 1, sellerId: 1, salePrice: 1, gstRate: 1, hsnCode: 1, title: 1, sku: 1 } })
      .limit(5000).toArray();
    const customerDocs = await conn.collection('users')
      .find({ role: 'BUYER' }, { projection: { _id: 1 } })
      .limit(5000).toArray();

    if (!productDocs.length || !customerDocs.length) {
      this.logger.warn('Products or customers not found — skipping orders');
      return { created: 0 };
    }

    const now = new Date();
    const totalOrders = 50000;
    const BATCH_SIZE = 1000;
    let created = 0;

    for (let batch = 0; batch < totalOrders; batch += BATCH_SIZE) {
      const orderValues = [];
      const itemValues = [];
      const historyValues = [];

      const batchCount = Math.min(BATCH_SIZE, totalOrders - batch);

      for (let j = 0; j < batchCount; j++) {
        const orderId = uuidv4();
        const orderNum = `ORD-${String(batch + j + 1).padStart(7, '0')}`;
        const customer = rand(customerDocs);
        const status = pickWeighted(ORDER_STATUSES, STATUS_WEIGHTS);
        const paymentMethod = rand(PAYMENT_METHODS);
        const paymentStatus = status === 'cancelled' ? 'refunded' : status === 'refunded' ? 'refunded' : 'paid';
        const [city, state, pincode] = rand(CITIES_STATES);
        const firstName = rand(FIRSTNAMES);
        const lastName = rand(LASTNAMES);
        const daysAgo = randNum(1, 730);
        const createdAt = new Date(now.getTime() - daysAgo * 86400000);

        // Items per order
        const itemCount = randNum(1, 5);
        let subtotal = 0;
        let taxTotal = 0;

        for (let k = 0; k < itemCount; k++) {
          const product = rand(productDocs);
          const qty = randNum(1, 3);
          const unitPrice = product.salePrice;
          const taxRate = product.gstRate || 18;
          const taxAmt = parseFloat((unitPrice * qty * taxRate / (100 + taxRate)).toFixed(2));
          const lineTotal = parseFloat((unitPrice * qty).toFixed(2));
          subtotal += lineTotal;
          taxTotal += taxAmt;

          itemValues.push(`(
            '${uuidv4()}','${orderId}','${product._id}',NULL,
            '${product.sku}','${(product.title || '').replace(/'/g, "''")}',
            '${product.sellerId}',${qty},${unitPrice},${lineTotal},0,${taxAmt},
            '{"igst":${taxRate},"cgst":${taxRate/2},"sgst":${taxRate/2}}',
            '${product.hsnCode || ''}',NULL,NULL,
            NOW(),NOW()
          )`);
        }

        const shippingCharge = subtotal >= 499 ? 0 : 49;
        const discountAmt = parseFloat((subtotal * randFloat(0, 0.15)).toFixed(2));
        const total = parseFloat((subtotal + shippingCharge - discountAmt).toFixed(2));

        const addr = JSON.stringify({
          name: `${firstName} ${lastName}`,
          phone: `+91${randNum(7000000000, 9999999999)}`,
          line1: `${randNum(1, 999)}, Main Road`,
          city, state, country: 'India', postalCode: pincode
        }).replace(/'/g, "''");

        orderValues.push(`(
          '${orderId}','${orderNum}','${customer._id}','${status}',
          '${paymentStatus}','${paymentMethod}',
          ${parseFloat(subtotal.toFixed(2))},${parseFloat(discountAmt.toFixed(2))},
          ${parseFloat(taxTotal.toFixed(2))},${parseFloat(total.toFixed(2))},
          ${shippingCharge},'INR',
          '${addr}'::jsonb,
          '{"notes":null,"source":"web","utm_source":"organic"}'::jsonb,
          '${createdAt.toISOString()}','${createdAt.toISOString()}'
        )`);

        historyValues.push(`(
          '${uuidv4()}','${orderId}',NULL,'${status}',
          '${customer._id}','BUYER','${status.toUpperCase()} at order placement',NULL,
          '{}'::jsonb,'${createdAt.toISOString()}','${createdAt.toISOString()}'
        )`);
      }

      // Bulk insert orders
      try {
        await this.sequelize.query(`
          INSERT INTO orders (
            id, order_number, buyer_id, status, payment_status, payment_method,
            subtotal_amount, discount_amount, tax_amount, total_amount,
            shipping_amount, currency, shipping_address, metadata,
            created_at, updated_at
          ) VALUES ${orderValues.join(',')}
          ON CONFLICT (id) DO NOTHING
        `);
      } catch (e) {
        this.logger.warn(`Order batch insert error: ${e.message.substring(0, 200)}`);
      }

      // Bulk insert order_items
      try {
        await this.sequelize.query(`
          INSERT INTO order_items (
            id, order_id, product_id, variant_id, variant_sku, variant_title,
            seller_id, quantity, unit_price, line_total,
            discount_amount, tax_amount, tax_breakup, hsn_code, fulfillment_status,
            shipment_id, created_at, updated_at
          ) VALUES ${itemValues.join(',')}
          ON CONFLICT DO NOTHING
        `);
      } catch (e) {
        this.logger.warn(`Item batch insert error: ${e.message.substring(0, 200)}`);
      }

      // Order status history
      try {
        await this.sequelize.query(`
          INSERT INTO order_status_history (
            id, order_id, from_status, to_status,
            actor_id, actor_role, reason, note, metadata,
            created_at, updated_at
          ) VALUES ${historyValues.join(',')}
          ON CONFLICT DO NOTHING
        `);
      } catch (e) {
        // Status history table may not exist — ignore
      }

      created += batchCount;
      this.logger.recordBatch(batchCount);
    }

    this.logger.printStats();
    return { created };
  }
}

module.exports = OrdersSeed;
