const { okResponse } = require("../../../shared/http/reply");
const { InventoryService } = require("../services/inventory.service");
const { WarehouseService } = require("../services/warehouse.service");

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
  create = async (req, res) => res.status(201).json(okResponse(await this.warehouseService.create(req.body)));
  update = async (req, res) => res.json(okResponse(await this.warehouseService.update(req.params.warehouseId, req.body)));
  setStatus = async (req, res) => res.json(okResponse(await this.warehouseService.setStatus(req.body.ids || req.body._id, req.body.isDisable)));
  delete = async (req, res) => res.json(okResponse(await this.warehouseService.deleteMany(req.body.ids || req.body._id || req.params.warehouseId)));
}

module.exports = { WarehouseController };
