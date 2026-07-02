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
  templateBody,
  updateTemplateBody,
  cloneTemplateBody,
  listProfilesSchema,
  listTemplatesSchema,
  profileParamSchema,
  templateParamSchema,
  bulkDeleteProfilesSchema,
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

// Admin-authored templates. Sellers can view published templates and clone their own copy.
shippingProfilesRoutes.get(
  "/templates",
  authenticate,
  allowPermissions("delivery:view"),
  checkInput({ query: listTemplatesSchema }),
  catchErrors(controller.listTemplates)
);

shippingProfilesRoutes.post(
  "/templates",
  authenticate,
  allowPermissions("delivery:create"),
  checkInput({ body: templateBody }),
  catchErrors(controller.createTemplate)
);

shippingProfilesRoutes.get(
  "/templates/:templateId",
  authenticate,
  allowPermissions("delivery:view"),
  checkInput({ params: templateParamSchema }),
  catchErrors(controller.getTemplate)
);

shippingProfilesRoutes.patch(
  "/templates/:templateId",
  authenticate,
  allowPermissions("delivery:update"),
  checkInput({ params: templateParamSchema, body: updateTemplateBody }),
  catchErrors(controller.updateTemplate)
);

shippingProfilesRoutes.delete(
  "/templates/:templateId",
  authenticate,
  allowPermissions("delivery:delete"),
  checkInput({ params: templateParamSchema }),
  catchErrors(controller.archiveTemplate)
);

shippingProfilesRoutes.post(
  "/templates/:templateId/clone",
  authenticate,
  allowPermissions("delivery:create"),
  checkInput({ params: templateParamSchema, body: cloneTemplateBody }),
  catchErrors(controller.cloneTemplate)
);

// Create
shippingProfilesRoutes.post(
  "/",
  authenticate,
  allowPermissions("delivery:create"),
  checkInput({ body: profileBody }),
  catchErrors(controller.create)
);

// Bulk delete
shippingProfilesRoutes.post(
  "/bulk-delete",
  authenticate,
  allowPermissions("delivery:delete"),
  checkInput({ body: bulkDeleteProfilesSchema }),
  catchErrors(controller.bulkDelete)
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
