const { getPage } = require("../../../shared/tools/page");
const { buildMongoFilter } = require("../../../shared/tools/query-builder");
const { PlatformRepository } = require("../repositories/platform.repository");
const { AppError } = require("../../../shared/errors/app-error");
const { auditService } = require("../../../shared/logger/audit.service");
const { forget } = require("../../../shared/tools/cache");
const {
  AdminTaxModel,
  AdminSubTaxModel,
  AdminTaxRuleModel,
} = require("../../admin/models/common-management.model");
const {
  buildWarrantyTemplateSeedDocuments,
} = require("../constants/default-warranty-templates");

class PlatformService {
  constructor({ platformRepository = new PlatformRepository() } = {}) {
    this.platformRepository = platformRepository;
  }

  invalidateCatalogCaches() {
    if (typeof forget === "function") {
      forget(/^products:/);
    }
  }

  async ensureDefaultWarrantyTemplates() {
    const existing = await this.platformRepository.listWarrantyTemplates({}, { skip: 0, limit: 1 });
    if ((existing.total || 0) > 0) return false;

    const templates = buildWarrantyTemplateSeedDocuments();
    for (const template of templates) {
      try {
        await this.platformRepository.createWarrantyTemplate(template);
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }
    this.invalidateCatalogCaches();
    return true;
  }

  async createCategory(payload, req) {
    const category = await this.platformRepository.createCategory(payload);
    this.invalidateCatalogCaches();
    auditService.create(req, { module: "categories", entityId: category?._id || category?.categoryKey, entityType: "Category", newData: payload });
    return category;
  }

  async updateCategory(categoryKey, payload, req) {
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) throw AppError.notFound("Category");
    const updated = await this.platformRepository.updateCategory(categoryKey, payload);
    this.invalidateCatalogCaches();
    auditService.update(req, { module: "categories", entityId: categoryKey, entityType: "Category", oldData: category, newData: payload });
    return updated;
  }

  async getCategory(categoryKey) {
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) throw AppError.notFound("Category");
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
      ? { page: 1, limit: 5000, skip: 0 }
      : getPage(query);
    const filter = buildMongoFilter({
      search:      query.q || query.keyWord || query.search,
      searchFields:["title", "categoryKey"],
      exactFilters:{
        parentKey:   query.parentKey,
        categoryKey: query.categoryKey,
      },
    });
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";

    const result = await this.platformRepository.listCategories(filter, pagination);

    if (!isTreeRequested) {
      return result;
    }

    const maxDepth = query.maxDepth || 3;
    const tree = this.buildCategoryTree(result.items || [], maxDepth);
    return { items: tree, total: tree.length };
  }

  async deleteCategory(categoryKey, req) {
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) throw AppError.notFound("Category");
    const result = await this.platformRepository.deleteCategory(categoryKey);
    this.invalidateCatalogCaches();
    auditService.remove(req, { module: "categories", entityId: categoryKey, entityType: "Category", oldData: category });
    return result;
  }

  async createProductFamily(payload) {
    const item = await this.platformRepository.createProductFamily(payload);
    this.invalidateCatalogCaches();
    return item;
  }

  async updateProductFamily(familyCode, payload) {
    const family = await this.platformRepository.getProductFamily(familyCode);
    if (!family) {
      throw AppError.notFound("Product family");
    }
    const item = await this.platformRepository.updateProductFamily(familyCode, payload);
    this.invalidateCatalogCaches();
    return item;
  }

  async getProductFamily(familyCode) {
    const family = await this.platformRepository.getProductFamily(familyCode);
    if (!family) {
      throw AppError.notFound("Product family");
    }
    return family;
  }

  async listProductFamilies(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.category) filter.category = query.category;
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.status) filter.status = query.status;
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { familyCode: { $regex: q, $options: "i" } },
      ];
    }
    return this.platformRepository.listProductFamilies(filter, pagination);
  }

  async deleteProductFamily(familyCode) {
    const family = await this.platformRepository.getProductFamily(familyCode);
    if (!family) {
      throw AppError.notFound("Product family");
    }
    const item = await this.platformRepository.deleteProductFamily(familyCode);
    this.invalidateCatalogCaches();
    return item;
  }

  async createProductVariant(payload) {
    return this.platformRepository.createProductVariant(payload);
  }

  async updateProductVariant(variantId, payload) {
    const variant = await this.platformRepository.getProductVariant(variantId);
    if (!variant) {
      throw AppError.notFound("Product variant");
    }
    return this.platformRepository.updateProductVariant(variantId, payload);
  }

  async getProductVariant(variantId) {
    const variant = await this.platformRepository.getProductVariant(variantId);
    if (!variant) {
      throw AppError.notFound("Product variant");
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
      throw AppError.notFound("Product variant");
    }
    return this.platformRepository.deleteProductVariant(variantId);
  }

  async createHsnCode(payload) {
    const item = await this.platformRepository.createHsnCode(payload);
    this.invalidateCatalogCaches();
    return item;
  }

  async updateHsnCode(code, payload) {
    const item = await this.platformRepository.getHsnCode(code);
    if (!item) {
      throw AppError.notFound("HSN code");
    }
    const updated = await this.platformRepository.updateHsnCode(code, payload);
    this.invalidateCatalogCaches();
    return updated;
  }

  async getHsnCode(code) {
    const item = await this.platformRepository.getHsnCode(code);
    if (!item) {
      throw AppError.notFound("HSN code");
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
      throw AppError.notFound("HSN code");
    }
    const result = await this.platformRepository.deleteHsnCode(code);
    this.invalidateCatalogCaches();
    return result;
  }

  async createGeography(payload) {
    return this.platformRepository.createGeography(payload);
  }

  async updateGeography(countryCode, payload) {
    const item = await this.platformRepository.getGeography(countryCode);
    if (!item) {
      throw AppError.notFound("Geography record");
    }
    return this.platformRepository.updateGeography(countryCode, payload);
  }

  async getGeography(countryCode) {
    const item = await this.platformRepository.getGeography(countryCode);
    if (!item) {
      throw AppError.notFound("Geography record");
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
      throw AppError.notFound("Geography record");
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
      throw AppError.notFound("Content page");
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
      throw AppError.notFound("Content page");
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
      throw AppError.notFound("Content page");
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
      throw AppError.notFound("Product review");
    }
    return this.platformRepository.updateProductReview(reviewId, payload);
  }

  async deleteProductReview(reviewId) {
    const item = await this.platformRepository.getProductReview(reviewId);
    if (!item) {
      throw AppError.notFound("Product review");
    }
    return this.platformRepository.deleteProductReview(reviewId);
  }

  async createBrand(payload, req) {
    const item = await this.platformRepository.createBrand(payload);
    this.invalidateCatalogCaches();
    auditService.create(req, { module: "brands", entityId: item?._id, entityType: "Brand", newData: payload });
    return item;
  }

  async updateBrand(brandId, payload, req) {
    const item = await this.platformRepository.getBrand(brandId);
    if (!item) throw AppError.notFound("Brand");
    const updated = await this.platformRepository.updateBrand(brandId, payload);
    this.invalidateCatalogCaches();
    auditService.update(req, { module: "brands", entityId: brandId, entityType: "Brand", oldData: item, newData: payload });
    return updated;
  }

  async getBrand(brandId) {
    const item = await this.platformRepository.getBrand(brandId);
    if (!item) throw AppError.notFound("Brand");
    return item;
  }

  async listBrands(query) {
    const pagination = getPage(query);
    const filter = buildMongoFilter({
      search:      query.q || query.keyWord || query.search,
      searchFields:["name"],
    });
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    return this.platformRepository.listBrands(filter, pagination);
  }

  async deleteBrand(brandId, req) {
    const item = await this.platformRepository.getBrand(brandId);
    if (!item) throw AppError.notFound("Brand");
    const result = await this.platformRepository.deleteBrand(brandId);
    this.invalidateCatalogCaches();
    auditService.remove(req, { module: "brands", entityId: brandId, entityType: "Brand", oldData: item });
    return result;
  }

  async createWarrantyTemplate(payload) {
    const item = await this.platformRepository.createWarrantyTemplate(payload);
    this.invalidateCatalogCaches();
    return item;
  }

  async updateWarrantyTemplate(templateId, payload) {
    const item = await this.platformRepository.getWarrantyTemplate(templateId);
    if (!item) {
      throw AppError.notFound("Warranty template");
    }
    const result = await this.platformRepository.updateWarrantyTemplate(templateId, payload);
    this.invalidateCatalogCaches();
    return result;
  }

  async getWarrantyTemplate(templateId) {
    const item = await this.platformRepository.getWarrantyTemplate(templateId);
    if (!item) {
      throw AppError.notFound("Warranty template");
    }
    return item;
  }

  async listWarrantyTemplates(query) {
    await this.ensureDefaultWarrantyTemplates();
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
      throw AppError.notFound("Warranty template");
    }
    const result = await this.platformRepository.deleteWarrantyTemplate(templateId);
    this.invalidateCatalogCaches();
    return result;
  }

  async createFinish(payload) {
    return this.platformRepository.createFinish(payload);
  }

  async updateFinish(finishId, payload) {
    const item = await this.platformRepository.getFinish(finishId);
    if (!item) throw AppError.notFound("Finish");
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
    if (!item) throw AppError.notFound("Finish");
    return this.platformRepository.deleteFinish(finishId);
  }

  async createDimension(payload) {
    return this.platformRepository.createDimension(payload);
  }

  async updateDimension(dimensionId, payload) {
    const item = await this.platformRepository.getDimension(dimensionId);
    if (!item) throw AppError.notFound("Dimension");
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
    if (!item) throw AppError.notFound("Dimension");
    return this.platformRepository.deleteDimension(dimensionId);
  }

  async createBatch(payload) {
    return this.platformRepository.createBatch(payload);
  }

  async updateBatch(batchId, payload) {
    const item = await this.platformRepository.getBatch(batchId);
    if (!item) throw AppError.notFound("Batch");
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
    if (!item) throw AppError.notFound("Batch");
    return this.platformRepository.deleteBatch(batchId);
  }

  async createProductOption(payload, req) {
    const item = await this.platformRepository.createProductOption(payload);
    this.invalidateCatalogCaches();
    auditService.create(req, { module: "option_masters", entityId: item?._id, entityType: "ProductOption", newData: payload });
    return item;
  }

  async updateProductOption(optionId, payload, req) {
    const item = await this.platformRepository.getProductOption(optionId);
    if (!item) throw AppError.notFound("Product option");
    const updated = await this.platformRepository.updateProductOption(optionId, payload);
    this.invalidateCatalogCaches();
    auditService.update(req, { module: "option_masters", entityId: optionId, entityType: "ProductOption", oldData: item, newData: payload });
    return updated;
  }

  async listProductOptions(query) {
    const pagination = getPage(query);
    const filter = buildMongoFilter({
      search:      query.q || query.keyWord || query.search,
      searchFields:["name"],
    });
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    return this.platformRepository.listProductOptions(filter, pagination);
  }

  async deleteProductOption(optionId, req) {
    const item = await this.platformRepository.getProductOption(optionId);
    if (!item) throw AppError.notFound("Product option");
    const result = await this.platformRepository.deleteProductOption(optionId);
    this.invalidateCatalogCaches();
    auditService.remove(req, { module: "option_masters", entityId: optionId, entityType: "ProductOption", oldData: item });
    return result;
  }

  async createProductOptionValue(payload) {
    const normalized = await this.normalizeProductOptionValuePayload(payload);
    const item = await this.platformRepository.createProductOptionValue(normalized);
    this.invalidateCatalogCaches();
    return item;
  }

  async updateProductOptionValue(optionValueId, payload) {
    const item = await this.platformRepository.getProductOptionValue(optionValueId);
    if (!item) throw AppError.notFound("Product option value");
    const normalized = await this.normalizeProductOptionValuePayload(payload, { partial: true });
    const result = await this.platformRepository.updateProductOptionValue(optionValueId, normalized);
    this.invalidateCatalogCaches();
    return result;
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
    if (!item) throw AppError.notFound("Product option value");
    const result = await this.platformRepository.deleteProductOptionValue(optionValueId);
    this.invalidateCatalogCaches();
    return result;
  }

  async normalizeProductOptionValuePayload(payload = {}, { partial = false } = {}) {
    const optionId = payload.optionId || payload.option_id;
    if (!partial && !optionId) {
      throw AppError.validation("optionId is required");
    }

    const normalized = { ...payload };
    delete normalized.option_id;

    if (optionId) {
      const option = await this.platformRepository.getProductOption(optionId);
      if (!option) {
        throw AppError.notFound("Product option");
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
    await this.ensureDefaultWarrantyTemplates();
    const categories = (await this.platformRepository.listCategories({}, { skip: 0, limit: 5000 })).items || [];
    const brands = (await this.platformRepository.listBrands(query.includeInactive ? {} : { active: true }, { skip: 0, limit: 500 })).items || [];
    const families = (await this.platformRepository.listProductFamilies({}, { skip: 0, limit: 500 })).items || [];
    const variants = (await this.platformRepository.listProductVariants({}, { skip: 0, limit: 500 })).items || [];
    const hsnCodes = (await this.platformRepository.listHsnCodes({ active: true }, { skip: 0, limit: 1000 })).items || [];
    const warrantyTemplates = (await this.platformRepository.listWarrantyTemplates(query.includeInactive ? {} : { active: true }, { skip: 0, limit: 500 })).items || [];
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
      brands,
      families,
      variants,
      hsnCodes,
      warrantyTemplates,
      taxes,
      subTaxes,
      taxRules,
      options,
      optionValues,
    };
  }
}

module.exports = { PlatformService };
