const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPublicProductFilter,
  buildPublicSearchFilters,
  isPublicProduct,
} = require("../src/shared/catalog/public-product-filter");
const {
  AdvancedSearchService,
} = require("../src/shared/services/advanced-search.service");

test("storefront visibility requires active and approved product states", () => {
  const now = new Date("2026-08-11T12:00:00.000Z");
  const publicProduct = {
    status: "active",
    approvalStatus: "approved",
    visibility: "public",
    publishedAt: new Date("2026-08-10T12:00:00.000Z"),
  };

  assert.equal(isPublicProduct(publicProduct, now), true);
  assert.equal(isPublicProduct({ ...publicProduct, status: "inactive" }, now), false);
  assert.equal(isPublicProduct({ ...publicProduct, status: "draft" }, now), false);
  assert.equal(isPublicProduct({ ...publicProduct, approvalStatus: "pending" }, now), false);
  assert.equal(isPublicProduct({ ...publicProduct, approvalStatus: "rejected" }, now), false);

  const mongoFilter = buildPublicProductFilter(now);
  assert.equal(mongoFilter.status, "active");
  assert.equal(mongoFilter.approvalStatus, "approved");

  const searchFilters = buildPublicSearchFilters(now);
  assert.deepEqual(searchFilters.slice(0, 2), [
    { term: { status: "active" } },
    { term: { approvalStatus: "approved" } },
  ]);
});

test("search documents preserve the approval state used by the public gate", () => {
  const searchDocument = AdvancedSearchService.buildSearchDocument({
    _id: "product-1",
    title: "Pending product",
    status: "active",
    approvalStatus: "pending",
    visibility: "public",
  });
  assert.equal(searchDocument.approvalStatus, "pending");
  assert.equal(isPublicProduct(searchDocument), false);
});
