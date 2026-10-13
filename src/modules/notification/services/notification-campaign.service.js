const { createQueue } = require('../../../shared/queues/queue-factory');
const { NotificationCampaignModel: Campaign, NotificationDeliveryModel: Delivery } = require('../models/notification-campaign.model');
const { UserModel } = require('../../user/models/user.model');
const { ROLES } = require('../../../shared/constants/roles');
const { AppError } = require('../../../shared/errors/app-error');
const { sendMail } = require('../../../infrastructure/mail/mailer');
const { renderEmailTemplate } = require('./email-template-catalog');
const { env } = require('../../../config/env');

const campaignQueue = createQueue('notification-campaigns');
const bulkQueue = createQueue('notification-bulk-delivery');
const BATCH_SIZE = 200;
const HIGH_WATER_MARK = 2000;
const jobId = (delivery) => `delivery-${delivery._id}`;

function audienceFilter(campaign) {
  const filter = { accountStatus: { $ne: 'deleted' } };
  if (campaign.audience === 'specific_users') {
    filter._id = { $in: (campaign.userIds || []).filter(id => UserModel.db.base.Types.ObjectId.isValid(id)) };
  } else if (campaign.audience === 'buyers') filter.role = ROLES.BUYER;
  else if (campaign.audience === 'sellers') filter.role = { $in: [ROLES.SELLER, ROLES.SELLER_ADMIN, ROLES.SELLER_SUB_ADMIN] };
  else if (campaign.audience === 'admins') filter.role = { $in: [ROLES.ADMIN, ROLES.SUB_ADMIN, ROLES.SUPER_ADMIN, 'admin', 'sub-admin', 'super-admin'] };
  return filter;
}

async function enqueueDeliveries(rows) {
  if (!rows.length) return;
  await bulkQueue.addBulk(rows.map(row => ({
    name: 'deliver', data: { deliveryId: String(row._id) },
    opts: { jobId: jobId(row), attempts: 3, backoff: { type: 'exponential', delay: 30000 } },
  })));
}

const campaignService = {
  async create(payload) {
    if (!['in_app', 'email'].includes(payload.channel || 'in_app')) {
      throw new AppError('Bulk sending currently supports in-app and email channels only', 400);
    }
    if ((payload.channel || 'in_app') === 'email' && env.smtp.mode !== 'live') {
      throw new AppError('Live email delivery must be configured before starting an email campaign', 503);
    }
    const upper = await UserModel.findOne(audienceFilter(payload)).sort({ _id: -1 }).select('_id').lean();
    const campaign = await Campaign.create({ ...payload, channel: payload.channel || 'in_app', upperBound: upper ? String(upper._id) : null });
    try {
      await campaignQueue.add('expand', { campaignId: String(campaign._id) }, { jobId: `campaign-${campaign._id}` });
    } catch (error) {
      await Campaign.updateOne({ _id: campaign._id }, { status: 'failed', lastError: error.message });
      throw error;
    }
    return { campaignId: String(campaign._id), status: 'queued', channel: campaign.channel, audience: campaign.audience };
  },

  async expand({ campaignId }) {
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign || campaign.status === 'expanded') return;
    const backlog = await bulkQueue.getJobCounts('waiting', 'active', 'delayed');
    if (Object.values(backlog).reduce((a, b) => a + b, 0) >= HIGH_WATER_MARK) {
      await campaignQueue.add('expand', { campaignId }, { delay: 5000 });
      return;
    }
    if (!campaign.upperBound) {
      await Campaign.updateOne({ _id: campaignId }, { status: 'expanded' });
      return;
    }
    const filter = audienceFilter(campaign);
    filter._id = { ...(filter._id || {}), $lte: campaign.upperBound, ...(campaign.cursor ? { $gt: campaign.cursor } : {}) };
    const recipients = await UserModel.find(filter).sort({ _id: 1 }).limit(BATCH_SIZE).select('_id email role').lean();
    if (!recipients.length) {
      await Campaign.updateOne({ _id: campaignId }, { status: 'expanded', lastError: null });
      return;
    }
    await Delivery.bulkWrite(recipients.map(user => ({ updateOne: {
      filter: { campaignId, userId: String(user._id) },
      update: { $setOnInsert: { campaignId, userId: String(user._id), email: user.email, role: user.role, status: 'queued', attempts: 0 } },
      upsert: true,
    } })));
    const rows = await Delivery.find({ campaignId, userId: { $in: recipients.map(u => String(u._id)) }, status: 'queued' }).lean();
    await enqueueDeliveries(rows);
    // Enqueue continuation before committing cursor. Replays are safe by unique delivery/job IDs.
    await campaignQueue.add('expand', { campaignId });
    await Campaign.updateOne({ _id: campaignId }, { cursor: String(recipients[recipients.length - 1]._id), status: 'processing', lastError: null });
  },

  async deliver({ deliveryId }) {
    const delivery = await Delivery.findById(deliveryId).lean();
    if (!delivery || ['saved', 'provider_accepted', 'delivery_unknown'].includes(delivery.status)) return;
    if (delivery.sendStartedAt) {
      await Delivery.updateOne({ _id: deliveryId }, { status: 'delivery_unknown', lastError: 'Previous send interrupted; verify provider logs before resending.' });
      return;
    }
    const campaign = await Campaign.findById(delivery.campaignId).lean();
    if (!campaign) throw new Error('Campaign missing');
    await Delivery.updateOne({ _id: deliveryId }, { $inc: { attempts: 1 }, $set: { status: 'processing' } });
    let sendingEmail = false;
    try {
      if (campaign.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery.email || '')) {
        await Delivery.updateOne({ _id: deliveryId }, { status: 'failed', lastError: 'Invalid or missing recipient email' });
        return;
      }
      const { NotificationService } = require('./notification.service');
      await new NotificationService().createNotification({
        userId: delivery.userId, channel: campaign.channel, subject: campaign.title, template: campaign.body,
        payload: { ...campaign.data, campaignId: delivery.campaignId, recipientType: delivery.role, targetType: 'broadcast' },
        idempotencyKey: `campaign-${delivery.campaignId}-${delivery.userId}`,
      });
      if (campaign.channel === 'email') {
        const rendered = renderEmailTemplate({ subject: campaign.title, message: campaign.body, recipientType: delivery.role, templateKey: campaign.data?.templateKey, payload: campaign.data || {} });
        await Delivery.updateOne({ _id: deliveryId }, { sendStartedAt: new Date() });
        sendingEmail = true;
        const result = await sendMail({ to: delivery.email, subject: rendered.subject, text: rendered.text, html: rendered.html });
        if (!result?.accepted?.length || String(result.messageId || '').startsWith('static-')) {
          sendingEmail = false;
          await Delivery.updateOne({ _id: deliveryId }, { status: 'failed', sendStartedAt: null, lastError: 'Email provider did not accept recipient' });
          return;
        }
        await Delivery.updateOne({ _id: deliveryId }, { providerMessageId: result.messageId || null });
      }
      await Delivery.updateOne({ _id: deliveryId }, { status: campaign.channel === 'email' ? 'provider_accepted' : 'saved', lastError: null, completedAt: new Date() });
    } catch (error) {
      if (sendingEmail) {
        await Delivery.updateOne({ _id: deliveryId }, { status: 'delivery_unknown', lastError: String(error.message).slice(0, 1000) });
        return;
      }
      await Delivery.updateOne({ _id: deliveryId }, { status: 'retrying', lastError: String(error.message).slice(0, 1000) });
      throw error;
    }
  },

  async inspect(campaignId) {
    if (!UserModel.db.base.Types.ObjectId.isValid(campaignId)) throw new AppError('Invalid campaign ID', 400);
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) throw new AppError('Campaign not found', 404);
    const counts = await Delivery.aggregate([{ $match: { campaignId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
    const failed = await Delivery.find({ campaignId, status: 'failed' }).limit(50).select('userId attempts lastError').lean();
    return { campaign, counts: Object.fromEntries(counts.map(row => [row._id, row.count])), failed };
  },

  async retry(campaignId) {
    const { campaign } = await this.inspect(campaignId);
    if (campaign.status === 'failed') {
      await Campaign.updateOne({ _id: campaignId }, { status: 'queued', lastError: null });
      await campaignQueue.add('expand', { campaignId });
    }
    await campaignQueue.add('retry-failed', { campaignId });
    return { campaignId, status: 'retry_queued' };
  },

  async retryFailed({ campaignId, cursor }) {
    const backlog = await bulkQueue.getJobCounts('waiting', 'active', 'delayed');
    if (Object.values(backlog).reduce((a, b) => a + b, 0) >= HIGH_WATER_MARK) {
      await campaignQueue.add('retry-failed', { campaignId, cursor }, { delay: 5000 });
      return;
    }
    const rows = await Delivery.find({ campaignId, status: 'failed', ...(cursor ? { _id: { $gt: cursor } } : {}) }).sort({ _id: 1 }).limit(BATCH_SIZE).lean();
    for (const row of rows) {
      const job = await bulkQueue.getJob(jobId(row));
      if (job) {
        const state = await job.getState();
        if (state === 'failed') await job.retry();
        else if (state === 'completed') { await job.remove(); await enqueueDeliveries([row]); }
      } else await enqueueDeliveries([row]);
    }
    if (rows.length) await campaignQueue.add('retry-failed', { campaignId, cursor: String(rows[rows.length - 1]._id) }, { delay: 5000 });
  },
};
module.exports = { campaignService, audienceFilter, BATCH_SIZE, HIGH_WATER_MARK };
