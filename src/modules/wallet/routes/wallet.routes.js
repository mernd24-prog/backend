const express = require("express");
const { WalletController } = require("../controllers/wallet.controller");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowActions, allowPermissions } = require("../../../shared/middleware/access");
const { ACTIONS } = require("../../../shared/constants/actions");
const { catchErrors } = require("../../../shared/middleware/catch-errors");

const walletRoutes = express.Router();
const walletController = new WalletController();

walletRoutes.get(
  "/admin/transactions",
  authenticate,
  allowPermissions("wallets:view"),
  catchErrors(walletController.listTransactions),
);

walletRoutes.get(
  "/me",
  authenticate,
  allowActions(ACTIONS.WALLET_SELF),
  catchErrors(walletController.getMyWallet),
);

module.exports = { walletRoutes };
