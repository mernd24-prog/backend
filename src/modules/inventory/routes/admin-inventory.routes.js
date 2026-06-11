const express = require("express");
const { WarehouseController } = require("../controllers/warehouse.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const { allowPermissions } = require("../../../shared/middleware/access");
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
  allowPermissions("inventory:view"),
  checkInput(listInventoryTransactionsSchema),
  catchErrors(warehouseController.listTransactions),
);
adminInventoryRoutes.get(
  "/warehouses",
  allowPermissions("inventory:view"),
  checkInput(listWarehousesSchema),
  catchErrors(warehouseController.list),
);
adminInventoryRoutes.post(
  "/warehouses",
  allowPermissions("inventory:create"),
  checkInput(createWarehouseSchema),
  catchErrors(warehouseController.create),
);
adminInventoryRoutes.patch(
  "/warehouses/status",
  allowPermissions("inventory:status_change"),
  checkInput(warehouseStatusSchema),
  catchErrors(warehouseController.setStatus),
);
adminInventoryRoutes.patch(
  "/warehouses/:warehouseId",
  allowPermissions("inventory:update"),
  checkInput(updateWarehouseSchema),
  catchErrors(warehouseController.update),
);
adminInventoryRoutes.delete(
  "/warehouses",
  allowPermissions("inventory:delete"),
  checkInput(warehouseDeleteSchema),
  catchErrors(warehouseController.delete),
);
adminInventoryRoutes.delete(
  "/warehouses/:warehouseId",
  allowPermissions("inventory:delete"),
  checkInput(warehouseParamSchema),
  catchErrors(warehouseController.delete),
);

module.exports = { adminInventoryRoutes };
