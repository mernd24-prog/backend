const { AppError } = require("../../../shared/errors/app-error");
const {
  applyShippingPolicy,
  calculateInclusiveShippingTax,
  resolveShippingPolicy,
  uniqueCommissionRates,
} = require("../../../shared/domain/seller-payout-rules");
const { COUPON_TYPE } = require("../../../shared/domain/commerce-constants");
const { PricingRepository } = require("../repositories/pricing.repository");
const { ProductRepository } = require("../../product/repositories/product.repository");
const { WalletRepository } = require("../../wallet/repositories/wallet.repository");
const { PlatformRepository } = require("../../platform/repositories/platform.repository");
const { DealService } = require("../../deal/services/deal.service");
const { PAYMENT_PROVIDER } = require("../../../shared/domain/commerce-constants");
const { redis } = require("../../../infrastructure/redis/redis-client");
const { env } = require("../../../config/env");
const { isPublicProduct } = require("../../../shared/catalog/public-product-filter");
const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const { commerceSettingsService } = require("../../admin/services/commerce-settings.service");
const { sellerChargeSettingsService } = require("../../seller/services/seller-charge-settings.service");
const { ReferralService } = require("../../referral/services/referral.service");

class PricingService {
  constructor({
    pricingRepository = new PricingRepository(),
    productRepository = new ProductRepository(),
    walletRepository = new WalletRepository(),
    platformRepository = new PlatformRepository(),
    dealService = new DealService(),
    redisClient = redis,
    referralService = new ReferralService(),
  } = {}) {
    this.pricingRepository = pricingRepository;
    this.productRepository = productRepository;
    this.walletRepository = walletRepository;
    this.platformRepository = platformRepository;
    this.dealService = dealService;
    this.redis = redisClient;
    this.referralService = referralService;
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
      items.map(async (item, itemIndex) => {
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

        const productReturnPolicy = product.warranty?.returnPolicy || {};
        const isNonReturnable = String(productReturnPolicy.type || "").toLowerCase() === "non_returnable";
        const returnable = isNonReturnable
          ? false
          : productReturnPolicy.returnable ?? productReturnPolicy.eligible ?? true;
        const returnWindowDays = returnable
          ? Math.max(Number(productReturnPolicy.returnWindowDays ?? productReturnPolicy.days ?? 0), 0)
          : 0;
        const returnPolicySnapshot = {
          ...productReturnPolicy,
          returnable,
          eligible: returnable,
          returnWindowDays,
          days: returnWindowDays,
          type: returnable ? productReturnPolicy.type || "standard" : "non_returnable",
          resolution: productReturnPolicy.resolution || "refund_or_replacement",
          requiresImages: Boolean(productReturnPolicy.requiresImages || productReturnPolicy.requires_images),
          inspectionRequired: productReturnPolicy.inspectionRequired ?? productReturnPolicy.requiresQc ?? true,
          shippingPaidBy: productReturnPolicy.shippingPaidBy || "seller",
          source: "product_snapshot",
        };

        return {
          pricingLineId: `${String(product.id)}:${String(variant?._id || variant?.id || item.variantId || variant?.sku || item.variantSku || "default")}:${itemIndex}`,
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
            warranty: product.warranty || {},
            returnPolicy: returnPolicySnapshot,
            commercialPolicy: {
              returnPolicy: returnPolicySnapshot,
            },
          },
        };
      }),
    );

    const subtotalAmount = pricedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const discount = await this.calculateDiscount(
      couponCode,
      subtotalAmount,
      userId,
      pricedItems,
    );
    const commerceSettings = await commerceSettingsService.getSettings();
    const sellerFundingPercent = Number(discount.sellerFundingPercent || 0);
    const taxBreakup = await this.calculateTaxBreakup(
      pricedItems,
      subtotalAmount,
      discount.discountAmount,
      shippingAddress,
      { sellerFundingPercent },
    );
    const totalSellerFundedDiscount = Number(
      (discount.discountAmount * sellerFundingPercent / 100).toFixed(2),
    );
    let allocatedSellerFunding = 0;
    for (const [index, item] of pricedItems.entries()) {
      const allocatedDiscount = Number(item.discountAmount || 0);
      item.sellerFundedDiscountAmount = index === pricedItems.length - 1
        ? Number((totalSellerFundedDiscount - allocatedSellerFunding).toFixed(2))
        : Number((allocatedDiscount * sellerFundingPercent / 100).toFixed(2));
      allocatedSellerFunding = Number(
        (allocatedSellerFunding + item.sellerFundedDiscountAmount).toFixed(2),
      );
      item.marketplaceFundedDiscountAmount = Number(
        (discount.fundingType === "payment_partner"
          ? 0
          : allocatedDiscount - item.sellerFundedDiscountAmount).toFixed(2),
      );
      item.paymentPartnerFundedDiscountAmount = Number(
        (discount.fundingType === "payment_partner" ? allocatedDiscount : 0).toFixed(2),
      );
      item.discountFundingType = discount.fundingType || "marketplace";
    }
    const platformFee = await this.calculatePlatformFee(pricedItems, {
      subtotalAmount,
      discountAmount: discount.discountAmount,
      customerItemsAmount: Number((subtotalAmount - discount.discountAmount).toFixed(2)),
      totalAmount: Number((subtotalAmount - discount.discountAmount + taxBreakup.taxPayableAmount).toFixed(2)),
      commerceSettings,
    });
    for (const [itemIndex, item] of pricedItems.entries()) {
      const fee = item.pricingLineId
        ? platformFee.breakup.find(
            (entry) => entry.pricingLineId === item.pricingLineId,
          )
        : platformFee.breakup[itemIndex];
      const platformFeeAmount = Number(fee?.sellerFeeTotal ?? fee?.totalFee ?? 0);
      const platformFeeTaxAmount = commerceSettings.finance.chargePlatformFeeTaxToSeller
        ? Number(((platformFeeAmount * Number(commerceSettings.finance.platformFeeTaxRate || 0)) / 100).toFixed(2))
        : 0;
      const discountedLineTotal = Number(item.discountedLineTotal ?? item.lineTotal ?? 0);
      const sellerGrossLineTotal = Number(item.lineTotal || 0);
      const sellerFundedDiscountAmount = Number(item.sellerFundedDiscountAmount || 0);
      const sellerNetLineTotal = Number((sellerGrossLineTotal - sellerFundedDiscountAmount).toFixed(2));
      const sellerPayoutBaseAmount = commerceSettings.finance.sellerPayoutBase === "taxable_ex_gst"
        ? Number(item.taxableAmountBeforeDiscount || item.taxableAmount || 0)
        : sellerNetLineTotal;
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
        customerPlatformFeeTaxAmount: fee?.customerFeeTaxAmount || 0,
        closingFee: fee?.closingFee || 0,
        platformFeeAmount,
        platformFeeTaxAmount,
        platformFeeTaxRate: Number(commerceSettings.finance.platformFeeTaxRate || 0),
        chargePlatformFeeTaxToSeller: Boolean(commerceSettings.finance.chargePlatformFeeTaxToSeller),
        sellerPayoutBase: commerceSettings.finance.sellerPayoutBase,
        sellerPayoutBaseAmount: item.sellerPayoutBaseAmount,
     sellerCommissionBaseAmount: Number(
    fee?.sellerCommissionBaseAmount ??
    item.taxableAmount
),
        sellerGrossLineTotal,
        discountAmount: Number(item.discountAmount || 0),
        discountFundingType: item.discountFundingType || "marketplace",
        marketplaceFundedDiscountAmount: Number(item.marketplaceFundedDiscountAmount || 0),
        paymentPartnerFundedDiscountAmount: Number(item.paymentPartnerFundedDiscountAmount || 0),
        sellerFundedDiscountAmount,
        productTaxLiabilityAmount: item.productTaxLiabilityAmount,
        sellerReceivable: item.settlementAmount,
        source: fee?.source || "platform_commission",
      };
    }
    const customerItemsAmount = Number((subtotalAmount - discount.discountAmount).toFixed(2));
    const sellerFundedDiscountAmount = Number(pricedItems.reduce(
      (sum, item) => sum + Number(item.sellerFundedDiscountAmount || 0), 0,
    ).toFixed(2));
    const marketplaceFundedDiscountAmount = Number(pricedItems.reduce(
      (sum, item) => sum + Number(item.marketplaceFundedDiscountAmount || 0), 0,
    ).toFixed(2));
    const paymentPartnerFundedDiscountAmount = Number(pricedItems.reduce(
      (sum, item) => sum + Number(item.paymentPartnerFundedDiscountAmount || 0), 0,
    ).toFixed(2));
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
        sellerFundedDiscountAmount,
        marketplaceFundedDiscountAmount,
        paymentPartnerFundedDiscountAmount,
        walletAppliedAmount: walletBreakup.walletAppliedAmount,
        taxAmount: taxBreakup.totalTaxAmount,
        taxIncludedAmount: taxBreakup.taxIncludedAmount,
        taxPayableAmount: taxBreakup.taxPayableAmount,
        taxBreakup,
        platformFeeAmount: platformFee.totalFeeAmount,
        sellerPlatformFeeAmount: platformFee.sellerFeeAmount,
        sellerPlatformFeeTaxAmount: Number(pricedItems.reduce((sum, item) => sum + Number(item.platformFeeTaxAmount || 0), 0).toFixed(2)),
        totalSellerDeduction: Number(pricedItems.reduce((sum, item) => sum + Number(item.platformFeeAmount || 0) + Number(item.platformFeeTaxAmount || 0), 0).toFixed(2)),
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
        discountSource: discount.discountSource || null,
        discountFundingType: discount.fundingType || "marketplace",
        sellerFundingPercent,
        referralDiscountAmount: discount.discountSource === "influencer" ? discount.discountAmount : 0,
        commerceSettingsSnapshot: {
          finance: commerceSettings.finance,
          platformFees: commerceSettings.platformFees,
          wallet: commerceSettings.wallet,
          cod: commerceSettings.cod,
          checkout: commerceSettings.checkout,
        },
      },
      couponToConsume: discount.couponToConsume,
      referralContext: discount.referralContext || null,
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
        commissionRates: [],
      };
      current.grossSalesAmount += Number(item.lineTotal || 0);
      current.sellerPayoutBaseAmount += Number(item.sellerPayoutBaseAmount || 0);
      current.taxableAmount += Number(item.taxableAmount || 0);
      current.taxAmount += Number(item.taxAmount || 0);
      current.platformFeeAmount += Number(item.platformFeeAmount || 0);
      current.platformFeeTaxAmount += Number(item.platformFeeTaxAmount || 0);
      current.productTaxLiabilityAmount += Number(item.productTaxLiabilityAmount || 0);
      current.sellerPayoutAmount += Number(item.settlementAmount || 0);
      const commissionRate = Number(item.pricingSnapshot?.commissionPercent || 0);
      if (commissionRate > 0) current.commissionRates.push(commissionRate);
      sellers.set(key, current);
    }

    const shippingBySeller = new Map(
      (deliveryCharge?.breakup?.sellers || []).map((seller) => [
        `${String(seller.sellerId)}:${seller.organizationId || "default"}`,
        seller,
      ]),
    );

    const normalized = [...sellers.values()].map((seller) => {
      const deliveryEntry =
        shippingBySeller.get(`${String(seller.sellerId)}:${seller.organizationId || "default"}`) ||
        shippingBySeller.get(`${String(seller.sellerId)}:default`) ||
        {};
   const sellerDeliveryChargeAmount = Number(
  deliveryEntry.chargeAmount || 0,
);

// Use the commerce finance setting.
// deliveryEntry is only passed as a fallback.
const shippingPolicy =
  financeSettings.shippingPolicy ||
  resolveShippingPolicy(
    financeSettings.shippingPolicy,
    deliveryEntry,
  );

const shippingReimbursementAmount =
  shippingPolicy === "reimburse_seller"
    ? sellerDeliveryChargeAmount
    : 0;

const shippingDeductionAmount =
  shippingPolicy === "deduct_from_seller"
    ? sellerDeliveryChargeAmount
    : 0;

// Calculate shipping tax from the actual shipping charge.
// Do not use only reimbursement amount here.
const shippingTax = calculateInclusiveShippingTax(
  sellerDeliveryChargeAmount,
  seller.taxableAmount,
  seller.taxAmount,
);

const payoutBeforeStatutoryDeductions =
  applyShippingPolicy(
    seller.sellerPayoutAmount,
    sellerDeliveryChargeAmount,
    shippingPolicy,
  );

const gstTcsRate = financeSettings.gstTcsEnabled
  ? Number(financeSettings.gstTcsRate || 0)
  : 0;

const incomeTaxTdsRate =
  financeSettings.incomeTaxTdsEnabled
    ? Number(financeSettings.incomeTaxTdsRate || 0)
    : 0;

// According to your current PDF flow,
// TCS and TDS use product taxable value only.
const gstTcsTaxableAmount = Number(
  Number(seller.taxableAmount || 0).toFixed(2),
);

const gstTcsAmount = Number(
  (
    (gstTcsTaxableAmount * gstTcsRate) /
    100
  ).toFixed(2),
);

const incomeTaxTdsTaxableAmount = Number(
  Number(seller.taxableAmount || 0).toFixed(2),
);

const incomeTaxTdsAmount = Number(
  (
    (
      incomeTaxTdsTaxableAmount *
      incomeTaxTdsRate
    ) /
    100
  ).toFixed(2),
);
      const sellerPayoutAmount = Math.max(0, Number(
        (payoutBeforeStatutoryDeductions - gstTcsAmount - incomeTaxTdsAmount).toFixed(2),
      ));
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
        shippingTaxableAmount: shippingTax.taxableAmount,
        shippingTaxAmount: shippingTax.taxAmount,
        shippingPolicy,
        commissionRates: uniqueCommissionRates(seller.commissionRates),
        gstTcsRate,
        gstTcsTaxableAmount,
        gstTcsAmount,
        incomeTaxTdsRate,
        incomeTaxTdsTaxableAmount,
        incomeTaxTdsAmount,
        statutoryDeductionAmount: Number((gstTcsAmount + incomeTaxTdsAmount).toFixed(2)),
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

    const config = settings.cod || {};
    if (config.enabled === false) {
      throw new AppError("Cash on Delivery is currently disabled", 400);
    }

    const productCodBlocker = pricedItems.find((item) => {
      const shipping = item.shipping && typeof item.shipping === "object"
        ? item.shipping
        : {};
      const snapshotShipping =
        item.productSnapshot?.shipping && typeof item.productSnapshot.shipping === "object"
          ? item.productSnapshot.shipping
          : {};
      return shipping.codAvailable === false || snapshotShipping.codAvailable === false;
    });
    if (productCodBlocker) {
      throw new AppError("Cash on Delivery is not available for one or more products in this cart", 400);
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
    const min = config.minOrderAmount === null || config.minOrderAmount === undefined ? null : Number(config.minOrderAmount);
    const max = config.maxOrderAmount === null || config.maxOrderAmount === undefined ? null : Number(config.maxOrderAmount);
    if (min !== null && amount < min) {
      throw new AppError(`Cash on Delivery is available for orders above ${min}`, 400);
    }
    if (max !== null && amount > max) {
      throw new AppError(`Cash on Delivery is available for orders up to ${max}`, 400);
    }

    const platformCharge = Number(Number(config.feeAmount || 0).toFixed(2));
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
        payoutRequiresCapture: settings.cod?.payoutRequiresCapture !== false,
        sellerRules: sellerCod.sellers,
      },
    };
  }

  calculateConfiguredFee(type, value, baseAmount, quantity = 1) {
    const amount = Number(value || 0);
    if (String(type || "percentage") === "fixed") {
      return Number((amount * Number(quantity || 1)).toFixed(2));
    }
    return Number(((Number(baseAmount || 0) * amount) / 100).toFixed(2));
  }

  resolvePlatformFeeBase(item = {}, context = {}, calculationBase = "subtotal") {
    const lineAmount = Number(item.discountedLineTotal ?? item.lineTotal ?? 0);
    const subtotal = Number(context.customerItemsAmount ?? context.subtotalAmount ?? lineAmount);
    const total = Number(context.totalAmount ?? subtotal);
    const proportion = subtotal > 0 ? lineAmount / subtotal : 1;

    if (calculationBase === "order_total") {
      return Number((total * proportion).toFixed(2));
    }
    if (calculationBase === "subtotal") {
      return Number((subtotal * proportion).toFixed(2));
    }
    return Number(lineAmount.toFixed(2));
  }

 resolveSellerCommissionBase(item = {}) {
  return Number(item.taxableAmount || 0);
}

  async calculatePlatformFee(pricedItems, context = {}) {
    const settings = context.commerceSettings || await commerceSettingsService.getSettings();
    const config = settings.platformFees || {};
    const calculationBase = config.calculationBase || "subtotal";
    const sellerCommissionType = config.sellerCommissionType || config.sellerFeeType || "percentage";
    const sellerCommissionValue = Number(config.sellerCommissionValue ?? config.sellerFeeValue ?? 0);
    const customerFeeType = config.customerFeeType || "fixed";
    const customerFeeValue = Number(config.customerFeeValue || 0);
    const breakup = [];
    let sellerFeeAmount = 0;
    const customerOrderFeeBase = calculationBase === "order_total"
      ? Number(context.totalAmount || 0)
      : Number(context.customerItemsAmount ?? context.subtotalAmount ?? 0);
    const customerFeeAmount = this.calculateConfiguredFee(
      customerFeeType,
      customerFeeValue,
      customerOrderFeeBase,
      1,
    );
    const customerFeeTaxRate = Number(config.customerFeeTaxRate || 0);
    const customerFeeTaxAmount = Number(
      (customerFeeAmount * customerFeeTaxRate / 100).toFixed(2),
    );
    const allocationBaseTotal = pricedItems.reduce(
      (sum, item) => sum + this.resolvePlatformFeeBase(item, context, calculationBase),
      0,
    );
    let allocatedCustomerFee = 0;

    for (const [index, item] of pricedItems.entries()) {
      const feeBaseAmount = this.resolvePlatformFeeBase(item, context, calculationBase);
      const sellerCommissionBaseAmount = this.resolveSellerCommissionBase(item, settings.finance || {});
      const sellerCommission = this.calculateConfiguredFee(
        sellerCommissionType,
        sellerCommissionValue,
        sellerCommissionBaseAmount,
        item.quantity,
      );
      const customerPlatformFee = index === pricedItems.length - 1
        ? Number((customerFeeAmount - allocatedCustomerFee).toFixed(2))
        : Number((customerFeeAmount * (feeBaseAmount / Math.max(allocationBaseTotal, 1))).toFixed(2));
      const customerPlatformFeeTax = index === pricedItems.length - 1
        ? Number((customerFeeTaxAmount - breakup.reduce((sum, entry) => sum + Number(entry.customerFeeTaxAmount || 0), 0)).toFixed(2))
        : Number((customerFeeTaxAmount * (feeBaseAmount / Math.max(allocationBaseTotal, 1))).toFixed(2));

      sellerFeeAmount += sellerCommission;
      allocatedCustomerFee += customerPlatformFee;

      breakup.push({
        pricingLineId: item.pricingLineId,
        productId: item.productId,
        variantId: item.variantId || "",
        variantSku: item.variantSku || item.sku || "",
        sellerId: item.sellerId,
        organizationId: item.organizationId || null,
        dealId: item.dealId || null,
        category: item.category,
        quantity: item.quantity,
        feeBaseAmount,
        sellerCommissionBaseAmount,
        commissionPercent: sellerCommissionType === "percentage" ? sellerCommissionValue : 0,
        commissionFee: sellerCommissionType === "percentage" ? sellerCommission : 0,
        fixedFee: sellerCommissionType === "fixed" ? sellerCommission : 0,
        closingFee: 0,
        sellerFeeTotal: Number(sellerCommission.toFixed(2)),
        customerFeeTotal: Number(customerPlatformFee.toFixed(2)),
        customerFeeTaxAmount: Number(customerPlatformFeeTax.toFixed(2)),
        totalFee: Number((sellerCommission + customerPlatformFee).toFixed(2)),
        platformFeeChargedToCustomer: customerPlatformFee > 0,
        applyOn: calculationBase,
        taxHandling: "exclusive",
        source: "platform_commission",
      });
    }

    const sellerFeeTotal = Number(sellerFeeAmount.toFixed(2));
    const customerFeeTotal = Number(customerFeeAmount.toFixed(2));
    return {
      totalFeeAmount: Number((sellerFeeTotal + customerFeeTotal).toFixed(2)),
      sellerFeeAmount: sellerFeeTotal,
      customerFeeAmount: customerFeeTotal,
      customerFeeTaxAmount: Number(customerFeeTaxAmount.toFixed(2)),
      breakup,
    };
  }

  async finalizeCouponUsage(couponId) {
    if (!couponId) {
      return null;
    }

    const coupon = await this.pricingRepository.incrementCouponUsage(couponId);
    if (!coupon) {
      throw new AppError("Coupon usage limit reached", 409);
    }
    return coupon;
  }

  async rollbackCouponUsage(couponId) {
    return this.pricingRepository.decrementCouponUsage(couponId);
  }

  isAdminActor(actor = {}) {
    return ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
  }

  assertAdminCouponManager(actor = {}) {
    if (!this.isAdminActor(actor)) {
      throw new AppError("Coupons and discounts are managed by admin only", 403);
    }
  }

  async createCoupon(payload, actor = {}) {
    this.assertAdminCouponManager(actor);
    return this.pricingRepository.createCoupon({
      ...this.normalizeCouponPayload(payload),
      sellerId: null,
      createdBy: actor.userId || null,
    });
  }

  async listCoupons(actor = {}) {
    this.assertAdminCouponManager(actor);
    return this.pricingRepository.listCoupons({});
  }

  async getCoupon(couponId, actor = {}) {
    this.assertAdminCouponManager(actor);
    const coupon = await this.pricingRepository.findCouponById(couponId, {});
    if (!coupon) {
      throw new AppError("Coupon not found", 404);
    }
    return coupon;
  }

  async updateCoupon(couponId, payload, actor = {}) {
    this.assertAdminCouponManager(actor);
    const coupon = await this.pricingRepository.updateCoupon(
      couponId,
      this.normalizeCouponPayload(payload),
      {},
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
    this.assertAdminCouponManager(actor);
    const coupon = await this.pricingRepository.deleteCoupon(couponId, {});
    if (!coupon) {
      throw new AppError("Coupon not found", 404);
    }
    return coupon;
  }

  async calculateTaxBreakup(
    pricedItems,
    subtotalAmount,
    discountAmount,
    shippingAddress = {},
    { sellerFundingPercent = 100 } = {},
  ) {
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

    let allocatedDiscount = 0;
    for (const [index, item] of pricedItems.entries()) {
      const proportion = subtotalAmount > 0 ? item.lineTotal / subtotalAmount : 0;
      const itemDiscount = index === pricedItems.length - 1
        ? Number((discountAmount - allocatedDiscount).toFixed(2))
        : Number((discountAmount * proportion).toFixed(2));
      allocatedDiscount = Number((allocatedDiscount + itemDiscount).toFixed(2));
      const customerDiscountedLineTotal = Number((item.lineTotal - itemDiscount).toFixed(2));
      const sellerFundedItemDiscount = Number(
        (itemDiscount * Number(sellerFundingPercent || 0) / 100).toFixed(2),
      );
      const discountedLineTotal = Number((item.lineTotal - sellerFundedItemDiscount).toFixed(2));
      const grossLineTotal = Number(item.lineTotal || 0);
      let taxableAmount = discountedLineTotal;
      let taxableAmountBeforeDiscount = grossLineTotal;
      item.discountAmount = itemDiscount;
      item.discountedLineTotal = customerDiscountedLineTotal;

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

        const supplierState = originState || businessState;
        const placeOfSupplyState = buyerState || businessState;

        if (originCountry !== "INDIA") {
          itemTaxMode = "igst";
        } else if (!supplierState || !placeOfSupplyState || supplierState !== placeOfSupplyState) {
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
          taxableAmountBeforeDiscount = totalRate > 0
            ? Number(((grossLineTotal * 100) / (100 + totalRate)).toFixed(2))
            : grossLineTotal;
          itemTax = Number((taxableAmount * (item.gstRate / 100)).toFixed(2));
          itemCess = Number((discountedLineTotal - taxableAmount - itemTax).toFixed(2));
        } else {
          taxableAmountBeforeDiscount = grossLineTotal;
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

      const itemTaxBreakup = {
        pricingLineId: item.pricingLineId,
        productId: item.productId,
        variantId: item.variantId || "",
        variantSku: item.variantSku || item.sku || "",
        lineTotal: item.lineTotal,
        discountedLineTotal,
        customerDiscountedLineTotal,
        sellerFundedDiscountAmount: sellerFundedItemDiscount,
        taxableAmount,
        taxableAmountBeforeDiscount,
        gstRate: item.gstRate,
        cessRate: item.cessRate,
        gstInclusive: Boolean(item.gstInclusive),
        taxType: item.taxType,
        taxMode: itemTaxMode,
        taxAmount: itemTax,
        cessAmount: itemCess,
        taxIncludedAmount: item.gstInclusive ? itemTax + itemCess : 0,
        taxPayableAmount: item.gstInclusive ? 0 : itemTax + itemCess,
      };
      result.items.push(itemTaxBreakup);

      // Assign the calculation to the exact priced line while it is being
      // calculated. Matching later by productId is ambiguous when a cart has
      // two variants of the same product.
      item.taxAmount = itemTaxBreakup.taxAmount + itemTaxBreakup.cessAmount;
      item.taxableAmount = itemTaxBreakup.taxableAmount;
      item.taxableAmountBeforeDiscount = itemTaxBreakup.taxableAmountBeforeDiscount;
      item.taxIncludedAmount = itemTaxBreakup.taxIncludedAmount;
      item.taxPayableAmount = itemTaxBreakup.taxPayableAmount;
      item.taxBreakup = itemTaxBreakup;
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
      : result.items[0]?.taxMode || (isExport ? "zero_rated_export" : "cgst_sgst");

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

  async calculateDiscount(couponCode, subtotalAmount, userId = null, items = []) {
    if (!couponCode) {
      return {
        discountAmount: 0,
        appliedCouponCode: null,
        couponToConsume: null,
        discountSource: null,
        fundingType: "marketplace",
        sellerFundingPercent: 0,
        referralContext: null,
      };
    }

    const coupon = await this.pricingRepository.findCouponByCode(couponCode);
    if (!coupon) {
      const referralContext = await this.referralService.resolveInfluencerCodeForCheckout(
        couponCode,
        subtotalAmount,
        userId,
        items,
      );
      if (!referralContext) throw new AppError("Invalid coupon or influencer code", 400);
      return {
        discountAmount: referralContext.customerDiscountAmount,
        appliedCouponCode: referralContext.code,
        couponToConsume: null,
        discountSource: "influencer",
        fundingType: "marketplace",
        sellerFundingPercent: 0,
        referralContext,
      };
    }
    if (!coupon.active) {
      throw new AppError("Coupon is not active", 400);
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
      discountSource: "coupon",
      fundingType: coupon.fundingType || "marketplace",
      sellerFundingPercent: coupon.fundingType === "seller"
        ? 100
        : coupon.fundingType === "shared"
          ? Number(coupon.sellerFundingPercent || 0)
          : 0,
      referralContext: null,
    };
  }
}

module.exports = { PricingService };
