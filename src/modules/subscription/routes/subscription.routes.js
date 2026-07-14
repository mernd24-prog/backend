const express = require("express");
const { SubscriptionController } = require("../controllers/subscription.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowRoles } = require("../../../shared/middleware/access");
const { checkInput } = require("../../../shared/middleware/check-input");
const { ROLES } = require("../../../shared/constants/roles");
const {
  listPlansSchema,
  purchasePlanSchema,
  subscriptionIdParamSchema,
  createPlanSchema,
  listPlansAdminSchema,
  planIdParamSchema,
  updatePlanSchema,
  listSubscriptionsAdminSchema,
  updateSubscriptionStatusAdminSchema,
} = require("../validation/subscription.validation");

const subscriptionRoutes = express.Router();
const subscriptionController = new SubscriptionController();

subscriptionRoutes.get("/plans", checkInput(listPlansSchema), catchErrors(subscriptionController.listPlans));
subscriptionRoutes.post(
  "/purchase",
  authenticate,
  checkInput(purchasePlanSchema),
  catchErrors(subscriptionController.purchasePlan),
);
subscriptionRoutes.get("/me", authenticate, catchErrors(subscriptionController.listMine));
subscriptionRoutes.put(
  "/:subscriptionId/pause",
  authenticate,
  checkInput(subscriptionIdParamSchema),
  catchErrors(subscriptionController.pauseMine),
);
subscriptionRoutes.put(
  "/:subscriptionId/resume",
  authenticate,
  checkInput(subscriptionIdParamSchema),
  catchErrors(subscriptionController.resumeMine),
);
subscriptionRoutes.put(
  "/:subscriptionId/cancel",
  authenticate,
  checkInput(subscriptionIdParamSchema),
  catchErrors(subscriptionController.cancelMine),
);

subscriptionRoutes.post(
  "/admin/plans",
  authenticate,
  allowRoles(ROLES.ADMIN),
  checkInput(createPlanSchema),
  catchErrors(subscriptionController.createPlan),
);
subscriptionRoutes.get(
  "/admin/plans",
  authenticate,
  allowRoles(ROLES.ADMIN),
  checkInput(listPlansAdminSchema),
  catchErrors(subscriptionController.listPlansAdmin),
);
subscriptionRoutes.get(
  "/admin/plans/:planId",
  authenticate,
  allowRoles(ROLES.ADMIN),
  checkInput(planIdParamSchema),
  catchErrors(subscriptionController.getPlan),
);
subscriptionRoutes.patch(
  "/admin/plans/:planId",
  authenticate,
  allowRoles(ROLES.ADMIN),
  checkInput(updatePlanSchema),
  catchErrors(subscriptionController.updatePlan),
);
subscriptionRoutes.delete(
  "/admin/plans/:planId",
  authenticate,
  allowRoles(ROLES.ADMIN),
  checkInput(planIdParamSchema),
  catchErrors(subscriptionController.deletePlan),
);
subscriptionRoutes.get(
  "/admin/subscriptions",
  authenticate,
  allowRoles(ROLES.ADMIN),
  checkInput(listSubscriptionsAdminSchema),
  catchErrors(subscriptionController.listSubscriptionsAdmin),
);
subscriptionRoutes.patch(
  "/admin/subscriptions/:subscriptionId/status",
  authenticate,
  allowRoles(ROLES.ADMIN),
  checkInput(updateSubscriptionStatusAdminSchema),
  catchErrors(subscriptionController.updateSubscriptionStatusAdmin),
);
module.exports = { subscriptionRoutes };
