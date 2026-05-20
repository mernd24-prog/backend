const { getPage } = require("../../../shared/tools/page");
const { PlatformRepository } = require("../repositories/platform.repository");
const { AppError } = require("../../../shared/errors/app-error");
const {
  AdminTaxModel,
  AdminSubTaxModel,
  AdminTaxRuleModel,
} = require("../../admin/models/common-management.model");

class PlatformService {
  constructor({ platformRepository = new PlatformRepository() } = {}) {
    this.platformRepository = platformRepository;
  }

  async createCategory(payload) {
    return this.platformRepository.createCategory(payload);
  }

  async updateCategory(categoryKey, payload) {
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) {
      throw new AppError("Category not found", 404);
    }
    return this.platformRepository.updateCategory(categoryKey, payload);
  }

  async getCategory(categoryKey) {
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) {
      throw new AppError("Category not found", 404);
    }
    return category;
  }

  normalizeCategoryAttributes(category = {}) {
    if (Array.isArray(category.attributeSchema) && category.attributeSchema.length) {
      return category.attributeSchema;
    }
    const legacy = category.attributesSchema || {};
    return Object.keys(legacy).map((key) => ({
      key,
      label: key,
      type: Array.isArray(legacy[key]) ? "multi_select" : "text",
      required: false,
      options: Array.isArray(legacy[key]) ? legacy[key] : [],
      isVariantAttribute: false,
      isFilterable: false,
      isSearchable: false,
    }));
  }

  async getCategoryAttributes(categoryKey) {
    const category = await this.getCategory(categoryKey);
    return {
      categoryKey: category.categoryKey,
      title: category.title,
      attributeSchema: this.normalizeCategoryAttributes(category),
    };
  }

  buildCategoryTree(categories = [], maxDepth = 3) {
    const normalizedMaxDepth = Number.isFinite(Number(maxDepth)) ? Number(maxDepth) : 3;
    const byKey = new Map();
    const roots = [];

    categories.forEach((category) => {
      byKey.set(category.categoryKey, { ...category, children: [] });
    });

    byKey.forEach((node) => {
      if (node.parentKey && byKey.has(node.parentKey)) {
        const parent = byKey.get(node.parentKey);
        if ((parent.level ?? 0) < normalizedMaxDepth - 1) {
          parent.children.push(node);
        }
      } else {
        roots.push(node);
      }
    });

    const sortNodes = (nodes = []) => {
      nodes.sort(
        (a, b) =>
          (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
          String(a.title || "").localeCompare(String(b.title || "")),
      );
      nodes.forEach((node) => {
        if (Array.isArray(node.children) && node.children.length) {
          sortNodes(node.children);
        }
      });
    };

    sortNodes(roots);
    return roots;
  }

  async listCategories(query) {
    const isTreeRequested = query.tree === true || query.tree === "true";
    const pagination = isTreeRequested
      ? { page: 1, limit: 1000, skip: 0 }
      : getPage(query);
    const filter = {};
    if (query.parentKey) filter.parentKey = query.parentKey;
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    if (query.categoryKey) filter.categoryKey = query.categoryKey;

    const result = await this.platformRepository.listCategories(filter, pagination);

    if (!isTreeRequested) {
      return result;
    }

    const maxDepth = query.maxDepth || 3;
    const tree = this.buildCategoryTree(result.items || [], maxDepth);
    return { items: tree, total: tree.length };
  }

  async deleteCategory(categoryKey) {
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) {
      throw new AppError("Category not found", 404);
    }
    return this.platformRepository.deleteCategory(categoryKey);
  }

  async createProductFamily(payload) {
    return this.platformRepository.createProductFamily(payload);
  }

  async updateProductFamily(familyCode, payload) {
    const family = await this.platformRepository.getProductFamily(familyCode);
    if (!family) {
      throw new AppError("Product family not found", 404);
    }
    return this.platformRepository.updateProductFamily(familyCode, payload);
  }

  async getProductFamily(familyCode) {
    const family = await this.platformRepository.getProductFamily(familyCode);
    if (!family) {
      throw new AppError("Product family not found", 404);
    }
    return family;
  }

  async listProductFamilies(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.category) filter.category = query.category;
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.status) filter.status = query.status;
    return this.platformRepository.listProductFamilies(filter, pagination);
  }

  async deleteProductFamily(familyCode) {
    const family = await this.platformRepository.getProductFamily(familyCode);
    if (!family) {
      throw new AppError("Product family not found", 404);
    }
    return this.platformRepository.deleteProductFamily(familyCode);
  }

  async createProductVariant(payload) {
    return this.platformRepository.createProductVariant(payload);
  }

  async updateProductVariant(variantId, payload) {
    const variant = await this.platformRepository.getProductVariant(variantId);
    if (!variant) {
      throw new AppError("Product variant not found", 404);
    }
    return this.platformRepository.updateProductVariant(variantId, payload);
  }

  async getProductVariant(variantId) {
    const variant = await this.platformRepository.getProductVariant(variantId);
    if (!variant) {
      throw new AppError("Product variant not found", 404);
    }
    return variant;
  }

  async listProductVariants(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.productId) filter.productId = query.productId;
    if (query.familyCode) filter.familyCode = query.familyCode;
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.sku) filter.sku = { $regex: query.sku, $options: "i" };
    if (query.status) filter.status = query.status;
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$or = [
        { sku: { $regex: q, $options: "i" } },
        { familyCode: { $regex: q, $options: "i" } },
      ];
    }
    return this.platformRepository.listProductVariants(filter, pagination);
  }

  async deleteProductVariant(variantId) {
    const variant = await this.platformRepository.getProductVariant(variantId);
    if (!variant) {
      throw new AppError("Product variant not found", 404);
    }
    return this.platformRepository.deleteProductVariant(variantId);
  }

  async createHsnCode(payload) {
    return this.platformRepository.createHsnCode(payload);
  }

  async updateHsnCode(code, payload) {
    const item = await this.platformRepository.getHsnCode(code);
    if (!item) {
      throw new AppError("HSN code not found", 404);
    }
    return this.platformRepository.updateHsnCode(code, payload);
  }

  async getHsnCode(code) {
    const item = await this.platformRepository.getHsnCode(code);
    if (!item) {
      throw new AppError("HSN code not found", 404);
    }
    return item;
  }

  async listHsnCodes(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    if (query.category) filter.category = query.category;
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$or = [
        { code: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } },
      ];
    }
    return this.platformRepository.listHsnCodes(filter, pagination);
  }

  async deleteHsnCode(code) {
    const item = await this.platformRepository.getHsnCode(code);
    if (!item) {
      throw new AppError("HSN code not found", 404);
    }
    return this.platformRepository.deleteHsnCode(code);
  }

  async createGeography(payload) {
    return this.platformRepository.createGeography(payload);
  }

  async updateGeography(countryCode, payload) {
    const item = await this.platformRepository.getGeography(countryCode);
    if (!item) {
      throw new AppError("Geography record not found", 404);
    }
    return this.platformRepository.updateGeography(countryCode, payload);
  }

  async getGeography(countryCode) {
    const item = await this.platformRepository.getGeography(countryCode);
    if (!item) {
      throw new AppError("Geography record not found", 404);
    }
    return item;
  }

  async listGeographies(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    return this.platformRepository.listGeographies(filter, pagination);
  }

  async deleteGeography(countryCode) {
    const item = await this.platformRepository.getGeography(countryCode);
    if (!item) {
      throw new AppError("Geography record not found", 404);
    }
    return this.platformRepository.deleteGeography(countryCode);
  }

  async createContentPage(payload) {
    const nextPayload = this.normalizeContentPagePayload(payload);
    if (nextPayload.published && !nextPayload.publishedAt) {
      nextPayload.publishedAt = new Date();
    }
    return this.platformRepository.createContentPage(nextPayload);
  }

  async updateContentPage(slug, payload) {
    const item = await this.platformRepository.getContentPage(slug);
    if (!item) {
      throw new AppError("Content page not found", 404);
    }
    const nextPayload = this.normalizeContentPagePayload(payload, item);
    if (nextPayload.published && !nextPayload.publishedAt) {
      nextPayload.publishedAt = new Date();
    }
    return this.platformRepository.updateContentPage(slug, nextPayload);
  }

  async getContentPage(slug) {
    const item = await this.platformRepository.getContentPage(slug);
    if (!item) {
      throw new AppError("Content page not found", 404);
    }
    return item;
  }

  async listContentPages(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.pageType) filter.pageType = query.pageType;
    if (query.status) filter.status = query.status;
    if (query.language) filter.language = query.language;
    if (query.published !== undefined) filter.published = query.published === true || query.published === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { slug: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { body: { $regex: q, $options: "i" } },
      ];
    }
    return this.platformRepository.listContentPages(filter, pagination);
  }

  normalizeContentPagePayload(payload = {}, existing = {}) {
    const nextPayload = { ...payload };
    const imageUrl = nextPayload.image?.url || nextPayload.heroImage || nextPayload.coverImage || "";
    const imageAlt = nextPayload.image?.alt || nextPayload.title || existing.title || "";

    if (nextPayload.image || imageUrl) {
      nextPayload.image = {
        url: imageUrl,
        alt: imageAlt,
        title: nextPayload.image?.title || "",
        caption: nextPayload.image?.caption || "",
        type: nextPayload.image?.type || "hero",
      };
    }

    if (Array.isArray(nextPayload.galleryImages) && !Array.isArray(nextPayload.gallery)) {
      nextPayload.gallery = nextPayload.galleryImages.map((url) => ({ url, alt: nextPayload.title || "" }));
    }

    if (Array.isArray(nextPayload.gallery)) {
      nextPayload.galleryImages = nextPayload.gallery.map((item) => item?.url || "").filter(Boolean);
    }

    if (nextPayload.image?.url) {
      nextPayload.heroImage = nextPayload.heroImage || nextPayload.image.url;
      nextPayload.coverImage = nextPayload.coverImage || nextPayload.image.url;
      nextPayload.thumbnailUrl = nextPayload.thumbnailUrl || nextPayload.image.url;
    }

    if (!nextPayload.excerpt && nextPayload.description) {
      nextPayload.excerpt = nextPayload.description;
    }

    if (!nextPayload.body && (nextPayload.description || Array.isArray(nextPayload.sections))) {
      nextPayload.body = this.makeContentPageBody(nextPayload);
    }

    if (nextPayload.status) {
      nextPayload.published = nextPayload.status === "published";
    } else if (nextPayload.published !== undefined) {
      nextPayload.status = nextPayload.published ? "published" : "draft";
    }

    return nextPayload;
  }

  makeContentPageBody(page = {}) {
    const lines = [`# ${page.title || ""}`];
    if (page.description) lines.push("", page.description);
    for (const section of page.sections || []) {
      if (section.title) lines.push("", `## ${section.title}`);
      if (section.description) lines.push(section.description);
      for (const point of section.points || []) {
        if (point.title || point.description) {
          lines.push(`- ${[point.title, point.description].filter(Boolean).join(": ")}`);
        }
      }
    }
    return lines.join("\n").trim();
  }

  async deleteContentPage(slug) {
    const item = await this.platformRepository.getContentPage(slug);
    if (!item) {
      throw new AppError("Content page not found", 404);
    }
    return this.platformRepository.deleteContentPage(slug);
  }

  async listProductReviews(query = {}) {
    const pagination = getPage(query);
    const filter = {};
    if (query.productId) filter.productId = query.productId;
    if (query.buyerId) filter.buyerId = query.buyerId;
    if (query.orderId) filter.orderId = query.orderId;
    if (query.status) filter.status = query.status;
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { reviewText: { $regex: q, $options: "i" } },
        { productId: { $regex: q, $options: "i" } },
        { buyerId: { $regex: q, $options: "i" } },
      ];
    }
    return this.platformRepository.listProductReviews(filter, pagination);
  }

  async updateProductReview(reviewId, payload) {
    const item = await this.platformRepository.getProductReview(reviewId);
    if (!item) {
      throw new AppError("Product review not found", 404);
    }
    return this.platformRepository.updateProductReview(reviewId, payload);
  }

  async deleteProductReview(reviewId) {
    const item = await this.platformRepository.getProductReview(reviewId);
    if (!item) {
      throw new AppError("Product review not found", 404);
    }
    return this.platformRepository.deleteProductReview(reviewId);
  }

  async createBrand(payload) {
    return this.platformRepository.createBrand(payload);
  }

  async updateBrand(brandId, payload) {
    const item = await this.platformRepository.getBrand(brandId);
    if (!item) {
      throw new AppError("Brand not found", 404);
    }
    return this.platformRepository.updateBrand(brandId, payload);
  }

  async getBrand(brandId) {
    const item = await this.platformRepository.getBrand(brandId);
    if (!item) {
      throw new AppError("Brand not found", 404);
    }
    return item;
  }

  async listBrands(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.name = { $regex: q, $options: "i" };
    }
    return this.platformRepository.listBrands(filter, pagination);
  }

  async deleteBrand(brandId) {
    const item = await this.platformRepository.getBrand(brandId);
    if (!item) {
      throw new AppError("Brand not found", 404);
    }
    return this.platformRepository.deleteBrand(brandId);
  }

  async createWarrantyTemplate(payload) {
    return this.platformRepository.createWarrantyTemplate(payload);
  }

  async updateWarrantyTemplate(templateId, payload) {
    const item = await this.platformRepository.getWarrantyTemplate(templateId);
    if (!item) {
      throw new AppError("Warranty template not found", 404);
    }
    return this.platformRepository.updateWarrantyTemplate(templateId, payload);
  }

  async getWarrantyTemplate(templateId) {
    const item = await this.platformRepository.getWarrantyTemplate(templateId);
    if (!item) {
      throw new AppError("Warranty template not found", 404);
    }
    return item;
  }

  async listWarrantyTemplates(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.period = { $regex: q, $options: "i" };
    }
    return this.platformRepository.listWarrantyTemplates(filter, pagination);
  }

  async deleteWarrantyTemplate(templateId) {
    const item = await this.platformRepository.getWarrantyTemplate(templateId);
    if (!item) {
      throw new AppError("Warranty template not found", 404);
    }
    return this.platformRepository.deleteWarrantyTemplate(templateId);
  }

  async createFinish(payload) {
    return this.platformRepository.createFinish(payload);
  }

  async updateFinish(finishId, payload) {
    const item = await this.platformRepository.getFinish(finishId);
    if (!item) throw new AppError("Finish not found", 404);
    return this.platformRepository.updateFinish(finishId, payload);
  }

  async listFinishes(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) filter.name = { $regex: q, $options: "i" };
    return this.platformRepository.listFinishes(filter, pagination);
  }

  async deleteFinish(finishId) {
    const item = await this.platformRepository.getFinish(finishId);
    if (!item) throw new AppError("Finish not found", 404);
    return this.platformRepository.deleteFinish(finishId);
  }

  async createDimension(payload) {
    return this.platformRepository.createDimension(payload);
  }

  async updateDimension(dimensionId, payload) {
    const item = await this.platformRepository.getDimension(dimensionId);
    if (!item) throw new AppError("Dimension not found", 404);
    return this.platformRepository.updateDimension(dimensionId, payload);
  }

  async listDimensions(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) filter.dimensions_value = { $regex: q, $options: "i" };
    return this.platformRepository.listDimensions(filter, pagination);
  }

  async deleteDimension(dimensionId) {
    const item = await this.platformRepository.getDimension(dimensionId);
    if (!item) throw new AppError("Dimension not found", 404);
    return this.platformRepository.deleteDimension(dimensionId);
  }

  async createBatch(payload) {
    return this.platformRepository.createBatch(payload);
  }

  async updateBatch(batchId, payload) {
    const item = await this.platformRepository.getBatch(batchId);
    if (!item) throw new AppError("Batch not found", 404);
    return this.platformRepository.updateBatch(batchId, payload);
  }

  async listBatches(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) filter.batchCode = { $regex: q, $options: "i" };
    return this.platformRepository.listBatches(filter, pagination);
  }

  async deleteBatch(batchId) {
    const item = await this.platformRepository.getBatch(batchId);
    if (!item) throw new AppError("Batch not found", 404);
    return this.platformRepository.deleteBatch(batchId);
  }

  async createProductOption(payload) {
    return this.platformRepository.createProductOption(payload);
  }

  async updateProductOption(optionId, payload) {
    const item = await this.platformRepository.getProductOption(optionId);
    if (!item) throw new AppError("Product option not found", 404);
    return this.platformRepository.updateProductOption(optionId, payload);
  }

  async listProductOptions(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) filter.name = { $regex: q, $options: "i" };
    return this.platformRepository.listProductOptions(filter, pagination);
  }

  async deleteProductOption(optionId) {
    const item = await this.platformRepository.getProductOption(optionId);
    if (!item) throw new AppError("Product option not found", 404);
    return this.platformRepository.deleteProductOption(optionId);
  }

  async createProductOptionValue(payload) {
    const normalized = await this.normalizeProductOptionValuePayload(payload);
    return this.platformRepository.createProductOptionValue(normalized);
  }

  async updateProductOptionValue(optionValueId, payload) {
    const item = await this.platformRepository.getProductOptionValue(optionValueId);
    if (!item) throw new AppError("Product option value not found", 404);
    const normalized = await this.normalizeProductOptionValuePayload(payload, { partial: true });
    return this.platformRepository.updateProductOptionValue(optionValueId, normalized);
  }

  async listProductOptionValues(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.option_id || query.optionId) filter.optionId = query.option_id || query.optionId;
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) filter.name = { $regex: q, $options: "i" };
    const result = await this.platformRepository.listProductOptionValues(filter, pagination);
    return {
      ...result,
      items: await this.decorateProductOptionValues(result.items),
    };
  }

  async deleteProductOptionValue(optionValueId) {
    const item = await this.platformRepository.getProductOptionValue(optionValueId);
    if (!item) throw new AppError("Product option value not found", 404);
    return this.platformRepository.deleteProductOptionValue(optionValueId);
  }

  async normalizeProductOptionValuePayload(payload = {}, { partial = false } = {}) {
    const optionId = payload.optionId || payload.option_id;
    if (!partial && !optionId) {
      throw new AppError("optionId is required", 400);
    }

    const normalized = { ...payload };
    delete normalized.option_id;

    if (optionId) {
      const option = await this.platformRepository.getProductOption(optionId);
      if (!option) {
        throw new AppError("Product option not found", 404);
      }
      normalized.optionId = String(option._id);
      normalized.option_id = String(option._id);
      normalized.optionName = option.name;
    }

    if (normalized.valueCode === undefined && normalized.name) {
      normalized.valueCode = String(normalized.name)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
    }

    return normalized;
  }

  async decorateProductOptionValues(items = []) {
    if (!Array.isArray(items) || !items.length) return items;
    const optionIds = Array.from(new Set(items.map((item) => String(item.optionId || "")).filter(Boolean)));
    if (!optionIds.length) return items;

    const options = await Promise.all(optionIds.map((id) => this.platformRepository.getProductOption(id)));
    const optionMap = new Map(options.filter(Boolean).map((opt) => [String(opt._id), opt]));

    return items.map((item) => {
      const value = item.toObject ? item.toObject() : { ...item };
      const option = optionMap.get(String(value.optionId || ""));
      return {
        ...value,
        optionId: value.optionId || value.option_id || "",
        optionName: value.optionName || option?.name || "",
      };
    });
  }

  async getCatalogPrefillData(query = {}) {
    const categories = (await this.platformRepository.listCategories({}, { skip: 0, limit: 500 })).items || [];
    const families = (await this.platformRepository.listProductFamilies({}, { skip: 0, limit: 500 })).items || [];
    const variants = (await this.platformRepository.listProductVariants({}, { skip: 0, limit: 500 })).items || [];
    const hsnCodes = (await this.platformRepository.listHsnCodes({ active: true }, { skip: 0, limit: 1000 })).items || [];
    const options = await this.platformRepository.listAllProductOptions(query.includeInactive ? {} : { active: true });
    const optionValuesRaw = await this.platformRepository.listAllProductOptionValues(query.includeInactive ? {} : { active: true });
    const optionValues = await this.decorateProductOptionValues(optionValuesRaw);
    const [taxes, subTaxes, taxRules] = await Promise.all([
      AdminTaxModel.find(query.includeInactive ? {} : { active: true }).sort({ name: 1 }),
      AdminSubTaxModel.find(query.includeInactive ? {} : { active: true }).sort({ name: 1 }),
      AdminTaxRuleModel.find(query.includeInactive ? {} : { active: true }).sort({ createdAt: -1 }),
    ]);

    return {
      categories,
      categoryAttributes: categories.map((category) => ({
        categoryKey: category.categoryKey,
        title: category.title,
        attributeSchema: this.normalizeCategoryAttributes(category),
      })),
      families,
      variants,
      hsnCodes,
      taxes,
      subTaxes,
      taxRules,
      options,
      optionValues,
    };
  }
}

module.exports = { PlatformService };
