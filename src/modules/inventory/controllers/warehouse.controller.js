const { okResponse } = require("../../../shared/http/reply");
const { InventoryService } = require("../services/inventory.service");
const { WarehouseService } = require("../services/warehouse.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { auditService } = require("../../../shared/logger/audit.service");

class WarehouseController {
  constructor({
    warehouseService = new WarehouseService(),
    inventoryService = new InventoryService(),
  } = {}) {
    this.warehouseService = warehouseService;
    this.inventoryService = inventoryService;
  }

  sendList(res, result) {
    res.json(okResponse(result.items, {
      total: result.total,
      page: result.page,
      limit: result.limit,
    }));
  }

  list = async (req, res) => this.sendList(res, await this.warehouseService.list(req.query));
  listTransactions = async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 200);
    const offset = Number(req.query.offset || 0);
    res.json(okResponse(await this.inventoryService.listTransactions(req.query, { limit, offset })));
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
}

module.exports = { WarehouseController };
