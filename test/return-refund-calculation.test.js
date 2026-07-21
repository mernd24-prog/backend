const test = require("node:test");
const assert = require("node:assert/strict");

const { ReturnServiceClass } = require("../src/modules/returns/services/return.service");

const service = new ReturnServiceClass();

test("return refund does not add GST already included in the product price", () => {
  const breakup = service.calculateRefundBreakup([
    {
      lineTotal: 19899,
      discountAmount: 0,
      taxAmount: 946.99,
      additionalTaxAmount: 0,
    },
  ], {
    subtotal_amount: 19899,
    discount_amount: 0,
    tax_amount: 946.99,
  });

  assert.equal(breakup.itemSubtotal, 19899);
  assert.equal(breakup.taxReversal, 0);
  assert.equal(breakup.totalRefundAmount, 19899);
});

test("return refund subtracts allocated discount and adds only separately charged tax", () => {
  const breakup = service.calculateRefundBreakup([
    {
      lineTotal: 1000,
      discountAmount: 100,
      taxAmount: 180,
      additionalTaxAmount: 162,
    },
  ], {
    subtotal_amount: 1000,
    discount_amount: 100,
    tax_amount: 162,
  });

  assert.equal(breakup.discountReversal, 100);
  assert.equal(breakup.taxReversal, 162);
  assert.equal(breakup.totalRefundAmount, 1062);
});
