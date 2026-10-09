"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const helpers = require("../src/modules/deal/services/deal-variant");
const { AppError } = require("../src/shared/errors/app-error");
const constants = require("../src/modules/deal/models/deal.model");
const product = { sellerId: "seller", title: "Lamp", variants: [
  { _id: "pink", sku: "PINK", title: "Pink", salePrice: 300, mrp: 600, stock: 8, reservedStock: 2, images: ["pink.png"] },
  { _id: "blue", sku: "BLUE", title: "Blue", salePrice: 700, mrp: 900, stock: 5, images: ["blue.png"] },
] };
async function main() {
  assert.equal(helpers.resolveDealVariant(product, {}), null);
  assert.equal(helpers.resolveDealVariant(product, { variantId: "pink", variantSku: "BLUE" }), null);
  const projected = helpers.projectDealVariant(product, { variantId: "pink" });
  assert.equal(projected.title, "Lamp – Pink");
  assert.equal(projected.salePrice, 300);
  assert.equal(projected.availableStock, 6);
  assert.deepEqual(projected.images, ["pink.png"]);
  assert.equal(product.variants[1].salePrice, 700);
  assert.equal(helpers.projectDealVariant(product, { variantId: "deleted" }), null);
  const source = fs.readFileSync(require.resolve("../src/modules/deal/services/deal.service"), "utf8");
  const method = source.slice(source.indexOf("  async normalizeDealPayload("), source.indexOf("  async listDeals("));
  const Service = vm.runInNewContext(`(class Service { ${method} })`, { ...helpers, ...constants, AppError });
  const service = new Service();
  service.productRepository = { findById: async () => product };
  service.isAdmin = actor => actor.role === "admin";
  service.sellerIdFor = actor => actor.sellerId;
  const payload = { sellerId: "seller", productId: "product", variantId: "pink", allocatedQuantity: 6 };
  const normalized = await service.normalizeDealPayload(payload, { role: "admin" });
  assert.equal(normalized.sellingPrice, 300);
  assert.equal(normalized.catalogPrice, 600);
  assert.equal(normalized.variantSku, "PINK");
  await assert.rejects(service.normalizeDealPayload({ ...payload, sellerId: "other" }, { role: "admin" }), /does not belong/);
  await assert.rejects(service.normalizeDealPayload({ ...payload, variantId: "missing" }, { role: "admin" }), /valid product variant/);
  await assert.rejects(service.normalizeDealPayload({ ...payload, allocatedQuantity: 7 }, { role: "admin" }), /exceeds/);
  await assert.rejects(service.normalizeDealPayload(payload, { role: "seller", sellerId: "other" }), /another seller/);
  const { createDealSchema } = require("../src/modules/deal/validation/deal.validation");
  const request = { ...payload, title: "Pink promotion", startAt: "2026-10-09T00:00:00Z", endAt: "2026-10-10T00:00:00Z" };
  assert.equal(createDealSchema.body.validate(request).error, undefined);
  for (const key of ["dealPrice", "originalPrice", "discountPercent", "discountAmount"]) {
    assert.ok(createDealSchema.body.validate({ ...request, [key]: 1 }).error, `${key} must not be accepted`);
  }
  console.log("Deal variant regression checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
