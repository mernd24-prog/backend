const express = require("express");
const { WarehouseController } = require("../controllers/warehouse.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  listWarehousesSchema,
  listInventoryTransactionsSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  warehouseParamSchema,
  warehouseStatusSchema,
  warehouseDeleteSchema,
} = require("../validation/warehouse.validation");

const adminInventoryRoutes = express.Router();
const warehouseController = new WarehouseController();

adminInventoryRoutes.get(
  "/transactions",
  checkInput(listInventoryTransactionsSchema),
  catchErrors(warehouseController.listTransactions),
);
adminInventoryRoutes.get(
  "/warehouses",
  checkInput(listWarehousesSchema),
  catchErrors(warehouseController.list),
);
adminInventoryRoutes.post(
  "/warehouses",
  checkInput(createWarehouseSchema),
  catchErrors(warehouseController.create),
);
adminInventoryRoutes.patch(
  "/warehouses/status",
  checkInput(warehouseStatusSchema),
  catchErrors(warehouseController.setStatus),
);
adminInventoryRoutes.patch(
  "/warehouses/:warehouseId",
  checkInput(updateWarehouseSchema),
  catchErrors(warehouseController.update),
);
adminInventoryRoutes.delete(
  "/warehouses",
  checkInput(warehouseDeleteSchema),
  catchErrors(warehouseController.delete),
);
adminInventoryRoutes.delete(
  "/warehouses/:warehouseId",
  checkInput(warehouseParamSchema),
  catchErrors(warehouseController.delete),
);

module.exports = { adminInventoryRoutes };
