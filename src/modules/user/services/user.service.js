const { AppError } = require("../../../shared/errors/app-error");
const { UserRepository } = require("../repositories/user.repository");
const { UserKycRepository } = require("../repositories/user-kyc.repository");
const { KYC_STATUS } = require("../../../shared/domain/commerce-constants");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { ROLES } = require("../../../shared/constants/roles");
const { makeSellerOnboardingState } = require("../../../shared/domain/seller-onboarding");
const { SellerRepository } = require("../../seller/repositories/seller.repository");
const { sellerOrganizationService } = require("../../seller/services/seller-organization.service");
const {
  storageService: defaultStorageService,
} = require("../../../shared/storage/storage-service");

class UserService {
  constructor({
    userRepository = new UserRepository(),
    userKycRepository = new UserKycRepository(),
    sellerRepository = new SellerRepository(),
    storageService = defaultStorageService,
  } = {}) {
    this.userRepository = userRepository;
    this.userKycRepository = userKycRepository;
    this.sellerRepository = sellerRepository;
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
    const [organizations, kyc] = await Promise.all([
      sellerOrganizationService.organizationRepository.listBySeller(sellerId),
      this.sellerRepository.findKycBySellerId(sellerId),
    ]);
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
      kyc,
    });

    return {
      ...userObject,
      kyc: kyc
        ? {
            verificationStatus: kyc.verification_status,
            legalName: kyc.legal_name,
            businessType: kyc.business_type,
            panNumber: kyc.pan_number,
            gstNumber: kyc.gst_number,
            aadhaarNumber: kyc.aadhaar_number,
            panVerified: kyc.pan_verified === true,
            panVerifiedAt: kyc.pan_verified_at || null,
            aadhaarVerified: kyc.aadhaar_verified === true,
            aadhaarReferenceId: kyc.aadhaar_reference_id || null,
            aadhaarVerifiedAt: kyc.aadhaar_verified_at || null,
            rejectionReason: kyc.rejection_reason || null,
            submittedAt: kyc.submitted_at || null,
            reviewedAt: kyc.reviewed_at || null,
            documents: sellerOrganizationService.organizationRepository.parseJson(
              kyc.documents,
              {},
            ),
          }
        : null,
      sellerProfile: {
        ...organizationBackedProfile,
        panVerified: kyc?.pan_verified === true,
        panVerifiedAt: kyc?.pan_verified_at || null,
        aadhaarVerified: kyc?.aadhaar_verified === true,
        aadhaarReferenceId: kyc?.aadhaar_reference_id || null,
        aadhaarVerifiedAt: kyc?.aadhaar_verified_at || null,
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

    const {
      description: nestedDescription,
      ...nestedProfilePayload
    } = payload.profile || {};
    const profilePayload = {
      ...nestedProfilePayload,
      ...(payload.firstName !== undefined ? { firstName: payload.firstName } : {}),
      ...(payload.lastName !== undefined ? { lastName: payload.lastName } : {}),
      ...(payload.avatarUrl !== undefined ? { avatarUrl: payload.avatarUrl } : {}),
    };
    const hasDescription = Object.prototype.hasOwnProperty.call(payload, "description") ||
      Object.prototype.hasOwnProperty.call(payload.profile || {}, "description");
    const description = Object.prototype.hasOwnProperty.call(payload, "description")
      ? payload.description
      : nestedDescription;
    const isSeller = [
      ROLES.SELLER,
      ROLES.SELLER_ADMIN,
      ROLES.SELLER_SUB_ADMIN,
    ].includes(existingUser.role);
    const existingProfile = existingUser.profile?.toObject?.() || existingUser.profile || {};
    const existingSellerProfile =
      existingUser.sellerProfile?.toObject?.() || existingUser.sellerProfile || {};
    const setPayload = {};

    if (Object.keys(profilePayload).length) {
      setPayload.profile = {
        ...existingProfile,
        ...profilePayload,
      };
    }

    if (isSeller && hasDescription) {
      setPayload.sellerProfile = {
        ...existingSellerProfile,
        description,
      };
    }

    if (!Object.keys(setPayload).length) {
      return this.withSellerProfileState(existingUser);
    }

    const updatedUser = await this.userRepository.updateById(userId, {
      $set: setPayload,
    });

    if (!updatedUser) {
      throw new AppError("User not found", 404);
    }

    if (isSeller && hasDescription) {
      const organization = await sellerOrganizationService.getDefaultOrOnlyOrganization(userId);
      if (organization?.id) {
        await sellerOrganizationService.organizationRepository.update(organization.id, {
          description,
          updatedBy: userId,
        });
      }
    }

    return this.withSellerProfileState(updatedUser);
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
