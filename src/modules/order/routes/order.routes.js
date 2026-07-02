const express = require("express");
const { OrderController } = require("../controllers/order.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions, allowPermissions } = require("../../../shared/middleware/access");
const { ACTIONS } = require("../../../shared/constants/actions");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  createOrderSchema,
  quoteOrderSchema,
  adminQuoteOrderSchema,
  updateOrderStatusSchema,
  orderParamSchema,
  cancelOrderSchema,
  listOrdersSchema,
  addOrderNoteSchema,
} = require("../validation/order.validation");

const orderRoutes = express.Router();
const orderController = new OrderController();

orderRoutes.get(
  "/",
  authenticate,
  allowActions(ACTIONS.ORDER_MANAGE),
  checkInput(listOrdersSchema),
  catchErrors(orderController.listAdminOrders),
);
orderRoutes.get("/me", authenticate, checkInput(listOrdersSchema), catchErrors(orderController.listMine));
orderRoutes.post("/quote", authenticate, checkInput(quoteOrderSchema), catchErrors(orderController.quote));
orderRoutes.post(
  "/checkout/admin-quote",
  authenticate,
  allowPermissions("orders:view"),
  checkInput(adminQuoteOrderSchema),
  catchErrors(orderController.adminQuote),
);
orderRoutes.get(
  "/seller/me",
  authenticate,
  allowActions(ACTIONS.ORDER_MANAGE),
  checkInput(listOrdersSchema),
  catchErrors(orderController.listSellerOrders),
);
orderRoutes.post("/", authenticate, checkInput(createOrderSchema), catchErrors(orderController.create));
orderRoutes.get(
  "/:orderId",
  authenticate,
  checkInput(orderParamSchema),
  catchErrors(orderController.getOne),
);
orderRoutes.post(
  "/:orderId/cancel",
  authenticate,
  checkInput(cancelOrderSchema),
  catchErrors(orderController.cancel),
);
orderRoutes.patch(
  "/:orderId/status",
  authenticate,
  allowPermissions("orders:update"),
  checkInput(updateOrderStatusSchema),
  catchErrors(orderController.updateStatus),
);
orderRoutes.post(
  "/:orderId/payment/retry",
  authenticate,
  checkInput(orderParamSchema),
  catchErrors(orderController.reopenPayment),
);
orderRoutes.post(
  "/:orderId/notes",
  authenticate,
  allowPermissions("orders:update"),
  checkInput(addOrderNoteSchema),
  catchErrors(orderController.addNote),
);

module.exports = { orderRoutes };
