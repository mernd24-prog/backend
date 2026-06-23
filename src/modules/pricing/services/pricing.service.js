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
const { commerceSettingsService } = require("../../admin/services/commerce-settings.service");
const { sellerChargeSettingsService } = require("../../seller/services/seller-charge-settings.service");

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
        const hasActiveDealPrice = activeDeal?.dealId && activeDeal.dealType !== "sponsored_placement";
        const unitPrice = hasActiveDealPrice
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
          organizationId: product.organizationId || null,
          storeId: product.storeId || null,
          warehouseId: product.warehouseId || null,
          organizationSnapshot: product.organizationSnapshot || {},
          category: product.category,
          quantity: item.quantity,
          unitPrice,
          originalUnitPrice: baseUnitPrice,
          lineTotal,
          dealId: activeDeal?.dealId || null,
          dealSnapshot: activeDeal || {},
          fulfillmentSnapshot: activeDeal?.fulfillmentSnapshot || {},
          dealDiscountAmount: hasActiveDealPrice
            ? Number(((baseUnitPrice - unitPrice) * item.quantity).toFixed(2))
            : 0,
          gstRate: taxData.gstRate,
          cessRate: taxData.cessRate,
          gstInclusive,
          hsnCode: product.hsnCode,
          taxExempt: taxData.exempt,
          taxType: taxData.taxType,
          origin: product.origin || {},
          shipping: product.shipping || {},
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
            organizationId: product.organizationId || null,
            storeId: product.storeId || null,
            warehouseId: product.warehouseId || null,
            shipping: product.shipping || {},
          },
        };
      }),
    );

    const subtotalAmount = pricedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const discount = await this.calculateDiscount(couponCode, subtotalAmount, userId);
    const commerceSettings = await commerceSettingsService.getSettings();
    const taxBreakup = await this.calculateTaxBreakup(
      pricedItems,
      subtotalAmount,
      discount.discountAmount,
      shippingAddress,
    );
    const platformFee = await this.calculatePlatformFee(pricedItems, {
      subtotalAmount,
      discountAmount: discount.discountAmount,
      customerItemsAmount: Number((subtotalAmount - discount.discountAmount).toFixed(2)),
    });
    for (const item of pricedItems) {
      const fee = platformFee.breakup.find((entry) => entry.productId === item.productId);
      const platformFeeAmount = Number(fee?.sellerFeeTotal ?? fee?.totalFee ?? 0);
      const platformFeeTaxAmount = commerceSettings.finance.chargePlatformFeeTaxToSeller
        ? Number(((platformFeeAmount * Number(commerceSettings.finance.platformFeeTaxRate || 0)) / 100).toFixed(2))
        : 0;
      const discountedLineTotal = Number(item.discountedLineTotal ?? item.lineTotal ?? 0);
      const sellerPayoutBaseAmount = commerceSettings.finance.sellerPayoutBase === "taxable_ex_gst"
        ? Number(item.taxableAmount || 0)
        : discountedLineTotal;
      item.platformFeeAmount = platformFeeAmount;
      item.platformFeeTaxAmount = platformFeeTaxAmount;
      item.sellerPayoutBaseAmount = Number(sellerPayoutBaseAmount.toFixed(2));
      item.productTaxLiabilityAmount = Number(item.taxAmount || 0);
      item.settlementAmount = Number(
        Math.max(0, sellerPayoutBaseAmount - platformFeeAmount - platformFeeTaxAmount).toFixed(2),
      );
      item.pricingSnapshot = {
        commissionPercent: fee?.commissionPercent || 0,
        organizationId: item.organizationId || null,
        commissionFee: fee?.commissionFee || 0,
        fixedFee: fee?.fixedFee || 0,
        customerPlatformFee: fee?.customerFeeTotal || 0,
        closingFee: fee?.closingFee || 0,
        platformFeeAmount,
        platformFeeTaxAmount,
        platformFeeTaxRate: Number(commerceSettings.finance.platformFeeTaxRate || 0),
        chargePlatformFeeTaxToSeller: Boolean(commerceSettings.finance.chargePlatformFeeTaxToSeller),
        sellerPayoutBase: commerceSettings.finance.sellerPayoutBase,
        sellerPayoutBaseAmount: item.sellerPayoutBaseAmount,
        productTaxLiabilityAmount: item.productTaxLiabilityAmount,
      };
    }
    const customerItemsAmount = Number((subtotalAmount - discount.discountAmount).toFixed(2));
    const deliveryCharge = await sellerChargeSettingsService.calculateDeliveryCharges(
      pricedItems,
      shippingAddress,
    );
    const codCharge = await this.calculateCodCharge(
      paymentProvider,
      customerItemsAmount,
      commerceSettings,
      shippingAddress,
      pricedItems,
    );
    const totalAmount = Number(
      (
        customerItemsAmount +
        taxBreakup.taxPayableAmount +
        deliveryCharge.amount +
        codCharge.amount +
        Number(platformFee.customerFeeAmount || 0) +
        Number(platformFee.customerFeeTaxAmount || 0)
      ).toFixed(2),
    );
    const walletBreakup = await this.calculateWalletUsage(
      userId,
      walletAmount,
      totalAmount,
      commerceSettings.wallet,
    );
    const payableAmount = Number((totalAmount - walletBreakup.walletAppliedAmount).toFixed(2));
    const settlement = this.calculateSellerSettlement(
      pricedItems,
      commerceSettings.finance,
      deliveryCharge,
    );

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
        sellerPlatformFeeAmount: platformFee.sellerFeeAmount,
        customerPlatformFeeAmount: platformFee.customerFeeAmount,
        customerPlatformFeeTaxAmount: platformFee.customerFeeTaxAmount,
        platformFeeBreakup: platformFee.breakup,
        sellerSettlementBreakup: settlement.sellers,
        sellerPayoutAmount: settlement.totalSellerPayout,
        paymentProvider,
        codChargeAmount: codCharge.amount,
        codChargeBreakup: codCharge.breakup,
        deliveryChargeAmount: deliveryCharge.amount,
        shippingFeeAmount: deliveryCharge.amount,
        deliveryChargeBreakup: deliveryCharge.breakup,
        totalAmount,
        payableAmount,
        appliedCouponCode: discount.appliedCouponCode,
        commerceSettingsSnapshot: {
          finance: commerceSettings.finance,
          wallet: commerceSettings.wallet,
          cod: commerceSettings.cod,
          checkout: commerceSettings.checkout,
        },
      },
      couponToConsume: discount.couponToConsume,
      walletToReserveAmount: walletBreakup.walletAppliedAmount,
    };
  }

  calculateSellerSettlement(pricedItems, financeSettings = {}, deliveryCharge = null) {
    const sellers = new Map();
    for (const item of pricedItems) {
      const sellerId = item.sellerId || "platform";
      const organizationId = item.organizationId || null;
      const key = `${sellerId}:${organizationId || "default"}`;
      const current = sellers.get(key) || {
        sellerId,
        organizationId,
        grossSalesAmount: 0,
        sellerPayoutBaseAmount: 0,
        taxableAmount: 0,
        taxAmount: 0,
        platformFeeAmount: 0,
        platformFeeTaxAmount: 0,
        productTaxLiabilityAmount: 0,
        sellerPayoutAmount: 0,
      };
      current.grossSalesAmount += Number(item.lineTotal || 0);
      current.sellerPayoutBaseAmount += Number(item.sellerPayoutBaseAmount || 0);
      current.taxableAmount += Number(item.taxableAmount || 0);
      current.taxAmount += Number(item.taxAmount || 0);
      current.platformFeeAmount += Number(item.platformFeeAmount || 0);
      current.platformFeeTaxAmount += Number(item.platformFeeTaxAmount || 0);
      current.productTaxLiabilityAmount += Number(item.productTaxLiabilityAmount || 0);
      current.sellerPayoutAmount += Number(item.settlementAmount || 0);
      sellers.set(key, current);
    }

    const shippingBySeller = new Map(
      (deliveryCharge?.breakup?.sellers || []).map((seller) => [
        `${String(seller.sellerId)}:${seller.organizationId || "default"}`,
        Number(seller.chargeAmount || 0),
      ]),
    );
    const shippingPolicy = financeSettings.shippingPolicy || "not_in_seller_payout";

    const normalized = [...sellers.values()].map((seller) => {
      const sellerDeliveryChargeAmount = Number(
        shippingBySeller.get(`${String(seller.sellerId)}:${seller.organizationId || "default"}`) ||
        shippingBySeller.get(`${String(seller.sellerId)}:default`) ||
        0,
      );
      const shippingReimbursementAmount = shippingPolicy === "reimburse_seller" ? sellerDeliveryChargeAmount : 0;
      const shippingDeductionAmount = shippingPolicy === "deduct_from_seller" ? sellerDeliveryChargeAmount : 0;
      const sellerPayoutAmount = Math.max(
        0,
        seller.sellerPayoutAmount + shippingReimbursementAmount - shippingDeductionAmount,
      );
      return {
        ...seller,
        grossSalesAmount: Number(seller.grossSalesAmount.toFixed(2)),
        sellerPayoutBaseAmount: Number(seller.sellerPayoutBaseAmount.toFixed(2)),
        taxableAmount: Number(seller.taxableAmount.toFixed(2)),
        taxAmount: Number(seller.taxAmount.toFixed(2)),
        platformFeeAmount: Number(seller.platformFeeAmount.toFixed(2)),
        platformFeeTaxAmount: Number(seller.platformFeeTaxAmount.toFixed(2)),
        productTaxLiabilityAmount: Number(seller.productTaxLiabilityAmount.toFixed(2)),
        sellerDeliveryChargeAmount: Number(sellerDeliveryChargeAmount.toFixed(2)),
        shippingReimbursementAmount: Number(shippingReimbursementAmount.toFixed(2)),
        shippingDeductionAmount: Number(shippingDeductionAmount.toFixed(2)),
        shippingPolicy,
        sellerPayoutAmount: Number(sellerPayoutAmount.toFixed(2)),
      };
    });

    return {
      sellers: normalized,
      totalSellerPayout: Number(normalized.reduce((sum, seller) => sum + seller.sellerPayoutAmount, 0).toFixed(2)),
    };
  }

  async calculateCodCharge(paymentProvider, orderAmount, commerceSettings = null, shippingAddress = {}, pricedItems = []) {
    if (paymentProvider !== PAYMENT_PROVIDER.COD) {
      return { amount: 0, breakup: null };
    }

    const settings = commerceSettings || await commerceSettingsService.getSettings();
    if (!commerceSettingsService.isCodAllowedForAddress(settings, shippingAddress)) {
      throw new AppError("Cash on Delivery is not available for this delivery pincode", 400);
    }

    const config = await this.paymentMethodConfigRepository.getCodConfig();
    if (!config.enabled) {
      throw new AppError("Cash on Delivery is currently disabled", 400);
    }

    const sellerCod = await sellerChargeSettingsService.evaluateCodForItems(
      pricedItems,
      shippingAddress,
    );
    if (!sellerCod.allowed) {
      const sellerId = sellerCod.blockers[0]?.sellerId || "seller";
      throw new AppError(`Cash on Delivery is not available for seller ${sellerId}`, 400);
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

    const platformCharge = Number(Number(config.charge_amount || 0).toFixed(2));
    const sellerCharge = Number(Number(sellerCod.sellerChargeAmount || 0).toFixed(2));
    const charge = Number((platformCharge + sellerCharge).toFixed(2));
    return {
      amount: charge,
      breakup: {
        method: PAYMENT_PROVIDER.COD,
        enabled: Boolean(config.enabled),
        chargeAmount: charge,
        platformChargeAmount: platformCharge,
        sellerChargeAmount: sellerCharge,
        minOrderAmount: min,
        maxOrderAmount: max,
        currency: config.currency || "INR",
        availabilityMode: settings.cod?.availabilityMode || "all_pincodes",
        collectionPolicy: settings.cod?.collectionPolicy || "platform_or_courier",
        payoutRequiresCapture: settings.cod?.payoutRequiresCapture !== false,
        sellerRules: sellerCod.sellers,
      },
    };
  }

  normalizeRuleText(value) {
    return String(value || "").trim().toLowerCase();
  }

  normalizeRuleId(value) {
    return String(value || "").trim();
  }

  getRulePercentage(rule = {}) {
    if (rule.percentage !== undefined && rule.percentage !== null && rule.percentage !== "") {
      return Number(rule.percentage || 0);
    }
    if (rule.commissionPercent !== undefined) return Number(rule.commissionPercent || 0);
    if (rule.commission_percent !== undefined) return Number(rule.commission_percent || 0);
    return Number(rule.rate || 0) * 100;
  }

  getRuleFixedFee(rule = {}) {
    return Number(
      rule.fixedFeeAmount ??
      rule.fixed_fee_amount ??
      rule.fixedFee ??
      rule.fixed_fee ??
      rule.amount ??
      0,
    );
  }

  ruleScope(rule = {}) {
    if (rule.ruleScope) return rule.ruleScope;
    if (rule.productId || rule.productSku) return "product";
    if (rule.categoryId || rule.categoryName || rule.category) return "category";
    if (rule.sellerId) return "seller";
    if (rule.organizationId) return "organization";
    return "global";
  }

  ruleSpecificity(scope) {
    return {
      product: 500,
      category: 400,
      seller: 300,
      organization: 250,
      global: 100,
    }[scope] || 0;
  }

  ruleMatchesItem(rule = {}, item = {}) {
    if (rule.isActive === false || rule.status === "inactive") return false;
    const scope = this.ruleScope(rule);
    const productId = this.normalizeRuleId(rule.productId);
    const productSku = this.normalizeRuleText(rule.productSku);
    const categoryName = this.normalizeRuleText(rule.categoryName || rule.category);
    const sellerId = this.normalizeRuleId(rule.sellerId);
    const organizationId = this.normalizeRuleId(rule.organizationId);

    if (scope === "product") {
      return Boolean(
        (productId && productId === this.normalizeRuleId(item.productId)) ||
        (productSku && productSku === this.normalizeRuleText(item.sku || item.variantSku)),
      );
    }
    if (scope === "category") {
      if (categoryName && categoryName !== "default" && categoryName !== "*") {
        return categoryName === this.normalizeRuleText(item.category);
      }
      return Boolean(rule.categoryId) ? this.normalizeRuleId(rule.categoryId) === this.normalizeRuleId(item.categoryId) : true;
    }
    if (scope === "seller") {
      return sellerId && sellerId === this.normalizeRuleId(item.sellerId);
    }
    if (scope === "organization") {
      return organizationId && organizationId === this.normalizeRuleId(item.organizationId);
    }
    return true;
  }

  pickBestRule(rules = [], item = {}) {
    const matches = (rules || [])
      .filter((rule) => this.ruleMatchesItem(rule, item))
      .map((rule) => ({
        rule,
        score: this.ruleSpecificity(this.ruleScope(rule)) + Number(rule.priority || 0),
      }))
      .sort((a, b) => b.score - a.score);
    return matches[0]?.rule || null;
  }

  getFeeBaseAmount(rule = {}, item = {}, context = {}) {
    const applyOn = rule.applyOn || "product_amount";
    const lineAmount = Number(item.discountedLineTotal ?? item.lineTotal ?? 0);
    const subtotal = Number(context.customerItemsAmount ?? context.subtotalAmount ?? lineAmount);
    const proportion = subtotal > 0 ? lineAmount / subtotal : 1;

    if (applyOn === "order_subtotal" || applyOn === "final_paid_amount") {
      const base = Number(context.customerItemsAmount ?? context.subtotalAmount ?? lineAmount);
      return Number((base * proportion).toFixed(2));
    }

    return Number(lineAmount.toFixed(2));
  }

  computeRuleFee(rule = {}, item = {}, context = {}) {
    const type = rule.commissionType || rule.feeType || "percentage";
    const percentage = this.getRulePercentage(rule);
    const fixedFeeAmount = this.getRuleFixedFee(rule);
    const feeBaseAmount = this.getFeeBaseAmount(rule, item, context);
    const includePercentage = type === "percentage" || type === "mixed" || (!type && percentage > 0);
    const includeFixed = type === "fixed" || type === "flat" || type === "mixed";
    const commissionFee = includePercentage
      ? Number(((feeBaseAmount * percentage) / 100).toFixed(2))
      : 0;
    const fixedFee = includeFixed
      ? Number((fixedFeeAmount * Number(item.quantity || 1)).toFixed(2))
      : 0;
    const capAmount = rule.maxFeeAmount !== null && rule.maxFeeAmount !== undefined && rule.maxFeeAmount !== ""
      ? Number(rule.maxFeeAmount)
      : null;
    const rawTotal = Number((commissionFee + fixedFee).toFixed(2));
    const total = capAmount !== null ? Math.min(rawTotal, capAmount) : rawTotal;
    const rawTaxRate = Number(rule.taxRate || 0);
    const taxRate = rawTaxRate > 0 && rawTaxRate <= 1 ? rawTaxRate * 100 : rawTaxRate;
    const feeTaxAmount = rule.taxHandling === "exclusive"
      ? Number(((total * taxRate) / 100).toFixed(2))
      : 0;

    return {
      feeBaseAmount,
      commissionPercent: percentage,
      commissionFee,
      fixedFee,
      closingFee: 0,
      feeTaxAmount,
      total,
    };
  }

  async calculateModernPlatformFees(pricedItems = [], context = {}) {
    const [commissionRules, platformFeeRules] = await Promise.all([
      this.pricingRepository.listActiveCommissionRules(),
      this.pricingRepository.listActiveCustomerPlatformFeeRules(),
    ]);
    if (!commissionRules.length && !platformFeeRules.length) {
      return null;
    }

    const breakup = [];
    let sellerFeeAmount = 0;
    let customerFeeAmount = 0;
    let customerFeeTaxAmount = 0;

    for (const item of pricedItems) {
      const dealRule = item.dealSnapshot?.commissionRuleSnapshot || {};
      const hasDealCommission = Boolean(item.dealId && (
        dealRule.id ||
        dealRule.commission_percent !== undefined ||
        dealRule.commissionPercent !== undefined ||
        dealRule.fixed_fee !== undefined ||
        dealRule.fixedFee !== undefined
      ));
      const commissionRule = hasDealCommission ? {
        ...dealRule,
        name: dealRule.name || "Deal commission",
        commissionType: Number(dealRule.fixed_fee ?? dealRule.fixedFee ?? 0) > 0 ? "mixed" : "percentage",
        percentage: Number(dealRule.commission_percent ?? dealRule.commissionPercent ?? 0),
        fixedFeeAmount: Number(dealRule.fixed_fee ?? dealRule.fixedFee ?? 0),
        applyOn: "product_amount",
        source: "deal_commission_rule",
      } : this.pickBestRule(commissionRules, item);
      const platformFeeRule = this.pickBestRule(platformFeeRules, item);

      const commission = commissionRule
        ? this.computeRuleFee(commissionRule, item, context)
        : { feeBaseAmount: Number(item.discountedLineTotal ?? item.lineTotal ?? 0), commissionPercent: 0, commissionFee: 0, fixedFee: 0, closingFee: 0, feeTaxAmount: 0, total: 0 };
      const platformFee = platformFeeRule
        ? this.computeRuleFee(platformFeeRule, item, context)
        : { feeBaseAmount: commission.feeBaseAmount, commissionPercent: 0, commissionFee: 0, fixedFee: 0, closingFee: 0, feeTaxAmount: 0, total: 0 };

      const sellerPlatformFee = platformFeeRule?.chargeToCustomer ? 0 : platformFee.total;
      const customerPlatformFee = platformFeeRule?.chargeToCustomer ? platformFee.total : 0;
      const customerPlatformFeeTax = platformFeeRule?.chargeToCustomer ? platformFee.feeTaxAmount : 0;
      const sellerFeeTotal = Number((commission.total + sellerPlatformFee).toFixed(2));
      const itemCustomerFeeTotal = Number(customerPlatformFee.toFixed(2));

      sellerFeeAmount += sellerFeeTotal;
      customerFeeAmount += itemCustomerFeeTotal;
      customerFeeTaxAmount += customerPlatformFeeTax;

      breakup.push({
        productId: item.productId,
        sellerId: item.sellerId,
        organizationId: item.organizationId || null,
        dealId: item.dealId || null,
        category: item.category,
        quantity: item.quantity,
        feeBaseAmount: commission.feeBaseAmount,
        commissionPercent: commission.commissionPercent,
        commissionFee: commission.commissionFee,
        fixedFee: Number((commission.fixedFee + sellerPlatformFee).toFixed(2)),
        closingFee: 0,
        sellerFeeTotal,
        customerFeeTotal: itemCustomerFeeTotal,
        customerFeeTaxAmount: Number(customerPlatformFeeTax.toFixed(2)),
        totalFee: Number((sellerFeeTotal + itemCustomerFeeTotal).toFixed(2)),
        commissionRuleId: commissionRule?._id || commissionRule?.id || null,
        commissionRuleName: commissionRule?.name || null,
        platformFeeRuleId: platformFeeRule?._id || platformFeeRule?.id || null,
        platformFeeRuleName: platformFeeRule?.name || null,
        platformFeeChargedToCustomer: Boolean(platformFeeRule?.chargeToCustomer),
        applyOn: commissionRule?.applyOn || platformFeeRule?.applyOn || "product_amount",
        taxHandling: platformFeeRule?.taxHandling || commissionRule?.taxHandling || "exclusive",
        source: hasDealCommission
          ? "deal_commission_rule"
          : commissionRule || platformFeeRule
            ? "commission_fee_rule"
            : "none",
      });
    }

    const totalFeeAmount = Number((sellerFeeAmount + customerFeeAmount).toFixed(2));
    return {
      totalFeeAmount,
      sellerFeeAmount: Number(sellerFeeAmount.toFixed(2)),
      customerFeeAmount: Number(customerFeeAmount.toFixed(2)),
      customerFeeTaxAmount: Number(customerFeeTaxAmount.toFixed(2)),
      breakup,
    };
  }

  async calculateLegacyPlatformFee(pricedItems = []) {
    const categories = pricedItems.map((item) => item.category).filter(Boolean);
    const rules = await this.pricingRepository.listActivePlatformFeeRules(categories);
    if (!rules.length) {
      return { totalFeeAmount: 0, sellerFeeAmount: 0, customerFeeAmount: 0, customerFeeTaxAmount: 0, breakup: [] };
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

      const feeBaseAmount = Number(item.discountedLineTotal ?? item.lineTotal ?? 0);
      const commissionFee = Number(((feeBaseAmount * commissionPercent) / 100).toFixed(2));
      const fixedFee = Number((fixedFeeAmount * item.quantity).toFixed(2));
      const closingFee = Number((closingFeeAmount * item.quantity).toFixed(2));
      const rawItemFeeTotal = Number((commissionFee + fixedFee + closingFee).toFixed(2));
      const itemFeeTotal = capAmount !== null ? Math.min(rawItemFeeTotal, capAmount) : rawItemFeeTotal;

      totalFeeAmount += itemFeeTotal;
      breakup.push({
        productId: item.productId,
        sellerId: item.sellerId,
        organizationId: item.organizationId || null,
        dealId: item.dealId || null,
        category: item.category,
        quantity: item.quantity,
        feeBaseAmount,
        commissionPercent,
        commissionFee,
        fixedFee,
        closingFee,
        sellerFeeTotal: itemFeeTotal,
        customerFeeTotal: 0,
        totalFee: itemFeeTotal,
        configId: hasDealCommission ? dealRule.id || item.dealId : rule.id,
        source: hasDealCommission ? "deal_commission_rule" : "legacy_platform_fee_config",
      });
    }

    const sellerFeeAmount = Number(totalFeeAmount.toFixed(2));
    return {
      totalFeeAmount: sellerFeeAmount,
      sellerFeeAmount,
      customerFeeAmount: 0,
      customerFeeTaxAmount: 0,
      breakup,
    };
  }

  async calculatePlatformFee(pricedItems, context = {}) {
    const modern = await this.calculateModernPlatformFees(pricedItems, context);
    if (modern) return modern;
    return this.calculateLegacyPlatformFee(pricedItems);
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
      item.discountAmount = itemDiscount;
      item.discountedLineTotal = discountedLineTotal;

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

  async calculateWalletUsage(userId, requestedAmount, eligibleAmount, walletPolicy = {}) {
    if (!userId || walletPolicy.partialPaymentMode === "disabled") {
      return { walletAppliedAmount: 0 };
    }

    const wallet = await this.walletRepository.findWalletByUserId(userId);
    if (!wallet) {
      return { walletAppliedAmount: 0 };
    }

    const requested = Number(requestedAmount || 0);
    const shouldAutoApply = walletPolicy.partialPaymentMode === "auto_apply" && requested <= 0;
    const desiredAmount = shouldAutoApply ? Number(wallet.available_balance || 0) : requested;
    if (!desiredAmount || desiredAmount <= 0) {
      return { walletAppliedAmount: 0 };
    }

    const maxPercent = Number(walletPolicy.autoApplyMaxPercent ?? env.commerce.maxWalletUsagePerOrderPercent);
    const maxWalletByPolicy = (Number(eligibleAmount || 0) * maxPercent) / 100;
    const walletAppliedAmount = Number(
      Math.min(desiredAmount, Number(wallet.available_balance), maxWalletByPolicy).toFixed(2),
    );

    return {
      walletAppliedAmount,
      autoApplied: shouldAutoApply && walletAppliedAmount > 0,
      walletPolicy: walletPolicy.partialPaymentMode || "user_opt_in",
    };
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
