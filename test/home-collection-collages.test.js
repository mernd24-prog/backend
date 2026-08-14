const test = require("node:test");
const assert = require("node:assert/strict");

const { HomeService } = require("../src/modules/home/services/home.service");

test("home collage product reads avoid counts and support fallback image fields", async () => {
  const productRepository = {
    listCalls: [],
    async list(filter, pagination, options) {
      this.listCalls.push({ filter, pagination, options });
      return [
        {
          _id: "product-1",
          title: "Common image product",
          category: "electronics",
          commonImages: ["https://example.test/common.jpg"],
          status: "active",
          approvalStatus: "approved",
          visibility: "public",
        },
      ];
    },
  };
  const service = new HomeService({
    productRepository,
    dealRepository: {},
    platformRepository: {},
  });

  const items = await service.listProductItems(
    { key: "trending", source: "products", sort: "popular" },
    4,
    ["electronics"],
  );

  assert.equal(productRepository.listCalls.length, 1);
  assert.equal(productRepository.listCalls[0].filter.status, "active");
  assert.equal(productRepository.listCalls[0].filter.approvalStatus, "approved");
  assert.equal(productRepository.listCalls[0].filter.visibility, "public");
  assert.equal(productRepository.listCalls[0].pagination.sortBy, "popular");
  assert.equal(productRepository.listCalls[0].options.lean, true);
  assert.equal(items.length, 1);
  assert.equal(items[0].image, "https://example.test/common.jpg");
  assert.equal(items[0].link, "/products/product-1");
  assert.equal(items[0].label, "Common image product");
  assert.equal(items[0].productId, "product-1");
  assert.equal(items[0].category, "electronics");
  assert.equal(items[0].source, "product");
});

test("home collage generic fallback does not build a giant active-category filter", async () => {
  const productRepository = {
    async list() {
      return [];
    },
    async findByIds() {
      return [];
    },
  };
  const platformRepository = {
    async getCategoryDescendantKeys() {
      return [];
    },
    async listCategories(filter) {
      assert.notDeepEqual(filter, { active: true });
      return { items: [], total: 0 };
    },
  };
  const dealRepository = {
    dealCalls: [],
    async listActiveDealProducts() {
      this.dealCalls.push(true);
      return [];
    },
  };
  const service = new HomeService({
    productRepository,
    dealRepository,
    platformRepository,
  });

  await service.listCollectionCollages({ limit: 1, itemsPerSection: 4 });

  assert.equal(dealRepository.dealCalls.length, 1);
});

test("dashboard category collage uses prefix filter without resolving descendants", async () => {
  const productRepository = {
    listCalls: [],
    async list(filter) {
      this.listCalls.push(filter);
      return [];
    },
  };
  const platformRepository = {
    async getCategoryDescendantKeys() {
      throw new Error("descendants should not be resolved for strict dashboard categories");
    },
  };
  const service = new HomeService({
    productRepository,
    dealRepository: {},
    platformRepository,
  });

  await service.listProductItems(
    { key: "category-collage-electronics", source: "products", category: "electronics", strictCategory: true },
    4,
  );

  assert.equal(productRepository.listCalls.length, 1);
  assert.match(String(productRepository.listCalls[0].$or[0].category), /electronics/);
});
