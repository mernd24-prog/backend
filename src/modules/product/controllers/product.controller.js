const { okResponse, paginationMeta } = require("../../../shared/http/reply");
const { getPage } = require("../../../shared/tools/page");
const { ProductService } = require("../services/product.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { auditService } = require("../../../shared/logger/audit.service");

class ProductController {
  constructor({ productService = new ProductService() } = {}) {
    this.productService = productService;
  }

  create = async (req, res) => {
    const actor = getCurrentUser(req);
    const product = await this.productService.createProduct(req.body, actor);
    await auditService.create(req, {
      module: "products",
      entityId: product?._id || product?.id,
      entityType: "Product",
      newData: product,
    });
    res.status(201).json(okResponse(product));
  };

  prefill = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.productService.getProductPrefillData(req.query, actor);
    res.json(okResponse(result));
  };

  list = async (req, res) => {
    const { page, limit } = getPage(req.query);
    const result = await this.productService.listProducts(req.query, {
      publicOnly: !req.auth,
    });
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  listMine = async (req, res) => {
    const actor = getCurrentUser(req);
    const { page, limit } = getPage(req.query);
    const result = await this.productService.listSellerProducts(req.query, actor);
    res.json(okResponse(result.items, { pagination: paginationMeta(page, limit, result.total) }));
  };

  getOne = async (req, res) => {
    const product = req.auth
      ? await this.productService.getProductForManagement(
          req.params.productId,
          getCurrentUser(req),
        )
      : await this.productService.getProduct(req.params.productId);
    if (!req.auth) {
      // Track customer views only for public product reads.
      this.productService.trackView(req.params.productId).catch(() => {});
    }
    res.json(okResponse(product));
  };

  search = async (req, res) => {
    const result = await this.productService.searchProducts(req.query);
    res.json(okResponse(result.items, { total: result.total, source: result.source }));
  };

  update = async (req, res) => {
    const actor = getCurrentUser(req);
    const product = await this.productService.updateProduct(req.params.productId, req.body, actor);
    await auditService.update(req, {
      module: "products",
      entityId: req.params.productId,
      entityType: "Product",
      newData: product,
      reason: req.body.reason,
    });
    res.json(okResponse(product));
  };

  review = async (req, res) => {
    const actor = getCurrentUser(req);
    const product = await this.productService.reviewProduct(req.params.productId, req.body, actor);
    await auditService.record(req, {
      module: "products",
      action: req.body.status === "active"
        ? "approve"
        : req.body.status === "rejected"
          ? "reject"
          : "status_change",
      entityId: req.params.productId,
      entityType: "Product",
      newData: product,
      reason: req.body.rejectionReason || req.body.notes,
    });
    res.json(okResponse(product));
  };

  status = async (req, res) => {
    const actor = getCurrentUser(req);
    const product = await this.productService.changeProductStatus(req.params.productId, req.body, actor);
    await auditService.statusChange(req, {
      module: "products",
      entityId: req.params.productId,
      entityType: "Product",
      newData: product,
      reason: req.body.reason || req.body.rejectionReason,
    });
    res.json(okResponse(product));
  };

  listRevisions = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.productService.listProductRevisions(
      req.params.productId,
      req.query,
      actor,
    );
    res.json(okResponse(result.items, {
      total: result.total,
      page: result.page,
      limit: result.limit,
    }));
  };

  reviewRevision = async (req, res) => {
    const actor = getCurrentUser(req);
    const product = await this.productService.reviewProductRevision(
      req.params.productId,
      req.params.revisionId,
      req.body,
      actor,
    );
    await auditService.record(req, {
      module: "products",
      action: req.body.status === "active" ? "approve_revision" : "reject_revision",
      entityId: req.params.productId,
      entityType: "ProductRevision",
      newData: product,
      reason: req.body.rejectionReason || req.body.notes,
    });
    res.json(okResponse(product));
  };

  delete = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.productService.deleteProduct(req.params.productId, actor);
    await auditService.remove(req, {
      module: "products",
      entityId: req.params.productId,
      entityType: "Product",
      newData: result,
      reason: "soft_archived",
    });
    res.json(okResponse(result));
  };

  archive = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.productService.archiveProduct(req.params.productId, req.body, actor);
    await auditService.statusChange(req, {
      module: "products",
      entityId: req.params.productId,
      entityType: "Product",
      newData: result,
      reason: req.body.reason || "product_archived",
    });
    res.json(okResponse(result));
  };

  restore = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.productService.restoreProduct(req.params.productId, req.body, actor);
    await auditService.statusChange(req, {
      module: "products",
      entityId: req.params.productId,
      entityType: "Product",
      newData: result,
      reason: req.body.reason || "product_restored",
    });
    res.json(okResponse(result));
  };

  duplicate = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.productService.duplicateProduct(req.params.productId, req.body, actor);
    await auditService.create(req, {
      module: "products",
      entityId: result?._id || result?.id,
      entityType: "Product",
      newData: result,
      reason: `duplicated_from:${req.params.productId}`,
    });
    res.status(201).json(okResponse(result));
  };

  // ─── Bulk operations ─────────────────────────────────────────────────────

  bulkUpdate = async (req, res) => {
    const actor = getCurrentUser(req);
    const { productIds, status, visibility } = req.body;
    let result;
    if (status) {
      result = await this.productService.bulkUpdateStatus(productIds, status, actor);
    } else if (visibility) {
      result = await this.productService.bulkUpdateVisibility(productIds, visibility, actor);
    }
    await auditService.record(req, {
      module: "products",
      action: "bulk_action",
      entityType: "Product",
      newData: result,
      reason: status ? `bulk_status:${status}` : visibility ? `bulk_visibility:${visibility}` : "bulk_update",
    });
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
    await auditService.record(req, {
      module: "products",
      action: "inventory_adjust",
      entityId: req.params.productId,
      entityType: "Product",
      newData: product,
      reason: req.body.reason,
    });
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
