const crypto = require("crypto");
const { PaymentRepository } = require("../repositories/payment.repository");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { ORDER_STATUS, PAYMENT_PROVIDER, PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const { paymentProviderRegistry } = require("../../../infrastructure/payments/provider-registry");
const { AppError } = require("../../../shared/errors/app-error");
const { mapPaymentResponse } = require("../dtos/payment-response");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { OrderService } = require("../../order/services/order.service");
const { PaymentMethodConfigRepository } = require("../repositories/payment-method-config.repository");
const { env } = require("../../../config/env");

const PROVIDER_RECEIPT_MAX_LENGTH = 40;

const buildProviderReceipt = (orderId) => {
  const timestamp = Date.now().toString(36);
  const nonce = crypto.randomBytes(4).toString("hex");
  const cleanOrderId = String(orderId || "").replace(/[^a-zA-Z0-9]/g, "");
  const prefix = `ord_${timestamp}_`;
  const suffixBudget = Math.max(
    PROVIDER_RECEIPT_MAX_LENGTH - prefix.length - nonce.length - 1,
    0,
  );
  const orderSuffix = cleanOrderId.slice(-Math.min(12, suffixBudget));
  const receipt = orderSuffix
    ? `${prefix}${orderSuffix}_${nonce}`
    : `${prefix}${nonce}`;

  return receipt.slice(0, PROVIDER_RECEIPT_MAX_LENGTH);
};

const buildRazorpayCheckout = (payment = {}) => {
  const providerOrderId = payment.providerOrderId || payment.provider_order_id;
  if (!providerOrderId) return null;

  return {
    keyId: env.razorpay.configured ? env.razorpay.keyId : "rzp_mock_key",
    amount: Math.round(Number(payment.amount || 0) * 100),
    currency: payment.currency || "INR",
    orderId: providerOrderId,
  };
};

class PaymentService {
  constructor({
    paymentRepository = new PaymentRepository(),
    orderRepository = new OrderRepository(),
    paymentMethodConfigRepository = new PaymentMethodConfigRepository(),
    orderService = new OrderService({ orderRepository }),
  } = {}) {
    this.paymentRepository = paymentRepository;
    this.orderRepository = orderRepository;
    this.paymentMethodConfigRepository = paymentMethodConfigRepository;
    this.orderService = orderService;
  }

  normalizeJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return value;
  }

  mapCodConfig(config = {}) {
    return {
      method: PAYMENT_PROVIDER.COD,
      enabled: Boolean(config.enabled),
      chargeAmount: Number(config.charge_amount ?? config.chargeAmount ?? 0),
      minOrderAmount: config.min_order_amount === null || config.min_order_amount === undefined ? null : Number(config.min_order_amount),
      maxOrderAmount: config.max_order_amount === null || config.max_order_amount === undefined ? null : Number(config.max_order_amount),
      currency: config.currency || "INR",
      metadata: this.normalizeJson(config.metadata, {}),
    };
  }

  async getPaymentOptions(query = {}) {
    const cod = this.mapCodConfig(await this.paymentMethodConfigRepository.getCodConfig());
    const orderAmount = Number(query.orderAmount || 0);
    const codAvailable = cod.enabled &&
      (cod.minOrderAmount === null || orderAmount >= cod.minOrderAmount) &&
      (cod.maxOrderAmount === null || orderAmount <= cod.maxOrderAmount);

    return {
      providers: [
        {
          provider: PAYMENT_PROVIDER.RAZORPAY,
          label: env.razorpay.mock ? "Online Payment (Test)" : "Online Payment",
          enabled: env.razorpay.enabled,
          chargeAmount: 0,
          payableNow: true,
          mode: env.razorpay.mode,
          ...(env.razorpay.enabled
            ? {}
            : {
                disabledReason: env.razorpay.liveRequested
                  ? "Razorpay live credentials are missing"
                  : "Razorpay is disabled by environment configuration",
              }),
        },
        { provider: PAYMENT_PROVIDER.COD, label: "Cash on Delivery", enabled: codAvailable, chargeAmount: cod.chargeAmount, payableNow: false, config: cod },
        { provider: PAYMENT_PROVIDER.MANUAL_UPI, label: "Manual UPI", enabled: true, chargeAmount: 0, payableNow: false },
        { provider: PAYMENT_PROVIDER.MANUAL_BANK_TRANSFER, label: "Bank Transfer", enabled: true, chargeAmount: 0, payableNow: false },
      ],
    };
  }

  async getCodConfig(actor) {
    if (!["admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      throw new AppError("Only admin users can view COD settings", 403);
    }
    return this.mapCodConfig(await this.paymentMethodConfigRepository.getCodConfig());
  }

  async updateCodConfig(payload, actor) {
    if (!["admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      throw new AppError("Only admin users can update COD settings", 403);
    }
    if (payload.maxOrderAmount !== null && payload.maxOrderAmount !== undefined && payload.minOrderAmount !== null && payload.minOrderAmount !== undefined && Number(payload.maxOrderAmount) < Number(payload.minOrderAmount)) {
      throw new AppError("Maximum COD order amount cannot be lower than minimum amount", 400);
    }
    return this.mapCodConfig(await this.paymentMethodConfigRepository.upsertCodConfig(payload));
  }

  async initiatePayment(payload, actor) {
    const existingByKey = await this.paymentRepository.findByIdempotencyKey(payload.idempotencyKey);
    if (existingByKey) {
      return mapPaymentResponse(existingByKey);
    }

    const order = await this.orderRepository.findByIdAndBuyer(payload.orderId, actor.userId);
    if (!order) {
      throw new AppError("Order not found", 404);
    }

    const existingPayment = await this.paymentRepository.findByOrderId(payload.orderId, actor.userId);
    if (
      existingPayment &&
      existingPayment.status !== PAYMENT_STATUS.FAILED &&
      existingPayment.provider === payload.provider
    ) {
      const response = mapPaymentResponse(existingPayment);
      if (
        response.provider === PAYMENT_PROVIDER.RAZORPAY &&
        response.status === PAYMENT_STATUS.INITIATED
      ) {
        response.checkout = buildRazorpayCheckout(response);
      }
      return response;
    }

    const payableAmount = Number(order.payable_amount ?? order.total_amount);
    if (payload.provider === PAYMENT_PROVIDER.WALLET_ONLY) {
      if (payableAmount > 0) {
        throw new AppError("Wallet-only payment is allowed only when payable amount is zero", 400);
      }
      await this.orderService.markPaymentCaptured(payload.orderId, {
        userId: actor.userId,
        role: actor.role,
        metadata: { provider: PAYMENT_PROVIDER.WALLET_ONLY },
      });
      return mapPaymentResponse({
        id: payload.orderId,
        orderId: payload.orderId,
        buyerId: actor.userId,
        provider: PAYMENT_PROVIDER.WALLET_ONLY,
        status: PAYMENT_STATUS.CAPTURED,
        amount: 0,
        currency: order.currency || "INR",
        transactionReference: `wallet_${payload.orderId}`,
        metadata: {},
      });
    }

    if (payableAmount <= 0) {
      throw new AppError("This order does not require external payment", 400);
    }

    const provider = paymentProviderRegistry.get(payload.provider);
    if (payload.provider === PAYMENT_PROVIDER.COD) {
      const metadata = this.normalizeJson(order.metadata, {});
      const orderPaymentProvider = order.payment_provider || metadata.paymentProvider;
      if (orderPaymentProvider !== PAYMENT_PROVIDER.COD) {
        throw new AppError("Create this order with Cash on Delivery selected before initiating COD payment", 400);
      }
      const codConfig = this.mapCodConfig(await this.paymentMethodConfigRepository.getCodConfig());
      if (!codConfig.enabled) {
        throw new AppError("Cash on Delivery is currently disabled", 400);
      }
      const payment = await this.createOfflinePayment({
        ...payload,
        buyerId: actor.userId,
        order,
        payableAmount,
        status: PAYMENT_STATUS.AUTHORIZED,
        metadata: {
          cod: true,
          collectAmount: payableAmount,
          codChargeAmount: Number(order.cod_charge_amount || metadata.codCharge?.chargeAmount || 0),
          notes: payload.notes || {},
        },
      });
      await this.orderService.markPaymentAuthorized(payload.orderId, {
        userId: actor.userId,
        role: actor.role,
        reason: "cod_authorized",
        metadata: { provider: PAYMENT_PROVIDER.COD, paymentId: payment.id, collectLater: true },
      });
      return mapPaymentResponse(payment);
    }

    if ([PAYMENT_PROVIDER.MANUAL_BANK_TRANSFER, PAYMENT_PROVIDER.MANUAL_UPI].includes(payload.provider)) {
      const payment = await this.createOfflinePayment({
        ...payload,
        buyerId: actor.userId,
        order,
        payableAmount,
        status: PAYMENT_STATUS.INITIATED,
        metadata: {
          manual: true,
          referenceId: payload.referenceId || null,
          screenshotUrl: payload.screenshotUrl || null,
          notes: payload.notes || {},
        },
      });
      return mapPaymentResponse(payment);
    }

    if (order.status === ORDER_STATUS.PAYMENT_FAILED) {
      await this.orderService.reopenPayment(payload.orderId, {
        userId: actor.userId,
        role: actor.role,
        source: "payment-module",
      });
    }
    const providerOrder = await provider.createOrder({
      amount: payableAmount,
      currency: payload.currency || order.currency,
      receipt: buildProviderReceipt(payload.orderId),
      notes: {
        orderId: payload.orderId,
        buyerId: actor.userId,
        ...payload.notes,
      },
    });

    const paymentEvent = makeEvent(
      DOMAIN_EVENTS.PAYMENT_INITIATED_V1,
      {
        buyerId: actor.userId,
        orderId: payload.orderId,
        provider: payload.provider,
        amount: payableAmount,
        currency: payload.currency || order.currency || "INR",
        providerOrderId: providerOrder.providerOrderId,
      },
      {
        source: "payment-module",
      },
    );

    const payment = await this.paymentRepository.createPayment(
      {
        ...payload,
        buyerId: actor.userId,
        status: PAYMENT_STATUS.INITIATED,
        amount: payableAmount,
        currency: payload.currency || order.currency || "INR",
        providerOrderId: providerOrder.providerOrderId,
        metadata: providerOrder.metadata,
        idempotencyKey: payload.idempotencyKey || null,
      },
      paymentEvent,
    );

    if (providerOrder.autoCapture) {
      const paymentVerifiedEvent = makeEvent(
        DOMAIN_EVENTS.PAYMENT_VERIFIED_V1,
        {
          buyerId: actor.userId,
          orderId: payload.orderId,
          paymentId: payment.id,
          provider: payload.provider,
          providerPaymentId: providerOrder.providerPaymentId,
          providerOrderId: providerOrder.providerOrderId,
        },
        {
          source: "payment-module",
        },
      );

      const updatedPayment = await this.paymentRepository.updatePaymentStatus(
        payment.id,
        {
          status: PAYMENT_STATUS.CAPTURED,
          providerPaymentId: providerOrder.providerPaymentId,
          verificationMethod: "mock_auto_capture",
          metadata: {
            ...(providerOrder.metadata || {}),
            autoCaptured: true,
          },
          verifiedAt: new Date(),
        },
        paymentVerifiedEvent,
      );

      await this.orderService.markPaymentCaptured(payload.orderId, {
        userId: actor.userId,
        role: actor.role,
        metadata: {
          paymentId: payment.id,
          provider: payload.provider,
          providerPaymentId: providerOrder.providerPaymentId,
          providerOrderId: providerOrder.providerOrderId,
          verificationMethod: "mock_auto_capture",
        },
      });

      return mapPaymentResponse({
        ...updatedPayment,
        checkout: providerOrder.checkout,
      });
    }

    return mapPaymentResponse({
      ...payment,
      checkout: providerOrder.checkout,
    });
  }

  async createOfflinePayment(payload) {
    const paymentEvent = makeEvent(
      DOMAIN_EVENTS.PAYMENT_INITIATED_V1,
      {
        buyerId: payload.buyerId,
        orderId: payload.orderId,
        provider: payload.provider,
        amount: payload.payableAmount,
        currency: payload.currency || payload.order.currency || "INR",
      },
      { source: "payment-module" },
    );

    return this.paymentRepository.createPayment(
      {
        orderId: payload.orderId,
        buyerId: payload.buyerId,
        provider: payload.provider,
        status: payload.status,
        amount: payload.payableAmount,
        currency: payload.currency || payload.order.currency || "INR",
        transactionReference: payload.referenceId || payload.transactionReference,
        providerOrderId: payload.referenceId || null,
        providerPaymentId: payload.referenceId || null,
        verificationMethod: payload.provider === PAYMENT_PROVIDER.COD ? "cod_authorized" : "manual_pending",
        metadata: payload.metadata || {},
        idempotencyKey: payload.idempotencyKey || null,
      },
      paymentEvent,
    );
  }

  async verifyPayment(payload, actor) {
    const payment = await this.paymentRepository.findByOrderId(payload.orderId, actor.userId);
    if (!payment) {
      throw new AppError("Payment record not found for this order", 404);
    }

    if (payment.provider !== payload.provider) {
      throw new AppError("Payment provider does not match the existing payment record", 400);
    }

    const provider = paymentProviderRegistry.get(payload.provider);
    const verification = await provider.verifyPayment(payload);
    const paymentEvent = makeEvent(
      DOMAIN_EVENTS.PAYMENT_VERIFIED_V1,
      {
        buyerId: actor.userId,
        orderId: payload.orderId,
        paymentId: payment.id,
        provider: payment.provider,
        providerPaymentId: verification.providerPaymentId,
        providerOrderId: verification.providerOrderId,
      },
      {
        source: "payment-module",
      },
    );

    const updatedPayment = await this.paymentRepository.updatePaymentStatus(
      payment.id,
      {
        status: verification.status,
        providerPaymentId: verification.providerPaymentId,
        verificationMethod: verification.verificationMethod,
        metadata: verification.metadata,
        verifiedAt: new Date(),
      },
      paymentEvent,
    );

    if (verification.status === PAYMENT_STATUS.CAPTURED) {
      await this.orderService.markPaymentCaptured(payload.orderId, {
        userId: actor.userId,
        role: actor.role,
        metadata: {
          paymentId: payment.id,
          provider: payment.provider,
          providerPaymentId: verification.providerPaymentId,
          providerOrderId: verification.providerOrderId,
          verificationMethod: verification.verificationMethod,
        },
      });
    }

    if (verification.status === PAYMENT_STATUS.FAILED) {
      await this.orderService.markPaymentFailed(payload.orderId, {
        userId: actor.userId,
        role: actor.role,
        reason: verification.metadata?.error_description || "payment_failed",
        metadata: {
          paymentId: payment.id,
          provider: payment.provider,
          providerPaymentId: verification.providerPaymentId,
          providerOrderId: verification.providerOrderId,
          verificationMethod: verification.verificationMethod,
        },
      });
    }

    return mapPaymentResponse(updatedPayment);
  }

  async handleWebhook(signature, rawBody) {
    const { verifyRazorpayWebhookSignature } = require("../../../infrastructure/payments/razorpay-client");
    if (!env.razorpay.live) {
      return {
        acknowledged: true,
        ignored: true,
        mode: env.razorpay.mode,
        reason: "Razorpay webhook ignored because live Razorpay is disabled.",
      };
    }

    if (!signature || !rawBody) {
      throw new AppError("Invalid Razorpay webhook request", 400);
    }

    if (!env.razorpay.webhookSecret) {
      throw new AppError("Razorpay webhook secret is not configured", 503);
    }

    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
      throw new AppError("Invalid Razorpay webhook signature", 401);
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (error) {
      throw new AppError("Invalid Razorpay webhook payload", 400);
    }
    const eventType = payload.event;

    if (eventType === "payment.captured") {
      const entity = payload.payload?.payment?.entity;
      if (!entity?.id || !entity?.order_id) {
        throw new AppError("Invalid Razorpay payment captured payload", 400);
      }
      const eventId = payload.id || entity.acquirer_data?.rrn || entity.id;
      if (await this.paymentRepository.findWebhookEvent("razorpay", eventId)) {
        return { acknowledged: true, duplicate: true };
      }
      const payment = await this.paymentRepository.findByProviderOrderId(entity.order_id);
      if (!payment) {
        return { acknowledged: true, ignored: true };
      }

      const paymentEvent = makeEvent(
        DOMAIN_EVENTS.PAYMENT_VERIFIED_V1,
        {
          buyerId: payment.buyer_id,
          orderId: payment.order_id,
          paymentId: payment.id,
          provider: payment.provider,
          providerPaymentId: entity.id,
          providerOrderId: entity.order_id,
        },
        {
          source: "payment-webhook",
        },
      );

      await this.paymentRepository.updatePaymentStatus(
        payment.id,
        {
          status: PAYMENT_STATUS.CAPTURED,
          providerPaymentId: entity.id,
          verificationMethod: "webhook",
          metadata: entity,
          verifiedAt: new Date(),
        },
        paymentEvent,
      );
      await this.paymentRepository.recordWebhookEvent({
        provider: "razorpay",
        providerEventId: eventId,
        eventType,
        paymentId: payment.id,
        orderId: payment.order_id,
        payload,
      });
      await this.orderService.markPaymentCaptured(payment.order_id, {
        userId: payment.buyer_id,
        role: "system",
        metadata: {
          paymentId: payment.id,
          provider: payment.provider,
          providerPaymentId: entity.id,
          providerOrderId: entity.order_id,
          verificationMethod: "webhook",
        },
      });
    }

    if (eventType === "payment.failed") {
      const entity = payload.payload?.payment?.entity;
      if (!entity?.id || !entity?.order_id) {
        throw new AppError("Invalid Razorpay payment failed payload", 400);
      }
      const eventId = payload.id || entity.id;
      if (await this.paymentRepository.findWebhookEvent("razorpay", eventId)) {
        return { acknowledged: true, duplicate: true };
      }
      const payment = await this.paymentRepository.findByProviderOrderId(entity.order_id);
      if (!payment) {
        return { acknowledged: true, ignored: true };
      }

      const paymentEvent = makeEvent(
        DOMAIN_EVENTS.PAYMENT_FAILED_V1,
        {
          buyerId: payment.buyer_id,
          orderId: payment.order_id,
          paymentId: payment.id,
          provider: payment.provider,
          providerPaymentId: entity.id,
          reason: entity.error_description || entity.error_reason || "payment_failed",
        },
        {
          source: "payment-webhook",
        },
      );

      await this.paymentRepository.updatePaymentStatus(
        payment.id,
        {
          status: PAYMENT_STATUS.FAILED,
          providerPaymentId: entity.id,
          verificationMethod: "webhook",
          metadata: entity,
          failedReason: entity.error_description || entity.error_reason || "payment_failed",
        },
        paymentEvent,
      );
      await this.paymentRepository.recordWebhookEvent({
        provider: "razorpay",
        providerEventId: eventId,
        eventType,
        paymentId: payment.id,
        orderId: payment.order_id,
        payload,
      });
      await this.orderService.markPaymentFailed(payment.order_id, {
        userId: payment.buyer_id,
        role: "system",
        reason: entity.error_description || entity.error_reason || "payment_failed",
        metadata: {
          paymentId: payment.id,
          provider: payment.provider,
          providerPaymentId: entity.id,
          providerOrderId: entity.order_id,
          verificationMethod: "webhook",
        },
      });
    }

    if (eventType === "refund.processed" || eventType === "payment.refunded") {
      const entity = payload.payload?.refund?.entity || payload.payload?.payment?.entity;
      if (!entity?.id) {
        throw new AppError("Invalid Razorpay refund payload", 400);
      }
      const providerPaymentId = entity.payment_id || entity.id;
      const eventId = payload.id || entity.id;
      if (await this.paymentRepository.findWebhookEvent("razorpay", eventId)) {
        return { acknowledged: true, duplicate: true };
      }
      const payment = await this.paymentRepository.findByProviderPaymentId(providerPaymentId);
      if (!payment) {
        return { acknowledged: true, ignored: true };
      }
      await this.paymentRepository.updatePaymentStatus(payment.id, {
        status: PAYMENT_STATUS.REFUNDED,
        providerPaymentId,
        verificationMethod: "webhook",
        metadata: entity,
        verifiedAt: new Date(),
      });
      await this.paymentRepository.recordWebhookEvent({
        provider: "razorpay",
        providerEventId: eventId,
        eventType,
        paymentId: payment.id,
        orderId: payment.order_id,
        payload,
      });
      const refundEvent = makeEvent(
        DOMAIN_EVENTS.PAYMENT_REFUNDED_V1,
        {
          buyerId: payment.buyer_id,
          orderId: payment.order_id,
          paymentId: payment.id,
          provider: payment.provider,
          providerPaymentId,
          refundId: entity.id,
          amount: Number(entity.amount || payment.amount || 0),
        },
        { source: "payment-webhook" },
      );
      const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
      await eventPublisher.publish(refundEvent);
    }

    return { acknowledged: true };
  }

  async listPayments(actor) {
    const payments = await this.paymentRepository.listPaymentsByBuyer(actor.userId);
    return payments.map(mapPaymentResponse);
  }

  async listPaymentsForAdmin(query, actor) {
    if (!["admin", "sub-admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      throw new AppError("Only admin users can list payments", 403);
    }
    return this.paymentRepository.listPaymentsForAdmin({
      ...query,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
  }

  async approveManualPayment(paymentId, payload, actor) {
    if (!["admin", "sub-admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      throw new AppError("Only admin users can approve manual payments", 403);
    }

    const payment = await this.paymentRepository.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);
    if (![PAYMENT_PROVIDER.MANUAL_BANK_TRANSFER, PAYMENT_PROVIDER.MANUAL_UPI, PAYMENT_PROVIDER.COD].includes(payment.provider)) {
      throw new AppError("Only manual/COD payments can be approved here", 400);
    }
    if (payment.status === PAYMENT_STATUS.CAPTURED) return mapPaymentResponse(payment);

    const updatedPayment = await this.paymentRepository.updatePaymentStatus(paymentId, {
      status: PAYMENT_STATUS.CAPTURED,
      providerPaymentId: payload.referenceId || payment.provider_payment_id,
      verificationMethod: "admin_approval",
      metadata: { approvalReason: payload.reason || null, referenceId: payload.referenceId || null },
      verifiedAt: new Date(),
      approvedBy: actor.userId,
      approvedAt: new Date(),
    });

    await this.orderService.markPaymentCaptured(payment.order_id, {
      userId: actor.userId,
      role: actor.role,
      metadata: { provider: payment.provider, paymentId },
    });

    return mapPaymentResponse(updatedPayment);
  }

  async rejectManualPayment(paymentId, payload, actor) {
    if (!["admin", "sub-admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      throw new AppError("Only admin users can reject manual payments", 403);
    }
    const payment = await this.paymentRepository.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);

    const updatedPayment = await this.paymentRepository.updatePaymentStatus(paymentId, {
      status: PAYMENT_STATUS.FAILED,
      verificationMethod: "admin_rejection",
      metadata: { rejectionReason: payload.reason || null },
      failedReason: payload.reason || "manual_payment_rejected",
    });

    await this.orderService.markPaymentFailed(payment.order_id, {
      userId: actor.userId,
      role: actor.role,
      reason: payload.reason || "manual_payment_rejected",
      metadata: { provider: payment.provider, paymentId },
    });

    return mapPaymentResponse(updatedPayment);
  }
}

module.exports = { PaymentService, buildProviderReceipt, buildRazorpayCheckout };
