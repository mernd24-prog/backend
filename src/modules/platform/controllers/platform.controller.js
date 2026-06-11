const { okResponse, paginationMeta } = require("../../../shared/http/reply");
const { getPage } = require("../../../shared/tools/page");
const { PlatformService } = require("../services/platform.service");

class PlatformController {
  constructor({ platformService = new PlatformService() } = {}) {
    this.platformService = platformService;
  }

  // ── Categories ──────────────────────────────────────────────────────────────

  createCategory = async (req, res) => {
    const category = await this.platformService.createCategory(req.body, req);
    res.status(201).json(okResponse(category, { message: "Category created successfully." }));
  };

  updateCategory = async (req, res) => {
    const category = await this.platformService.updateCategory(req.params.categoryKey, req.body, req);
    res.json(okResponse(category, { message: "Category updated successfully." }));
  };

  getCategory = async (req, res) => {
    const category = await this.platformService.getCategory(req.params.categoryKey);
    res.json(okResponse(category));
  };

  getCategoryAttributes = async (req, res) => {
    const category = await this.platformService.getCategoryAttributes(req.params.categoryKey);
    res.json(okResponse(category));
  };

  listCategories = async (req, res) => {
    const isTreeRequested = req.query.tree === true || req.query.tree === "true";
    const { page, limit } = isTreeRequested ? { page: 1, limit: 1000 } : getPage(req.query);
    const result = await this.platformService.listCategories(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteCategory = async (req, res) => {
    const category = await this.platformService.deleteCategory(req.params.categoryKey, req);
    res.json(okResponse(category, { message: "Category deleted successfully." }));
  };

  // ── Product Families ────────────────────────────────────────────────────────

  createProductFamily = async (req, res) => {
    const family = await this.platformService.createProductFamily(req.body, req);
    res.status(201).json(okResponse(family, { message: "Product family created successfully." }));
  };

  updateProductFamily = async (req, res) => {
    const family = await this.platformService.updateProductFamily(req.params.familyCode, req.body, req);
    res.json(okResponse(family, { message: "Product family updated successfully." }));
  };

  getProductFamily = async (req, res) => {
    const family = await this.platformService.getProductFamily(req.params.familyCode);
    res.json(okResponse(family));
  };

  listProductFamilies = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listProductFamilies(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteProductFamily = async (req, res) => {
    const family = await this.platformService.deleteProductFamily(req.params.familyCode, req);
    res.json(okResponse(family, { message: "Product family deleted successfully." }));
  };

  // ── Product Variants ────────────────────────────────────────────────────────

  createProductVariant = async (req, res) => {
    const variant = await this.platformService.createProductVariant(req.body, req);
    res.status(201).json(okResponse(variant, { message: "Product variant created successfully." }));
  };

  updateProductVariant = async (req, res) => {
    const variant = await this.platformService.updateProductVariant(req.params.variantId, req.body, req);
    res.json(okResponse(variant, { message: "Product variant updated successfully." }));
  };

  getProductVariant = async (req, res) => {
    const variant = await this.platformService.getProductVariant(req.params.variantId);
    res.json(okResponse(variant));
  };

  listProductVariants = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listProductVariants(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteProductVariant = async (req, res) => {
    const variant = await this.platformService.deleteProductVariant(req.params.variantId, req);
    res.json(okResponse(variant, { message: "Product variant deleted successfully." }));
  };

  // ── HSN Codes ───────────────────────────────────────────────────────────────

  createHsnCode = async (req, res) => {
    const item = await this.platformService.createHsnCode(req.body);
    res.status(201).json(okResponse(item));
  };

  updateHsnCode = async (req, res) => {
    const item = await this.platformService.updateHsnCode(req.params.hsnCode, req.body);
    res.json(okResponse(item));
  };

  getHsnCode = async (req, res) => {
    const item = await this.platformService.getHsnCode(req.params.hsnCode);
    res.json(okResponse(item));
  };

  listHsnCodes = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listHsnCodes(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteHsnCode = async (req, res) => {
    const item = await this.platformService.deleteHsnCode(req.params.hsnCode);
    res.json(okResponse(item));
  };

  // ── Geography ───────────────────────────────────────────────────────────────

  createGeography = async (req, res) => {
    const item = await this.platformService.createGeography(req.body);
    res.status(201).json(okResponse(item));
  };

  updateGeography = async (req, res) => {
    const item = await this.platformService.updateGeography(req.params.countryCode, req.body);
    res.json(okResponse(item));
  };

  getGeography = async (req, res) => {
    const item = await this.platformService.getGeography(req.params.countryCode);
    res.json(okResponse(item));
  };

  listGeographies = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listGeographies(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteGeography = async (req, res) => {
    const item = await this.platformService.deleteGeography(req.params.countryCode);
    res.json(okResponse(item));
  };

  // ── Product Reviews ─────────────────────────────────────────────────────────

  listProductReviews = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listProductReviews(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  updateProductReview = async (req, res) => {
    const item = await this.platformService.updateProductReview(req.params.reviewId, req.body);
    res.json(okResponse(item));
  };

  deleteProductReview = async (req, res) => {
    const item = await this.platformService.deleteProductReview(req.params.reviewId);
    res.json(okResponse(item));
  };

  // ── Brands ──────────────────────────────────────────────────────────────────

  createBrand = async (req, res) => {
    const item = await this.platformService.createBrand(req.body, req);
    res.status(201).json(okResponse(item, { message: "Brand created successfully." }));
  };

  updateBrand = async (req, res) => {
    const item = await this.platformService.updateBrand(req.params.brandId, req.body, req);
    res.json(okResponse(item, { message: "Brand updated successfully." }));
  };

  getBrand = async (req, res) => {
    const item = await this.platformService.getBrand(req.params.brandId);
    res.json(okResponse(item));
  };

  listBrands = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listBrands(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteBrand = async (req, res) => {
    const item = await this.platformService.deleteBrand(req.params.brandId, req);
    res.json(okResponse(item, { message: "Brand deleted successfully." }));
  };

  // ── Warranty Templates ──────────────────────────────────────────────────────

  createWarrantyTemplate = async (req, res) => {
    const item = await this.platformService.createWarrantyTemplate(req.body, req);
    res.status(201).json(okResponse(item));
  };

  updateWarrantyTemplate = async (req, res) => {
    const item = await this.platformService.updateWarrantyTemplate(req.params.templateId, req.body, req);
    res.json(okResponse(item));
  };

  getWarrantyTemplate = async (req, res) => {
    const item = await this.platformService.getWarrantyTemplate(req.params.templateId);
    res.json(okResponse(item));
  };

  listWarrantyTemplates = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listWarrantyTemplates(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteWarrantyTemplate = async (req, res) => {
    const item = await this.platformService.deleteWarrantyTemplate(req.params.templateId, req);
    res.json(okResponse(item));
  };

  // ── Finishes ────────────────────────────────────────────────────────────────

  createFinish = async (req, res) => {
    const item = await this.platformService.createFinish(req.body, req);
    res.status(201).json(okResponse(item));
  };

  updateFinish = async (req, res) => {
    const item = await this.platformService.updateFinish(req.params.finishId, req.body, req);
    res.json(okResponse(item));
  };

  listFinishes = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listFinishes(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteFinish = async (req, res) => {
    const item = await this.platformService.deleteFinish(req.params.finishId, req);
    res.json(okResponse(item));
  };

  // ── Dimensions ──────────────────────────────────────────────────────────────

  createDimension = async (req, res) => {
    const item = await this.platformService.createDimension(req.body, req);
    res.status(201).json(okResponse(item));
  };

  updateDimension = async (req, res) => {
    const item = await this.platformService.updateDimension(req.params.dimensionId, req.body, req);
    res.json(okResponse(item));
  };

  listDimensions = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listDimensions(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteDimension = async (req, res) => {
    const item = await this.platformService.deleteDimension(req.params.dimensionId, req);
    res.json(okResponse(item));
  };

  // ── Batches ─────────────────────────────────────────────────────────────────

  createBatch = async (req, res) => {
    const item = await this.platformService.createBatch(req.body, req);
    res.status(201).json(okResponse(item));
  };

  updateBatch = async (req, res) => {
    const item = await this.platformService.updateBatch(req.params.batchId, req.body, req);
    res.json(okResponse(item));
  };

  listBatches = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listBatches(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteBatch = async (req, res) => {
    const item = await this.platformService.deleteBatch(req.params.batchId, req);
    res.json(okResponse(item));
  };

  // ── Product Options ─────────────────────────────────────────────────────────

  createProductOption = async (req, res) => {
    const item = await this.platformService.createProductOption(req.body, req);
    res.status(201).json(okResponse(item, { message: "Product option created successfully." }));
  };

  updateProductOption = async (req, res) => {
    const item = await this.platformService.updateProductOption(req.params.optionId, req.body, req);
    res.json(okResponse(item, { message: "Product option updated successfully." }));
  };

  listProductOptions = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listProductOptions(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteProductOption = async (req, res) => {
    const item = await this.platformService.deleteProductOption(req.params.optionId, req);
    res.json(okResponse(item, { message: "Product option deleted successfully." }));
  };

  // ── Product Option Values ───────────────────────────────────────────────────

  createProductOptionValue = async (req, res) => {
    const item = await this.platformService.createProductOptionValue(req.body, req);
    res.status(201).json(okResponse(item, { message: "Product option value created successfully." }));
  };

  updateProductOptionValue = async (req, res) => {
    const item = await this.platformService.updateProductOptionValue(req.params.optionValueId, req.body, req);
    res.json(okResponse(item, { message: "Product option value updated successfully." }));
  };

  listProductOptionValues = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.platformService.listProductOptionValues(req.query);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  deleteProductOptionValue = async (req, res) => {
    const item = await this.platformService.deleteProductOptionValue(req.params.optionValueId, req);
    res.json(okResponse(item, { message: "Product option value deleted successfully." }));
  };

  // ── Catalog Prefill ─────────────────────────────────────────────────────────

  getCatalogPrefillData = async (req, res) => {
    const result = await this.platformService.getCatalogPrefillData(req.query);
    res.json(okResponse(result));
  };
}

module.exports = { PlatformController };
