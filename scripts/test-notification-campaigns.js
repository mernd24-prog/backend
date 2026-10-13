const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

(async () => {
  const adds = [];
  const updates = [];
  let backlog = 2000;
  let rows = [];
  let recipientQueryRan = false;
  const campaign = { _id: 'campaign', audience: 'all', channel: 'in_app', upperBound: 'upper', data: {} };
  const queue = { getJobCounts: async () => ({ waiting: backlog }), add: async (...args) => adds.push(args), addBulk: async jobs => adds.push(jobs) };
  const chain = result => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => result });
  const Campaign = { findById: () => chain(campaign), updateOne: async (...args) => updates.push(args) };
  const Delivery = { find: () => chain(rows), bulkWrite: async () => {}, updateOne: async (...args) => updates.push(args) };
  const UserModel = { find: () => { recipientQueryRan = true; return chain(rows); }, db: { base: { Types: { ObjectId: { isValid: () => true } } } } };
  const modules = {
    '../../../shared/queues/queue-factory': { createQueue: () => queue },
    '../models/notification-campaign.model': { NotificationCampaignModel: Campaign, NotificationDeliveryModel: Delivery },
    '../../user/models/user.model': { UserModel },
    '../../../shared/constants/roles': { ROLES: {} },
    '../../../shared/errors/app-error': { AppError: Error },
    '../../../infrastructure/mail/mailer': { sendMail: async () => {} },
    './email-template-catalog': { renderEmailTemplate: () => ({}) },
    '../../../config/env': { env: { smtp: { mode: 'live' } } },
  };
  const context = { module: { exports: {} }, require: name => { assert.ok(modules[name], name); return modules[name]; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/modules/notification/services/notification-campaign.service.js'), 'utf8'), context);
  const service = context.module.exports.campaignService;
  await service.expand({ campaignId: 'campaign' });
  assert.equal(recipientQueryRan, false, 'backpressure avoids recipient reads');
  assert.equal(adds[0][2].delay, 5000);
  backlog = 0;
  rows = [{ _id: 'user1', userId: 'user1', status: 'queued', email: 'a@example.com' }];
  await service.expand({ campaignId: 'campaign' });
  const jobs = adds.find(entry => entry[0]?.opts);
  assert.equal(jobs[0].opts.jobId, 'delivery-user1');
  assert.equal(jobs[0].opts.attempts, 3);
  assert.ok(updates.some(([filter, update]) => update.cursor === 'user1'));
  assert.equal(context.module.exports.BATCH_SIZE, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(context.module.exports.audienceFilter({ audience: 'specific_users', userIds: [] })))._id.$in, []);
  await assert.rejects(service.create({ channel: 'push' }), /supports in-app and email/);
  // One invalid recipient finishes without throwing or preventing other queued jobs.
  campaign.channel = 'email';
  Delivery.findById = () => chain({ _id: 'bad', campaignId: 'campaign', userId: 'user1', email: '' });
  await service.deliver({ deliveryId: 'bad' });
  assert.ok(updates.some(([filter, update]) => filter._id === 'bad' && update.status === 'failed'));
  Delivery.findById = () => chain({ _id: 'uncertain', campaignId: 'campaign', sendStartedAt: new Date() });
  await service.deliver({ deliveryId: 'uncertain' });
  assert.ok(updates.some(([filter, update]) => filter._id === 'uncertain' && update.status === 'delivery_unknown'));
  // Exercise the actual expansion method for 10,000 synthetic recipients in bounded batches.
  campaign.channel = 'in_app';
  adds.length = 0;
  let processed = 0;
  for (let batch = 0; batch < 50; batch++) {
    rows = Array.from({ length: 200 }, (_, offset) => ({ _id: `u${batch * 200 + offset}`, userId: `u${batch * 200 + offset}`, status: 'queued' }));
    await service.expand({ campaignId: 'campaign' });
    const queued = adds.filter(entry => entry[0]?.opts).pop();
    assert.equal(queued.length, 200);
    processed += queued.length;
  }
  assert.equal(processed, 10000);
  console.log('Notification campaign tests passed: backpressure, bounded batching, retry IDs, audience, invalid recipient isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
