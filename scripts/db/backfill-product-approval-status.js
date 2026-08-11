"use strict";

const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { ProductModel } = require("../../src/modules/product/models/product.model");
const { ProductService } = require("../../src/modules/product/services/product.service");

const shouldApply = process.env.APPLY_PRODUCT_APPROVAL_BACKFILL === "true";

async function main() {
  await connectMongo();
  const missing = await ProductModel.countDocuments({
    $or: [{ approvalStatus: { $exists: false } }, { approvalStatus: null }],
  });
  console.log(JSON.stringify({ dryRun: !shouldApply, productsToBackfill: missing }, null, 2));
  if (!shouldApply) {
    console.log("Dry run only. Set APPLY_PRODUCT_APPROVAL_BACKFILL=true to apply.");
    return;
  }

  await ProductModel.updateMany(
    { status: "rejected" },
    { $set: { status: "inactive", approvalStatus: "rejected" } },
  );
  await ProductModel.updateMany(
    { status: "pending_approval" },
    { $set: { status: "active", approvalStatus: "pending" } },
  );
  await ProductModel.updateMany(
    {
      $or: [{ approvalStatus: { $exists: false } }, { approvalStatus: null }],
      approvedAt: { $exists: true, $ne: null },
    },
    { $set: { approvalStatus: "approved" } },
  );
  // Before approvalStatus was split from status, an active product represented
  // an already approved/live product. Preserve that meaning for legacy data.
  await ProductModel.updateMany(
    {
      status: "active",
      $or: [{ approvalStatus: { $exists: false } }, { approvalStatus: null }],
    },
    { $set: { approvalStatus: "approved" } },
  );
  await ProductModel.updateMany(
    { $or: [{ approvalStatus: { $exists: false } }, { approvalStatus: null }] },
    { $set: { approvalStatus: "pending" } },
  );

  const productService = new ProductService();
  const cursor = ProductModel.find({ status: "active", approvalStatus: "approved" }).cursor();
  let reindexed = 0;
  for await (const product of cursor) {
    await productService._indexProduct(product);
    reindexed += 1;
  }
  console.log(JSON.stringify({ backfillComplete: true, reindexed }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
