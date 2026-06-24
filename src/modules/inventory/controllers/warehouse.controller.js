const { okResponse } = require("../../../shared/http/reply");
const { InventoryService } = require("../services/inventory.service");
const { WarehouseService } = require("../services/warehouse.service");
const { ProductService } = require("../../product/services/product.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { auditService } = require("../../../shared/logger/audit.service");
const { getPage } = require("../../../shared/tools/page");

class WarehouseController {
  constructor({
    warehouseService = new WarehouseService(),
    inventoryService = new InventoryService(),
    productService = new ProductService(),
  } = {}) {
    this.warehouseService = warehouseService;
    this.inventoryService = inventoryService;
    this.productService = productService;
  }

  sendList(res, result) {
    res.json(okResponse(result.items, {
      total: result.total,
      page: result.page,
      limit: result.limit,
    }));
  }

  list = async (req, res) => {
    const actor = getCurrentUser(req);
    const isAdmin = ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
    const query = {
      ...req.query,
      ...(!isAdmin
        ? {
            sellerId: actor.ownerSellerId || actor.userId,
            organizationId: actor.organizationId || undefined,
          }
        : {}),
    };
    this.sendList(res, await this.warehouseService.list(query));
  };
  listTransactions = async (req, res) => {
    const actor = getCurrentUser(req);
    const isAdmin = ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
    const limit = Math.min(Number(req.query.limit || 100), 200);
    const offset = Number(req.query.offset || 0);
    res.json(okResponse(await this.inventoryService.listTransactions({
      ...req.query,
      ...(!isAdmin
        ? {
            sellerId: actor.ownerSellerId || actor.userId,
            organizationId: actor.organizationId || undefined,
          }
        : {}),
    }, { limit, offset })));
  };

  releaseExpiredReservations = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.inventoryService.releaseExpiredReservations(req.body || {}, actor);
    await auditService.record(req, {
      module: "inventory",
      action: "adjust",
      entityType: "InventoryReservation",
      entityId: "expired-reservations",
      newData: result,
      reason: req.body?.reason || "expired_reservation_cleanup",
      description: "Released expired inventory reservations",
    });
    res.json(okResponse(result));
  };

  create = async (req, res) => {
    const actor = getCurrentUser(req);
    const warehouse = await this.warehouseService.create(req.body, actor);
    await auditService.create(req, {
      module: "inventory",
      entityId: warehouse?._id || warehouse?.id,
      entityType: "Warehouse",
      newData: warehouse,
    });
    res.status(201).json(okResponse(warehouse));
  };

  update = async (req, res) => {
    const actor = getCurrentUser(req);
    const warehouse = await this.warehouseService.update(req.params.warehouseId, req.body, actor);
    await auditService.update(req, {
      module: "inventory",
      entityId: req.params.warehouseId,
      entityType: "Warehouse",
      newData: warehouse,
    });
    res.json(okResponse(warehouse));
  };

  setStatus = async (req, res) => {
    const actor = getCurrentUser(req);
    const ids = req.body.ids || req.body._id;
    const result = await this.warehouseService.setStatus(ids, req.body.isDisable, actor);
    await auditService.statusChange(req, {
      module: "inventory",
      entityId: Array.isArray(ids) ? ids.join(",") : ids,
      entityType: "Warehouse",
      newData: result,
      reason: req.body.isDisable ? "warehouse_deactivated" : "warehouse_activated",
    });
    res.json(okResponse(result));
  };

  delete = async (req, res) => {
    const ids = req.body.ids || req.body._id || req.params.warehouseId;
    const result = await this.warehouseService.deleteMany(ids);
    await auditService.remove(req, {
      module: "inventory",
      entityId: Array.isArray(ids) ? ids.join(",") : ids,
      entityType: "Warehouse",
      newData: result,
      reason: "warehouse_deleted",
    });
    res.json(okResponse(result));
  };

  getStats = async (req, res) => {
    const actor = getCurrentUser(req);
    const isAdmin = ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
    const sellerId = isAdmin ? req.query.sellerId || null : actor.ownerSellerId || actor.userId;
    const stats = await this.productService.getInventoryStats(
      sellerId,
      req.query.organizationId || actor.organizationId || null,
    );
    res.json(okResponse(stats));
  };

  getLowStock = async (req, res) => {
    const pagination = getPage(req.query);
    const actor = getCurrentUser(req);
    const isAdmin = ["admin", "sub-admin", "super-admin"].includes(actor.role) || actor.isSuperAdmin;
    const sellerId = isAdmin ? req.query.sellerId || null : actor.ownerSellerId || actor.userId;
    const organizationId = req.query.organizationId || actor.organizationId || null;
    const result = await this.productService.listProducts(
      {
        ...req.query,
        stockStatus: "low_stock",
        includeAllStatuses: true,
        ...(sellerId ? { sellerId } : {}),
        ...(organizationId ? { organizationId } : {}),
        page: pagination.page,
        limit: pagination.limit,
      },
      { publicOnly: false },
    );
    res.json(okResponse(result.items, { total: result.total }));
  };
}

module.exports = { WarehouseController };
