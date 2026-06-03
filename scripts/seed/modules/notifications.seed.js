'use strict';

/**
 * Notifications Seed Module
 * Seeds notification templates + sample notification records
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const TEMPLATES = [
  { template: 'order_confirmed',    subject: 'Your order has been confirmed!',           channel: 'email', type: 'transactional' },
  { template: 'order_packed',       subject: 'Your order is being packed',                channel: 'email', type: 'transactional' },
  { template: 'order_shipped',      subject: 'Your order has been shipped!',              channel: 'email', type: 'transactional' },
  { template: 'order_out_for_delivery', subject: 'Your order is out for delivery',        channel: 'push',  type: 'transactional' },
  { template: 'order_delivered',    subject: 'Your order has been delivered!',            channel: 'email', type: 'transactional' },
  { template: 'order_cancelled',    subject: 'Your order has been cancelled',             channel: 'email', type: 'transactional' },
  { template: 'refund_initiated',   subject: 'Your refund has been initiated',            channel: 'email', type: 'transactional' },
  { template: 'refund_completed',   subject: 'Refund processed successfully!',            channel: 'email', type: 'transactional' },
  { template: 'payment_success',    subject: 'Payment successful — Order confirmed',      channel: 'email', type: 'transactional' },
  { template: 'payment_failed',     subject: 'Payment failed — Please retry',             channel: 'email', type: 'transactional' },
  { template: 'product_approved',   subject: 'Your product has been approved!',           channel: 'email', type: 'seller' },
  { template: 'product_rejected',   subject: 'Product review update — Action required',  channel: 'email', type: 'seller' },
  { template: 'low_stock_alert',    subject: 'Low stock alert for your product',          channel: 'email', type: 'seller' },
  { template: 'payout_released',    subject: 'Payment has been released to your account',channel: 'email', type: 'seller' },
  { template: 'new_order',          subject: 'New order received!',                       channel: 'email', type: 'seller' },
  { template: 'welcome_user',       subject: 'Welcome to ShopIndia — Your account is ready!', channel: 'email', type: 'marketing' },
  { template: 'price_drop',         subject: 'Price drop alert — Items in your wishlist!', channel: 'push', type: 'marketing' },
  { template: 'flash_sale',         subject: '⚡ Flash Sale starts NOW — Up to 80% off!', channel: 'push', type: 'marketing' },
  { template: 'cart_reminder',      subject: 'You left something in your cart',           channel: 'email', type: 'marketing' },
  { template: 'review_request',     subject: 'How was your order? Leave a review',        channel: 'email', type: 'transactional' },
  { template: 'otp_verification',   subject: 'Your OTP for ShopIndia login',              channel: 'sms',   type: 'transactional' },
  { template: 'loyalty_points',     subject: 'You earned loyalty points!',                channel: 'push',  type: 'marketing' },
];

const CHANNELS = ['in_app','email','sms','push'];
const STATUSES = ['sent','sent','sent','queued','failed'];

class NotificationsSeed {
  constructor() {
    this.logger = new SeedLogger('Notifications');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info(`🔔 Seeding Notifications — ${TEMPLATES.length} templates + 50,000 records`);

    await conn.collection('notificationtemplates').deleteMany({});
    await conn.collection('notifications').deleteMany({});
    await conn.collection('notificationqueues').deleteMany({});

    // Templates
    const templateDocs = TEMPLATES.map(t => ({
      _id: new mongoose.Types.ObjectId(),
      ...t,
      bodyTemplate: `<p>Dear {{name}},</p><p>{{message}}</p><p>Thank you,<br/>ShopIndia Team</p>`,
      smsTemplate: '{{message}} - ShopIndia',
      pushTemplate: { title: t.subject, body: '{{message}}' },
      active: true,
      createdAt: new Date(),
    }));
    await conn.collection('notificationtemplates').insertMany(templateDocs);
    this.logger.recordBatch(templateDocs.length);

    // Load users for notification records
    const users = await conn.collection('users').find({}, { projection: { _id: 1, role: 1 } }).limit(3000).toArray();
    if (!users.length) {
      this.logger.warn('No users found for notifications');
      return { created: templateDocs.length };
    }

    const now = new Date();
    const notifDocs = [];

    for (let i = 0; i < 50000; i++) {
      const user = users[i % users.length];
      const template = rand(TEMPLATES);
      const channel = rand(CHANNELS);
      const status = rand(STATUSES);
      const daysAgo = randNum(0, 365);

      notifDocs.push({
        _id: new mongoose.Types.ObjectId(),
        userId: user._id.toString(),
        channel,
        template: template.template,
        subject: template.subject,
        payload: {
          name: 'Customer',
          orderId: `ORD-${String(randNum(1, 50000)).padStart(7, '0')}`,
          amount: randNum(100, 50000),
          message: template.subject,
        },
        status,
        attempts: status === 'failed' ? randNum(1, 3) : 1,
        lastAttemptAt: new Date(now.getTime() - randNum(0, 3600) * 1000),
        sentAt: status === 'sent' ? new Date(now.getTime() - daysAgo * 86400000) : null,
        idempotencyKey: `${user._id}-${template.template}-${i}`,
        metadata: { source: 'seed', type: template.type },
        createdAt: new Date(now.getTime() - daysAgo * 86400000),
        updatedAt: new Date(),
      });
    }

    const BATCH = 1000;
    for (let i = 0; i < notifDocs.length; i += BATCH) {
      await conn.collection('notifications').insertMany(notifDocs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, notifDocs.length - i));
    }

    this.logger.printStats();
    return { created: templateDocs.length + notifDocs.length, templates: templateDocs.length, notifications: notifDocs.length };
  }
}

module.exports = NotificationsSeed;
