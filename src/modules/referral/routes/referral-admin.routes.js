const express = require("express");
const {
  ReferralAdminController,
} = require("../controllers/referral-admin.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  listInfluencersSchema,
  createParentInfluencerSchema,
  createChildInfluencerSchema,
  updateInfluencerStatusSchema,
  promoteInfluencerSchema,
  listCodesSchema,
  createCodeSchema,
  updateCodeSchema,
  listOrdersSchema,
  listCommissionsSchema,
  listPayoutsSchema,
  payoutActionSchema,
  listRulesSchema,
  upsertRulesSchema,
  listBonusRulesSchema,
  createBonusRuleSchema,
  updateBonusRuleSchema,
  listBonusAchievementsSchema,
  bonusProgressSchema,
  evaluateBonusRulesSchema,
  emptySchema,
  listFraudReviewsSchema,
} = require("../validation/referral-admin.validation");

const referralAdminRoutes = express.Router();
const referralAdminController = new ReferralAdminController();

referralAdminRoutes.get(
  "/influencers",
  checkInput(listInfluencersSchema),
  catchErrors(referralAdminController.listInfluencers),
);
referralAdminRoutes.post(
  "/influencers/parents",
  checkInput(createParentInfluencerSchema),
  catchErrors(referralAdminController.createParentInfluencer),
);
referralAdminRoutes.post(
  "/influencers/:parentId/children",
  checkInput(createChildInfluencerSchema),
  catchErrors(referralAdminController.createChildInfluencer),
);
referralAdminRoutes.patch(
  "/influencers/:influencerId/status",
  checkInput(updateInfluencerStatusSchema),
  catchErrors(referralAdminController.updateInfluencerStatus),
);
referralAdminRoutes.patch(
  "/influencers/:influencerId/promote",
  checkInput(promoteInfluencerSchema),
  catchErrors(referralAdminController.promoteInfluencer),
);

referralAdminRoutes.get(
  "/codes",
  checkInput(listCodesSchema),
  catchErrors(referralAdminController.listCodes),
);
referralAdminRoutes.post(
  "/codes",
  checkInput(createCodeSchema),
  catchErrors(referralAdminController.createCode),
);
referralAdminRoutes.patch(
  "/codes/:codeId",
  checkInput(updateCodeSchema),
  catchErrors(referralAdminController.updateCode),
);

referralAdminRoutes.get(
  "/orders",
  checkInput(listOrdersSchema),
  catchErrors(referralAdminController.listOrders),
);
referralAdminRoutes.get(
  "/commissions",
  checkInput(listCommissionsSchema),
  catchErrors(referralAdminController.listCommissions),
);
referralAdminRoutes.get(
  "/payouts",
  checkInput(listPayoutsSchema),
  catchErrors(referralAdminController.listPayouts),
);
referralAdminRoutes.patch(
  "/payouts/:payoutId/approve",
  checkInput(payoutActionSchema),
  catchErrors(referralAdminController.approvePayout),
);
referralAdminRoutes.patch(
  "/payouts/:payoutId/reject",
  checkInput(payoutActionSchema),
  catchErrors(referralAdminController.rejectPayout),
);
referralAdminRoutes.patch(
  "/payouts/:payoutId/paid",
  checkInput(payoutActionSchema),
  catchErrors(referralAdminController.markPayoutPaid),
);

referralAdminRoutes.get(
  "/rules",
  checkInput(listRulesSchema),
  catchErrors(referralAdminController.getRules),
);
referralAdminRoutes.put(
  "/rules",
  checkInput(upsertRulesSchema),
  catchErrors(referralAdminController.upsertRules),
);

referralAdminRoutes.get(
  "/bonus-rules",
  checkInput(listBonusRulesSchema),
  catchErrors(referralAdminController.listBonusRules),
);
referralAdminRoutes.post(
  "/bonus-rules",
  checkInput(createBonusRuleSchema),
  catchErrors(referralAdminController.createBonusRule),
);
referralAdminRoutes.patch(
  "/bonus-rules/:ruleId",
  checkInput(updateBonusRuleSchema),
  catchErrors(referralAdminController.updateBonusRule),
);
referralAdminRoutes.post(
  "/bonus-rules/evaluate",
  checkInput(evaluateBonusRulesSchema),
  catchErrors(referralAdminController.evaluateBonusRules),
);
referralAdminRoutes.get(
  "/bonus-achievements",
  checkInput(listBonusAchievementsSchema),
  catchErrors(referralAdminController.listBonusAchievements),
);
referralAdminRoutes.get(
  "/reports/bonus-progress",
  checkInput(bonusProgressSchema),
  catchErrors(referralAdminController.bonusProgressReport),
);

referralAdminRoutes.get(
  "/reports/summary",
  checkInput(emptySchema),
  catchErrors(referralAdminController.summaryReport),
);
referralAdminRoutes.get(
  "/reports/hierarchy",
  checkInput(emptySchema),
  catchErrors(referralAdminController.hierarchyReport),
);
referralAdminRoutes.get(
  "/fraud",
  checkInput(listFraudReviewsSchema),
  catchErrors(referralAdminController.listFraudReviews),
);

module.exports = { referralAdminRoutes };
