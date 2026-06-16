const { mongoose } = require("../../../infrastructure/mongo/mongo-client");
const { ROLES } = require("../../../shared/constants/roles");

const sellerAddressSchema = new mongoose.Schema(
  {
    line1: String,
    line2: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,
  },
  { _id: false },
);

const sellerBankDetailsSchema = new mongoose.Schema(
  {
    accountHolderName: String,
    accountNumber: String,
    ifscCode: String,
    bankName: String,
    branchName: String,
  },
  { _id: false },
);

const sellerProfileSchema = new mongoose.Schema(
  {
    businessName: String,
    displayName: String,
    legalBusinessName: String,
    description: String,
    supportEmail: String,
    supportPhone: String,
    businessType: String,
    registrationNumber: String,
    gstNumber: String,
    panNumber: String,
    profileCompleted: { type: Boolean, default: false },
    aadhaarNumber: String,
    dateOfBirth: Date,
    businessWebsite: String,
    primaryContactName: String,
    bankDetails: sellerBankDetailsSchema,
    businessAddress: sellerAddressSchema,
    pickupAddress: sellerAddressSchema,
    returnAddress: sellerAddressSchema,
    kycStatus: {
      type: String,
      enum: ["not_submitted", "submitted", "under_review", "verified", "rejected"],
      default: "not_submitted",
    },
    bankVerificationStatus: {
      type: String,
      enum: ["not_submitted", "submitted", "verified", "rejected"],
      default: "not_submitted",
    },
    goLiveStatus: {
      type: String,
      enum: ["pending", "ready", "live", "blocked"],
      default: "pending",
    },
    rejectionReason: String,
    bankRejectionReason: String,
    verifiedBy: String,
    verifiedAt: Date,
    goLiveApprovedBy: String,
    goLiveApprovedAt: Date,
    onboardingStatus: {
      type: String,
      default: "initiated",
    },
    onboardingChecklist: {
      profileCompleted: { type: Boolean, default: false },
      kycSubmitted: { type: Boolean, default: false },
      gstVerified: { type: Boolean, default: false },
      bankLinked: { type: Boolean, default: false },
      firstProductPublished: { type: Boolean, default: false },
    },
  },
  { _id: false },
);

const userAddressSchema = new mongoose.Schema(
  {
    label: { type: String, default: "home" },
    fullName: String,
    phone: String,
    line1: String,
    line2: String,
    city: String,
    state: String,
    country: { type: String, default: "India" },
    postalCode: String,
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const influencerProfileSnapshotSchema = new mongoose.Schema(
  {
    influencerId: String,
    influencerType: {
      type: String,
      enum: ["parent", "child"],
    },
    parentInfluencerId: String,
    rootInfluencerId: String,
    originalParentInfluencerId: String,
    level: Number,
    path: [String],
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "rejected"],
    },
    canCreateChildren: Boolean,
    promotedAt: Date,
    onboardingStatus: String,
    kycStatus: String,
    payoutProfileStatus: String,
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, index: true },
    passwordHash: { type: String },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.BUYER,
      index: true,
    },
    profile: {
      firstName: String,
      lastName: String,
      avatarUrl: String,
    },
    addresses: [userAddressSchema],
    sellerProfile: sellerProfileSchema,
    influencerProfile: influencerProfileSnapshotSchema,
    sellerSettings: {
      autoAcceptOrders: { type: Boolean, default: false },
      handlingTimeHours: { type: Number, default: 24 },
      returnWindowDays: { type: Number, default: 7 },
      ndrResponseHours: { type: Number, default: 24 },
      shippingModes: [{ type: String }],
      payoutSchedule: {
        type: String,
        default: "weekly",
      },
    },
    referralCode: { type: String, unique: true, sparse: true, index: true },
    referredByUserId: { type: String, index: true },
    emailVerified: { type: Boolean, default: false },
    accountStatus: { type: String, default: "active", index: true },
    tokenVersion: { type: Number, default: 0 },
    sessionVersion: { type: Number, default: 0 },
    permissionVersion: { type: Number, default: 0 },
    passwordChangedAt: Date,
    forceLogoutAt: Date,
    deletedAt: Date,
    blockedAt: Date,
    deactivatedAt: Date,
    sessionInvalidationReason: String,
    allowedModules: [{ type: String }],
    createdBy: { type: String, index: true },
    createdByRole: { type: String, enum: Object.values(ROLES) },
    parentAdminId: { type: String, index: true },
    parentSellerId: { type: String, index: true },
    hierarchyLevel: { type: Number, default: 0, index: true },
    ownerAdminId: { type: String, index: true },
    ownerSellerId: { type: String, index: true },
    authProviders: [
      {
        provider: { type: String, required: true },
        providerUserId: { type: String, required: true },
        linkedAt: { type: Date, default: Date.now },
      },
    ],
    refreshSessions: [
      {
        sessionId: { type: String, required: true },
        tokenHash: { type: String, required: true },
        provider: { type: String, default: "password" },
        ipAddress: String,
        userAgent: String,
        platform: String,
        createdAt: { type: Date, default: Date.now },
        lastUsedAt: { type: Date, default: Date.now },
      },
    ],
    lastLoginAt: Date,
  },
  { timestamps: true },
);

userSchema.index({ "authProviders.provider": 1, "authProviders.providerUserId": 1 });

const UserModel = mongoose.model("User", userSchema);

module.exports = { UserModel };
