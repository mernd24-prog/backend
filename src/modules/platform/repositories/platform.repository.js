const { CategoryTreeModel } = require("../models/category-tree.model");
const { CollectionModel } = require("../models/collection.model");
const { ProductFamilyModel } = require("../models/product-family.model");
const { ProductVariantModel } = require("../models/product-variant.model");
const { HsnCodeModel } = require("../models/hsn-code.model");
const { GeographyModel } = require("../models/geography.model");
const { PlatformBrandModel } = require("../models/platform-brand.model");
const { PlatformBatchModel } = require("../models/platform-batch.model");
const { PlatformProductOptionModel } = require("../models/platform-product-option.model");
const { PlatformProductOptionValueModel } = require("../models/platform-product-option-value.model");
const { ProductReviewModel } = require("../models/product-review.model");
const { ProductModel } = require("../../product/models/product.model");
const { applyPublicProductFilter } = require("../../../shared/catalog/public-product-filter");
const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

function makeCodeOrIdFilter(value, codeField = "code") {
  if (mongoose.Types.ObjectId.isValid(String(value))) {
    return { $or: [{ _id: value }, { [codeField]: value }] };
  }
  return { [codeField]: value };
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    const [result] = await CategoryTreeModel.aggregate([
      {
        $match: mongoose.Types.ObjectId.isValid(String(categoryKey))
          ? { $or: [{ _id: new mongoose.Types.ObjectId(String(categoryKey)) }, { categoryKey }] }
          : { categoryKey },
      },
      { $limit: 1 },
      {
        $graphLookup: {
          from: "categorytrees",
          startWith: "$categoryKey",
          connectFromField: "categoryKey",
          connectToField: "parentKey",
          as: "descendants",
          restrictSearchWithMatch: { active: true },
        },
      },
      {
        $project: {
          keys: {
            $setUnion: [
              ["$categoryKey"],
              {
                $map: {
                  input: "$descendants",
                  as: "descendant",
                  in: "$$descendant.categoryKey",
                },
              },
              [{ $toString: "$_id" }],
              {
                $map: {
                  input: "$descendants",
                  as: "descendant",
                  in: { $toString: "$$descendant._id" },
                },
              },
            ],
          },
        },
      },
    ]);

    return (result?.keys || []).filter(Boolean);
  }

  async getProductCountsByCategories(categories = []) {
    const requestedItems = categories
      .map((category) =>
        typeof category?.toObject === "function" ? category.toObject() : category,
      )
      .filter((category) => category?.categoryKey);
    if (!requestedItems.length) return new Map();

    // Navigation queries often contain only level-0 rows. Load the complete
    // public tree so products assigned to a leaf can increment every ancestor.
    const publicTree = await CategoryTreeModel.find({
      active: true,
      approvalStatus: "approved",
    }).lean();
    const itemByKey = new Map(
      [...publicTree, ...requestedItems].map((category) => [
        String(category.categoryKey),
        category,
      ]),
    );
    const items = [...itemByKey.values()];

    const byKey = new Map();
    const keyByReference = new Map();
    const counts = new Map();
    for (const category of items) {
      const key = String(category.categoryKey).trim();
      byKey.set(key, category);
      counts.set(key.toLowerCase(), 0);
      [key, category._id]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
        .forEach((reference) => keyByReference.set(reference, key));
    }

    const references = [
      ...new Set([
        ...keyByReference.keys(),
        ...items.flatMap((category) => [
          String(category.categoryKey || "").trim(),
          String(category._id || "").trim(),
        ]),
      ]),
    ].filter(Boolean);
    const products = await ProductModel.find({
      ...applyPublicProductFilter({}),
      $or: [
        { category: { $in: references } },
        { categoryId: { $in: references } },
      ],
    })
      .select("category categoryId")
      .lean();

    for (const product of products) {
      const directKey = [product.categoryId, product.category]
        .map((value) => String(value || "").trim().toLowerCase())
        .map((reference) => keyByReference.get(reference))
        .find(Boolean);
      if (!directKey) continue;

      let key = directKey;
      const visited = new Set();
      while (key && byKey.has(key) && !visited.has(key)) {
        visited.add(key);
        const normalizedKey = key.toLowerCase();
        counts.set(normalizedKey, (counts.get(normalizedKey) || 0) + 1);
        key = String(byKey.get(key)?.parentKey || "").trim();
      }
    }

    return counts;
  }

  async listCategories(filter = {}, pagination = {}, options = {}) {
    const sort = { sortOrder: 1, title: 1 };
    const allItems = await CategoryTreeModel.find(filter).sort(sort).lean();

    const withCounts = options.includeProductCounts || options.hasProducts
      ? allItems.map((item) => ({
          ...item,
          productCount: 0,
        }))
      : allItems;

    if (options.includeProductCounts || options.hasProducts) {
      const counts = await this.getProductCountsByCategories(withCounts);

      for (const item of withCounts) {
        const key = String(item.categoryKey || item.key || "").trim();
        item.productCount = Number(counts.get(key.toLowerCase()) || 0);
      }
    }

    const filteredItems = options.hasProducts
      ? withCounts.filter((item) => Number(item.productCount || 0) > 0)
      : withCounts;

    const total = filteredItems.length;
    const items = filteredItems.slice(
      Number(pagination.skip || 0),
      Number(pagination.skip || 0) + Number(pagination.limit || filteredItems.length),
    );

    if (options.includeTotal === false) {
      return { items, total: items.length };
    }

    return { items, total };
  }

  async listCategoriesFast(filter = {}, pagination = {}, projection = null, options = {}) {
    let query = CategoryTreeModel.find(filter)
      .sort({ level: 1, sortOrder: 1, title: 1 })
      .lean();
    if (projection) query = query.select(projection);
    const allItems = await query;

    let items = allItems;
    if (options.includeProductCounts || options.hasProducts) {
      const counts = await this.getProductCountsByCategories(allItems);
      items = allItems.map((item) => {
        const categoryKey = String(item.categoryKey || item.key || "").trim();
        return {
          ...item,
          productCount: Number(counts.get(categoryKey.toLowerCase()) || 0),
        };
      });
    }

    if (options.hasProducts) {
      items = items.filter((item) => Number(item.productCount || 0) > 0);
    }

    const total = items.length;
    const pageItems = items.slice(
      Number(pagination.skip || 0),
      Number(pagination.skip || 0) + Number(pagination.limit || items.length),
    );

    return { items: pageItems, total };
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

  async getProductReviewByBuyerAndOrder(productId, buyerId, orderId, orderItemId = null) {
    return ProductReviewModel.findOne({
      productId,
      buyerId,
      orderId,
      ...(orderItemId ? { orderItemId } : {}),
    });
  }

  async getProductReviewByProductAndBuyer(productId, buyerIds = []) {
    const ids = Array.isArray(buyerIds) ? buyerIds.filter(Boolean) : [buyerIds].filter(Boolean);
    if (!ids.length) return null;
    const idVariants = [];
    const productValue = String(productId || "");
    if (productValue) {
      idVariants.push(productValue);
      if (mongoose.Types.ObjectId.isValid(productValue)) {
        idVariants.push(new mongoose.Types.ObjectId(productValue));
      }
    }
    return ProductReviewModel.findOne({ productId: { $in: idVariants }, buyerId: { $in: ids } }).sort({ createdAt: -1 });
  }

  async createProductReview(payload) {
    return ProductReviewModel.create(payload);
  }

  async listProductReviews(filter = {}, pagination = {}) {
    const sort = {};
    if (pagination.sortBy === "rating") sort.rating = pagination.sortDir === "asc" ? 1 : -1;
    else if (pagination.sortBy === "helpfulVotes") sort.helpfulVotes = pagination.sortDir === "asc" ? 1 : -1;
    else sort.createdAt = pagination.sortDir === "asc" ? 1 : -1;

    const normalizedFilter = { ...filter };
    if (normalizedFilter.productId !== undefined) {
      const productIdValues = [];
      const value = normalizedFilter.productId;
      if (value !== null && value !== undefined) {
        if (Array.isArray(value)) productIdValues.push(...value);
        else productIdValues.push(value);
      }
      const stringValues = productIdValues
        .map((entry) => String(entry || ""))
        .filter(Boolean);
      const objectIdValues = stringValues.filter((entry) => mongoose.Types.ObjectId.isValid(entry)).map((entry) => new mongoose.Types.ObjectId(entry));
      normalizedFilter.productId = { $in: Array.from(new Set([...stringValues, ...objectIdValues.map((entry) => entry.toString()), ...objectIdValues])) };
    }

    const [items, total] = await Promise.all([
      ProductReviewModel.find(normalizedFilter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      ProductReviewModel.countDocuments(normalizedFilter),
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
    const productIds = [String(productId || "")].filter(Boolean);
    const result = await ProductReviewModel.aggregate([
      { $match: { productId: { $in: productIds }, status: "published" } },
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

  async getProductReviewModerationStats(productId) {
    const productIds = [String(productId || "")].filter(Boolean);
    const [result] = await ProductReviewModel.aggregate([
      { $match: { productId: { $in: productIds } } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$rating" },
          count: { $sum: 1 },
          ratings: { $push: "$rating" },
          publishedCount: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } },
          pendingCount: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          hiddenCount: { $sum: { $cond: [{ $eq: ["$status", "hidden"] }, 1, 0] } },
          rejectedCount: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
        },
      },
    ]);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    (result?.ratings || []).forEach((rating) => {
      if (distribution[rating] !== undefined) distribution[rating] += 1;
    });
    return {
      avgRating: Number(Number(result?.avgRating || 0).toFixed(1)),
      count: Number(result?.count || 0),
      distribution,
      publishedCount: Number(result?.publishedCount || 0),
      pendingCount: Number(result?.pendingCount || 0),
      hiddenCount: Number(result?.hiddenCount || 0),
      rejectedCount: Number(result?.rejectedCount || 0),
    };
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

  async resolveBrandReferences(values = []) {
    const normalizedValues = Array.from(
      new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
    );
    if (!normalizedValues.length) return new Map();

    const objectIds = normalizedValues
      .filter((value) => mongoose.Types.ObjectId.isValid(value))
      .map((value) => new mongoose.Types.ObjectId(value));
    const lowerValues = normalizedValues.map((value) => value.toLowerCase());
    const brands = await PlatformBrandModel.find({
      $or: [
        ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
        { nameKey: { $in: lowerValues } },
        { slug: { $in: lowerValues } },
        { name: { $in: normalizedValues } },
      ],
    })
      .collation({ locale: "en", strength: 2 })
      .lean();

    const references = new Map();
    for (const brand of brands) {
      const reference = {
        id: String(brand._id),
        name: brand.name || "",
        slug: brand.slug || "",
        active: brand.active !== false,
        approvalStatus: brand.approvalStatus || null,
      };
      [brand._id, brand.name, brand.nameKey, brand.slug]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
        .forEach((key) => references.set(key, reference));
    }
    return references;
  }

  async resolveCategoryReferences(values = []) {
    const normalizedValues = Array.from(
      new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
    );
    if (!normalizedValues.length) return new Map();

    const objectIds = normalizedValues
      .filter((value) => mongoose.Types.ObjectId.isValid(value))
      .map((value) => new mongoose.Types.ObjectId(value));
    const categories = await CategoryTreeModel.find({
      $or: [
        ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
        { categoryKey: { $in: normalizedValues } },
      ],
    }).lean();

    const references = new Map();
    for (const category of categories) {
      const reference = {
        id: String(category._id),
        key: category.categoryKey || "",
        name: category.title || "",
        active: category.active !== false,
        approvalStatus: category.approvalStatus || null,
      };
      [category._id, category.categoryKey]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
        .forEach((key) => references.set(key, reference));
    }
    return references;
  }

  async findBrandByName(name, excludeBrandId = null) {
    const normalized = String(name || "").trim();
    if (!normalized) return null;
    const filter = { name: new RegExp(`^${escapeRegExp(normalized)}$`, "i") };
    if (excludeBrandId && mongoose.Types.ObjectId.isValid(String(excludeBrandId))) {
      filter._id = { $ne: excludeBrandId };
    }
    return PlatformBrandModel.findOne(filter);
  }

  async listBrands(filter = {}, pagination = {}, options = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      {
        name: "name",
        active: "active",
        approvalStatus: "approvalStatus",
        sortOrder: "sortOrder",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      { sortOrder: 1, name: 1 },
    );

    const platformItems = await PlatformBrandModel.find(filter).sort(sort).lean();
    const productBrandCounts = await this.getProductCountsByBrands(platformItems);
    const productBrandNameLookup = new Map();
    const brandNameSeeds = await PlatformBrandModel.find({}).select("_id name nameKey slug").lean();

    for (const brand of brandNameSeeds) {
      const name = String(brand?.name || "").trim();
      const keys = [brand?._id, brand?.name, brand?.nameKey, brand?.slug]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      for (const key of keys) {
        productBrandNameLookup.set(String(key).toLowerCase(), name || key);
      }
    }

    const normalizeDisplayBrandName = (value = "") => {
      const candidate = String(value || "").trim();
      if (!candidate) return "";
      if (/^[a-f\d]{24}$/i.test(candidate)) return "";
      return candidate;
    };

    const stableBrandId = (rawId, fallbackValue = "") => {
      const raw = String(rawId || "").trim();
      if (!raw) return String(fallbackValue || "").trim();
      if (/^[a-f\d]{24}$/i.test(raw)) {
        const fallback = String(fallbackValue || "").trim();
        return fallback || raw.toLowerCase();
      }
      return raw;
    };

    const mergeBrand = (brand, fallbackName = "") => {
      const brandName = normalizeDisplayBrandName(brand?.name || brand?.nameKey || fallbackName || "");
      if (!brandName) return null;

      const slug = String(brand?.slug || brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "").trim();
      const normalizedName = brandName.toLowerCase();
      const base = {
        _id: stableBrandId(brand?._id, slug || normalizedName),
        name: brandName,
        slug,
        logo: brand?.logo || "",
        logoUrl: brand?.logoUrl || "",
        imageUrl: brand?.imageUrl || "",
        active: brand?.active !== false,
        approvalStatus: brand?.approvalStatus || "approved",
        sortOrder: Number(brand?.sortOrder || 0),
        productCount: Number(brand?.productCount || productBrandCounts.get(normalizedName) || 0),
      };

      for (const key of [brand?._id, brand?.slug, brandName, normalizedName]) {
        if (key) {
          productBrandCounts.set(String(key).toLowerCase(), base.productCount);
        }
      }

      return base;
    };

    const mergedItems = platformItems.map((item) => mergeBrand(item, item?.name)).filter(Boolean);

    const brandCounts = await ProductModel.aggregate([
      {
        $match: {
          ...applyPublicProductFilter({}),
          brand: { $type: "string", $ne: "" },
        },
      },
      {
        $group: {
          _id: { $toLower: "$brand" },
          name: { $first: "$brand" },
          count: { $sum: 1 },
        },
      },
    ]);

    for (const item of brandCounts) {
      const rawBrandKey = String(item?._id || item?.name || "").trim();
      const resolvedBrandName =
        productBrandNameLookup.get(String(rawBrandKey).toLowerCase()) ||
        String(item.name || "").trim();
      const brandName = normalizeDisplayBrandName(resolvedBrandName);
      if (!brandName) continue;

      const normalizedName = brandName.toLowerCase();
      const existing = mergedItems.find((entry) => String(entry.name || "").trim().toLowerCase() === normalizedName);
      if (existing) {
        existing.productCount = Number(existing.productCount || 0) + Number(item.count || 0);
        continue;
      }

      mergedItems.push({
        _id: stableBrandId(null, brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || normalizedName),
        name: brandName,
        slug: brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
        logo: "",
        logoUrl: "",
        imageUrl: "",
        active: true,
        approvalStatus: "approved",
        sortOrder: 9999,
        productCount: Number(item.count || 0),
      });
    }

    const filteredItems = options.hasProducts
      ? mergedItems.filter((item) => Number(item.productCount || 0) > 0)
      : mergedItems;

    const total = filteredItems.length;
    const pagedItems = filteredItems.slice(
      Number(pagination.skip || 0),
      Number(pagination.skip || 0) + Number(pagination.limit || filteredItems.length),
    );

    return {
      items: pagedItems.map((item) => {
        const plainItem = typeof item.toObject === "function" ? item.toObject() : item;
        return {
          ...plainItem,
          productCount: Number(plainItem.productCount || 0),
        };
      }),
      total,
    };
  }

  async getProductCountsByBrands(brands = []) {
    const brandKeys = new Map();
    for (const brand of brands) {
      const plainBrand = typeof brand.toObject === "function" ? brand.toObject() : brand;
      const keys = [plainBrand?._id, plainBrand?.name, plainBrand?.slug]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      for (const key of keys) {
        const normalizedKey = key.toLowerCase();
        if (!brandKeys.has(normalizedKey)) brandKeys.set(normalizedKey, new Set());
        brandKeys.get(normalizedKey).add(String(plainBrand._id));
      }
    }

    const lookupKeys = [...brandKeys.keys()];
    if (!lookupKeys.length) return new Map();

    const counts = await ProductModel.aggregate([
      {
        $match: {
          ...applyPublicProductFilter({}),
          brand: { $type: "string", $ne: "" },
          $expr: { $in: [{ $toLower: "$brand" }, lookupKeys] },
        },
      },
      {
        $group: {
          _id: { $toLower: "$brand" },
          count: { $sum: 1 },
        },
      },
    ]);

    const result = new Map();
    for (const { _id, count } of counts) {
      for (const brandId of brandKeys.get(_id) || []) {
        result.set(brandId, (result.get(brandId) || 0) + count);
      }
    }
    return result;
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

  async updateProductOptionValues(filter, payload) {
    return PlatformProductOptionValueModel.updateMany(filter, payload);
  }

  async createCollection(payload) {
    return CollectionModel.create(payload);
  }

  async getCollection(collectionId) {
    const value = String(collectionId || "");
    return CollectionModel.findOne(mongoose.Types.ObjectId.isValid(value)
      ? { $or: [{ _id: value }, { slug: value }] }
      : { slug: value });
  }

  async updateCollection(collectionId, payload) {
    const item = await this.getCollection(collectionId);
    if (!item) return null;
    return CollectionModel.findByIdAndUpdate(item._id, payload, { new: true, runValidators: true });
  }

  async listCollections(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      { name: "name", type: "type", sortOrder: "sortOrder", featured: "featured", active: "active", createdAt: "createdAt" },
      { featured: -1, sortOrder: 1, createdAt: -1 },
    );
    const query = CollectionModel.find(filter).sort(sort);
    if (pagination.limit) query.skip(pagination.skip || 0).limit(pagination.limit);
    const [items, total] = await Promise.all([query.lean(), CollectionModel.countDocuments(filter)]);
    return { items, total };
  }

  async deleteCollection(collectionId) {
    const item = await this.getCollection(collectionId);
    return item ? CollectionModel.findByIdAndDelete(item._id) : null;
  }

}

module.exports = { PlatformRepository };

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
