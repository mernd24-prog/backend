"use strict";

const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { CartModel } = require("../../src/modules/cart/models/cart.model");
const { ProductModel } = require("../../src/modules/product/models/product.model");

const shouldApply = process.env.APPLY_ANALYTICS_BACKFILL === "true";

function addCount(map, productId, amount = 1) {
  const id = String(productId || "");
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return;
  map.set(id, (map.get(id) || 0) + amount);
}

async function buildCounts() {
  const cartAdds = new Map();
  const wishlistAdds = new Map();
  const cursor = CartModel.find({}, { items: 1, wishlist: 1 }).lean().cursor();

  for await (const cart of cursor) {
    (Array.isArray(cart.items) ? cart.items : []).forEach((item) => {
      addCount(cartAdds, item.productId, Math.max(0, Number(item.quantity || 0)));
    });
    new Set(Array.isArray(cart.wishlist) ? cart.wishlist : []).forEach((productId) => {
      addCount(wishlistAdds, productId, 1);
    });
  }

  return { cartAdds, wishlistAdds };
}

async function main() {
  await connectMongo();
  const { cartAdds, wishlistAdds } = await buildCounts();
  const productIds = Array.from(new Set([...cartAdds.keys(), ...wishlistAdds.keys()]));

  console.log(JSON.stringify({
    dryRun: !shouldApply,
    productsWithCartAdds: cartAdds.size,
    productsWithWishlistAdds: wishlistAdds.size,
    productsToUpdate: productIds.length,
  }, null, 2));

  if (!shouldApply) {
    console.log("Dry run only. Re-run with APPLY_ANALYTICS_BACKFILL=true to update product analytics.");
    return;
  }

  await ProductModel.updateMany({}, {
    $set: {
      "analytics.cartAdds": 0,
      "analytics.wishlistAdds": 0,
    },
  });

  if (productIds.length) {
    await ProductModel.bulkWrite(productIds.map((productId) => ({
      updateOne: {
        filter: { _id: productId },
        update: {
          $set: {
            "analytics.cartAdds": cartAdds.get(productId) || 0,
            "analytics.wishlistAdds": wishlistAdds.get(productId) || 0,
          },
        },
      },
    })));
  }

  console.log("Product cart/wishlist analytics backfill complete.");
}

main()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
