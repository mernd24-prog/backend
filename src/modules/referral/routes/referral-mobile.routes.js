const express = require("express");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { checkInput } = require("../../../shared/middleware/check-input");
const {
  ReferralMobileController,
} = require("../controllers/referral-mobile.controller");
const {
  dashboardQuerySchema,
  codesQuerySchema,
  ordersQuerySchema,
  ledgerQuerySchema,
  withdrawalsQuerySchema,
  createWithdrawalSchema,
  networkQuerySchema,
  bonusProgressQuerySchema,
  emptySchema,
} = require("../validation/referral-mobile.validation");

const referralMobileRoutes = express.Router();
const referralMobileController = new ReferralMobileController();

referralMobileRoutes.use(authenticate);

referralMobileRoutes.get(
  "/session",
  checkInput(emptySchema),
  catchErrors(referralMobileController.session),
);
referralMobileRoutes.get(
  "/dashboard/summary",
  checkInput(dashboardQuerySchema),
  catchErrors(referralMobileController.dashboardSummary),
);
referralMobileRoutes.get(
  "/codes",
  checkInput(codesQuerySchema),
  catchErrors(referralMobileController.myCodes),
);
referralMobileRoutes.get(
  "/orders",
  checkInput(ordersQuerySchema),
  catchErrors(referralMobileController.referralOrders),
);
referralMobileRoutes.get(
  "/ledger",
  checkInput(ledgerQuerySchema),
  catchErrors(referralMobileController.coinLedger),
);
referralMobileRoutes.get(
  "/wallet",
  checkInput(emptySchema),
  catchErrors(referralMobileController.wallet),
);
referralMobileRoutes.get(
  "/withdrawals",
  checkInput(withdrawalsQuerySchema),
  catchErrors(referralMobileController.withdrawals),
);
referralMobileRoutes.post(
  "/withdrawals",
  checkInput(createWithdrawalSchema),
  catchErrors(referralMobileController.createWithdrawal),
);
referralMobileRoutes.get(
  "/network",
  checkInput(networkQuerySchema),
  catchErrors(referralMobileController.network),
);
referralMobileRoutes.get(
  "/profile",
  checkInput(emptySchema),
  catchErrors(referralMobileController.profile),
);
referralMobileRoutes.get(
  "/bonus-progress",
  checkInput(bonusProgressQuerySchema),
  catchErrors(referralMobileController.bonusProgress),
);

module.exports = { referralMobileRoutes };
