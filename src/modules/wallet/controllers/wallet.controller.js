const { okResponse } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { WalletService } = require("../services/wallet.service");

class WalletController {
  constructor({ walletService = new WalletService() } = {}) {
    this.walletService = walletService;
  }

  getMyWallet = async (req, res) => {
    const actor = getCurrentUser(req);
    const wallet = await this.walletService.getWalletSummary(actor.userId);
    res.json(okResponse(wallet));
  };

  listTransactions = async (req, res) => {
    const transactions = await this.walletService.listAdminTransactions(req.query);
    res.json(okResponse(transactions));
  };
}

module.exports = { WalletController };
