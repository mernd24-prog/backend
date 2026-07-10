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
  releaseExpiredReservationsSchema,
  listVariantInventorySchema,
  productInventorySchema,
  adjustVariantInventorySchema,
} = require("../validation/warehouse.validation");

const adminInventoryRoutes = express.Router();
const warehouseController = new WarehouseController();

adminInventoryRoutes.get(
  "/variants",
  allowPermissions("inventory:view"),
  checkInput(listVariantInventorySchema),
  catchErrors(warehouseController.listVariantInventory),
);
adminInventoryRoutes.get(
  "/products/:productId",
  allowPermissions("inventory:view"),
  checkInput(productInventorySchema),
  catchErrors(warehouseController.getProductInventory),
);
adminInventoryRoutes.patch(
  "/products/:productId/variants/:variantSku/adjust",
  allowPermissions("inventory:adjust"),
  checkInput(adjustVariantInventorySchema),
  catchErrors(warehouseController.adjustVariantInventory),
);
adminInventoryRoutes.get(
  "/stats",
  allowPermissions("inventory:view"),
  catchErrors(warehouseController.getStats),
);
adminInventoryRoutes.get(
  "/low-stock",
  allowPermissions("inventory:view"),
  catchErrors(warehouseController.getLowStock),
);
adminInventoryRoutes.get(
  "/transactions",
  allowPermissions("inventory:view"),
  checkInput(listInventoryTransactionsSchema),
  catchErrors(warehouseController.listTransactions),
);
adminInventoryRoutes.post(
  "/reservations/release-expired",
  allowPermissions("inventory:adjust"),
  checkInput(releaseExpiredReservationsSchema),
  catchErrors(warehouseController.releaseExpiredReservations),
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
