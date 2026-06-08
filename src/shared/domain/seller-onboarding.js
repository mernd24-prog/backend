const { KYC_STATUS } = require("./commerce-constants");

const SELLER_ONBOARDING_STATUS = Object.freeze({
  INITIATED: "initiated",
  IN_PROGRESS: "in_progress",
  UNDER_REVIEW: "under_review",
  READY_FOR_GO_LIVE: "ready_for_go_live",
  REJECTED: "rejected",
});

const SELLER_PROFILE_REQUIRED_FIELDS = Object.freeze([
  "displayName",
  "legalBusinessName",
  "supportEmail",
  "supportPhone",
]);

const SELLER_BANK_REQUIRED_FIELDS = Object.freeze([
  "accountHolderName",
  "accountNumber",
  "ifscCode",
  "bankName",
]);

const DEFAULT_SELLER_CHECKLIST = Object.freeze({
  profileCompleted: false,
  kycSubmitted: false,
  gstVerified: false,
  bankLinked: false,
  firstProductPublished: false,
});

function cleanText(value) {
  return String(value || "").trim();
}

function firstNonEmpty(...values) {
  return values.find((value) => cleanText(value).length > 0) || "";
}

function getNameFromUserProfile(userProfile = {}) {
  return [userProfile?.firstName, userProfile?.lastName].map(cleanText).filter(Boolean).join(" ");
}

function getSellerProfileFieldValue(sellerProfile = {}, field, { user = {}, kyc = null } = {}) {
  const userProfile = user?.profile || {};

  const fallbackMap = {
    displayName: [
      sellerProfile.displayName,
      sellerProfile.storeName,
      sellerProfile.shopName,
      sellerProfile.businessName,
      sellerProfile.primaryContactName,
      getNameFromUserProfile(userProfile),
    ],
    legalBusinessName: [
      sellerProfile.legalBusinessName,
      sellerProfile.businessName,
      sellerProfile.companyName,
      sellerProfile.legalName,
      kyc?.legal_name,
    ],
    supportEmail: [sellerProfile.supportEmail, sellerProfile.email, user?.email],
    supportPhone: [sellerProfile.supportPhone, sellerProfile.phone, user?.phone],
  };

  return firstNonEmpty(...(fallbackMap[field] || [sellerProfile?.[field]]));
}

function getSellerBankFieldValue(bankDetails = {}, field) {
  const details = bankDetails || {};
  const fallbackMap = {
    accountHolderName: [
      details.accountHolderName,
      details.holderName,
      details.accountName,
      details.beneficiaryName,
    ],
    accountNumber: [
      details.accountNumber,
      details.bankAccountNumber,
      details.accountNo,
      details.bankAccountNo,
    ],
    ifscCode: [details.ifscCode, details.ifsc, details.ifsc_code],
    bankName: [details.bankName, details.bank],
  };

  return firstNonEmpty(...(fallbackMap[field] || [details?.[field]]));
}

function getMissingSellerProfileFields(sellerProfile = {}, context = {}) {
  return SELLER_PROFILE_REQUIRED_FIELDS.filter(
    (field) => !getSellerProfileFieldValue(sellerProfile, field, context),
  );
}

function getMissingSellerBankFields(bankDetails = {}) {
  return SELLER_BANK_REQUIRED_FIELDS.filter((field) => !getSellerBankFieldValue(bankDetails, field));
}

function hasCompleteSellerProfile(sellerProfile = {}, context = {}) {
  return getMissingSellerProfileFields(sellerProfile, context).length === 0;
}

function hasCompleteSellerBankDetails(bankDetails = {}) {
  return getMissingSellerBankFields(bankDetails).length === 0;
}

function hasStartedOnboarding(checklist = {}) {
  return Object.values(checklist).some((value) => value === true);
}

function makeSellerOnboardingChecklist({
  sellerProfile = {},
  user = {},
  kyc = null,
  existingChecklist = null,
} = {}) {
  const profile = sellerProfile || {};
  const storedChecklist = existingChecklist || profile.onboardingChecklist || {};
  const storedKycStatus = profile.kycStatus || profile.verificationStatus;

  return {
    ...DEFAULT_SELLER_CHECKLIST,
    profileCompleted: hasCompleteSellerProfile(profile, { user, kyc }),
    kycSubmitted: Boolean(kyc) || Boolean(storedKycStatus),
    gstVerified: kyc?.verification_status === KYC_STATUS.VERIFIED || storedKycStatus === KYC_STATUS.VERIFIED,
    bankLinked:
      profile.bankVerificationStatus !== "rejected" &&
      hasCompleteSellerBankDetails(profile.bankDetails),
    firstProductPublished: storedChecklist.firstProductPublished === true,
  };
}

function makeSellerOnboardingRequirements({ sellerProfile = {}, user = {}, kyc = null } = {}) {
  const missingProfileFields = getMissingSellerProfileFields(sellerProfile, { user, kyc });
  const missingBankFields = getMissingSellerBankFields(sellerProfile?.bankDetails || {});

  return {
    profile: {
      requiredFields: SELLER_PROFILE_REQUIRED_FIELDS,
      missingFields: missingProfileFields,
      completed: missingProfileFields.length === 0,
    },
    bankDetails: {
      requiredFields: SELLER_BANK_REQUIRED_FIELDS,
      missingFields: missingBankFields,
      completed: missingBankFields.length === 0,
    },
  };
}

function getSellerKycStatus(kyc, checklist = {}, sellerProfile = {}) {
  if (sellerProfile?.kycStatus || sellerProfile?.verificationStatus) {
    return sellerProfile.kycStatus || sellerProfile.verificationStatus;
  }

  if (kyc?.verification_status) {
    return kyc.verification_status;
  }

  return checklist.kycSubmitted === true ? KYC_STATUS.SUBMITTED : KYC_STATUS.DRAFT;
}

function getSellerOnboardingStatus(
  checklist = {},
  kycStatus = KYC_STATUS.DRAFT,
  currentStatus = SELLER_ONBOARDING_STATUS.INITIATED,
) {
  if (kycStatus === KYC_STATUS.REJECTED) {
    return SELLER_ONBOARDING_STATUS.REJECTED;
  }

  const baseComplete =
    checklist.profileCompleted === true &&
    checklist.kycSubmitted === true &&
    checklist.bankLinked === true;

  if (baseComplete && kycStatus === KYC_STATUS.VERIFIED) {
    return SELLER_ONBOARDING_STATUS.READY_FOR_GO_LIVE;
  }

  if (baseComplete && [KYC_STATUS.SUBMITTED, KYC_STATUS.UNDER_REVIEW].includes(kycStatus)) {
    return SELLER_ONBOARDING_STATUS.UNDER_REVIEW;
  }

  if (hasStartedOnboarding(checklist) || currentStatus !== SELLER_ONBOARDING_STATUS.INITIATED) {
    return SELLER_ONBOARDING_STATUS.IN_PROGRESS;
  }

  return SELLER_ONBOARDING_STATUS.INITIATED;
}

function makeSellerOnboardingState({ sellerProfile = {}, user = {}, kyc = null } = {}) {
  const checklist = makeSellerOnboardingChecklist({ sellerProfile, user, kyc });
  const kycStatus = getSellerKycStatus(kyc, checklist, sellerProfile);
  const onboardingStatus = getSellerOnboardingStatus(
    checklist,
    kycStatus,
    sellerProfile?.onboardingStatus,
  );

  return {
    checklist,
    kycStatus,
    onboardingStatus,
    requirements: makeSellerOnboardingRequirements({ sellerProfile, user, kyc }),
  };
}

module.exports = {
  SELLER_ONBOARDING_STATUS,
  DEFAULT_SELLER_CHECKLIST,
  makeSellerOnboardingChecklist,
  makeSellerOnboardingRequirements,
  makeSellerOnboardingState,
  getSellerKycStatus,
  hasCompleteSellerBankDetails,
  hasCompleteSellerProfile,
  getSellerOnboardingStatus,
};
