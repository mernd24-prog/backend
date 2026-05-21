const { AppError } = require("../../../shared/errors/app-error");
const { COUPON_TYPE } = require("../../../shared/domain/commerce-constants");
const { PricingRepository } = require("../repositories/pricing.repository");
const { ProductRepository } = require("../../product/repositories/product.repository");
const { WalletRepository } = require("../../wallet/repositories/wallet.repository");
const { PlatformRepository } = require("../../platform/repositories/platform.repository");
const { redis } = require("../../../infrastructure/redis/redis-client");
const { env } = require("../../../config/env");

class PricingService {
  constructor({
    pricingRepository = new PricingRepository(),
    productRepository = new ProductRepository(),
    walletRepository = new WalletRepository(),
    platformRepository = new PlatformRepository(),
    redisClient = redis,
  } = {}) {
    this.pricingRepository = pricingRepository;
    this.productRepository = productRepository;
    this.walletRepository = walletRepository;
    this.platformRepository = platformRepository;
    this.redis = redisClient;
  }

  async priceOrder({ items, couponCode = null, walletAmount = 0, shippingAddress, userId }) {
    const productIds = items.map((item) => item.productId);
    const products = await this.productRepository.findByIds(productIds);
    const productMap = new Map(products.map((product) => [String(product.id), product]));

    const pricedItems = await Promise.all(
      items.map(async (item) => {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new AppError(`Product ${item.productId} not found`, 404);
        }

        if (product.status !== "active") {
          throw new AppError(`Product ${item.productId} is not active`, 400);
        }

        const availableStock = product.stock - product.reservedStock;
        if (availableStock < item.quantity) {
          throw new AppError(`Insufficient stock for product ${product.title}`, 409);
        }

        const taxData = await this.getProductTaxData(product);
        const unitPrice = Number(product.price);
        const lineTotal = unitPrice * item.quantity;

        return {
          productId: String(product.id),
          sellerId: product.sellerId,
          category: product.category,
          quantity: item.quantity,
          unitPrice,
          lineTotal,
          gstRate: taxData.gstRate,
          cessRate: taxData.cessRate,
          hsnCode: product.hsnCode,
          taxExempt: taxData.exempt,
          taxType: taxData.taxType,
          origin: product.origin || {},
          title: product.title,
        };
      }),
    );

    const subtotalAmount = pricedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const discount = await this.calculateDiscount(couponCode, subtotalAmount);
    const taxBreakup = await this.calculateTaxBreakup(
      pricedItems,
      subtotalAmount,
      discount.discountAmount,
      shippingAddress,
    );
    const platformFee = await this.calculatePlatformFee(pricedItems);
    const walletBreakup = await this.calculateWalletUsage(userId, walletAmount, subtotalAmount);
    const totalAmount = Number(
      (subtotalAmount - discount.discountAmount + taxBreakup.totalTaxAmount + platformFee.totalFeeAmount).toFixed(2),
    );
    const payableAmount = Number((totalAmount - walletBreakup.walletAppliedAmount).toFixed(2));

    return {
      items: pricedItems,
      pricing: {
        subtotalAmount,
        discountAmount: discount.discountAmount,
        walletAppliedAmount: walletBreakup.walletAppliedAmount,
        taxAmount: taxBreakup.totalTaxAmount,
        taxBreakup,
        platformFeeAmount: platformFee.totalFeeAmount,
        platformFeeBreakup: platformFee.breakup,
        totalAmount,
        payableAmount,
        appliedCouponCode: discount.appliedCouponCode,
      },
      couponToConsume: discount.couponToConsume,
      walletToReserveAmount: walletBreakup.walletAppliedAmount,
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
      const key = String(item.category || "").trim().toLowerCase();
      const rule = perCategory.get(key) || defaultRule;
      if (!rule) {
        continue;
      }

      const commissionPercent = Number(rule.commission_percent || 0);
      const fixedFeeAmount = Number(rule.fixed_fee_amount || 0);
      const closingFeeAmount = Number(rule.closing_fee_amount || 0);

      const commissionFee = Number(((item.lineTotal * commissionPercent) / 100).toFixed(2));
      const fixedFee = Number((fixedFeeAmount * item.quantity).toFixed(2));
      const closingFee = Number((closingFeeAmount * item.quantity).toFixed(2));
      const itemFeeTotal = Number((commissionFee + fixedFee + closingFee).toFixed(2));

      totalFeeAmount += itemFeeTotal;
      breakup.push({
        productId: item.productId,
        sellerId: item.sellerId,
        category: item.category,
        quantity: item.quantity,
        commissionPercent,
        commissionFee,
        fixedFee,
        closingFee,
        totalFee: itemFeeTotal,
        configId: rule.id,
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
      const taxableAmount = Number((item.lineTotal - itemDiscount).toFixed(2));

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
        itemTax = Number((taxableAmount * (item.gstRate / 100)).toFixed(2));
        itemCess = Number((taxableAmount * (item.cessRate / 100)).toFixed(2));
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
        taxableAmount,
        gstRate: item.gstRate,
        cessRate: item.cessRate,
        taxType: item.taxType,
        taxMode: itemTaxMode,
        taxAmount: itemTax,
        cessAmount: itemCess,
      });
    }

    result.cgstAmount = Number(cgstAmount.toFixed(2));
    result.sgstAmount = Number(sgstAmount.toFixed(2));
    result.igstAmount = Number(igstAmount.toFixed(2));
    result.cessAmount = Number(cessAmount.toFixed(2));
    result.totalTaxAmount = Number(totalTaxAmount.toFixed(2));
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

  async calculateDiscount(couponCode, subtotalAmount) {
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
