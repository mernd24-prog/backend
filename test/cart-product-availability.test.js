const test = require("node:test");
const assert = require("node:assert/strict");

const { CartService } = require("../src/modules/cart/services/cart.service");
const { ProductModel } = require("../src/modules/product/models/product.model");

const PRODUCT_ID = "507f1f77bcf86cd799439011";

function projectedProductQuery(product) {
  let selectedFields = [];
  return {
    select(fields) {
      selectedFields = String(fields).split(/\s+/).filter(Boolean);
      return this;
    },
    async lean() {
      return [{
        _id: product._id,
        ...Object.fromEntries(
          selectedFields
            .filter((field) => Object.prototype.hasOwnProperty.call(product, field))
            .map((field) => [field, product[field]]),
        ),
      }];
    },
  };
}

test("approved public products remain available when cart items are normalized", async (t) => {
  const originalFind = ProductModel.find;
  t.after(() => { ProductModel.find = originalFind; });

  ProductModel.find = () => projectedProductQuery({
    _id: PRODUCT_ID,
    sellerId: "seller-1",
    title: "Available product",
    status: "active",
    approvalStatus: "approved",
    visibility: "public",
    price: 100,
    stock: 10,
    variants: [],
  });

  const service = new CartService({
    cartRepository: {},
    dealService: { findActiveDealForItem: async () => null },
  });
  const items = await service.mergeItems([{ productId: PRODUCT_ID, quantity: 1 }]);

  assert.equal(items.length, 1);
  assert.equal(items[0].productId, PRODUCT_ID);
  assert.equal(items[0].stockStatus, "in_stock");
});

test("approved public products are retained when wishlist items are normalized", async (t) => {
  const originalFind = ProductModel.find;
  t.after(() => { ProductModel.find = originalFind; });

  ProductModel.find = () => projectedProductQuery({
    _id: PRODUCT_ID,
    status: "active",
    approvalStatus: "approved",
    visibility: "public",
  });

  const service = new CartService({ cartRepository: {} });
  const wishlist = await service.normalizeWishlist([PRODUCT_ID]);

  assert.deepEqual(wishlist, [PRODUCT_ID]);
});
