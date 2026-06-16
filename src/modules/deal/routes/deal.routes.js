"use strict";

const express = require("express");
const { DealController } = require("../controllers/deal.controller");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");
const { checkInput } = require("../../../shared/middleware/check-input");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const {
  listDealsSchema,
  createDealSchema,
  updateDealSchema,
  dealParamSchema,
  dealActionSchema,
  rejectDealSchema,
  commissionRuleUpdateSchema,
  sponsorshipUpdateSchema,
  sponsorshipParamSchema,
  placementSchema,
  analyticsSchema,
  payoutGenerateSchema,
  payoutListSchema,
  payoutParamSchema,
  processPayoutSchema,
} = require("../validation/deal.validation");

const dealRoutes = express.Router();
const dealController = new DealController();

dealRoutes.get(
  "/public/placements",
  checkInput(placementSchema),
  catchErrors(dealController.publicPlacements),
);

dealRoutes.get(
  "/",
  authenticate,
  allowPermissions("deals:view"),
  checkInput(listDealsSchema),
  catchErrors(dealController.listDeals),
);

dealRoutes.post(
  "/",
  authenticate,
  allowPermissions("deals:create"),
  checkInput(createDealSchema),
  catchErrors(dealController.createDeal),
);

dealRoutes.get(
  "/analytics",
  authenticate,
  allowPermissions("deals:view"),
  checkInput(analyticsSchema),
  catchErrors(dealController.analytics),
);

dealRoutes.get(
  "/payouts",
  authenticate,
  allowPermissions("deals:view"),
  checkInput(payoutListSchema),
  catchErrors(dealController.listPayouts),
);

dealRoutes.post(
  "/payouts/generate",
  authenticate,
  allowPermissions("deals:approve"),
  checkInput(payoutGenerateSchema),
  catchErrors(dealController.generatePayout),
);

dealRoutes.patch(
  "/payouts/:payoutId/process",
  authenticate,
  allowPermissions("deals:approve"),
  checkInput(processPayoutSchema),
  catchErrors(dealController.processPayout),
);

dealRoutes.get(
  "/payouts/:payoutId",
  authenticate,
  allowPermissions("deals:view"),
  checkInput(payoutParamSchema),
  catchErrors((req, res) => res.json({ ok: true })),
);

dealRoutes.get(
  "/:dealId",
  authenticate,
  allowPermissions("deals:view"),
  checkInput(dealParamSchema),
  catchErrors(dealController.getDeal),
);

dealRoutes.patch(
  "/:dealId",
  authenticate,
  allowPermissions("deals:update"),
  checkInput(updateDealSchema),
  catchErrors(dealController.updateDeal),
);

dealRoutes.post(
  "/:dealId/submit",
  authenticate,
  allowPermissions("deals:update"),
  checkInput(dealActionSchema),
  catchErrors(dealController.submitDeal),
);

dealRoutes.post(
  "/:dealId/approve",
  authenticate,
  allowPermissions("deals:approve"),
  checkInput(dealActionSchema),
  catchErrors(dealController.approveDeal),
);

dealRoutes.post(
  "/:dealId/reject",
  authenticate,
  allowPermissions("deals:reject"),
  checkInput(rejectDealSchema),
  catchErrors(dealController.rejectDeal),
);

dealRoutes.post(
  "/:dealId/pause",
  authenticate,
  allowPermissions("deals:status_change"),
  checkInput(dealActionSchema),
  catchErrors(dealController.pauseDeal),
);

dealRoutes.post(
  "/:dealId/resume",
  authenticate,
  allowPermissions("deals:status_change"),
  checkInput(dealActionSchema),
  catchErrors(dealController.resumeDeal),
);

dealRoutes.post(
  "/:dealId/cancel",
  authenticate,
  allowPermissions("deals:status_change"),
  checkInput(dealActionSchema),
  catchErrors(dealController.cancelDeal),
);

dealRoutes.post(
  "/:dealId/renew",
  authenticate,
  allowPermissions("deals:create"),
  checkInput(updateDealSchema),
  catchErrors(dealController.renewDeal),
);

dealRoutes.put(
  "/:dealId/commission-rule",
  authenticate,
  allowPermissions("deals:approve"),
  checkInput(commissionRuleUpdateSchema),
  catchErrors(dealController.upsertCommissionRule),
);

dealRoutes.put(
  "/:dealId/sponsorship",
  authenticate,
  allowPermissions("deals:approve"),
  checkInput(sponsorshipUpdateSchema),
  catchErrors(dealController.upsertSponsorship),
);

dealRoutes.delete(
  "/sponsorships/:sponsorshipId",
  authenticate,
  allowPermissions("deals:delete"),
  checkInput(sponsorshipParamSchema),
  catchErrors(dealController.removeSponsorship),
);

module.exports = { dealRoutes };
