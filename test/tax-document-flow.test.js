const test = require("node:test");
const assert = require("node:assert/strict");

const { TaxService } = require("../src/modules/tax/services/tax.service");
const { DocumentRendererService } = require("../src/shared/services/document-renderer.service");
const { PricingService } = require("../src/modules/pricing/services/pricing.service");
const { redis } = require("../src/infrastructure/redis/redis-client");

test.after(() => redis.disconnect());

const service = new TaxService({ taxRepository: {}, orderRepository: {} });

test("seller invoice uses only its item discount and reconciles its total", () => {
  const order = {
    shipping_address: { state: "Madhya Pradesh" },
    items: [],
  };
  const items = [{
    seller_id: "seller-a",
    line_total: 2000,
    discount_amount: 200,
    tax_amount: 274.58,
    tax_breakup: {
      taxableAmount: 1525.42,
      igstAmount: 274.58,
      taxAmount: 274.58,
      taxPayableAmount: 0,
    },
  }];

  const amounts = service.calculateSellerCustomerAmounts(order, "seller-a", items);
  assert.equal(amounts.grossSalesAmount, 2000);
  assert.equal(amounts.discountAmount, 200);
  assert.equal(amounts.customerFinalAmount, 1800);
});

test("commission document expands product references into service rows", () => {
  const document = service.buildInvoiceDocument({
    invoice_number: "GST-C-1",
    invoice_type: "platform_commission",
    order_id: "order-1",
    currency: "INR",
    taxable_amount: 300,
    tax_amount: 54,
    total_amount: 354,
    metadata: {
      orderNumber: "ORD-1",
      seller: { legalBusinessName: "Seller A" },
      amounts: { taxableAmount: 300, taxAmount: 54, totalAmount: 354 },
      itemReferences: [
        {
          orderItemId: "item-1",
          productId: "product-1",
          productTitle: "Phone",
          productSku: "PHONE-1",
          quantity: 1,
          commissionRate: 2,
          platformFeeAmount: 100,
          platformFeeTaxAmount: 18,
          platformFeeTaxRate: 18,
          serviceSacCode: "998599",
        },
        {
          orderItemId: "item-2",
          productId: "product-2",
          productTitle: "Laptop",
          quantity: 1,
          commissionRate: 4,
          platformFeeAmount: 200,
          platformFeeTaxAmount: 36,
          platformFeeTaxRate: 18,
          serviceSacCode: "998599",
        },
      ],
    },
  });

  assert.equal(document.data.items.length, 2);
  assert.equal(document.data.items[0].productTitle, "Phone");
  assert.equal(document.data.items[0].taxableAmount, 100);
  assert.equal(document.data.items[0].taxAmount, 18);
  assert.equal(document.data.items[0].totalAmount, 118);
  assert.equal(document.data.items[0].hsnCode, "998599");
});

test("buyers never receive platform commission invoices", () => {
  const invoices = [
    { invoice_type: "order_customer" },
    { invoice_type: "seller_customer" },
    { invoice_type: "platform_commission" },
    { invoice_type: "platform_customer_fee" },
  ];
  const visible = service.filterInvoicesForScope(invoices, { isBuyer: true });
  assert.deepEqual(visible.map((invoice) => invoice.invoice_type), [
    "order_customer",
    "seller_customer",
    "platform_customer_fee",
  ]);
});

test("customer order documents become available for delivered orders and delivered items", () => {
  assert.equal(service.isOrderInvoiceReadyForBuyer({ status: "delivered", items: [] }), true);
  assert.equal(service.isOrderInvoiceReadyForBuyer({
    status: "processing",
    items: [{ delivery_status: "delivered" }, { delivered_at: "2026-07-23T10:00:00.000Z" }],
  }), true);
  assert.equal(service.isOrderInvoiceReadyForBuyer({
    status: "processing",
    items: [{ delivery_status: "delivered" }, { delivery_status: "shipped" }],
  }), false);
});

test("customer platform-fee invoice is available after payment capture before delivery", () => {
  const pendingDeliveryOrder = {
    status: "processing",
    payment_status: "captured",
    items: [{ delivery_status: "shipped" }],
  };
  assert.equal(service.isOrderInvoiceReadyForBuyer(pendingDeliveryOrder), false);
  assert.equal(service.isInvoiceReadyForBuyer(
    pendingDeliveryOrder,
    { invoice_type: "platform_customer_fee" },
  ), true);
  assert.equal(service.isInvoiceReadyForBuyer(
    pendingDeliveryOrder,
    { invoice_type: "seller_customer", seller_id: "seller-a" },
  ), false);
});

test("customer platform-fee reversal is identified as its own credit-note document", () => {
  const document = service.buildCreditNoteDocument({
    id: "credit-customer-fee",
    credit_note_number: "CN-FEE-1",
    order_id: "order-1",
    currency: "INR",
    taxable_amount: 10,
    tax_amount: 1.8,
    total_amount: 11.8,
    metadata: {
      creditNoteScope: "platform_customer_fee_invoice",
      items: [],
    },
  }, {
    id: "invoice-customer-fee",
    invoice_number: "GST-F-1",
    invoice_type: "platform_customer_fee",
    metadata: {},
  });

  assert.equal(document.title, "Customer Platform Fee Credit Note");
});

test("full cancellation credit notes reverse seller shipping and customer platform fee", async () => {
  const created = [];
  const sellerInvoice = {
    id: "seller-invoice",
    seller_id: "seller-a",
    organization_id: null,
    total_amount: 1049,
    metadata: {
      amounts: {
        deliveryChargeAmount: 49,
        shippingTaxableAmount: 41.53,
        shippingTaxAmount: 7.47,
        shippingCgstAmount: 3.74,
        shippingSgstAmount: 3.73,
        shippingIgstAmount: 0,
      },
    },
  };
  const feeInvoice = {
    id: "customer-fee-invoice",
    invoice_type: "platform_customer_fee",
    taxable_amount: 10,
    tax_amount: 1.8,
    cgst_amount: 0.9,
    sgst_amount: 0.9,
    igst_amount: 0,
    total_amount: 11.8,
  };
  const localService = new TaxService({
    taxRepository: {
      findInvoicesByOrderId: async () => [sellerInvoice, feeInvoice],
    },
    orderRepository: {
      findByIdWithItems: async () => ({
        id: "order-1",
        items: [{
          id: "item-1",
          seller_id: "seller-a",
          quantity: 1,
          line_total: 1000,
          discount_amount: 0,
          tax_amount: 152.54,
          tax_breakup: {
            taxableAmount: 847.46,
            taxAmount: 152.54,
            cgstAmount: 76.27,
            sgstAmount: 76.27,
          },
        }],
      }),
    },
  });
  localService.ensureMarketplaceInvoicesForCreditNote = async () => ({
    sellerInvoices: [sellerInvoice],
    platformCommissionInvoices: [],
  });
  localService.createCreditNote = async (payload) => {
    created.push(payload);
    return {
      id: `credit-${created.length}`,
      credit_note_number: `CN-${created.length}`,
      ...payload,
    };
  };

  const bundle = await localService.createMarketplaceCreditNotes({
    orderId: "order-1",
    referenceType: "cancellation",
    referenceId: "cancel-1",
    reason: "cancelled",
    metadata: { cancellationScope: "full" },
    items: [{ orderItemId: "item-1", quantity: 1, refundAmount: 1000 }],
  }, { userId: "admin-1", role: "admin" });

  const sellerCredit = created.find((entry) => entry.invoiceId === "seller-invoice");
  assert.equal(sellerCredit.taxableAmount, 888.99);
  assert.equal(sellerCredit.taxAmount, 160.01);
  assert.equal(sellerCredit.totalAmount, 1049);
  assert.equal(sellerCredit.metadata.shippingReversalAmount, 49);
  assert.equal(sellerCredit.metadata.items.at(-1).lineType, "seller_shipping_reversal");

  const feeCredit = created.find((entry) => entry.invoiceId === "customer-fee-invoice");
  assert.equal(feeCredit.totalAmount, 11.8);
  assert.equal(feeCredit.metadata.creditNoteScope, "platform_customer_fee_invoice");
  assert.equal(bundle.customerFeeCreditNote.invoiceId, "customer-fee-invoice");
});

test("PDF distinguishes receipt, product invoice, and commission invoice roles", () => {
  const renderer = new DocumentRendererService();
  const base = {
    invoice: { number: "DOC-1", currency: "INR", orderNumber: "ORD-1" },
    seller: { legalBusinessName: "Seller A" },
    buyer: { email: "buyer@example.com" },
    amounts: { taxAmount: 18, totalAmount: 118 },
    items: [{ productTitle: "Phone", quantity: 1, taxableAmount: 100, taxAmount: 18, totalAmount: 118 }],
  };
  const pdfText = (type) => renderer.renderPdf({
    layout: "invoice",
    data: { ...base, invoice: { ...base.invoice, type } },
  }).toString("binary");

  assert.match(pdfText("order_customer"), /ORDER RECEIPT/);
  assert.match(pdfText("seller_customer"), /SOLD BY \/ SUPPLIER/);
  const commission = pdfText("platform_commission");
  assert.match(commission, /COMMISSION TAX INVOICE/);
  assert.match(commission, /BILLED TO \/ SELLER/);
  assert.match(commission, /GST on Commission/);
  assert.doesNotMatch(commission, /Included GST/);
  assert.match(pdfText("platform_customer_fee"), /PLATFORM FEE TAX INVOICE/);
});

test("zero-GST customer platform fee is still a downloadable fee invoice", () => {
  assert.equal(service.getInvoiceDocumentTitle({
    invoice_type: "platform_customer_fee",
    tax_amount: 0,
  }), "Marketplace Customer Fee Invoice");

  const renderer = new DocumentRendererService();
  const pdf = renderer.renderPdf({
    layout: "invoice",
    data: {
      invoice: {
        type: "platform_customer_fee",
        number: "FEE-1",
        currency: "INR",
        orderNumber: "ORD-1",
      },
      buyer: { email: "buyer@example.com" },
      amounts: { taxableAmount: 21, taxAmount: 0, totalAmount: 21 },
      items: [{
        description: "Marketplace customer platform service fee",
        quantity: 1,
        taxableAmount: 21,
        taxAmount: 0,
        totalAmount: 21,
      }],
    },
  }).toString("binary");
  assert.match(pdf, /PLATFORM FEE INVOICE/);
  assert.doesNotMatch(pdf, /PLATFORM FEE TAX INVOICE/);
});

test("seller invoice exposes seller-managed shipping as a separate supply line", () => {
  const renderer = new DocumentRendererService();
  const pdf = renderer.renderPdf({
    layout: "invoice",
    data: {
      invoice: {
        type: "seller_customer",
        number: "SELLER-SHIP-1",
        currency: "INR",
        orderNumber: "ORD-SHIP-1",
      },
      seller: { legalBusinessName: "Seller A" },
      buyer: { email: "buyer@example.com" },
      amounts: {
        grossSalesAmount: 1000,
        deliveryChargeAmount: 49,
        shippingTaxableAmount: 41.53,
        shippingTaxAmount: 7.47,
        customerFinalAmount: 1049,
      },
      items: [
        {
          productTitle: "Phone",
          quantity: 1,
          taxableAmount: 847.46,
          taxAmount: 152.54,
          totalAmount: 1000,
        },
        {
          description: "Delivery / shipping collected by platform on behalf of seller",
          quantity: 1,
          taxableAmount: 41.53,
          taxAmount: 7.47,
          totalAmount: 49,
          lineType: "seller_shipping",
        },
      ],
    },
  }).toString("binary");

  assert.match(pdf, /Delivery \/ shipping collected/);
  assert.match(pdf, /INR 49\.00/);
});

test("order discount allocation is exact after item-level rounding", async () => {
  const pricing = new PricingService();
  const items = [
    { lineTotal: 333.33, gstRate: 0, taxExempt: true },
    { lineTotal: 333.33, gstRate: 0, taxExempt: true },
    { lineTotal: 333.34, gstRate: 0, taxExempt: true },
  ];
  await pricing.calculateTaxBreakup(items, 1000, 10, { country: "India" });
  assert.equal(items.reduce((sum, item) => sum + item.discountAmount, 0), 10);
  assert.deepEqual(items.map((item) => item.discountAmount), [3.33, 3.33, 3.34]);
});

test("coupon funding snapshot resolves marketplace, seller, shared, and payment-partner responsibility", async () => {
  const coupon = {
    id: "coupon-1",
    code: "SHARED20",
    active: true,
    minOrderAmount: 0,
    type: "fixed",
    value: 100,
    fundingType: "shared",
    sellerFundingPercent: 25,
  };
  const pricing = new PricingService({
    pricingRepository: {
      findCouponByCode: async () => coupon,
      countCouponUsageByCustomer: async () => 0,
    },
  });
  const result = await pricing.calculateDiscount("SHARED20", 1000, "buyer-1");
  assert.equal(result.discountAmount, 100);
  assert.equal(result.fundingType, "shared");
  assert.equal(result.sellerFundingPercent, 25);

  coupon.fundingType = "payment_partner";
  coupon.code = "BANK100";
  const partnerResult = await pricing.calculateDiscount("BANK100", 1000, "buyer-1");
  assert.equal(partnerResult.discountAmount, 100);
  assert.equal(partnerResult.fundingType, "payment_partner");
  assert.equal(partnerResult.sellerFundingPercent, 0);
});

test("partial return reverses only the returned quantity tax and discount", () => {
  const item = service.normalizeRefundItem({ quantity: 1 }, {
    id: "item-1",
    product_id: "product-1",
    product_title: "Phone",
    seller_id: "seller-a",
    quantity: 2,
    line_total: 2360,
    discount_amount: 200,
    tax_breakup: {
      taxableAmount: 2000,
      taxAmount: 360,
      igstAmount: 360,
    },
  });
  assert.equal(item.taxableAmount, 1000);
  assert.equal(item.taxAmount, 180);
  assert.equal(item.igstAmount, 180);
});

test("marketplace-funded discount does not reduce seller taxable value", async () => {
  const pricing = new PricingService();
  const items = [{
    productId: "phone",
    lineTotal: 1180,
    gstRate: 18,
    cessRate: 0,
    gstInclusive: true,
    taxType: "gst",
  }];

  const marketplaceFunded = await pricing.calculateTaxBreakup(
    items.map((item) => ({ ...item })),
    1180,
    180,
    { country: "India" },
    { sellerFundingPercent: 0 },
  );
  assert.equal(marketplaceFunded.taxableAmount, 1000);
  assert.equal(marketplaceFunded.totalTaxAmount, 180);
  assert.equal(marketplaceFunded.items[0].customerDiscountedLineTotal, 1000);
  assert.equal(marketplaceFunded.items[0].discountedLineTotal, 1180);

  const sellerFunded = await pricing.calculateTaxBreakup(
    items.map((item) => ({ ...item })),
    1180,
    180,
    { country: "India" },
    { sellerFundingPercent: 100 },
  );
  assert.equal(sellerFunded.taxableAmount, 847.46);
  assert.equal(sellerFunded.totalTaxAmount, 152.54);
});

test("seller invoice records marketplace promotion as payment contribution", () => {
  const amounts = service.calculateSellerCustomerAmounts(
    { shipping_address: { state: "Madhya Pradesh" } },
    "seller-a",
    [{
      id: "item-1",
      seller_id: "seller-a",
      line_total: 1180,
      discount_amount: 100,
      tax_amount: 180,
      tax_breakup: {
        taxableAmount: 1000,
        taxAmount: 180,
        cgstAmount: 90,
        sgstAmount: 90,
        taxPayableAmount: 0,
      },
      pricing_snapshot: {
        discountAmount: 100,
        discountFundingType: "marketplace",
        marketplaceFundedDiscountAmount: 100,
        sellerFundedDiscountAmount: 0,
        paymentPartnerFundedDiscountAmount: 0,
      },
    }],
  );

  assert.equal(amounts.sellerFundedDiscountAmount, 0);
  assert.equal(amounts.customerDiscountAmount, 100);
  assert.equal(amounts.marketplaceFundedDiscountAmount, 100);
  assert.equal(amounts.customerFinalAmount, 1180);
  assert.equal(amounts.customerPaidTowardInvoiceAmount, 1080);
  assert.equal(amounts.customerPaidTowardInvoiceAmount + amounts.thirdPartyContributionAmount, amounts.customerFinalAmount);

  const invoicePdf = new DocumentRendererService().renderPdf({
    layout: "invoice",
    data: {
      invoice: { type: "seller_customer", number: "INV-PROMO-1", currency: "INR" },
      seller: { legalBusinessName: "Seller A" },
      buyer: { email: "buyer@example.com" },
      amounts,
      items: [{
        productTitle: "Phone",
        quantity: 1,
        taxableAmount: 1000,
        taxAmount: 180,
        totalAmount: 1180,
        customerDiscountAmount: 100,
        marketplaceFundedDiscountAmount: 100,
      }],
    },
  }).toString("binary");
  assert.match(invoicePdf, /Customer Promotion/);
  assert.match(invoicePdf, /AMOUNT PAID BY CUSTOMER/);
  assert.match(invoicePdf, /Tax invoice value/);
  assert.match(invoicePdf, /Marketplace promotion/);

  const reversal = service.normalizeRefundItem(
    { orderItemId: "item-1", quantity: 1, refundAmount: 1080 },
    {
      id: "item-1",
      quantity: 1,
      line_total: 1180,
      discount_amount: 100,
      tax_amount: 180,
      tax_breakup: { taxableAmount: 1000, taxAmount: 180, cgstAmount: 90, sgstAmount: 90 },
      pricing_snapshot: { marketplaceFundedDiscountAmount: 100 },
    },
  );
  assert.equal(reversal.customerRefundAmount, 1080);
  assert.equal(reversal.marketplaceContributionReversalAmount, 100);
  assert.equal(reversal.totalAmount, 1180);
});

test("seller shipping GST split reconciles exactly without a negative remainder", () => {
  const amounts = service.calculateSellerCustomerAmounts(
    {
      shipping_address: { state: "Punjab" },
      metadata: {
        commerceSettings: { finance: { shippingPolicy: "reimburse_seller" } },
        deliveryCharge: {
          sellers: [{
            sellerId: "seller-a",
            chargeAmount: 49,
            fulfillmentParty: "seller",
          }],
        },
      },
    },
    "seller-a",
    [{
      id: "item-1",
      seller_id: "seller-a",
      quantity: 1,
      line_total: 1000,
      discount_amount: 0,
      tax_amount: 152.54,
      tax_breakup: {
        taxableAmount: 847.46,
        taxAmount: 152.54,
        cgstAmount: 76.27,
        sgstAmount: 76.27,
      },
      pricing_snapshot: {
        sellerFundedDiscountAmount: 0,
        marketplaceFundedDiscountAmount: 0,
        paymentPartnerFundedDiscountAmount: 0,
      },
    }],
  );

  assert.equal(amounts.shippingTaxableAmount, 41.53);
  assert.equal(amounts.shippingTaxAmount, 7.47);
  assert.equal(amounts.shippingCgstAmount, 3.74);
  assert.equal(amounts.shippingSgstAmount, 3.73);
  assert.equal(amounts.shippingIgstAmount, 0);
  assert.equal(
    Number((
      amounts.shippingCgstAmount +
      amounts.shippingSgstAmount +
      amounts.shippingIgstAmount
    ).toFixed(2)),
    amounts.shippingTaxAmount,
  );
});

test("seller invoice shipping is scoped to the seller organization", () => {
  const order = {
    metadata: {
      commerceSettings: { finance: { shippingPolicy: "reimburse_seller" } },
      deliveryCharge: {
        sellers: [
          {
            sellerId: "seller-a",
            organizationId: "org-a",
            chargeAmount: 40,
            fulfillmentParty: "seller",
          },
          {
            sellerId: "seller-a",
            organizationId: "org-b",
            chargeAmount: 60,
            fulfillmentParty: "seller",
          },
        ],
      },
    },
  };

  assert.equal(service.getDeliveryChargeBySeller(order, "seller-a", "org-a"), 40);
  assert.equal(service.getDeliveryChargeBySeller(order, "seller-a", "org-b"), 60);
  assert.equal(service.getDeliveryChargeBySeller(order, "seller-a"), 0);
});

test("commission credit uses the returned product fee rather than an order-average ratio", () => {
  const commissionInvoice = {
    taxable_amount: 300,
    tax_amount: 54,
    cgst_amount: 27,
    sgst_amount: 27,
    metadata: {
      itemReferences: [
        { orderItemId: "item-1", productTitle: "Phone", quantity: 1, platformFeeAmount: 100, platformFeeTaxAmount: 18 },
        { orderItemId: "item-2", productTitle: "Laptop", quantity: 1, platformFeeAmount: 200, platformFeeTaxAmount: 36 },
      ],
    },
  };
  const refundGroup = { items: [{ orderItemId: "item-1", quantity: 1 }], totalAmount: 500 };
  const reversal = service.calculateCommissionReversalAmounts(commissionInvoice, { total_amount: 1000 }, refundGroup);
  assert.equal(reversal.taxableAmount, 100);
  assert.equal(reversal.taxAmount, 18);
  assert.equal(reversal.totalAmount, 118);
});

test("taxable customer platform fee is allocated once and separately from seller commission", async () => {
  const pricing = new PricingService({ redisClient: { get: async () => null, setex: async () => null } });
  const fee = await pricing.calculatePlatformFee([
    { productId: "p1", sellerId: "s1", lineTotal: 600, quantity: 1 },
    { productId: "p2", sellerId: "s2", lineTotal: 400, quantity: 1 },
  ], {
    subtotalAmount: 1000,
    customerItemsAmount: 1000,
    commerceSettings: {
      finance: {},
      platformFees: {
        customerFeeType: "fixed",
        customerFeeValue: 100,
        customerFeeTaxRate: 18,
        sellerCommissionType: "percentage",
        sellerCommissionValue: 0,
        calculationBase: "subtotal",
      },
    },
  });
  assert.equal(fee.customerFeeAmount, 100);
  assert.equal(fee.customerFeeTaxAmount, 18);
  assert.equal(fee.breakup.reduce((sum, item) => sum + item.customerFeeTotal, 0), 100);
  assert.equal(fee.breakup.reduce((sum, item) => sum + item.customerFeeTaxAmount, 0), 18);
});
