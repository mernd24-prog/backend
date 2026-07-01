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
const { ReturnService } = require("../../returns/services/return.service");
const { CancellationService } = require("../../cancellation/services/cancellation.service");
const { commerceSettingsService } = require("../../admin/services/commerce-settings.service");
const { sellerChargeSettingsService } = require("../../seller/services/seller-charge-settings.service");
const { UserModel } = require("../../user/models/user.model");

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
    returnService = ReturnService,
    cancellationService = new CancellationService(),
  } = {}) {
    this.paymentRepository = paymentRepository;
    this.orderRepository = orderRepository;
    this.paymentMethodConfigRepository = paymentMethodConfigRepository;
    this.orderService = orderService;
    this.returnService = returnService;
    this.cancellationService = cancellationService;
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

  async enrichAdminPayments(payments = []) {
    if (!payments.length) return payments;
    const buyerIds = Array.from(new Set(
      payments.map((payment) => String(payment.buyer_id || payment.buyerId || "")).filter((id) =>
        UserModel.base.Types.ObjectId.isValid(id)),
    ));
    const orderIds = Array.from(new Set(
      payments.map((payment) => String(payment.order_id || payment.orderId || "")).filter(Boolean),
    ));
    const [buyers, orders] = await Promise.all([
      buyerIds.length
        ? UserModel.find({ _id: { $in: buyerIds } }).select("email phone profile").lean().catch(() => [])
        : [],
      Promise.all(orderIds.map((orderId) => this.orderRepository.findById(orderId).catch(() => null))),
    ]);
    const buyersById = new Map(buyers.map((buyer) => {
      const fullName = [buyer.profile?.firstName, buyer.profile?.lastName].filter(Boolean).join(" ").trim();
      return [String(buyer._id), {
        id: String(buyer._id),
        displayName: fullName || buyer.email || "Customer",
        email: buyer.email || null,
        phone: buyer.phone || null,
      }];
    }));
    const orderNumbers = new Map(orders.filter(Boolean).map((order) => [String(order.id), order.order_number]));
    return payments.map((payment) => ({
      ...payment,
      buyer: buyersById.get(String(payment.buyer_id || payment.buyerId || "")) || null,
      buyerName: buyersById.get(String(payment.buyer_id || payment.buyerId || ""))?.displayName || null,
      orderNumber: orderNumbers.get(String(payment.order_id || payment.orderId || "")) || null,
    }));
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

  async processWebhookEvent(event, handler) {
    const claimed = await this.paymentRepository.claimWebhookEvent(event);
    if (!claimed) return { acknowledged: true, duplicate: true };

    try {
      await handler();
      await this.paymentRepository.completeWebhookEvent(
        event.provider,
        event.providerEventId,
        "processed",
      );
      return null;
    } catch (error) {
      await this.paymentRepository.completeWebhookEvent(
        event.provider,
        event.providerEventId,
        "failed",
        error?.message || "webhook_processing_failed",
      );
      throw error;
    }
  }

  async getPaymentOptions(query = {}) {
    const cod = this.mapCodConfig(await this.paymentMethodConfigRepository.getCodConfig());
    const commerceSettings = await commerceSettingsService.getSettings();
    const orderAmount = Number(query.orderAmount || 0);
    const shippingAddress = {
      postalCode: query.postalCode || query.pincode || query.zip || "",
      country: query.country || "",
    };
    const codAllowedByZone = commerceSettingsService.isCodAllowedForAddress(
      commerceSettings,
      shippingAddress,
    );
    const sellerIds = Array.isArray(query.sellerIds)
      ? query.sellerIds
      : String(query.sellerIds || "").split(",");
    let sellerOrderAmounts = query.sellerOrderAmounts || {};
    if (typeof sellerOrderAmounts === "string") {
      try {
        sellerOrderAmounts = JSON.parse(sellerOrderAmounts);
      } catch {
        sellerOrderAmounts = {};
      }
    }
    const normalizedSellerIds = sellerIds
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    const sellerCod = normalizedSellerIds.length
      ? await sellerChargeSettingsService.evaluateCodForItems(
          normalizedSellerIds.map((sellerId) => ({
            sellerId,
            discountedLineTotal: Number(sellerOrderAmounts[sellerId] || orderAmount / normalizedSellerIds.length || 0),
            quantity: 1,
          })),
          shippingAddress,
        )
      : { allowed: true, sellerChargeAmount: 0, sellers: [] };
    const productCodDisabled = query.productCodDisabled === "true" || query.productCodDisabled === true;
    const codAvailable = cod.enabled &&
      codAllowedByZone &&
      sellerCod.allowed &&
      !productCodDisabled &&
      (cod.minOrderAmount === null || orderAmount >= cod.minOrderAmount) &&
      (cod.maxOrderAmount === null || orderAmount <= cod.maxOrderAmount);
    const codDisabledReason = productCodDisabled
      ? "COD is not available for one or more products in this cart"
      : !codAllowedByZone
        ? "COD is not available for this delivery pincode"
        : !sellerCod.allowed
          ? "COD is not available for one or more sellers in this cart"
          : null;

    return {
      settings: {
        wallet: commerceSettings.wallet,
        checkout: commerceSettings.checkout,
        cod: commerceSettings.cod,
      },
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
        {
          provider: PAYMENT_PROVIDER.COD,
          label: "Cash on Delivery",
          enabled: codAvailable,
          chargeAmount: Number((cod.chargeAmount + Number(sellerCod.sellerChargeAmount || 0)).toFixed(2)),
          payableNow: false,
          config: {
            ...cod,
            availabilityMode: commerceSettings.cod.availabilityMode,
            collectionPolicy: commerceSettings.cod.collectionPolicy,
            payoutRequiresCapture: commerceSettings.cod.payoutRequiresCapture,
            sellerChargeAmount: Number(sellerCod.sellerChargeAmount || 0),
            sellerRules: sellerCod.sellers,
          },
          ...(codDisabledReason ? { disabledReason: codDisabledReason } : {}),
        },
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
    return this.mapCodConfig(await this.paymentMethodConfigRepository.upsertCodConfig({
      ...payload,
      metadata: {
        ...(payload.metadata || {}),
        updatedBy: actor.userId,
        updatedByRole: actor.role,
        updatedAt: new Date().toISOString(),
      },
    }));
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
      const commerceSettings = await commerceSettingsService.getSettings();
      const shippingAddress = this.normalizeJson(order.shipping_address, {});
      if (!commerceSettingsService.isCodAllowedForAddress(commerceSettings, shippingAddress)) {
        throw new AppError("Cash on Delivery is not available for this delivery pincode", 400);
      }
      const hydratedOrder = await this.orderRepository.findByIdWithItems(payload.orderId);
      const sellerCod = await sellerChargeSettingsService.evaluateCodForItems(
        (hydratedOrder?.items || []).map((item) => ({
          sellerId: item.seller_id || item.sellerId,
          discountedLineTotal: Number(item.line_total || 0) - Number(item.discount_amount || 0),
          quantity: Number(item.quantity || 0),
        })),
        shippingAddress,
      );
      if (!sellerCod.allowed) {
        throw new AppError("Cash on Delivery is no longer available for one or more sellers in this order", 400);
      }
      const productCodBlocker = (hydratedOrder?.items || []).find((item) => {
        const snapshot = (typeof item.product_snapshot === "object" && item.product_snapshot)
          ? item.product_snapshot
          : {};
        const shipping = (typeof snapshot.shipping === "object" && snapshot.shipping)
          ? snapshot.shipping
          : {};
        return shipping.codAvailable === false;
      });
      if (productCodBlocker) {
        throw new AppError("Cash on Delivery is not available for one or more products in this order", 400);
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

    if (["refund.created", "refund.processed", "refund.failed"].includes(eventType)) {
      const entity = payload.payload?.refund?.entity;
      if (!entity?.id) throw new AppError("Invalid Razorpay refund webhook payload", 400);
      const eventId = payload.id || `${eventType}:${entity.id}:${entity.status || "unknown"}`;
      const orderId = entity.notes?.orderId || null;
      const duplicate = await this.processWebhookEvent({
        provider: "razorpay",
        providerEventId: eventId,
        eventType,
        paymentId: null,
        orderId,
        payload,
      }, async () => {
        const refundService = entity.notes?.cancellationId || String(entity.notes?.returnId || "").startsWith("cancellation:")
          ? this.cancellationService
          : this.returnService;
        await refundService.handleProviderRefundWebhook(entity, eventType, {
          userId: "razorpay-webhook",
          role: "system",
        });
      });
      if (duplicate) return duplicate;
      return { acknowledged: true };
    }

    if (eventType === "payment.captured") {
      const entity = payload.payload?.payment?.entity;
      if (!entity?.id || !entity?.order_id) {
        throw new AppError("Invalid Razorpay payment captured payload", 400);
      }
      const eventId = payload.id || entity.acquirer_data?.rrn || entity.id;
      const payment = await this.paymentRepository.findByProviderOrderId(entity.order_id);
      if (!payment) {
        return { acknowledged: true, ignored: true };
      }
      const duplicate = await this.processWebhookEvent({
        provider: "razorpay",
        providerEventId: eventId,
        eventType,
        paymentId: payment.id,
        orderId: payment.order_id,
        payload,
      }, async () => {
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
          { source: "payment-webhook" },
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
      });
      if (duplicate) return duplicate;
    }

    if (eventType === "payment.failed") {
      const entity = payload.payload?.payment?.entity;
      if (!entity?.id || !entity?.order_id) {
        throw new AppError("Invalid Razorpay payment failed payload", 400);
      }
      const eventId = payload.id || entity.id;
      const payment = await this.paymentRepository.findByProviderOrderId(entity.order_id);
      if (!payment) {
        return { acknowledged: true, ignored: true };
      }

      const duplicate = await this.processWebhookEvent({
        provider: "razorpay",
        providerEventId: eventId,
        eventType,
        paymentId: payment.id,
        orderId: payment.order_id,
        payload,
      }, async () => {
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
          { source: "payment-webhook" },
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
      });
      if (duplicate) return duplicate;
    }

    if (eventType === "refund.processed" || eventType === "payment.refunded") {
      const entity = payload.payload?.refund?.entity || payload.payload?.payment?.entity;
      if (!entity?.id) {
        throw new AppError("Invalid Razorpay refund payload", 400);
      }
      const providerPaymentId = entity.payment_id || entity.id;
      const eventId = payload.id || entity.id;
      const payment = await this.paymentRepository.findByProviderPaymentId(providerPaymentId);
      if (!payment) {
        return { acknowledged: true, ignored: true };
      }
      const duplicate = await this.processWebhookEvent({
        provider: "razorpay",
        providerEventId: eventId,
        eventType,
        paymentId: payment.id,
        orderId: payment.order_id,
        payload,
      }, async () => {
        const paymentAmount = Number(payment.amount || 0);
        const rawRefundAmount = Number(entity.amount || 0);
        const refundAmount = rawRefundAmount > paymentAmount && rawRefundAmount >= 100
          ? Number((rawRefundAmount / 100).toFixed(2))
          : rawRefundAmount;
        const metadata = typeof payment.metadata === "object" && payment.metadata ? payment.metadata : {};
        const knownRefundedAmount = Math.max(
          Number(metadata.returnRefund?.refundedAmount || 0),
          Number(metadata.refundWebhook?.totalRefundedAmount || 0),
          refundAmount,
        );
        const paymentStatus = paymentAmount > 0 && knownRefundedAmount >= paymentAmount - 0.01
          ? PAYMENT_STATUS.REFUNDED
          : PAYMENT_STATUS.PARTIALLY_REFUNDED;
        await this.paymentRepository.updatePaymentStatus(payment.id, {
          status: paymentStatus,
          providerPaymentId,
          verificationMethod: "webhook",
          metadata: {
            ...entity,
            refundWebhook: {
              refundId: entity.id,
              refundAmount,
              totalRefundedAmount: knownRefundedAmount,
              paymentAmount,
              paymentStatus,
              eventType,
            },
          },
          verifiedAt: new Date(),
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
            amount: refundAmount,
            paymentStatus,
          },
          { source: "payment-webhook" },
        );
        const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
        await eventPublisher.publish(refundEvent);
      });
      if (duplicate) return duplicate;
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
    const result = await this.paymentRepository.listPaymentsForAdmin({
      ...query,
      limit: Number(query.limit || 50),
      offset: Number(query.offset || 0),
    });
    return { ...result, items: await this.enrichAdminPayments(result.items || []) };
  }

  async getPaymentForAdmin(paymentId, actor) {
    if (!["admin", "sub-admin", "super-admin"].includes(actor.role) && !actor.isSuperAdmin) {
      throw new AppError("Only admin users can view payment details", 403);
    }
    const payment = await this.paymentRepository.findById(paymentId);
    if (!payment) throw new AppError("Payment not found", 404);
    return (await this.enrichAdminPayments([payment]))[0];
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
    if (![PAYMENT_STATUS.INITIATED, PAYMENT_STATUS.AUTHORIZED].includes(payment.status)) {
      throw new AppError(`Payment in '${payment.status}' status cannot be approved`, 409);
    }

    const updatedPayment = await this.paymentRepository.updatePaymentStatus(paymentId, {
      status: PAYMENT_STATUS.CAPTURED,
      providerPaymentId: payload.referenceId || payment.provider_payment_id,
      verificationMethod: "admin_approval",
      metadata: {
        approvalReason: payload.reason || null,
        referenceId: payload.referenceId,
        approvedBy: actor.userId,
        approvedByRole: actor.role,
      },
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
    if (![PAYMENT_PROVIDER.MANUAL_BANK_TRANSFER, PAYMENT_PROVIDER.MANUAL_UPI, PAYMENT_PROVIDER.COD].includes(payment.provider)) {
      throw new AppError("Only manual/COD payments can be rejected here", 400);
    }
    if (payment.status === PAYMENT_STATUS.FAILED) return mapPaymentResponse(payment);
    if (![PAYMENT_STATUS.INITIATED, PAYMENT_STATUS.AUTHORIZED].includes(payment.status)) {
      throw new AppError(`Payment in '${payment.status}' status cannot be rejected`, 409);
    }

    const updatedPayment = await this.paymentRepository.updatePaymentStatus(paymentId, {
      status: PAYMENT_STATUS.FAILED,
      verificationMethod: "admin_rejection",
      metadata: {
        rejectionReason: payload.reason,
        rejectedBy: actor.userId,
        rejectedByRole: actor.role,
      },
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
