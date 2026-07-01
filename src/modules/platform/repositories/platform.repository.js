const { CategoryTreeModel } = require("../models/category-tree.model");
const { BadgeModel } = require("../models/badge.model");
const { ProductFamilyModel } = require("../models/product-family.model");
const { ProductVariantModel } = require("../models/product-variant.model");
const { HsnCodeModel } = require("../models/hsn-code.model");
const { GeographyModel } = require("../models/geography.model");
const { PlatformBrandModel } = require("../models/platform-brand.model");
const { PlatformBatchModel } = require("../models/platform-batch.model");
const { PlatformProductOptionModel } = require("../models/platform-product-option.model");
const { PlatformProductOptionValueModel } = require("../models/platform-product-option-value.model");
const { ProductReviewModel } = require("../models/product-review.model");
const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

function makeCodeOrIdFilter(value, codeField = "code") {
  if (mongoose.Types.ObjectId.isValid(String(value))) {
    return { $or: [{ _id: value }, { [codeField]: value }] };
  }
  return { [codeField]: value };
}

function buildSort(sortBy, sortDir, allowed = {}, fallback = { createdAt: -1 }) {
  const field = allowed[sortBy];
  if (!field) return fallback;
  return { [field]: sortDir === "asc" ? 1 : -1 };
}

class PlatformRepository {
  async createCategory(payload) {
    return CategoryTreeModel.create(payload);
  }

  async updateCategory(categoryKey, payload) {
    if (mongoose.Types.ObjectId.isValid(String(categoryKey))) {
      return CategoryTreeModel.findOneAndUpdate(
        { $or: [{ _id: categoryKey }, { categoryKey }] },
        payload,
        { new: true },
      );
    }
    return CategoryTreeModel.findOneAndUpdate({ categoryKey }, payload, { new: true });
  }

  async getCategory(categoryKey) {
    if (mongoose.Types.ObjectId.isValid(String(categoryKey))) {
      return CategoryTreeModel.findOne({
        $or: [{ _id: categoryKey }, { categoryKey }],
      });
    }
    return CategoryTreeModel.findOne({ categoryKey });
  }

  async getCategoryDescendantKeys(categoryKey) {
    const category = await this.getCategory(categoryKey);
    if (!category) return [];

    const keys = [category.categoryKey];
    for (let index = 0; index < keys.length; index += 1) {
      const children = await CategoryTreeModel.find({
        parentKey: keys[index],
        active: true,
      }).select("categoryKey");
      children.forEach((child) => {
        if (child.categoryKey && !keys.includes(child.categoryKey)) {
          keys.push(child.categoryKey);
        }
      });
    }
    return keys;
  }

  async listCategories(filter = {}, pagination = {}) {
    const [items, total] = await Promise.all([
      CategoryTreeModel.find(filter).sort({ sortOrder: 1, title: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
      CategoryTreeModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteCategory(categoryKey) {
    const category = await this.getCategory(categoryKey);
    if (!category) return null;

    const keysToDelete = [category.categoryKey];
    for (let index = 0; index < keysToDelete.length; index += 1) {
      const children = await CategoryTreeModel.find({ parentKey: keysToDelete[index] }).select("categoryKey");
      children.forEach((child) => {
        if (!keysToDelete.includes(child.categoryKey)) keysToDelete.push(child.categoryKey);
      });
    }

    await CategoryTreeModel.deleteMany({ categoryKey: { $in: keysToDelete } });
    return { ...category.toObject(), deletedCount: keysToDelete.length };
  }

  async createProductFamily(payload) {
    return ProductFamilyModel.create(payload);
  }

  async updateProductFamily(familyCode, payload) {
    return ProductFamilyModel.findOneAndUpdate({ familyCode }, payload, { new: true });
  }

  async getProductFamily(familyCode) {
    return ProductFamilyModel.findOne({ familyCode });
  }

  async listProductFamilies(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      {
        familyCode: "familyCode",
        title: "title",
        category: "category",
        sellerId: "sellerId",
        status: "status",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      { createdAt: -1 },
    );
    const [items, total] = await Promise.all([
      ProductFamilyModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      ProductFamilyModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteProductFamily(familyCode) {
    return ProductFamilyModel.findOneAndDelete({ familyCode });
  }

  async createProductVariant(payload) {
    return ProductVariantModel.create(payload);
  }

  async updateProductVariant(variantId, payload) {
    return ProductVariantModel.findByIdAndUpdate(variantId, payload, { new: true });
  }

  async getProductVariant(variantId) {
    return ProductVariantModel.findById(variantId);
  }

  async listProductVariants(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      {
        sku: "sku",
        familyCode: "familyCode",
        productId: "productId",
        sellerId: "sellerId",
        stock: "stock",
        reservedStock: "reservedStock",
        status: "status",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      { createdAt: -1 },
    );
    const [items, total] = await Promise.all([
      ProductVariantModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      ProductVariantModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteProductVariant(variantId) {
    return ProductVariantModel.findByIdAndDelete(variantId);
  }

  async createHsnCode(payload) {
    return HsnCodeModel.create(payload);
  }

  async updateHsnCode(code, payload) {
    return HsnCodeModel.findOneAndUpdate(makeCodeOrIdFilter(code), payload, { new: true });
  }

  async getHsnCode(code) {
    return HsnCodeModel.findOne(makeCodeOrIdFilter(code));
  }

  async listHsnCodes(filter = {}, pagination = {}) {
    const [items, total] = await Promise.all([
      HsnCodeModel.find(filter).sort({ code: 1 }).skip(pagination.skip).limit(pagination.limit),
      HsnCodeModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteHsnCode(code) {
    return HsnCodeModel.findOneAndDelete(makeCodeOrIdFilter(code));
  }

  async createGeography(payload) {
    return GeographyModel.create(payload);
  }

  async updateGeography(countryCode, payload) {
    return GeographyModel.findOneAndUpdate({ countryCode }, payload, { new: true });
  }

  async getGeography(countryCode) {
    return GeographyModel.findOne({ countryCode });
  }

  async listGeographies(filter = {}, pagination = {}) {
    const [items, total] = await Promise.all([
      GeographyModel.find(filter).sort({ countryName: 1 }).skip(pagination.skip).limit(pagination.limit),
      GeographyModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteGeography(countryCode) {
    return GeographyModel.findOneAndDelete({ countryCode });
  }

  async getProductReview(reviewId) {
    return ProductReviewModel.findById(reviewId);
  }

  async getProductReviewByBuyerAndOrder(productId, buyerId, orderId) {
    return ProductReviewModel.findOne({ productId, buyerId, orderId });
  }

  async createProductReview(payload) {
    return ProductReviewModel.create(payload);
  }

  async listProductReviews(filter = {}, pagination = {}) {
    const sort = {};
    if (pagination.sortBy === "rating") sort.rating = pagination.sortDir === "asc" ? 1 : -1;
    else if (pagination.sortBy === "helpfulVotes") sort.helpfulVotes = pagination.sortDir === "asc" ? 1 : -1;
    else sort.createdAt = pagination.sortDir === "asc" ? 1 : -1;

    const [items, total] = await Promise.all([
      ProductReviewModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      ProductReviewModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async bulkUpdateProductReviews(reviewIds = [], payload = {}) {
    if (!reviewIds.length) return { matchedCount: 0, modifiedCount: 0 };
    return ProductReviewModel.updateMany(
      { _id: { $in: reviewIds } },
      { $set: payload },
    );
  }

  async updateProductReview(reviewId, payload) {
    const update = { ...payload };
    if (payload.adminReply?.text !== undefined) {
      update["adminReply.text"] = payload.adminReply.text;
      update["adminReply.repliedAt"] = new Date();
      delete update.adminReply;
    }
    return ProductReviewModel.findByIdAndUpdate(reviewId, update, { new: true });
  }

  async deleteProductReview(reviewId) {
    return ProductReviewModel.findByIdAndDelete(reviewId);
  }

  async addHelpfulVote(reviewId, userId) {
    return ProductReviewModel.findByIdAndUpdate(
      reviewId,
      { $addToSet: { helpfulVotedBy: userId }, $inc: { helpfulVotes: 1 } },
      { new: true },
    );
  }

  async removeHelpfulVote(reviewId, userId) {
    return ProductReviewModel.findByIdAndUpdate(
      reviewId,
      { $pull: { helpfulVotedBy: userId }, $inc: { helpfulVotes: -1 } },
      { new: true },
    );
  }

  async getProductRatingStats(productId) {
    const result = await ProductReviewModel.aggregate([
      { $match: { productId, status: "published" } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$rating" },
          count: { $sum: 1 },
          dist: {
            $push: "$rating",
          },
        },
      },
    ]);
    if (!result.length) return { avgRating: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    const { avgRating, count, dist } = result[0];
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    dist.forEach((r) => { if (distribution[r] !== undefined) distribution[r]++; });
    return { avgRating: Math.round(avgRating * 10) / 10, count, distribution };
  }

  async createBrand(payload) {
    return PlatformBrandModel.create(payload);
  }

  async updateBrand(brandId, payload) {
    return PlatformBrandModel.findByIdAndUpdate(brandId, payload, { new: true });
  }

  async getBrand(brandId) {
    return PlatformBrandModel.findById(brandId);
  }

  async getBrandByValue(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return null;
    if (mongoose.Types.ObjectId.isValid(normalized)) {
      return PlatformBrandModel.findOne({
        $or: [
          { _id: normalized },
          { name: new RegExp(`^${escapeRegExp(normalized)}$`, "i") },
          { slug: normalized.toLowerCase() },
        ],
      });
    }
    return PlatformBrandModel.findOne({
      $or: [
        { name: new RegExp(`^${escapeRegExp(normalized)}$`, "i") },
        { slug: normalized.toLowerCase() },
      ],
    });
  }

  async listBrands(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      {
        name: "name",
        active: "active",
        sortOrder: "sortOrder",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      { sortOrder: 1, name: 1 },
    );
    const [items, total] = await Promise.all([
      PlatformBrandModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      PlatformBrandModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteBrand(brandId) {
    return PlatformBrandModel.findByIdAndDelete(brandId);
  }

  async createBatch(payload) {
    return PlatformBatchModel.create(payload);
  }

  async updateBatch(batchId, payload) {
    return PlatformBatchModel.findByIdAndUpdate(batchId, payload, { new: true });
  }

  async getBatch(batchId) {
    return PlatformBatchModel.findById(batchId);
  }

  async listBatches(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      {
        batchCode: "batchCode",
        manufactureDate: "manufactureDate",
        expiryDate: "expiryDate",
        active: "active",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      { createdAt: -1 },
    );
    const [items, total] = await Promise.all([
      PlatformBatchModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      PlatformBatchModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteBatch(batchId) {
    return PlatformBatchModel.findByIdAndDelete(batchId);
  }

  async createProductOption(payload) {
    return PlatformProductOptionModel.create(payload);
  }

  async updateProductOption(optionId, payload) {
    return PlatformProductOptionModel.findByIdAndUpdate(optionId, payload, { new: true });
  }

  async getProductOption(optionId) {
    return PlatformProductOptionModel.findById(optionId);
  }

  async listProductOptions(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      {
        name: "name",
        slug: "slug",
        displayType: "displayType",
        active: "active",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      { name: 1, createdAt: -1 },
    );
    const [items, total] = await Promise.all([
      PlatformProductOptionModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      PlatformProductOptionModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteProductOption(optionId) {
    return PlatformProductOptionModel.findByIdAndDelete(optionId);
  }

  async createProductOptionValue(payload) {
    return PlatformProductOptionValueModel.create(payload);
  }

  async updateProductOptionValue(optionValueId, payload) {
    return PlatformProductOptionValueModel.findByIdAndUpdate(optionValueId, payload, { new: true });
  }

  async getProductOptionValue(optionValueId) {
    return PlatformProductOptionValueModel.findById(optionValueId);
  }

  async listProductOptionValues(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      {
        name: "name",
        valueCode: "valueCode",
        sortOrder: "sortOrder",
        active: "active",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      { sortOrder: 1, name: 1 },
    );
    const [items, total] = await Promise.all([
      PlatformProductOptionValueModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      PlatformProductOptionValueModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteProductOptionValue(optionValueId) {
    return PlatformProductOptionValueModel.findByIdAndDelete(optionValueId);
  }

  async listAllProductOptions(filter = {}) {
    return PlatformProductOptionModel.find(filter).sort({ name: 1 });
  }

  async listAllProductOptionValues(filter = {}) {
    return PlatformProductOptionValueModel.find(filter).sort({ optionId: 1, sortOrder: 1, name: 1 });
  }

  // ── Badges ─────────────────────────────────────────────────────────────────

  async createBadge(payload) {
    return BadgeModel.create(payload);
  }

  async updateBadge(badgeId, payload) {
    return BadgeModel.findByIdAndUpdate(badgeId, payload, { new: true });
  }

  async getBadge(badgeId) {
    if (mongoose.Types.ObjectId.isValid(String(badgeId))) {
      return BadgeModel.findOne({ $or: [{ _id: badgeId }, { name: badgeId }] });
    }
    return BadgeModel.findOne({ name: badgeId });
  }

  async listBadges(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      { name: "name", label: "label", priority: "priority", active: "active", createdAt: "createdAt" },
      { priority: -1, createdAt: -1 },
    );
    const [items, total] = await Promise.all([
      BadgeModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      BadgeModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteBadge(badgeId) {
    return BadgeModel.findByIdAndDelete(badgeId);
  }

  async listActiveBadges() {
    const now = new Date();
    return BadgeModel.find({
      active: true,
      $or: [
        { validFrom: null, validTo: null },
        { validFrom: { $lte: now }, validTo: null },
        { validFrom: null, validTo: { $gte: now } },
        { validFrom: { $lte: now }, validTo: { $gte: now } },
      ],
    }).sort({ priority: -1 });
  }
}

module.exports = { PlatformRepository };

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
