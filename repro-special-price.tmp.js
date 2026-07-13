require('dotenv').config();
const { mongoose, connectMongo } = require('./src/infrastructure/mongo/mongo-client');
const { ProductService } = require('./src/modules/product/services/product.service');

(async () => {
  await connectMongo();
  const svc = new ProductService();
  const ProductModel = svc.productRepository.constructor === undefined ? null : require('./src/modules/product/models/product.model').ProductModel;

  const product = await ProductModel.findOne({ title: /408 Sneakers For Men/i });
  if (!product) {
    console.log('Product not found');
    process.exit(1);
  }
  console.log('Product:', product._id.toString(), 'variants:', product.variants.length);
  console.log('BEFORE:', product.variants.map(v => ({ id: v._id.toString(), sku: v.sku, price: v.price, mrp: v.mrp, salePrice: v.salePrice })));

  const targetVariant = product.variants[0];
  const untouchedBefore = product.variants.slice(1).map(v => ({ id: v._id.toString(), sku: v.sku, price: v.price, mrp: v.mrp, salePrice: v.salePrice }));

  const newSalePrice = Math.max(1, Math.floor((targetVariant.price || 100) * 0.9));

  const result = await svc.bulkUpdateSpecialPrices([
    {
      productId: product._id.toString(),
      variants: [
        { variantId: targetVariant._id.toString(), variantSku: targetVariant.sku, salePrice: newSalePrice },
      ],
    },
  ], {});

  console.log('Update result:', result);

  const after = await ProductModel.findById(product._id);
  console.log('AFTER:', after.variants.map(v => ({ id: v._id.toString(), sku: v.sku, price: v.price, mrp: v.mrp, salePrice: v.salePrice })));

  const untouchedAfter = after.variants.filter(v => v._id.toString() !== targetVariant._id.toString())
    .map(v => ({ id: v._id.toString(), sku: v.sku, price: v.price, mrp: v.mrp, salePrice: v.salePrice }));

  console.log('Untouched siblings BEFORE:', JSON.stringify(untouchedBefore));
  console.log('Untouched siblings AFTER: ', JSON.stringify(untouchedAfter));

  const targetAfter = after.variants.find(v => v._id.toString() === targetVariant._id.toString());
  console.log('Target variant salePrice expected:', newSalePrice, 'actual:', targetAfter.salePrice);

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('ERROR:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
