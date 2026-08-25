"use strict";

require("dotenv").config();

const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { ProductModel } = require("../../src/modules/product/models/product.model");
const { CategoryTreeModel } = require("../../src/modules/platform/models/category-tree.model");

async function main() {
  await connectMongo();
  const [productResult, categoryResult] = await Promise.all([
    ProductModel.syncIndexes(),
    CategoryTreeModel.syncIndexes(),
  ]);
  console.log(JSON.stringify([
    { model: "Product", result: productResult },
    { model: "CategoryTree", result: categoryResult },
  ], null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
