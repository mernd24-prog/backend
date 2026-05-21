const { okResponse } = require("../../../shared/http/reply");
const { ProductService } = require("../services/product.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

class ProductController {
  constructor({ productService = new ProductService() } = {}) {
    this.productService = productService;
  }

  create = async (req, res) => {
    const actor = getCurrentUser(req);
    const product = await this.productService.createProduct(req.body, actor);
    res.status(201).json(okResponse(product));
  };

  list = async (req, res) => {
    const result = await this.productService.listProducts(req.query);
    res.json(okResponse(result.items, { total: result.total }));
  };

  listMine = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.productService.listSellerProducts(req.query, actor);
    res.json(okResponse(result.items, { total: result.total }));
  };

  getOne = async (req, res) => {
    const product = await this.productService.getProduct(req.params.productId);
    // Track view asynchronously (non-blocking)
    this.productService.trackView(req.params.productId).catch(() => {});
    res.json(okResponse(product));
  };

  search = async (req, res) => {
    const result = await this.productService.searchProducts(req.query);
    res.json(okResponse(result.items, { total: result.total }));
  };

  update = async (req, res) => {
    const actor = getCurrentUser(req);
    const product = await this.productService.updateProduct(req.params.productId, req.body, actor);
    res.json(okResponse(product));
  };

  review = async (req, res) => {
    const actor = getCurrentUser(req);
    const product = await this.productService.reviewProduct(req.params.productId, req.body, actor);
    res.json(okResponse(product));
  };

  delete = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.productService.deleteProduct(req.params.productId, actor);
    res.json(okResponse(result));
  };

  // ─── Bulk operations ─────────────────────────────────────────────────────

  bulkUpdate = async (req, res) => {
    const actor = getCurrentUser(req);
    const { productIds, status, visibility } = req.body;
    let result;
    if (status) {
      result = await this.productService.bulkUpdateStatus(productIds, status, actor);
    } else if (visibility) {
      result = await this.productService.bulkUpdateVisibility(productIds, visibility);
    }
    res.json(okResponse(result));
  };

  // ─── Inventory ────────────────────────────────────────────────────────────

  adjustInventory = async (req, res) => {
    const actor = getCurrentUser(req);
    const product = await this.productService.adjustInventory(
      req.params.productId,
      req.body,
      actor,
    );
    res.json(okResponse(product));
  };

  inventoryStats = async (req, res) => {
    const actor = getCurrentUser(req);
    const sellerId = actor.role === "admin" ? req.query.sellerId : actor.ownerSellerId || actor.userId;
    const createdBy = ["seller-admin", "seller-sub-admin"].includes(actor.role) ? actor.userId : null;
    const stats = await this.productService.getInventoryStats(sellerId, createdBy);
    res.json(okResponse(stats));
  };

  // ─── Analytics ────────────────────────────────────────────────────────────

  topProducts = async (req, res) => {
    const limit = Number(req.query.limit || 10);
    const metric = req.query.metric || "purchases";
    const products = await this.productService.getTopProducts(limit, metric);
    res.json(okResponse(products));
  };
}

module.exports = { ProductController };
