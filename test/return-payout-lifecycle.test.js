const test = require("node:test");
const assert = require("node:assert/strict");

const { CommissionService } = require("../src/modules/seller/services/commission.service");
const { OrderRepository } = require("../src/modules/order/repositories/order.repository");
const { TaxService } = require("../src/modules/tax/services/tax.service");
const { ReturnService } = require("../src/modules/returns/services/return.service");
const { prorateMoney } = require("../src/shared/domain/quantity-allocation");
const { applyShippingPolicy, uniqueCommissionRates } = require("../src/shared/domain/seller-payout-rules");

test("item commission becomes available only after item eligibility", () => {
  const releaseData = new Map([
    ["order-1", { order: { id: "order-1", status: "fulfilled" } }],
  ]);
  releaseData.itemsById = new Map([
    ["item-1", { id: "item-1", payout_status: "pending", payout_eligible_at: "2026-07-20T00:00:00.000Z" }],
  ]);
  const commission = {
    id: "commission-1",
    order_id: "order-1",
    order_item_id: "item-1",
    seller_id: "seller-1",
    status: "pending",
    net_amount: 100,
  };

  const pending = CommissionService.evaluateCommissionRelease(commission, releaseData, {}, new Date("2026-07-21T00:00:00.000Z"));
  assert.equal(pending.available, false);
  assert.equal(pending.reason, "waiting_for_item_return_window");

  releaseData.itemsById.get("item-1").payout_status = "eligible";
  const eligible = CommissionService.evaluateCommissionRelease(commission, releaseData, {}, new Date("2026-07-21T00:00:00.000Z"));
  assert.equal(eligible.available, true);
  assert.equal(eligible.releaseStatus, "available");

  releaseData.itemsById.get("item-1").payout_status = "held";
  const held = CommissionService.evaluateCommissionRelease(commission, releaseData, {}, new Date("2026-07-21T00:00:00.000Z"));
  assert.equal(held.releaseStatus, "held");
  assert.equal(held.reason, "item_on_hold");
});

test("mixed delivery releases only the eligible order item", () => {
  const releaseData = new Map([["order-mixed", { order: { id: "order-mixed", status: "shipped" } }]]);
  releaseData.itemsById = new Map([
    ["delivered-item", { id: "delivered-item", payout_status: "eligible" }],
    ["shipping-item", { id: "shipping-item", payout_status: "pending" }],
  ]);
  const base = { order_id: "order-mixed", status: "pending", net_amount: 500 };
  assert.equal(CommissionService.evaluateCommissionRelease({ ...base, id: "c1", order_item_id: "delivered-item" }, releaseData).available, true);
  const pending = CommissionService.evaluateCommissionRelease({ ...base, id: "c2", order_item_id: "shipping-item" }, releaseData);
  assert.equal(pending.available, false);
  assert.equal(pending.reason, "waiting_for_item_return_window");
});

test("partial return holds only the affected order item", () => {
  const releaseData = new Map([["order-return", {
    order: { id: "order-return", status: "return_requested" },
  }]]);
  releaseData.itemsById = new Map([
    ["kept-item", { id: "kept-item", payout_status: "eligible" }],
    ["returned-item", { id: "returned-item", payout_status: "held" }],
  ]);
  const base = { order_id: "order-return", seller_id: "seller-1", status: "pending", net_amount: 500 };

  const kept = CommissionService.evaluateCommissionRelease({ ...base, id: "c-kept", order_item_id: "kept-item" }, releaseData);
  const returned = CommissionService.evaluateCommissionRelease({ ...base, id: "c-returned", order_item_id: "returned-item" }, releaseData);

  assert.equal(kept.available, true);
  assert.equal(kept.releaseStatus, "available");
  assert.equal(returned.available, false);
  assert.equal(returned.releaseStatus, "held");
  assert.equal(returned.reason, "item_on_hold");
});

test("partial quantity cancellation and return allocation are proportional and rounding-safe", () => {
  assert.deepEqual(
    {
      itemAmount: prorateMoney(500, 2, 5),
      discountAmount: prorateMoney(50, 2, 5),
      taxAmount: prorateMoney(45, 2, 5),
    },
    { itemAmount: 200, discountAmount: 20, taxAmount: 18 },
  );

  const returned = [{ lineTotal: 180 }, { lineTotal: 90 }];
  ReturnService.allocateItemRefunds(returned, 100);
  assert.equal(returned.reduce((sum, row) => sum + row.refundAmount, 0), 100);
  assert.deepEqual(returned.map((row) => row.refundAmount), [66.67, 33.33]);
});

test("all seller shipping policies apply exactly once", () => {
  assert.equal(applyShippingPolicy(900, 50, "reimburse_seller"), 950);
  assert.equal(applyShippingPolicy(900, 50, "deduct_from_seller"), 850);
  assert.equal(applyShippingPolicy(900, 50, "not_in_seller_payout"), 900);
});

test("different item commission rates remain visible while fees are summed", () => {
  const items = [{ rate: 1, fee: 10 }, { rate: 5, fee: 100 }];
  assert.equal(items.reduce((sum, item) => sum + item.fee, 0), 110);
  assert.equal(3000 - items.reduce((sum, item) => sum + item.fee, 0), 2890);
  assert.deepEqual(uniqueCommissionRates(items.map((item) => item.rate)), [1, 5]);
});

test("refunded item settlement exposes net commission, tax, and TCS without changing payout", () => {
  const repository = new OrderRepository();
  const [settlement] = repository.attachCommissionStatusToSettlements([{
    sellerId: "seller-1",
    organizationId: null,
    platformFeeAmount: 2300,
    platformFeeTaxAmount: 414,
    taxableAmount: 97442,
    sellerPayoutAmount: 0,
  }], [{
    id: "kept",
    seller_id: "seller-1",
    organization_id: null,
    amount: 50000,
    commission_amount: 1000,
    tax_amount: 180,
    refund_amount: 0,
    net_amount: 48620,
    status: "pending",
    metadata: { gstTcsAmount: 200, taxableSupplyAmount: 40000 },
  }, {
    id: "returned",
    seller_id: "seller-1",
    organization_id: null,
    amount: 65000,
    commission_amount: 1300,
    tax_amount: 234,
    refund_amount: 63166,
    net_amount: 0,
    status: "refunded",
    metadata: { gstTcsAmount: 300, taxableSupplyAmount: 57442 },
  }]);

  assert.equal(settlement.commissionReversalAmount, 1300);
  assert.equal(settlement.netPlatformCommissionAmount, 1000);
  assert.equal(settlement.commissionTaxReversalAmount, 234);
  assert.equal(settlement.netCommissionTaxAmount, 180);
  assert.equal(settlement.gstTcsReversalAmount, 300);
  assert.equal(settlement.netGstTcsAmount, 200);
  assert.equal(settlement.gstTcsTaxableBaseAmount, 97442);
  assert.equal(settlement.netGstTcsTaxableBaseAmount, 40000);
  assert.equal(settlement.sellerPayoutBaseReversalAmount, 65000);
  assert.equal(settlement.sellerPayoutAmount, 48620);
});

test("legacy zero commission snapshots recover the immutable order rate", () => {
  const metadata = {
    commerceSettings: {
      platformFees: { sellerCommissionType: "percentage", sellerCommissionValue: 2 },
      finance: {
        sellerPayoutBase: "gross_customer_item_amount",
        chargePlatformFeeTaxToSeller: true,
        platformFeeTaxRate: 18,
        gstTcsEnabled: true,
        gstTcsRate: 0.5,
      },
    },
  };
  const item = {
    seller_id: "seller-1",
    quantity: 1,
    line_total: 5499,
    platform_fee_amount: 109.64,
    tax_amount: 838.83,
    tax_breakup: { taxableAmount: 4660.17 },
    pricing_snapshot: { commissionFee: 109.64, platformFeeAmount: 109.64, platformFeeTaxAmount: 19.74 },
  };

  assert.equal(CommissionService.resolveSellerFeeAmount({ ...item, order_metadata: metadata }, item.pricing_snapshot), 109.98);
  assert.equal(
    CommissionService.resolveSellerFeeTaxAmount(
      { ...item, order_metadata: metadata },
      item.pricing_snapshot,
      metadata.commerceSettings.finance,
    ),
    19.8,
  );

  const [settlement] = new OrderRepository().buildSellerSettlements(
    [item],
    [{ id: "seller-1", sellerProfile: { displayName: "Seller" } }],
    { metadata },
  );
  assert.equal(settlement.platformFeeAmount, 109.98);
  assert.equal(settlement.platformFeeTaxAmount, 19.8);
  assert.equal(settlement.gstTcsAmount, 23.3);
  assert.equal(settlement.sellerPayoutAmount, 5345.92);
});

test("two percent gross commission and statutory deductions use exact bases", () => {
  const metadata = {
    commerceSettings: {
      platformFees: { sellerCommissionType: "percentage", sellerCommissionValue: 2 },
      finance: {
        sellerPayoutBase: "gross_customer_price",
        chargePlatformFeeTaxToSeller: true,
        platformFeeTaxRate: 18,
        gstTcsEnabled: true,
        gstTcsRate: 0.5,
      },
    },
  };
  const [settlement] = new OrderRepository().buildSellerSettlements([{
    seller_id: "seller-1",
    quantity: 1,
    line_total: 114999,
    gst_rate: 18,
    platform_fee_amount: 2299.64,
    tax_breakup: { taxableAmount: 97442, gstRate: 18, cessRate: 0, gstInclusive: true },
    pricing_snapshot: {
      sellerPayoutBaseAmount: 114999,
      sellerCommissionBaseAmount: 114982,
      commissionFee: 2299.64,
      platformFeeTaxAmount: 413.94,
    },
  }], [], { metadata });

  assert.equal(settlement.platformFeeAmount, 2299.98);
  assert.equal(settlement.platformFeeTaxAmount, 414);
  assert.equal(settlement.taxableAmount, 97442);
  assert.equal(settlement.gstTcsAmount, 487.21);
  assert.equal(settlement.sellerPayoutAmount, 111797.81);
});

test("buyer seller invoice becomes ready per delivered seller package", () => {
  const service = new TaxService({ taxRepository: {}, orderRepository: {} });
  const order = {
    status: "shipped",
    items: [
      { seller_id: "seller-a", organization_id: "org-a", delivery_status: "delivered" },
      { seller_id: "seller-a", organization_id: "org-a", delivered_at: "2026-07-21T10:00:00.000Z" },
      { seller_id: "seller-b", organization_id: "org-b", delivery_status: "in_transit" },
    ],
  };

  assert.equal(service.isInvoiceReadyForBuyer(order, {
    invoice_type: "seller_customer",
    seller_id: "seller-a",
    organization_id: "org-a",
  }), true);
  assert.equal(service.isInvoiceReadyForBuyer(order, {
    invoice_type: "seller_customer",
    seller_id: "seller-b",
    organization_id: "org-b",
  }), false);
  assert.equal(service.isInvoiceReadyForBuyer(order, { invoice_type: "order_customer" }), false);
});
