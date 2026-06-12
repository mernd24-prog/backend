const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const { CartModel } = require("../models/cart.model");
const { ProductModel } = require("../../product/models/product.model");

class CartRepository {
  async _populateItemsProduct(cartDoc) {
    if (!cartDoc || !Array.isArray(cartDoc.items) || cartDoc.items.length === 0) {
      return cartDoc;
    }

    const objectIdProductIds = [
      ...new Set(
        cartDoc.items
          .map((item) => item.productId)
          .filter((id) => typeof id === "string" && mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id)),
      ),
    ];

    if (objectIdProductIds.length === 0) {
      return cartDoc;
    }

    const products = await ProductModel.find({ _id: { $in: objectIdProductIds } }).lean();
    const productById = new Map(products.map((product) => [String(product._id), product]));

    const cart = cartDoc.toObject ? cartDoc.toObject() : { ...cartDoc };
    cart.items = cart.items.map((item) => ({
      ...item,
      productId: productById.get(String(item.productId)) || item.productId,
    }));

    return cart;
  }

  async getByUserId(userId) {
    const cart = await CartModel.findOne({ userId }).exec();
    return this._populateItemsProduct(cart);
  }

  async getById(cartId) {
    const cart = await CartModel.findById(cartId).exec();
    return this._populateItemsProduct(cart);
  }

  async upsertCart(userId, payload) {
    const cart = await CartModel.findOneAndUpdate({ userId }, payload, { upsert: true, new: true }).exec();
    return this._populateItemsProduct(cart);
  }

  async listCarts(filter = {}, { page = 1, limit = 20 } = {}) {
    const query = {};
    const search = String(filter.search || filter.q || filter.keyWord || "").trim();
    if (search) {
      query.$or = [
        { userId: { $regex: search, $options: "i" } },
        { "items.productId": { $regex: search, $options: "i" } },
        { "items.title": { $regex: search, $options: "i" } },
        { "items.sku": { $regex: search, $options: "i" } },
      ];
    }
    if (filter.userId) query.userId = String(filter.userId);
    if (filter.productId) query["items.productId"] = String(filter.productId);
    if (filter.sellerId) query["items.sellerId"] = String(filter.sellerId);
    if (filter.hasItems === true || filter.hasItems === "true") query["items.0"] = { $exists: true };
    if (filter.hasItems === false || filter.hasItems === "false") query.items = { $size: 0 };
    if (filter.updatedFrom || filter.updatedTo) {
      query.updatedAt = {};
      if (filter.updatedFrom) query.updatedAt.$gte = new Date(filter.updatedFrom);
      if (filter.updatedTo) query.updatedAt.$lte = new Date(filter.updatedTo);
    }

    const sortMap = {
      updatedAt: "updatedAt",
      createdAt: "createdAt",
      userId: "userId",
    };
    const sortField = sortMap[filter.sortBy] || "updatedAt";
    const sortDir = filter.sortDir === "asc" || filter.sortOrder === "asc" ? 1 : -1;
    const skip = (Math.max(Number(page || 1), 1) - 1) * Number(limit || 20);

    const [items, total] = await Promise.all([
      CartModel.find(query).sort({ [sortField]: sortDir }).skip(skip).limit(Number(limit || 20)).lean(),
      CartModel.countDocuments(query),
    ]);

    return { items, total, page: Number(page || 1), limit: Number(limit || 20) };
  }

  async clearCart(cartId, metadata = {}) {
    return CartModel.findByIdAndUpdate(
      cartId,
      {
        $set: {
          items: [],
          wishlist: [],
          metadata: {
            ...(metadata || {}),
            clearedAt: new Date(),
          },
        },
      },
      { new: true },
    ).exec();
  }
}

module.exports = { CartRepository };
