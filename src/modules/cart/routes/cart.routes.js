const express = require("express");
const { CartController } = require("../controllers/cart.controller");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const { allowPermissions } = require("../../../shared/middleware/access");
const {
  upsertCartSchema,
  listAdminCartsSchema,
  cartParamSchema,
  clearCartSchema,
} = require("../validation/cart.validation");

const cartRoutes = express.Router();
const adminCartRoutes = express.Router();
const cartController = new CartController();

cartRoutes.get("/me", authenticate, catchErrors(cartController.getMyCart));
cartRoutes.put(
  "/me",
  authenticate,
  checkInput(upsertCartSchema),
  catchErrors(cartController.upsertMyCart),
);

adminCartRoutes.get(
  "/",
  allowPermissions("carts:view"),
  checkInput(listAdminCartsSchema),
  catchErrors(cartController.listAdminCarts),
);
adminCartRoutes.get(
  "/:cartId",
  allowPermissions("carts:view"),
  checkInput(cartParamSchema),
  catchErrors(cartController.getAdminCart),
);
adminCartRoutes.delete(
  "/:cartId",
  allowPermissions("carts:delete"),
  checkInput(clearCartSchema),
  catchErrors(cartController.clearAdminCart),
);

module.exports = { cartRoutes, adminCartRoutes };
