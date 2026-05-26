const { UserRepository } = require("../../user/repositories/user.repository");
const { postgresPool } = require("../../../infrastructure/postgres/postgres-client");
const {
  SESSION_INVALIDATION_REASONS,
  makeSessionInvalidationUpdate,
  mergeMongoUpdates,
} = require("../../../shared/auth/session-state");

class AuthRepository {
  constructor({ userRepository = new UserRepository() } = {}) {
    this.userRepository = userRepository;
  }

  async findUserByEmail(email) {
    return this.userRepository.findByEmail(email);
  }

  async createUser(payload) {
    return this.userRepository.create(payload);
  }

  async findUserById(userId) {
    return this.userRepository.findById(userId);
  }

  async findUserWithPasswordById(userId) {
    const { UserModel } = require("../../user/models/user.model");
    return UserModel.findById(userId);
  }

  async findUserByProvider(provider, providerUserId) {
    return this.userRepository.findByProvider(provider, providerUserId);
  }

  async updateRefreshSessions(userId, refreshSessions) {
    return this.userRepository.updateById(userId, { $set: { refreshSessions } });
  }

  async updateLastLogin(userId, lastLoginAt) {
    return this.userRepository.updateById(userId, { $set: { lastLoginAt } });
  }

  async linkSocialProvider(userId, providerPayload) {
    return this.userRepository.updateById(userId, {
      $set: {
        emailVerified: providerPayload.emailVerified,
        "profile.avatarUrl": providerPayload.avatarUrl || undefined,
      },
      $addToSet: {
        authProviders: {
          provider: providerPayload.provider,
          providerUserId: providerPayload.providerUserId,
        },
      },
    });
  }

  async updatePassword(userId, passwordHash) {
    return this.userRepository.updateById(
      userId,
      mergeMongoUpdates(
        {
          $set: {
            passwordHash,
            passwordChangedAt: new Date(),
            refreshSessions: [],
          },
        },
        makeSessionInvalidationUpdate(SESSION_INVALIDATION_REASONS.PASSWORD_CHANGED),
      ),
    );
  }

  async findSellerKycBySellerId(sellerId) {
    const { rows } = await postgresPool.query(
      `SELECT
         verification_status,
         rejection_reason,
         submitted_at,
         reviewed_at,
         legal_name,
         business_type,
         pan_number,
         gst_number,
         aadhaar_number,
         documents
       FROM seller_kyc
       WHERE seller_id = $1
       LIMIT 1`,
      [sellerId],
    );
    return rows[0] || null;
  }
}

module.exports = { AuthRepository };
