"use strict";

require("dotenv").config();

const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { ProductModel } = require("../../src/modules/product/models/product.model");

async function main() {
  await connectMongo();
  const result = await ProductModel.syncIndexes();
  console.log(JSON.stringify({ model: "Product", result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
