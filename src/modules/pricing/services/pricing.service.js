const { AppError } = require("../../../shared/errors/app-error");
const { COUPON_TYPE } = require("../../../shared/domain/commerce-constants");
const { PricingRepository } = require("../repositories/pricing.repository");
const { ProductRepository } = require("../../product/repositories/product.repository");
const { WalletRepository } = require("../../wallet/repositories/wallet.repository");
const { PlatformRepository } = require("../../platform/repositories/platform.repository");
const { PaymentMethodConfigRepository } = require("../../payment/repositories/payment-method-config.repository");
const { DealService } = require("../../deal/services/deal.service");
const { PAYMENT_PROVIDER } = require("../../../shared/domain/commerce-constants");
const { redis } = require("../../../infrastructure/redis/redis-client");
const { env } = require("../../../config/env");
const { isPublicProduct } = require("../../../shared/catalog/public-product-filter");
const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

class PricingService {
  constructor({
    pricingRepository = new PricingRepository(),
    productRepository = new ProductRepository(),
    walletRepository = new WalletRepository(),
    platformRepository = new PlatformRepository(),
    paymentMethodConfigRepository = new PaymentMethodConfigRepository(),
    dealService = new DealService(),
    redisClient = redis,
  } = {}) {
    this.pricingRepository = pricingRepository;
    this.productRepository = productRepository;
    this.walletRepository = walletRepository;
    this.platformRepository = platformRepository;
    this.paymentMethodConfigRepository = paymentMethodConfigRepository;
    this.dealService = dealService;
    this.redis = redisClient;
  }

  async priceOrder({ items, couponCode = null, walletAmount = 0, shippingAddress, userId, paymentProvider = PAYMENT_PROVIDER.RAZORPAY }) {
    const productIds = [...new Set(items.map((item) => String(item.productId || "")).filter(Boolean))];
    productIds.forEach((productId) => {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new AppError("Invalid product id in checkout", 400);
      }
    });
    const products = await this.productRepository.findByIds(productIds);
    const productMap = new Map(products.map((product) => [String(product.id), product]));

    const pricedItems = await Promise.all(
      items.map(async (item) => {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new AppError(`Product ${item.productId} not found`, 404);
        }

        if (!isPublicProduct(product)) {
          throw new AppError(`Product ${item.productId} is not available for checkout`, 400);
        }

        const variant = item.variantSku || item.variantId
          ? (product.variants || []).find(
              (candidate) =>
                String(candidate.sku || "") === String(item.variantSku || "") ||
                String(candidate._id || candidate.id || "") === String(item.variantId || ""),
            )
          : null;

        if ((product.hasVariants || (product.variants || []).length > 0) && !variant) {
          throw new AppError(`Select a valid variant for ${product.title}`, 400);
        }

        if (variant?.status && variant.status !== "active") {
          throw new AppError(`Selected variant for ${product.title} is not active`, 400);
        }

        const availableStock = variant
          ? (Number(variant.stock) || 0) - (Number(variant.reservedStock) || 0)
          : product.stock - product.reservedStock;
        const trackInventory = product.inventorySettings?.trackInventory !== false;
        const allowBackorder = product.inventorySettings?.allowBackorder === true;
        if (trackInventory && !allowBackorder && availableStock < item.quantity) {
          throw new AppError(`Insufficient stock for product ${product.title}`, 409);
        }

        const taxData = await this.getProductTaxData(product);
        const baseUnitPrice = Number(variant?.salePrice ?? variant?.price ?? product.salePrice ?? product.price);
        const activeDeal = await this.dealService.findActiveDealForItem({
          productId: String(product.id),
          variantId: variant ? String(variant._id || variant.id || item.variantId || "") : item.variantId,
          variantSku: variant?.sku || item.variantSku || "",
          sellerId: product.sellerId,
        });
        if (activeDeal?.maxQuantityPerOrder && Number(item.quantity || 0) > Number(activeDeal.maxQuantityPerOrder)) {
          throw new AppError(`Deal quantity limit is ${activeDeal.maxQuantityPerOrder} for ${product.title}`, 409);
        }
        const unitPrice = activeDeal && activeDeal.dealType !== "sponsored_placement"
          ? Number(activeDeal.dealPrice)
          : baseUnitPrice;
        const lineTotal = unitPrice * item.quantity;
        const gstInclusive = Boolean(product.gstInclusive ?? product.gst_inclusive ?? true);

        return {
          productId: String(product.id),
          title: product.title,
          slug: product.slug,
          sku: variant?.sku || product.sku || item.variantSku || "",
          image: variant?.images?.[0] || product.images?.[0] || null,
          brand: product.brand || null,
          variantId: variant ? String(variant._id || variant.id || item.variantId || "") : "",
          variantSku: variant?.sku || item.variantSku || "",
          variantTitle: variant?.title || item.variantTitle || "",
          attributes: variant?.attributes || item.attributes || {},
          sellerId: product.sellerId,
          category: product.category,
          quantity: item.quantity,
          unitPrice,
          originalUnitPrice: baseUnitPrice,
          lineTotal,
          dealId: activeDeal?.dealId || null,
          dealSnapshot: activeDeal || {},
          fulfillmentSnapshot: activeDeal?.fulfillmentSnapshot || {},
          dealDiscountAmount: activeDeal && activeDeal.dealType !== "sponsored_placement"
            ? Number(((baseUnitPrice - unitPrice) * item.quantity).toFixed(2))
            : 0,
          gstRate: taxData.gstRate,
          cessRate: taxData.cessRate,
          gstInclusive,
          hsnCode: product.hsnCode,
          taxExempt: taxData.exempt,
          taxType: taxData.taxType,
          origin: product.origin || {},
          productSnapshot: {
            title: product.title,
            slug: product.slug,
            sku: variant?.sku || product.sku || "",
            variantTitle: variant?.title || "",
            brand: product.brand || null,
            category: product.category,
            image: variant?.images?.[0] || product.images?.[0] || null,
            hsnCode: product.hsnCode || null,
            gstRate: taxData.gstRate,
            gstInclusive,
            dealId: activeDeal?.dealId || null,
            dealNumber: activeDeal?.dealNumber || null,
          },
        };
      }),
    );

    const subtotalAmount = pricedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const discount = await this.calculateDiscount(couponCode, subtotalAmount, userId);
    const taxBreakup = await this.calculateTaxBreakup(
      pricedItems,
      subtotalAmount,
      discount.discountAmount,
      shippingAddress,
    );
    const platformFee = await this.calculatePlatformFee(pricedItems);
    for (const item of pricedItems) {
      const fee = platformFee.breakup.find((entry) => entry.productId === item.productId);
      if (fee) {
        item.platformFeeAmount = fee.totalFee;
        item.settlementAmount = Number(
          Math.max(0, Number(item.taxableAmount || item.lineTotal || 0) - Number(fee.totalFee || 0)).toFixed(2),
        );
        item.pricingSnapshot = {
          commissionPercent: fee.commissionPercent,
          commissionFee: fee.commissionFee,
          fixedFee: fee.fixedFee,
          closingFee: fee.closingFee,
          platformFeeAmount: fee.totalFee,
        };
      }
    }
    const codCharge = await this.calculateCodCharge(paymentProvider, subtotalAmount - discount.discountAmount);
    const walletBreakup = await this.calculateWalletUsage(userId, walletAmount, subtotalAmount);
    const customerItemsAmount = Number((subtotalAmount - discount.discountAmount).toFixed(2));
    const totalAmount = Number(
      (customerItemsAmount + taxBreakup.taxPayableAmount + codCharge.amount).toFixed(2),
    );
    const payableAmount = Number((totalAmount - walletBreakup.walletAppliedAmount).toFixed(2));
    const settlement = this.calculateSellerSettlement(pricedItems);

    return {
      items: pricedItems,
      pricing: {
        subtotalAmount,
        customerItemsAmount,
        discountAmount: discount.discountAmount,
        walletAppliedAmount: walletBreakup.walletAppliedAmount,
        taxAmount: taxBreakup.totalTaxAmount,
        taxIncludedAmount: taxBreakup.taxIncludedAmount,
        taxPayableAmount: taxBreakup.taxPayableAmount,
        taxBreakup,
        platformFeeAmount: platformFee.totalFeeAmount,
        platformFeeBreakup: platformFee.breakup,
        sellerSettlementBreakup: settlement.sellers,
        sellerPayoutAmount: settlement.totalSellerPayout,
        paymentProvider,
        codChargeAmount: codCharge.amount,
        codChargeBreakup: codCharge.breakup,
        totalAmount,
        payableAmount,
        appliedCouponCode: discount.appliedCouponCode,
      },
      couponToConsume: discount.couponToConsume,
      walletToReserveAmount: walletBreakup.walletAppliedAmount,
    };
  }

  calculateSellerSettlement(pricedItems) {
    const sellers = new Map();
    for (const item of pricedItems) {
      const sellerId = item.sellerId || "platform";
      const current = sellers.get(sellerId) || {
        sellerId,
        grossSalesAmount: 0,
        taxableAmount: 0,
        taxAmount: 0,
        platformFeeAmount: 0,
        sellerPayoutAmount: 0,
      };
      current.grossSalesAmount += Number(item.lineTotal || 0);
      current.taxableAmount += Number(item.taxableAmount || 0);
      current.taxAmount += Number(item.taxAmount || 0);
      current.platformFeeAmount += Number(item.platformFeeAmount || 0);
      current.sellerPayoutAmount += Number(item.settlementAmount || 0);
      sellers.set(sellerId, current);
    }

    const normalized = [...sellers.values()].map((seller) => ({
      ...seller,
      grossSalesAmount: Number(seller.grossSalesAmount.toFixed(2)),
      taxableAmount: Number(seller.taxableAmount.toFixed(2)),
      taxAmount: Number(seller.taxAmount.toFixed(2)),
      platformFeeAmount: Number(seller.platformFeeAmount.toFixed(2)),
      sellerPayoutAmount: Number(seller.sellerPayoutAmount.toFixed(2)),
    }));

    return {
      sellers: normalized,
      totalSellerPayout: Number(normalized.reduce((sum, seller) => sum + seller.sellerPayoutAmount, 0).toFixed(2)),
    };
  }

  async calculateCodCharge(paymentProvider, orderAmount) {
    if (paymentProvider !== PAYMENT_PROVIDER.COD) {
      return { amount: 0, breakup: null };
    }

    const config = await this.paymentMethodConfigRepository.getCodConfig();
    if (!config.enabled) {
      throw new AppError("Cash on Delivery is currently disabled", 400);
    }

    const amount = Number(orderAmount || 0);
    const min = config.min_order_amount === null || config.min_order_amount === undefined ? null : Number(config.min_order_amount);
    const max = config.max_order_amount === null || config.max_order_amount === undefined ? null : Number(config.max_order_amount);
    if (min !== null && amount < min) {
      throw new AppError(`Cash on Delivery is available for orders above ${min}`, 400);
    }
    if (max !== null && amount > max) {
      throw new AppError(`Cash on Delivery is available for orders up to ${max}`, 400);
    }

    const charge = Number(Number(config.charge_amount || 0).toFixed(2));
    return {
      amount: charge,
      breakup: {
        method: PAYMENT_PROVIDER.COD,
        enabled: Boolean(config.enabled),
        chargeAmount: charge,
        minOrderAmount: min,
        maxOrderAmount: max,
        currency: config.currency || "INR",
      },
    };
  }

  async calculatePlatformFee(pricedItems) {
    const categories = pricedItems.map((item) => item.category).filter(Boolean);
    const rules = await this.pricingRepository.listActivePlatformFeeRules(categories);
    if (!rules.length) {
      return { totalFeeAmount: 0, breakup: [] };
    }

    const perCategory = new Map();
    let defaultRule = null;

    for (const rule of rules) {
      const key = String(rule.category || "").trim().toLowerCase();
      if (key === "default" || key === "*") {
        if (!defaultRule) {
          defaultRule = rule;
        }
      } else if (!perCategory.has(key)) {
        perCategory.set(key, rule);
      }
    }

    const breakup = [];
    let totalFeeAmount = 0;

    for (const item of pricedItems) {
      const dealRule = item.dealSnapshot?.commissionRuleSnapshot || {};
      const hasDealCommission = Boolean(item.dealId && (
        dealRule.id ||
        dealRule.commission_percent !== undefined ||
        dealRule.commissionPercent !== undefined ||
        dealRule.fixed_fee !== undefined ||
        dealRule.fixedFee !== undefined
      ));
      const key = String(item.category || "").trim().toLowerCase();
      const rule = hasDealCommission ? null : perCategory.get(key) || defaultRule;
      if (!rule && !hasDealCommission) {
        continue;
      }

      const commissionPercent = hasDealCommission
        ? Number(dealRule.commission_percent ?? dealRule.commissionPercent ?? 0)
        : Number(rule.commission_percent || 0);
      const fixedFeeAmount = hasDealCommission
        ? Number(dealRule.fixed_fee ?? dealRule.fixedFee ?? 0)
        : Number(rule.fixed_fee_amount || 0);
      const closingFeeAmount = hasDealCommission ? 0 : Number(rule.closing_fee_amount || 0);
      const capAmount = hasDealCommission && dealRule.cap_amount !== null && dealRule.cap_amount !== undefined
        ? Number(dealRule.cap_amount)
        : hasDealCommission && dealRule.capAmount !== null && dealRule.capAmount !== undefined
          ? Number(dealRule.capAmount)
          : null;

      const commissionFee = Number(((item.lineTotal * commissionPercent) / 100).toFixed(2));
      const fixedFee = Number((fixedFeeAmount * item.quantity).toFixed(2));
      const closingFee = Number((closingFeeAmount * item.quantity).toFixed(2));
      const rawItemFeeTotal = Number((commissionFee + fixedFee + closingFee).toFixed(2));
      const itemFeeTotal = capAmount !== null ? Math.min(rawItemFeeTotal, capAmount) : rawItemFeeTotal;

      totalFeeAmount += itemFeeTotal;
      breakup.push({
        productId: item.productId,
        sellerId: item.sellerId,
        dealId: item.dealId || null,
        category: item.category,
        quantity: item.quantity,
        commissionPercent,
        commissionFee,
        fixedFee,
        closingFee,
        totalFee: itemFeeTotal,
        configId: hasDealCommission ? dealRule.id || item.dealId : rule.id,
        source: hasDealCommission ? "deal_commission_rule" : "platform_fee_rule",
      });
    }

    return { totalFeeAmount: Number(totalFeeAmount.toFixed(2)), breakup };
  }

  async finalizeCouponUsage(couponId) {
    if (!couponId) {
      return null;
    }

    return this.pricingRepository.incrementCouponUsage(couponId);
  }

  getSellerCouponScope(actor = {}) {
    if (!["seller", "seller-admin", "seller-sub-admin"].includes(actor.role)) {
      return {};
    }
    const sellerId = actor.ownerSellerId || actor.userId;
    return {
      sellerId,
      ...(["seller-admin", "seller-sub-admin"].includes(actor.role)
        ? { createdBy: actor.userId }
        : {}),
    };
  }

  async createCoupon(payload, actor = {}) {
    return this.pricingRepository.createCoupon({
      ...this.normalizeCouponPayload(payload),
      ...this.getSellerCouponScope(actor),
      createdBy: actor.userId || this.getSellerCouponScope(actor).createdBy,
    });
  }

  async listCoupons(actor = {}) {
    return this.pricingRepository.listCoupons(this.getSellerCouponScope(actor));
  }

  async getCoupon(couponId, actor = {}) {
    const coupon = await this.pricingRepository.findCouponById(couponId, this.getSellerCouponScope(actor));
    if (!coupon) {
      throw new AppError("Coupon not found", 404);
    }
    return coupon;
  }

  async updateCoupon(couponId, payload, actor = {}) {
    const coupon = await this.pricingRepository.updateCoupon(
      couponId,
      this.normalizeCouponPayload(payload),
      this.getSellerCouponScope(actor),
    );
    if (!coupon) {
      throw new AppError("Coupon not found", 404);
    }
    return coupon;
  }

  normalizeCouponPayload(payload = {}) {
    const normalized = { ...payload };
    if (normalized.type === "flat") normalized.type = "fixed";
    if (typeof normalized.isDisable === "boolean" && typeof normalized.active !== "boolean") {
      normalized.active = !normalized.isDisable;
    }
    delete normalized.isDisable;
    return normalized;
  }

  async deleteCoupon(couponId, actor = {}) {
    const coupon = await this.pricingRepository.deleteCoupon(couponId, this.getSellerCouponScope(actor));
    if (!coupon) {
      throw new AppError("Coupon not found", 404);
    }
    return coupon;
  }

  async calculateTaxBreakup(pricedItems, subtotalAmount, discountAmount, shippingAddress = {}) {
    const buyerState = String(shippingAddress?.state || "").trim().toUpperCase();
    const buyerCountry = String(shippingAddress?.country || "INDIA").trim().toUpperCase();
    const businessState = String(env.commerce.businessState || "").trim().toUpperCase();

    const result = {
      taxableAmount: Number((subtotalAmount - discountAmount).toFixed(2)),
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      cessAmount: 0,
      totalTaxAmount: 0,
      taxMode: "cgst_sgst",
      items: [],
    };

    let totalTaxAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;
    let cessAmount = 0;
    let hasMixedTaxMode = false;

    const isExport = buyerCountry !== "INDIA";

    for (const item of pricedItems) {
      const proportion = subtotalAmount > 0 ? item.lineTotal / subtotalAmount : 0;
      const itemDiscount = Number((discountAmount * proportion).toFixed(2));
      const discountedLineTotal = Number((item.lineTotal - itemDiscount).toFixed(2));
      let taxableAmount = discountedLineTotal;

      let itemTax = 0;
      let itemCess = 0;
      let itemTaxMode = "cgst_sgst";

      if (item.taxExempt || item.gstRate === 0) {
        itemTaxMode = isExport ? "zero_rated_export" : "exempt";
      } else if (isExport) {
        itemTaxMode = "zero_rated_export";
      } else {
        const originCountry = String(item.origin?.country || "INDIA").trim().toUpperCase();
        const originState = String(item.origin?.state || "").trim().toUpperCase();

        if (originCountry !== "INDIA") {
          itemTaxMode = "igst";
        } else if (originState !== businessState || buyerState !== businessState) {
          itemTaxMode = "igst";
        } else {
          itemTaxMode = "cgst_sgst";
        }
      }

      if (itemTaxMode !== "zero_rated_export" && itemTaxMode !== "exempt") {
        if (item.gstInclusive) {
          const totalRate = Number(item.gstRate || 0) + Number(item.cessRate || 0);
          taxableAmount = totalRate > 0
            ? Number(((discountedLineTotal * 100) / (100 + totalRate)).toFixed(2))
            : discountedLineTotal;
          itemTax = Number((taxableAmount * (item.gstRate / 100)).toFixed(2));
          itemCess = Number((discountedLineTotal - taxableAmount - itemTax).toFixed(2));
        } else {
          itemTax = Number((taxableAmount * (item.gstRate / 100)).toFixed(2));
          itemCess = Number((taxableAmount * (item.cessRate / 100)).toFixed(2));
        }
      }

      totalTaxAmount += itemTax + itemCess;
      cessAmount += itemCess;

      if (itemTaxMode === "cgst_sgst") {
        cgstAmount += Number((itemTax / 2).toFixed(2));
        sgstAmount += Number((itemTax / 2).toFixed(2));
      } else if (itemTaxMode === "igst") {
        igstAmount += itemTax;
      }

      if (result.items.length > 0 && result.items.some((existing) => existing.taxMode !== itemTaxMode)) {
        hasMixedTaxMode = true;
      }
      if (result.items.length === 0 && itemTaxMode !== result.taxMode) {
        result.taxMode = itemTaxMode;
      }

      result.items.push({
        productId: item.productId,
        lineTotal: item.lineTotal,
        discountedLineTotal,
        taxableAmount,
        gstRate: item.gstRate,
        cessRate: item.cessRate,
        gstInclusive: Boolean(item.gstInclusive),
        taxType: item.taxType,
        taxMode: itemTaxMode,
        taxAmount: itemTax,
        cessAmount: itemCess,
        taxIncludedAmount: item.gstInclusive ? itemTax + itemCess : 0,
        taxPayableAmount: item.gstInclusive ? 0 : itemTax + itemCess,
      });
    }

    for (const item of pricedItems) {
      const itemTax = result.items.find((taxItem) => taxItem.productId === item.productId);
      if (itemTax) {
        item.taxAmount = itemTax.taxAmount + itemTax.cessAmount;
        item.taxableAmount = itemTax.taxableAmount;
        item.taxIncludedAmount = itemTax.taxIncludedAmount;
        item.taxPayableAmount = itemTax.taxPayableAmount;
        item.taxBreakup = itemTax;
        item.settlementAmount = Number(Math.max(0, itemTax.taxableAmount - Number(item.platformFeeAmount || 0)).toFixed(2));
      }
    }

    result.cgstAmount = Number(cgstAmount.toFixed(2));
    result.sgstAmount = Number(sgstAmount.toFixed(2));
    result.igstAmount = Number(igstAmount.toFixed(2));
    result.cessAmount = Number(cessAmount.toFixed(2));
    result.taxableAmount = Number(result.items.reduce((sum, item) => sum + Number(item.taxableAmount || 0), 0).toFixed(2));
    result.totalTaxAmount = Number(totalTaxAmount.toFixed(2));
    result.taxIncludedAmount = Number(result.items.reduce((sum, item) => sum + Number(item.taxIncludedAmount || 0), 0).toFixed(2));
    result.taxPayableAmount = Number(result.items.reduce((sum, item) => sum + Number(item.taxPayableAmount || 0), 0).toFixed(2));
    result.taxMode = hasMixedTaxMode
      ? "mixed"
      : isExport
      ? "zero_rated_export"
      : buyerState === businessState
      ? "cgst_sgst"
      : "igst";

    return result;
  }

  async calculateWalletUsage(userId, requestedAmount, subtotalAmount) {
    if (!userId || !requestedAmount || requestedAmount <= 0) {
      return { walletAppliedAmount: 0 };
    }

    const wallet = await this.walletRepository.findWalletByUserId(userId);
    if (!wallet) {
      return { walletAppliedAmount: 0 };
    }

    const maxWalletByPolicy = (subtotalAmount * env.commerce.maxWalletUsagePerOrderPercent) / 100;
    const walletAppliedAmount = Number(
      Math.min(Number(requestedAmount), Number(wallet.available_balance), maxWalletByPolicy).toFixed(2),
    );

    return { walletAppliedAmount };
  }

  async getProductTaxData(product) {
    const defaultTax = {
      gstRate: Number(product.gstRate || 18),
      cessRate: 0,
      exempt: false,
      taxType: "gst",
    };

    if (!product.hsnCode) {
      return defaultTax;
    }

    // Check cache first
    const cacheKey = `hsn:${product.hsnCode}`;
    try {
      const cachedData = await this.redis.get(cacheKey);
      if (cachedData) {
        return JSON.parse(cachedData);
      }
    } catch (error) {
      // Continue without cache if Redis fails
    }

    const hsnRule = await this.platformRepository.getHsnCode(product.hsnCode);
    if (!hsnRule) {
      return defaultTax;
    }

    const taxData = {
      gstRate: Number(hsnRule.gstRate || product.gstRate || 18),
      cessRate: Number(hsnRule.cessRate || 0),
      exempt: Boolean(hsnRule.exempt),
      taxType: hsnRule.taxType || "gst",
    };

    // Cache for 1 hour
    try {
      await this.redis.setex(cacheKey, 3600, JSON.stringify(taxData));
    } catch (error) {
      // Continue without caching if Redis fails
    }

    return taxData;
  }

  async calculateDiscount(couponCode, subtotalAmount, userId = null) {
    if (!couponCode) {
      return { discountAmount: 0, appliedCouponCode: null, couponToConsume: null };
    }

    const coupon = await this.pricingRepository.findCouponByCode(couponCode);
    if (!coupon || !coupon.active) {
      throw new AppError("Invalid coupon code", 400);
    }

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new AppError("Coupon is not active yet", 400);
    }

    if (coupon.expiresAt && coupon.expiresAt < now) {
      throw new AppError("Coupon has expired", 400);
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new AppError("Coupon usage limit reached", 400);
    }

    if (coupon.usesPerCustomer && userId) {
      const customerUsageCount = await this.pricingRepository.countCouponUsageByCustomer(coupon.code, userId);
      if (customerUsageCount >= coupon.usesPerCustomer) {
        throw new AppError(`This coupon can only be used ${coupon.usesPerCustomer} time(s) per customer`, 400);
      }
    }

    if (subtotalAmount < coupon.minOrderAmount) {
      throw new AppError("Order does not meet coupon minimum amount", 400);
    }

    let discountAmount = 0;
    if (coupon.type === COUPON_TYPE.PERCENTAGE) {
      discountAmount = subtotalAmount * (coupon.value / 100);
      if (coupon.maxDiscountAmount) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
      }
    }

    if (coupon.type === COUPON_TYPE.FIXED) {
      discountAmount = coupon.value;
    }

    discountAmount = Number(Math.min(discountAmount, subtotalAmount).toFixed(2));

    return {
      discountAmount,
      appliedCouponCode: coupon.code,
      couponToConsume: coupon.id,
    };
  }
}

module.exports = { PricingService };
