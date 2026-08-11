const test = require("node:test");
const assert = require("node:assert/strict");

const { CommissionService } = require("../src/modules/seller/services/commission.service");
const { OrderRepository } = require("../src/modules/order/repositories/order.repository");
const { TaxService } = require("../src/modules/tax/services/tax.service");
const { ReturnService } = require("../src/modules/returns/services/return.service");
const { AnalyticsRepository } = require("../src/modules/analytics/repositories/analytics.repository");
const { CancellationService } = require("../src/modules/cancellation/services/cancellation.service");
const { DeliveryService } = require("../src/modules/delivery/services/delivery.service");
const { prorateMoney } = require("../src/shared/domain/quantity-allocation");
const {
  applyShippingPolicy,
  calculateInclusiveShippingTax,
  resolveShippingPolicy,
  uniqueCommissionRates,
} = require("../src/shared/domain/seller-payout-rules");

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

test("item cancellation keeps a shared shipment active while another item remains", async () => {
  const trackingEvents = [];
  const cancellationService = new CancellationService({
    deliveryRepository: {
      addTrackingEvent: async (...args) => trackingEvents.push(args),
    },
  });
  const order = {
    items: [
      { id: "item-a", seller_id: "seller-1", quantity: 1, cancelled_quantity: 0 },
      { id: "item-b", seller_id: "seller-1", quantity: 1, cancelled_quantity: 0 },
    ],
    relations: {
      shipments: [{
        id: "shipment-1",
        seller_id: "seller-1",
        status: "initiated",
        direction: "forward",
        metadata: { orderItemIds: ["item-a", "item-b"] },
      }],
    },
  };
  const cancellation = {
    id: "cancel-1",
    reason: "Changed mind",
    items: [{ orderItemId: "item-a", sellerId: "seller-1", quantity: 1 }],
  };

  await cancellationService.assertShipmentsCancellable(order, cancellation.items);
  const result = await cancellationService.cancelShipments(order, cancellation, { userId: "buyer-1" });

  assert.equal(result, "not_required");
  assert.equal(trackingEvents.length, 0);
});

test("item cancellation refunds shipping only when the seller group is fully cancelled", () => {
  const service = new CancellationService();
  const order = {
    metadata: {
      deliveryCharge: {
        sellers: [
          { sellerId: "seller-1", organizationId: "org-1", chargeAmount: 49 },
          { sellerId: "seller-2", organizationId: "org-2", chargeAmount: 75 },
        ],
      },
    },
    items: [
      { id: "item-a", seller_id: "seller-1", organization_id: "org-1", quantity: 1, cancelled_quantity: 0 },
      { id: "item-b", seller_id: "seller-1", organization_id: "org-1", quantity: 1, cancelled_quantity: 0 },
      { id: "item-c", seller_id: "seller-2", organization_id: "org-2", quantity: 1, cancelled_quantity: 0 },
    ],
  };

  assert.equal(service.getCompletedSellerGroupShippingAmount(order, [
    { orderItemId: "item-a", sellerId: "seller-1", quantity: 1 },
  ]), 0);
  assert.equal(service.getCompletedSellerGroupShippingAmount(order, [
    { orderItemId: "item-a", sellerId: "seller-1", quantity: 1 },
    { orderItemId: "item-b", sellerId: "seller-1", quantity: 1 },
  ]), 49);
  assert.equal(service.getCompletedSellerGroupShippingAmount(order, [
    { orderItemId: "item-c", sellerId: "seller-2", quantity: 1 },
  ]), 75);
});

test("COD commissions wait for collection capture before payout release", () => {
  const releaseData = new Map([["order-cod", {
    order: {
      id: "order-cod",
      status: "fulfilled",
      payment_provider: "cod",
      payment_status: "authorized",
      updated_at: "2026-07-21T00:00:00.000Z",
    },
    codCollections: [],
  }]]);
  releaseData.itemsById = new Map([
    ["item-cod", { id: "item-cod", payout_status: "eligible" }],
  ]);
  const commission = {
    id: "commission-cod",
    order_id: "order-cod",
    order_item_id: "item-cod",
    seller_id: "seller-1",
    status: "pending",
    net_amount: 1000,
  };

  const blocked = CommissionService.evaluateCommissionRelease(
    commission,
    releaseData,
    { codPayoutRequiresCapture: true },
  );
  assert.equal(blocked.available, false);
  assert.equal(blocked.releaseStatus, "blocked");
  assert.equal(blocked.reason, "waiting_for_cod_collection_confirmation");

  releaseData.get("order-cod").order.payment_status = "captured";
  const available = CommissionService.evaluateCommissionRelease(
    commission,
    releaseData,
    { codPayoutRequiresCapture: true },
  );
  assert.equal(available.available, true);
  assert.equal(available.releaseStatus, "available");
});

test("seller-direct COD collections block payout until verified", () => {
  const releaseData = new Map([["order-cod-direct", {
    order: {
      id: "order-cod-direct",
      status: "fulfilled",
      payment_provider: "cod",
      payment_status: "captured",
      fulfillment_eligible_at: "2026-07-20T00:00:00.000Z",
    },
    codCollections: [
      { seller_id: "seller-1", collection_mode: "seller_direct", status: "submitted" },
    ],
  }]]);
  const commission = {
    id: "commission-cod-direct",
    order_id: "order-cod-direct",
    seller_id: "seller-1",
    status: "pending",
    net_amount: 1000,
  };

  const blocked = CommissionService.evaluateCommissionRelease(
    commission,
    releaseData,
    { codPayoutRequiresCapture: true },
  );
  assert.equal(blocked.available, false);
  assert.equal(blocked.releaseStatus, "blocked");
  assert.equal(blocked.reason, "waiting_for_seller_cod_reconciliation");

  releaseData.get("order-cod-direct").codCollections[0].status = "verified";
  const available = CommissionService.evaluateCommissionRelease(
    commission,
    releaseData,
    { codPayoutRequiresCapture: true },
  );
  assert.equal(available.available, true);
  assert.equal(available.releaseStatus, "available");
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

test("seller-fulfilled customer shipping is credited and included in GST TCS base", () => {
  assert.equal(
    resolveShippingPolicy("not_in_seller_payout", {
      fulfillmentParty: "seller",
      settlementPolicy: "reimburse_seller",
    }),
    "reimburse_seller",
  );
  assert.equal(
    resolveShippingPolicy("not_in_seller_payout", {
      sellerId: "seller-1",
      ruleSource: "shipping_profile",
    }),
    "reimburse_seller",
  );
  assert.deepEqual(calculateInclusiveShippingTax(49, 847.46, 152.54), {
    taxableAmount: 41.53,
    taxAmount: 7.47,
  });

  const metadata = {
    commerceSettings: {
      platformFees: { sellerCommissionType: "percentage", sellerCommissionValue: 2 },
      finance: {
        sellerPayoutBase: "gross_customer_price",
        chargePlatformFeeTaxToSeller: true,
        platformFeeTaxRate: 18,
        shippingPolicy: "not_in_seller_payout",
        gstTcsEnabled: true,
        gstTcsRate: 0.5,
      },
    },
    deliveryCharge: {
      sellers: [{
        sellerId: "seller-1",
        chargeAmount: 49,
        fulfillmentParty: "seller",
        collectedBy: "platform",
        beneficiary: "seller",
        settlementPolicy: "reimburse_seller",
      }],
    },
  };
  const [settlement] = new OrderRepository().buildSellerSettlements([{
    seller_id: "seller-1",
    quantity: 1,
    line_total: 1000,
    tax_amount: 152.54,
    tax_breakup: { taxableAmount: 847.46, taxAmount: 152.54, gstRate: 18, gstInclusive: true },
    pricing_snapshot: {
      sellerPayoutBaseAmount: 1000,
      platformFeeAmount: 20,
      platformFeeTaxAmount: 3.6,
    },
  }], [], { metadata });

  assert.equal(settlement.shippingReimbursementAmount, 49);
  assert.equal(settlement.shippingTaxableAmount, 41.53);
  assert.equal(settlement.gstTcsTaxableAmount, 888.99);
  assert.equal(settlement.gstTcsAmount, 4.44);
  assert.equal(settlement.sellerPayoutAmount, 1020.96);
});

test("multi-seller shipping is credited only to its owning seller", () => {
  const metadata = {
    commerceSettings: {
      platformFees: { sellerCommissionType: "percentage", sellerCommissionValue: 0 },
      finance: { sellerPayoutBase: "gross_customer_price", shippingPolicy: "reimburse_seller" },
    },
    deliveryCharge: {
      sellers: [
        { sellerId: "seller-a", chargeAmount: 40, fulfillmentParty: "seller", settlementPolicy: "reimburse_seller" },
        { sellerId: "seller-b", chargeAmount: 60, fulfillmentParty: "seller", settlementPolicy: "reimburse_seller" },
      ],
    },
  };
  const settlements = new OrderRepository().buildSellerSettlements([
    { seller_id: "seller-a", quantity: 1, line_total: 1000, tax_breakup: { taxableAmount: 1000 }, pricing_snapshot: { sellerPayoutBaseAmount: 1000 } },
    { seller_id: "seller-b", quantity: 1, line_total: 2000, tax_breakup: { taxableAmount: 2000 }, pricing_snapshot: { sellerPayoutBaseAmount: 2000 } },
  ], [], { metadata });

  assert.deepEqual(
    settlements.map((row) => [row.sellerId, row.shippingReimbursementAmount, row.sellerPayoutAmount]),
    [["seller-a", 40, 1040], ["seller-b", 60, 2060]],
  );
});

test("income-tax TDS gross base includes seller-owned shipping", () => {
  const metadata = {
    commerceSettings: {
      platformFees: { sellerCommissionType: "percentage", sellerCommissionValue: 0 },
      finance: {
        sellerPayoutBase: "gross_customer_price",
        shippingPolicy: "reimburse_seller",
        incomeTaxTdsEnabled: true,
        incomeTaxTdsRate: 0.1,
      },
    },
    deliveryCharge: {
      sellers: [{
        sellerId: "seller-1",
        chargeAmount: 49,
        fulfillmentParty: "seller",
        settlementPolicy: "reimburse_seller",
      }],
    },
  };
  const [settlement] = new OrderRepository().buildSellerSettlements([{
    seller_id: "seller-1",
    quantity: 1,
    line_total: 1000,
    tax_amount: 152.54,
    tax_breakup: { taxableAmount: 847.46, taxAmount: 152.54 },
    pricing_snapshot: { sellerPayoutBaseAmount: 1000 },
  }], [], { metadata });

  assert.equal(settlement.incomeTaxTdsTaxableAmount, 1049);
  assert.equal(settlement.incomeTaxTdsAmount, 1.05);
  assert.equal(settlement.sellerPayoutAmount, 1047.95);
});

test("different item commission rates remain visible while fees are summed", () => {
  const items = [{ rate: 1, fee: 10 }, { rate: 5, fee: 100 }];
  assert.equal(items.reduce((sum, item) => sum + item.fee, 0), 110);
  assert.equal(3000 - items.reduce((sum, item) => sum + item.fee, 0), 2890);
  assert.deepEqual(uniqueCommissionRates(items.map((item) => item.rate)), [1, 5]);
});

test("settlement statements and finance exports expose shipping and statutory breakdowns", () => {
  const service = CommissionService;
  const commission = {
    id: "commission-shipping",
    seller_id: "seller-1",
    order_id: "order-1",
    status: "paid",
    amount: 1000,
    commission_amount: 20,
    tax_amount: 3.6,
    refund_amount: 0,
    net_amount: 1020.96,
    currency: "INR",
    metadata: {
      sellerDeliveryChargeAmount: 49,
      shippingReimbursementAmount: 49,
      shippingTaxableAmount: 41.53,
      shippingTaxAmount: 7.47,
      taxableSupplyAmount: 888.99,
      gstTcsAmount: 4.44,
      incomeTaxTdsAmount: 0,
    },
  };
  const settlement = {
    id: "settlement-1",
    seller_id: "seller-1",
    status: "completed",
    gross_amount: 1000,
    commission_amount: 20,
    tax_amount: 3.6,
    refund_amount: 0,
    adjustment_amount: 0,
    net_amount: 1020.96,
    currency: "INR",
    metadata: {
      financialBreakdown: {
        sellerDeliveryChargeAmount: 49,
        shippingReimbursementAmount: 49,
        shippingTaxableAmount: 41.53,
        shippingTaxAmount: 7.47,
        gstTcsTaxableAmount: 888.99,
        gstTcsAmount: 4.44,
        incomeTaxTdsAmount: 0,
      },
    },
  };

  const statement = service.buildSettlementDocument(settlement, null, [commission]);
  const amountRows = statement.sections.find((section) => section.title === "Amounts").rows;
  assert.equal(
    amountRows.find((row) => row.label === "Shipping Reimbursed To Seller").value,
    "INR 49.00",
  );
  assert.equal(
    amountRows.find((row) => row.label === "GST TCS Taxable Base").value,
    "INR 888.99",
  );

  const exportRows = service.buildSettlementsExportDocument([settlement]).sections[0].rows;
  assert.ok(exportRows[0].includes("Shipping Reimbursed"));
  assert.ok(exportRows[0].includes("GST TCS Base"));
  assert.ok(exportRows[1].includes("INR 49.00"));
  assert.ok(exportRows[1].includes("INR 888.99"));
});

test("platform revenue includes customer fees net of credits and never seller shipping", () => {
  const summary = new AnalyticsRepository().composeAdminFinanceSummary(
    {
      commission_count: 1,
      seller_gross_amount: 1049,
      platform_revenue_amount: 20,
      platform_revenue_tax_amount: 3.6,
      seller_payable_amount: 1020.96,
      currency: "INR",
    },
    {
      taxable_amount: 10,
      tax_amount: 1.8,
      total_amount: 11.8,
      // Deliberately present to prove this non-revenue seller amount is ignored.
      shipping_fee_amount: 49,
    },
    {
      taxable_amount: 4,
      tax_amount: 0.72,
      total_amount: 4.72,
    },
  );

  assert.equal(summary.commissionRevenueAmount, 20);
  assert.equal(summary.customerPlatformFeeRevenueAmount, 6);
  assert.equal(summary.customerPlatformFeeRevenueTaxAmount, 1.08);
  assert.equal(summary.platformRevenueAmount, 26);
  assert.equal(summary.platformRevenueTaxAmount, 4.68);
  assert.equal(summary.platformRevenueTotalAmount, 30.68);
});

test("full cancellation recovers all remaining seller payable but never the platform customer fee", () => {
  const sellerPayable = 1020.96;
  const customerRefundIncludingPlatformFee = 1032.76;
  assert.equal(
    CommissionService.resolveSellerRecoveryRequest({
      fullCancellation: true,
      customerRefundAmount: customerRefundIncludingPlatformFee,
      remainingSellerPayable: sellerPayable,
    }),
    sellerPayable,
  );
  assert.equal(
    CommissionService.resolveSellerRecoveryRequest({
      fullCancellation: false,
      customerRefundAmount: 500,
      remainingSellerPayable: sellerPayable,
    }),
    500,
  );
});

test("multi-seller RTO refunds only the returned seller shipping", () => {
  const service = new CancellationService();
  const order = {
    subtotal_amount: 3000,
    cod_charge_amount: 0,
    metadata: {
      deliveryCharge: {
        sellers: [
          { sellerId: "seller-a", organizationId: "org-a", chargeAmount: 49 },
          { sellerId: "seller-b", organizationId: "org-b", chargeAmount: 75 },
        ],
      },
    },
    relations: {
      shipments: [{
        id: "shipment-a",
        seller_id: "seller-a",
        organization_id: "org-a",
        status: "rto",
      }],
    },
  };
  const items = [{ itemAmount: 1000, refundAmount: 1000 }];
  const shippingRefund = service.getSellerShippingAmount(
    order,
    "seller-a",
    "org-a",
  );
  assert.equal(shippingRefund, 49);
  assert.doesNotThrow(() => service.assertRtoShipment(order, {
    shipmentId: "shipment-a",
    sellerId: "seller-a",
    organizationId: "org-a",
  }));
  const refund = service.calculateRefund(
    order,
    items,
    { status: "captured", provider: "razorpay" },
    false,
    shippingRefund,
  );
  assert.equal(refund.refundAmount, 1049);
  assert.equal(refund.providerRefundAmount, 1049);
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

test("manual shipment organization scope is inferred or required per seller group", () => {
  const service = new DeliveryService();
  const order = {
    items: [
      { seller_id: "seller-a", organization_id: "org-a" },
      { seller_id: "seller-a", organization_id: "org-b" },
      { seller_id: "seller-b", organization_id: "org-c" },
    ],
  };

  assert.equal(
    service.resolveShipmentOrganizationId(order, "seller-b", {}, {}),
    "org-c",
  );
  assert.equal(
    service.resolveShipmentOrganizationId(order, "seller-a", { organizationId: "org-b" }, {}),
    "org-b",
  );
  assert.throws(
    () => service.resolveShipmentOrganizationId(order, "seller-a", {}, {}),
    /Organization ID is required/,
  );
  assert.throws(
    () => service.resolveShipmentOrganizationId(order, "seller-a", { organizationId: "org-c" }, {}),
    /does not own items/,
  );
});
