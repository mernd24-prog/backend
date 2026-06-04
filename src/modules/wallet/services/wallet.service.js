const { AppError } = require("../../../shared/errors/app-error");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { WalletRepository } = require("../repositories/wallet.repository");
const { UserModel } = require("../../user/models/user.model");

class WalletService {
  constructor({ walletRepository = new WalletRepository() } = {}) {
    this.walletRepository = walletRepository;
  }

  async ensureWallet(userId) {
    return this.walletRepository.ensureWallet(userId);
  }

  async getWalletSummary(userId) {
    const wallet = await this.walletRepository.ensureWallet(userId);
    const transactions = await this.walletRepository.listTransactions(userId);
    return { wallet, transactions };
  }

  async credit(userId, amount, meta) {
    await this.walletRepository.creditWallet(userId, amount, meta);
    return this.walletRepository.findWalletByUserId(userId);
  }

  async hold(userId, amount, referenceId, metadata = {}) {
    if (!amount || amount <= 0) {
      return null;
    }

    try {
      await this.walletRepository.holdWalletAmount(userId, amount, referenceId, metadata);
      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.WALLET_RESERVED_V1,
          { userId, amount, referenceId },
          { source: "wallet-module", aggregateId: userId },
        ),
      );
    } catch (error) {
      throw new AppError(error.message || "Unable to reserve wallet amount", 409);
    }
  }

  async capture(userId, referenceId) {
    const transaction = await this.walletRepository.captureHeldAmount(userId, referenceId);
    if (transaction) {
      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.WALLET_CAPTURED_V1,
          { userId, amount: Number(transaction.amount), referenceId },
          { source: "wallet-module", aggregateId: userId },
        ),
      );
    }
    return transaction;
  }

  async release(userId, referenceId) {
    const transaction = await this.walletRepository.releaseHeldAmount(userId, referenceId);
    if (transaction) {
      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.WALLET_RELEASED_V1,
          { userId, amount: Number(transaction.amount), referenceId },
          { source: "wallet-module", aggregateId: userId },
        ),
      );
    }
    return transaction;
  }

  async listAdminTransactions(filters = {}) {
    const result = await this.walletRepository.listAllTransactions(filters);
    const userIds = Array.from(new Set(
      (result.items || [])
        .map((item) => String(item.user_id || ""))
        .filter((id) => /^[a-f\d]{24}$/i.test(id)),
    ));
    const users = userIds.length && UserModel.db.readyState === 1
      ? await UserModel.find({ _id: { $in: userIds } })
        .select("email full_name profile sellerProfile")
        .lean()
      : [];
    const userMap = new Map(users.map((user) => [String(user._id), user]));
    return {
      ...result,
      items: result.items.map((item) => {
        const user = userMap.get(String(item.user_id));
        const profileName = [
          user?.profile?.firstName,
          user?.profile?.lastName,
        ].filter(Boolean).join(" ");
        const userLabel = user?.full_name ||
          user?.sellerProfile?.displayName ||
          user?.sellerProfile?.legalBusinessName ||
          profileName ||
          user?.email ||
          item.user_id;
        return {
          ...item,
          metadata: this.parseMetadata(item.metadata),
          user: user ? {
            id: String(user._id),
            email: user.email || "",
            name: userLabel,
          } : null,
          userLabel,
        };
      }),
    };
  }

  parseMetadata(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
}

module.exports = { WalletService };
