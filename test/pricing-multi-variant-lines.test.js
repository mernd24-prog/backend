const test = require("node:test");
const assert = require("node:assert/strict");
const { PricingService } = require("../src/modules/pricing/services/pricing.service");

test("prices different variants of the same product as separate financial lines", async () => {
  const service = new PricingService();
  const common = {
    productId: "6a8435f539f6de80968d135d",
    sellerId: "seller-1",
    organizationId: "organization-1",
    category: "fashion-womens-ethnic-wear-kurta-sets",
    quantity: 1,
    gstRate: 18,
    cessRate: 0,
    gstInclusive: true,
    taxExempt: false,
    taxType: "gst",
    origin: { country: "INDIA", state: "KARNATAKA" },
  };
  const items = [
    {
      ...common,
      pricingLineId: `${common.productId}:orange:0`,
      variantId: "orange",
      variantSku: "SKU-ORANGE",
      lineTotal: 12000,
    },
    {
      ...common,
      pricingLineId: `${common.productId}:navy:1`,
      variantId: "navy",
      variantSku: "SKU-NAVY",
      lineTotal: 12489,
    },
  ];

  const tax = await service.calculateTaxBreakup(
    items,
    24489,
    0,
    { country: "INDIA", state: "TELANGANA" },
    { sellerFundingPercent: 0 },
  );

  assert.deepEqual(
    tax.items.map((item) => ({
      variantId: item.variantId,
      taxableAmount: item.taxableAmount,
      taxAmount: item.taxAmount,
    })),
    [
      { variantId: "orange", taxableAmount: 10169.49, taxAmount: 1830.51 },
      { variantId: "navy", taxableAmount: 10583.9, taxAmount: 1905.1 },
    ],
  );
  assert.equal(tax.taxableAmount, 20753.39);
  assert.equal(tax.totalTaxAmount, 3735.61);
  assert.equal(items[0].taxableAmount, 10169.49);
  assert.equal(items[1].taxableAmount, 10583.9);

  const settings = {
    platformFees: {
      calculationBase: "subtotal",
      sellerCommissionType: "percentage",
      sellerCommissionValue: 2,
      customerFeeType: "fixed",
      customerFeeValue: 100,
      customerFeeTaxRate: 0,
    },
    finance: {
      platformFeeTaxRate: 18,
      chargePlatformFeeTaxToSeller: true,
      sellerPayoutBase: "gross_customer_price",
      shippingPolicy: "reimburse_seller",
      gstTcsEnabled: true,
      gstTcsRate: 0.5,
      incomeTaxTdsEnabled: true,
      incomeTaxTdsRate: 0.1,
    },
  };
  const fees = await service.calculatePlatformFee(items, {
    subtotalAmount: 24489,
    customerItemsAmount: 24489,
    totalAmount: 24489,
    commerceSettings: settings,
  });

  assert.deepEqual(
    fees.breakup.map((fee) => ({
      variantId: fee.variantId,
      commissionFee: fee.commissionFee,
      customerFeeTotal: fee.customerFeeTotal,
    })),
    [
      { variantId: "orange", commissionFee: 203.39, customerFeeTotal: 49 },
      { variantId: "navy", commissionFee: 211.68, customerFeeTotal: 51 },
    ],
  );

  items.forEach((item, index) => {
    const fee = fees.breakup[index];
    item.platformFeeAmount = fee.sellerFeeTotal;
    item.platformFeeTaxAmount = Number((fee.sellerFeeTotal * 0.18).toFixed(2));
    item.sellerPayoutBaseAmount = item.lineTotal;
    item.productTaxLiabilityAmount = item.taxAmount;
    item.settlementAmount = Number(
      (item.lineTotal - item.platformFeeAmount - item.platformFeeTaxAmount).toFixed(2),
    );
    item.pricingSnapshot = { commissionPercent: fee.commissionPercent };
  });

  const settlement = service.calculateSellerSettlement(items, settings.finance, {
    breakup: { sellers: [] },
  });
  assert.equal(settlement.sellers[0].taxableAmount, 20753.39);
  assert.equal(settlement.sellers[0].platformFeeAmount, 415.07);
  assert.equal(settlement.sellers[0].platformFeeTaxAmount, 74.71);
  assert.equal(settlement.sellers[0].gstTcsAmount, 103.77);
  assert.equal(settlement.sellers[0].incomeTaxTdsAmount, 20.75);
  assert.equal(settlement.totalSellerPayout, 23874.7);
});
