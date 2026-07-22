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

  service.getDeliveryChargeBySeller = () => 0;
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

test("coupon funding snapshot resolves marketplace, seller, and shared responsibility", async () => {
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
