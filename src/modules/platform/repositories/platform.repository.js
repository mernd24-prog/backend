const { CategoryTreeModel } = require("../models/category-tree.model");
const { ProductFamilyModel } = require("../models/product-family.model");
const { ProductVariantModel } = require("../models/product-variant.model");
const { HsnCodeModel } = require("../models/hsn-code.model");
const { GeographyModel } = require("../models/geography.model");
const { PlatformBrandModel } = require("../models/platform-brand.model");
const { WarrantyTemplateModel } = require("../models/warranty-template.model");
const { PlatformFinishModel } = require("../models/platform-finish.model");
const { PlatformDimensionModel } = require("../models/platform-dimension.model");
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

  async listProductReviews(filter = {}, pagination = {}) {
    const [items, total] = await Promise.all([
      ProductReviewModel.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
      ProductReviewModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async updateProductReview(reviewId, payload) {
    return ProductReviewModel.findByIdAndUpdate(reviewId, payload, { new: true });
  }

  async deleteProductReview(reviewId) {
    return ProductReviewModel.findByIdAndDelete(reviewId);
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

  async createWarrantyTemplate(payload) {
    return WarrantyTemplateModel.create(payload);
  }

  async updateWarrantyTemplate(templateId, payload) {
    return WarrantyTemplateModel.findByIdAndUpdate(templateId, payload, { new: true });
  }

  async getWarrantyTemplate(templateId) {
    return WarrantyTemplateModel.findById(templateId);
  }

  async listWarrantyTemplates(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      {
        period: "period",
        active: "active",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      { createdAt: -1 },
    );
    const [items, total] = await Promise.all([
      WarrantyTemplateModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      WarrantyTemplateModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteWarrantyTemplate(templateId) {
    return WarrantyTemplateModel.findByIdAndDelete(templateId);
  }

  async createFinish(payload) {
    return PlatformFinishModel.create(payload);
  }

  async updateFinish(finishId, payload) {
    return PlatformFinishModel.findByIdAndUpdate(finishId, payload, { new: true });
  }

  async getFinish(finishId) {
    return PlatformFinishModel.findById(finishId);
  }

  async listFinishes(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      {
        name: "name",
        active: "active",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      { createdAt: -1 },
    );
    const [items, total] = await Promise.all([
      PlatformFinishModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      PlatformFinishModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteFinish(finishId) {
    return PlatformFinishModel.findByIdAndDelete(finishId);
  }

  async createDimension(payload) {
    return PlatformDimensionModel.create(payload);
  }

  async updateDimension(dimensionId, payload) {
    return PlatformDimensionModel.findByIdAndUpdate(dimensionId, payload, { new: true });
  }

  async getDimension(dimensionId) {
    return PlatformDimensionModel.findById(dimensionId);
  }

  async listDimensions(filter = {}, pagination = {}) {
    const sort = buildSort(
      pagination.sortBy,
      pagination.sortDir,
      {
        dimensions_value: "dimensions_value",
        active: "active",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      { createdAt: -1 },
    );
    const [items, total] = await Promise.all([
      PlatformDimensionModel.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
      PlatformDimensionModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async deleteDimension(dimensionId) {
    return PlatformDimensionModel.findByIdAndDelete(dimensionId);
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
}

module.exports = { PlatformRepository };

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
