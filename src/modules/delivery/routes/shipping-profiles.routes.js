"use strict";

const express = require("express");
const { ShippingProfilesController } = require("../controllers/shipping-profiles.controller");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");
const { checkInput } = require("../../../shared/middleware/check-input");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const {
  profileBody,
  updateProfileBody,
  listProfilesSchema,
  profileParamSchema,
} = require("../validation/shipping-profiles.validation");

const shippingProfilesRoutes = express.Router();
const controller = new ShippingProfilesController();

// List — accessible by admin and authenticated sellers
shippingProfilesRoutes.get(
  "/",
  authenticate,
  allowPermissions("delivery:view"),
  checkInput({ query: listProfilesSchema }),
  catchErrors(controller.list)
);

// Create
shippingProfilesRoutes.post(
  "/",
  authenticate,
  allowPermissions("delivery:create"),
  checkInput({ body: profileBody }),
  catchErrors(controller.create)
);

// Get single
shippingProfilesRoutes.get(
  "/:profileId",
  authenticate,
  allowPermissions("delivery:view"),
  checkInput({ params: profileParamSchema }),
  catchErrors(controller.get)
);

// Update
shippingProfilesRoutes.patch(
  "/:profileId",
  authenticate,
  allowPermissions("delivery:update"),
  checkInput({ params: profileParamSchema, body: updateProfileBody }),
  catchErrors(controller.update)
);

// Delete
shippingProfilesRoutes.delete(
  "/:profileId",
  authenticate,
  allowPermissions("delivery:delete"),
  checkInput({ params: profileParamSchema }),
  catchErrors(controller.delete)
);

// Set as default profile
shippingProfilesRoutes.post(
  "/:profileId/set-default",
  authenticate,
  allowPermissions("delivery:update"),
  checkInput({ params: profileParamSchema }),
  catchErrors(controller.setDefault)
);

module.exports = { shippingProfilesRoutes };
