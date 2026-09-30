const { env } = require("../../../config/env");
const { SMS_CATEGORIES, SMS_HEADERS, SMS_TEMPLATE_KEYS } = require("./sms.constants");

const define = (templateId, variables, buildMessage, options = {}) => Object.freeze({
  templateId,
  header: options.header || SMS_HEADERS.SERVICE,
  category: options.category || SMS_CATEGORIES.SERVICE_IMPLICIT,
  variables: Object.freeze(variables),
  otp: options.otp === true,
  buildMessage,
});

const brand = env.sms.brandName;
const SMS_TEMPLATES = Object.freeze({
  [SMS_TEMPLATE_KEYS.LOGIN_OTP]: define(env.sms.templateIds.loginOtp, ["otp", "validityMinutes"], ({ otp, validityMinutes }) => `${otp} is your OTP to log in to ${brand}. Valid for ${validityMinutes} minutes. Do not share it with anyone.`, { otp: true }),
  [SMS_TEMPLATE_KEYS.REGISTER_OTP]: define(env.sms.templateIds.registerOtp, ["otp", "validityMinutes"], ({ otp, validityMinutes }) => `${otp} is your OTP to register with ${brand}. Valid for ${validityMinutes} minutes. Do not share it with anyone.`, { otp: true }),
  [SMS_TEMPLATE_KEYS.FORGOT_PASSWORD_OTP]: define(env.sms.templateIds.forgotPasswordOtp, ["otp", "validityMinutes"], ({ otp, validityMinutes }) => `${otp} is your OTP to reset your ${brand} password. Valid for ${validityMinutes} minutes. Do not share it with anyone.`, { otp: true }),
  [SMS_TEMPLATE_KEYS.RESET_PASSWORD_OTP]: define(env.sms.templateIds.resetPasswordOtp, ["otp", "validityMinutes"], ({ otp, validityMinutes }) => `${otp} is your OTP to confirm your ${brand} password reset. Valid for ${validityMinutes} minutes. Do not share it with anyone.`, { otp: true }),
  [SMS_TEMPLATE_KEYS.VERIFY_MOBILE_OTP]: define(env.sms.templateIds.verifyMobileOtp, ["otp", "validityMinutes"], ({ otp, validityMinutes }) => `${otp} is your OTP to verify your mobile number with ${brand}. Valid for ${validityMinutes} minutes. Do not share it with anyone.`, { otp: true }),
  [SMS_TEMPLATE_KEYS.CHANGE_MOBILE_OTP]: define(env.sms.templateIds.changeMobileOtp, ["otp", "validityMinutes"], ({ otp, validityMinutes }) => `${otp} is your OTP to change your mobile number on ${brand}. Valid for ${validityMinutes} minutes. Do not share it with anyone.`, { otp: true }),
  [SMS_TEMPLATE_KEYS.ACCOUNT_RECOVERY_OTP]: define(env.sms.templateIds.accountRecoveryOtp, ["otp", "validityMinutes"], ({ otp, validityMinutes }) => `${otp} is your OTP for ${brand} account recovery. Valid for ${validityMinutes} minutes. Do not share it with anyone.`, { otp: true }),
  [SMS_TEMPLATE_KEYS.ORDER_PLACED]: define(env.sms.templateIds.orderPlaced, ["orderNumber", "amount"], ({ orderNumber, amount }) => `Your ${brand} order ${orderNumber} has been placed successfully for INR ${amount}.`),
  [SMS_TEMPLATE_KEYS.PAYMENT_SUCCESS]: define(env.sms.templateIds.paymentSuccess, ["amount", "orderNumber", "paymentReference"], ({ amount, orderNumber, paymentReference }) => `Payment of INR ${amount} for ${brand} order ${orderNumber} was successful. Reference: ${paymentReference}.`),
  [SMS_TEMPLATE_KEYS.PAYMENT_FAILED]: define(env.sms.templateIds.paymentFailed, ["orderNumber"], ({ orderNumber }) => `Payment for ${brand} order ${orderNumber} failed. Please retry from your account.`),
  [SMS_TEMPLATE_KEYS.ORDER_CANCELLED]: define(env.sms.templateIds.orderCancelled, ["orderNumber"], ({ orderNumber }) => `Your ${brand} order ${orderNumber} has been cancelled.`),
  [SMS_TEMPLATE_KEYS.REFUND_INITIATED]: define(env.sms.templateIds.refundInitiated, ["amount", "orderNumber"], ({ amount, orderNumber }) => `A refund of INR ${amount} for ${brand} order ${orderNumber} has been initiated.`),
  [SMS_TEMPLATE_KEYS.REFUND_COMPLETED]: define(env.sms.templateIds.refundCompleted, ["amount", "orderNumber", "refundReference"], ({ amount, orderNumber, refundReference }) => `Your refund of INR ${amount} for ${brand} order ${orderNumber} has been processed. Reference: ${refundReference}.`),
  [SMS_TEMPLATE_KEYS.SHIPMENT_DISPATCHED]: define(env.sms.templateIds.shipmentDispatched, ["orderNumber", "trackingNumber"], ({ orderNumber, trackingNumber }) => `Your ${brand} order ${orderNumber} has been dispatched. Tracking number: ${trackingNumber}.`),
  [SMS_TEMPLATE_KEYS.OUT_FOR_DELIVERY]: define(env.sms.templateIds.outForDelivery, ["orderNumber"], ({ orderNumber }) => `Your ${brand} order ${orderNumber} is out for delivery.`),
  [SMS_TEMPLATE_KEYS.ORDER_DELIVERED]: define(env.sms.templateIds.orderDelivered, ["orderNumber"], ({ orderNumber }) => `Your ${brand} order ${orderNumber} has been delivered successfully.`),
  [SMS_TEMPLATE_KEYS.DELIVERY_FAILED]: define(env.sms.templateIds.deliveryFailed, ["orderNumber"], ({ orderNumber }) => `Delivery of your ${brand} order ${orderNumber} was unsuccessful. We will update you about the next attempt.`),
});

module.exports = { SMS_TEMPLATES };
