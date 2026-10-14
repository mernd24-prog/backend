const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { shouldNotify } = require('../src/modules/notification/services/notification-policy');
const { DOMAIN_EVENTS: E } = require('../src/contracts/events/domain-events');
(async () => {
  for (const event of [E.SHIPMENT_CREATED_V1, E.INVOICE_GENERATED_V1]) assert.equal(shouldNotify(event), false);
  for (const status of ['in_transit', 'manifested', 'delivered', 'unknown']) assert.equal(shouldNotify(E.SHIPMENT_TRACKING_UPDATED_V1, { status }), false);
  assert.equal(shouldNotify(E.SHIPMENT_TRACKING_UPDATED_V1, { status: 'out-for-delivery' }), true);
  for (const status of ['pending', 'confirmed', 'processing', 'delivered']) assert.equal(shouldNotify(E.ORDER_STATUS_UPDATED_V1, { status }), false);
  assert.equal(shouldNotify(E.ORDER_STATUS_UPDATED_V1, { status: 'shipped' }), true);
  for (const event of [E.ORDER_CREATED_V1, E.ORDER_PAID_V1, E.ORDER_PAYMENT_FAILED_V1, E.ORDER_CANCELLED_V1, E.RETURN_APPROVED_V1, E.RETURN_REJECTED_V1, E.REFUND_PROCESSED_V1, E.REFUND_FAILED_V1, E.SHIPMENT_DELIVERED_V1, E.KYC_STATUS_UPDATED_V1, E.PRODUCT_REJECTED_V1, E.INVENTORY_LOW_STOCK_V1, E.OTP_SENT_V1]) assert.equal(shouldNotify(event), true);
  assert.equal(shouldNotify(E.AUTH_USER_REGISTERED_V1), false);
  assert.equal(shouldNotify(E.SELLER_PAYOUT_STATUS_UPDATED_V1, { status: 'processing' }), false);
  assert.equal(shouldNotify(E.SELLER_PAYOUT_STATUS_UPDATED_V1, { status: 'completed' }), true);
  const { notificationIdentity } = require('../src/modules/notification/services/notification-policy');
  assert.equal(notificationIdentity(E.REFUND_PROCESSED_V1, { refundId: 'r1' }), notificationIdentity(E.PAYMENT_REFUNDED_V1, { refundId: 'r1' }));
  assert.notEqual(notificationIdentity(E.REFUND_PROCESSED_V1, { refundId: 'r1' }), notificationIdentity(E.REFUND_PROCESSED_V1, { refundId: 'r2' }));
  assert.equal(notificationIdentity(E.REFUND_PROCESSED_V1, { orderId: 'o1' }), null);
  assert.equal(notificationIdentity(E.INVENTORY_LOW_STOCK_V1, { productId: 'p1' }, 100), notificationIdentity(E.INVENTORY_LOW_STOCK_V1, { productId: 'p1' }, 200));
  const notificationSource = fs.readFileSync(path.join(__dirname, '../src/modules/notification/services/notification.service.js'), 'utf8');
  const queueMethod = notificationSource.slice(notificationSource.indexOf('  async queueEmailForUser('), notificationSource.indexOf('  async findUserEmail('));
  const jobs = [];
  const jobOptions = [];
  const recipientContext = {
    shouldNotify, notificationIdentity,
    emailPattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    env: { smtp: { queue: { initialDelayMs: 0, retryBackoffMs: 1000 } } },
    require,
    notificationQueue: { add: async (name, data, options) => { jobs.push(data); jobOptions.push(options); } },
  };
  const recipientService = vm.runInNewContext(`({${queueMethod}})`, recipientContext);
  recipientService.findUserEmail = async () => 'admin@example.com';
  recipientService.extractSellerRecipientEmail = payload => payload.sellerEmail;
  recipientService.emailJobStatusKey = () => '';
  const onboardingEmail = {
    eventName: E.SELLER_KYC_SUBMITTED_V1, eventId: 'submission-1',
    recipientType: 'admin', payload: { sellerEmail: 'seller@example.com', emailDedupeKey: 'seller-onboarding:seller-id', emailDedupeEventName: 'seller.onboarding_submitted.admin' },
  };
  await recipientService.queueEmailForUser('admin-id', onboardingEmail);
  assert.equal(jobs.at(-1).to, 'admin@example.com', 'admin onboarding email must not go to seller');
  const firstOnboardingJobId = jobOptions.at(-1).jobId;
  assert.equal(firstOnboardingJobId.includes(':'), false, 'onboarding job ID must be accepted by BullMQ');
  const { Job } = require('bullmq');
  const validateQueueId = jobId => Job.prototype.validateOptions.call({ opts: { jobId } }, { data: '{}' });
  assert.throws(() => validateQueueId('seller.onboarding_submitted.admin|seller-onboarding:seller-id|admin|admin-id'), /Custom Id cannot contain/);
  assert.doesNotThrow(() => validateQueueId(firstOnboardingJobId), 'fixed onboarding ID passes installed BullMQ validation');
  await recipientService.queueEmailForUser('admin-id', { ...onboardingEmail, eventName: E.SELLER_ORGANIZATION_CREATED_V1, eventId: 'submission-2' });
  assert.equal(jobOptions.at(-1).jobId, firstOnboardingJobId, 'equivalent onboarding events remain deduplicated');
  await recipientService.queueEmailForUser('seller-id', { ...onboardingEmail, recipientType: 'seller' });
  assert.equal(jobs.at(-1).to, 'seller@example.com', 'seller email still goes to seller');
  await recipientService.queueEmailForUser('admin-id', { ...onboardingEmail, payload: { sellerEmail: 'seller@example.com', recipientEmail: 'override@example.com' } });
  assert.equal(jobs.at(-1).to, 'override@example.com', 'explicit recipient remains supported');
  const subscribers = new Map();
  const onboardingMethod = notificationSource.slice(notificationSource.indexOf('  registerOnboardingSubscribers() {'), notificationSource.indexOf('  sellerDisplayName('));
  const onboardingService = vm.runInNewContext(`({${onboardingMethod}})`, {
    DOMAIN_EVENTS: E,
    ROLES: { SUPER_ADMIN: 'super-admin' },
    eventBus: { subscribe: (name, handler) => subscribers.set(name, handler) },
  });
  onboardingService.findAdminRecipients = async () => [
    { _id: 'admin', role: 'admin' },
    { _id: 'sub-admin', role: 'sub-admin' },
    { _id: 'super-admin', role: 'super-admin' },
  ];
  onboardingService.enrichSellerPayload = async payload => payload;
  onboardingService.sellerDisplayName = () => 'Test Seller';
  const onboardingEmails = [];
  const inAppRecipients = [];
  onboardingService.createNotification = async notification => inAppRecipients.push(notification.userId);
  onboardingService.queueEmailForUser = async userId => onboardingEmails.push(userId);
  onboardingService.registerOnboardingSubscribers();
  for (const eventName of [E.SELLER_KYC_SUBMITTED_V1, E.SELLER_ORGANIZATION_CREATED_V1]) {
    onboardingEmails.length = 0;
    inAppRecipients.length = 0;
    await subscribers.get(eventName)({ eventName, id: 'submission', payload: { sellerId: 'seller' } });
    assert.deepEqual(onboardingEmails, ['super-admin'], 'seller submission email goes only to superadmin');
    assert.deepEqual(inAppRecipients.sort(), ['admin', 'sub-admin', 'super-admin'], 'admin in-app notifications remain available');
  }
  onboardingEmails.length = 0;
  await subscribers.get(E.KYC_STATUS_UPDATED_V1)({ eventName: E.KYC_STATUS_UPDATED_V1, id: 'approval', payload: { sellerId: 'seller', status: 'approved' } });
  assert.deepEqual(onboardingEmails, ['seller'], 'approval outcome still goes to seller');
  let sent = 0;
  const env = { smtp: { live: true, mode: 'live' }, mail: { sendEmails: false, sendAuthOtpEmails: true } };
  const modules = {
    nodemailer: { createTransport: () => ({ sendMail: async () => { sent++; return { messageId: 'mock-provider-id', accepted: ['test@example.com'] }; } }) },
    '../../config/env': { env }, '../../shared/errors/app-error': { AppError: Error },
    '../../shared/logger/logger': { logger: { warn() {}, info() {}, error() {} } },
  };
  const context = { module: { exports: {} }, process: { env: {} }, require: key => modules[key] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/infrastructure/mail/mailer.js'), 'utf8'), context);
  const { sendMail } = context.module.exports;
  await sendMail({ to: 'test@example.com', subject: 'General' });
  assert.equal(sent, 0, 'general mail disabled');
  await sendMail({ to: 'test@example.com', subject: 'OTP', type: 'auth_otp' });
  assert.equal(sent, 1, 'OTP remains enabled independently of general mail');
  env.mail.sendAuthOtpEmails = false;
  await sendMail({ to: 'test@example.com', subject: 'OTP', type: 'auth_otp' });
  assert.equal(sent, 1, 'OTP disable flag is respected');
  await assert.rejects(sendMail({ to: 'invalid', type: 'auth_otp' }), /valid recipient/);
  console.log('Notification policy and isolated OTP mail tests passed; no external mail/SMS sent.');
})().catch(error => { console.error(error); process.exitCode = 1; });
