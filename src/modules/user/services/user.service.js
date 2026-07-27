const { AppError } = require("../../../shared/errors/app-error");
const { UserRepository } = require("../repositories/user.repository");
const { UserKycRepository } = require("../repositories/user-kyc.repository");
const { KYC_STATUS } = require("../../../shared/domain/commerce-constants");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { ROLES } = require("../../../shared/constants/roles");
const { makeSellerOnboardingState } = require("../../../shared/domain/seller-onboarding");
const { sellerOrganizationService } = require("../../seller/services/seller-organization.service");
const {
  storageService: defaultStorageService,
} = require("../../../shared/storage/storage-service");

class UserService {
  constructor({
    userRepository = new UserRepository(),
    userKycRepository = new UserKycRepository(),
    storageService = defaultStorageService,
  } = {}) {
    this.userRepository = userRepository;
    this.userKycRepository = userKycRepository;
    this.storageService = storageService;
  }

  async createUser(payload) {
    const existingUser = await this.userRepository.findByEmail(payload.email);
    if (existingUser) {
      throw new AppError("User already exists", 409);
    }

    return this.userRepository.create(payload);
  }

  async getProfile(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    return this.withSellerProfileState(user);
  }

  toPlainObject(value = {}) {
    if (!value) return {};
    if (typeof value.toObject === "function") {
      return value.toObject({ depopulate: true });
    }
    return { ...value };
  }

  async withSellerProfileState(user) {
    if (user?.role !== ROLES.SELLER) {
      return user;
    }

    const userObject = this.toPlainObject(user);
    const sellerId = String(userObject._id || userObject.id || "");
    const organizations = await sellerOrganizationService.organizationRepository.listBySeller(sellerId);
    const organizationSummary = sellerOrganizationService.buildOrganizationCollectionSummary(organizations);
    const selectedOrganizationId =
      organizationSummary.selectedOrganizationId ||
      organizationSummary.onboardingTargetOrganizationId;
    const organization =
      organizations.find((item) => String(item.id) === String(selectedOrganizationId)) ||
      organizations.find((item) => item.isDefault) ||
      organizations[0] ||
      null;
    const organizationBackedProfile = sellerOrganizationService.buildSellerProfileMirror(
      userObject.sellerProfile || {},
      organization,
    );
    const onboardingState = makeSellerOnboardingState({
      sellerProfile: organizationBackedProfile,
      user: userObject,
      kyc: null,
    });

    return {
      ...userObject,
      sellerProfile: {
        ...organizationBackedProfile,
        onboardingChecklist: onboardingState.checklist,
        onboardingStatus: onboardingState.onboardingStatus,
        organizationSummary,
      },
    };
  }

  async updateProfile(userId, payload) {
    const existingUser = await this.userRepository.findById(userId);
    if (!existingUser) {
      throw new AppError("User not found", 404);
    }

    const updatedUser = await this.userRepository.updateById(userId, {
      $set: {
        profile: {
          ...(existingUser.profile?.toObject?.() || existingUser.profile || {}),
          ...payload.profile,
        },
      },
    });

    if (!updatedUser) {
      throw new AppError("User not found", 404);
    }

    return updatedUser;
  }

  async addAddress(userId, payload) {
    if (payload.isDefault) {
      await this.userRepository.updateById(userId, { $set: { "addresses.$[].isDefault": false } });
    }

    const updatedUser = await this.userRepository.updateById(
      userId,
      { $push: { addresses: payload } },
    );
    if (!updatedUser) {
      throw new AppError("User not found", 404);
    }
    return updatedUser.addresses;
  }

  async updateAddress(userId, addressId, payload) {
    if (payload.isDefault) {
      await this.userRepository.updateById(userId, { $set: { "addresses.$[].isDefault": false } });
    }

    const setPayload = Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [`addresses.$.${key}`, value]),
    );
    const updatedUser = await this.userRepository.updateOne(
      { _id: userId, "addresses._id": addressId },
      { $set: setPayload },
    );
    if (!updatedUser) {
      throw new AppError("Address not found", 404);
    }
    return updatedUser.addresses;
  }

  async deleteAddress(userId, addressId) {
    const updatedUser = await this.userRepository.updateById(userId, {
      $pull: { addresses: { _id: addressId } },
    });
    if (!updatedUser) {
      throw new AppError("User not found", 404);
    }
    return updatedUser.addresses;
  }

  async submitKyc(userId, payload) {
    const documents = await this.uploadKycDocuments(userId, payload.documents || {});
    const kyc = await this.userKycRepository.upsert({
      ...payload,
      documents,
      userId,
      verificationStatus: KYC_STATUS.SUBMITTED,
    });

    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.USER_KYC_SUBMITTED_V1,
        {
          userId,
          verificationStatus: kyc.verification_status,
          legalName: kyc.legal_name,
        },
        {
          source: "user-module",
          aggregateId: userId,
        },
      ),
    );

    return kyc;
  }

  async uploadKycDocuments(userId, documents = {}) {
    return this.storageService.uploadKycDocuments(documents, {
      ownerType: "users",
      ownerId: userId,
    });
  }

  async reviewKyc(userId, payload, actor) {
    const kyc = await this.userKycRepository.review(userId, {
      ...payload,
      reviewedBy: actor.userId,
    });

    if (!kyc) {
      throw new AppError("User KYC record not found", 404);
    }

    await eventPublisher.publish(
      makeEvent(
        DOMAIN_EVENTS.KYC_STATUS_UPDATED_V1,
        {
          userId,
          verificationStatus: kyc.verification_status,
          rejectionReason: kyc.rejection_reason,
        },
        {
          source: "user-module",
          aggregateId: userId,
        },
      ),
    );

    return kyc;
  }
}

module.exports = { UserService };
