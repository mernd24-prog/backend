#!/usr/bin/env node

/**
 * Creates or refreshes one complete development parent-influencer account.
 *
 * Usage:
 *   npm run db:create-complete-influencer
 *   npm run db:create-complete-influencer -- --scenario=verified
 *
 * Scenarios: pending, submitted (default), verified, rejected.
 * The identity and login values intentionally live in this development script.
 */

const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { hashText } = require("../../src/shared/tools/hash");
const { ReferralService } = require("../../src/modules/referral/services/referral.service");
const {
  InfluencerAccountModel,
  InfluencerProfileModel,
  InfluencerCodeModel,
  InfluencerWalletModel,
} = require("../../src/modules/referral/models/referral.model");

const args = Object.fromEntries(
  process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => {
    const [key, ...value] = arg.slice(2).split("=");
    return [key, value.length ? value.join("=") : true];
  }),
);

// Development test identity. Change these values here when another fixture is needed.
const config = {
  scenario: String(args.scenario || "submitted").toLowerCase(),
  email: "complete.influencer@example.com",
  password: "Influencer@12345",
  firstName: "Aarav",
  lastName: "Mehta",
  phone: "9867543210",
  code: "AARAVDEALS",
  panNumber: "SZKPS5212P",
  aadhaarNumber: "785324677404",
};

const SCENARIOS = {
  pending: {
    profileStatus: "pending", onboardingStatus: "pending", kycStatus: "pending",
    payoutProfileStatus: "pending", accountStatus: "active", verified: false,
  },
  submitted: {
    profileStatus: "active", onboardingStatus: "under_review", kycStatus: "submitted",
    payoutProfileStatus: "submitted", accountStatus: "active", verified: false,
  },
  verified: {
    profileStatus: "active", onboardingStatus: "approved", kycStatus: "verified",
    payoutProfileStatus: "verified", accountStatus: "active", verified: true,
  },
  rejected: {
    profileStatus: "rejected", onboardingStatus: "rejected", kycStatus: "rejected",
    payoutProfileStatus: "rejected", accountStatus: "active", verified: false,
  },
};

const completeDetails = {
  dateOfBirth: "1994-03-21",
  gender: "male",
  address: {
    line1: "402 Creator Residency, Bandra West",
    line2: "Near Linking Road",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    postalCode: "400050",
  },
  documents: {
    panCardUrl: "https://cdn.example.com/test/influencer/pan-card.pdf",
    aadhaarCardUrl: "https://cdn.example.com/test/influencer/aadhaar-card.pdf",
    cancelledChequeUrl: "https://cdn.example.com/test/influencer/cancelled-cheque.pdf",
  },
  payout: {
    method: "bank",
    accountHolderName: "Aarav Mehta",
    bankName: "HDFC Bank",
    accountNumber: "123456789012",
    ifscCode: "HDFC0001234",
    upiId: "aarav.creator@upi",
  },
};

function validate() {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error("This development seed script cannot run in production");
  }
  if (!SCENARIOS[config.scenario]) {
    throw new Error("scenario must be pending, submitted, verified, or rejected");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) throw new Error("Invalid email");
  if (!/^\+?[0-9]{7,15}$/.test(config.phone)) throw new Error("Invalid phone");
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(config.panNumber)) throw new Error("Invalid PAN format");
  if (!/^[0-9]{12}$/.test(config.aadhaarNumber)) throw new Error("Aadhaar must contain 12 digits");
  if (config.password.length < 8) throw new Error("Password must have at least 8 characters");
}

async function ensureProfileAndAccount(state) {
  const existingAccount = await InfluencerAccountModel.findOne({ email: config.email });
  let account = existingAccount;
  let profile = existingAccount
    ? await InfluencerProfileModel.findOne({ accountId: String(existingAccount._id) })
    : null;

  if (!account) {
    const service = new ReferralService();
    const created = await service.createParentInfluencer(
      {
        email: config.email,
        password: config.password,
        firstName: config.firstName,
        lastName: config.lastName,
        phone: config.phone,
        code: config.code,
        canCreateChildren: true,
        status: state.profileStatus,
        onboardingStatus: state.onboardingStatus,
        kycStatus: state.kycStatus,
        payoutProfileStatus: state.payoutProfileStatus,
        metadata: { source: "create-complete-influencer-script" },
      },
      { userId: null, role: "system" },
    );
    profile = await InfluencerProfileModel.findById(created.id || created._id);
    account = await InfluencerAccountModel.findById(profile.accountId);
  } else if (!profile) {
    profile = await InfluencerProfileModel.create({
      accountId: String(account._id),
      influencerType: "parent",
      level: 1,
      path: [],
      status: state.profileStatus,
      canCreateChildren: true,
      onboardingStatus: state.onboardingStatus,
      kycStatus: state.kycStatus,
      payoutProfileStatus: state.payoutProfileStatus,
      metadata: { source: "create-complete-influencer-script" },
    });
    profile.rootInfluencerId = String(profile._id);
    profile.path = [String(profile._id)];
    await profile.save();
  }

  await InfluencerAccountModel.findByIdAndUpdate(account._id, {
    $set: {
      phone: config.phone,
      passwordHash: await hashText(config.password),
      profile: {
        firstName: config.firstName,
        lastName: config.lastName,
        avatarUrl: "https://cdn.example.com/test/influencer/avatar.jpg",
      },
      accountStatus: state.accountStatus,
      emailVerified: true,
      metadata: {
        source: "create-complete-influencer-script",
        fixtureScenario: config.scenario,
        communicationPreferences: { email: true, sms: true, push: true },
        socialProfiles: {
          instagram: "https://instagram.com/aarav.creator",
          youtube: "https://youtube.com/@aaravcreator",
          website: "https://creator.example.com",
        },
      },
    },
  });

  const rejectionReason = config.scenario === "rejected"
    ? "Test rejection: KYC document requires correction"
    : null;
  profile = await InfluencerProfileModel.findByIdAndUpdate(
    profile._id,
    {
      $set: {
        influencerType: "parent",
        parentInfluencerId: null,
        rootInfluencerId: String(profile._id),
        originalParentInfluencerId: null,
        level: 1,
        path: [String(profile._id)],
        status: state.profileStatus,
        canCreateChildren: true,
        onboardingStatus: state.onboardingStatus,
        kycStatus: state.kycStatus,
        payoutProfileStatus: state.payoutProfileStatus,
        yearlySalesAmount: 0,
        metadata: {
          source: "create-complete-influencer-script",
          fixtureScenario: config.scenario,
          identity: {
            panNumber: config.panNumber,
            aadhaarNumber: config.aadhaarNumber,
            panVerified: state.verified,
            aadhaarVerified: state.verified,
            verifiedAt: state.verified ? new Date().toISOString() : null,
          },
          details: completeDetails,
          review: {
            rejectionReason,
            submittedAt: config.scenario === "pending" ? null : new Date().toISOString(),
            reviewedAt: state.verified || rejectionReason ? new Date().toISOString() : null,
          },
        },
      },
    },
    { new: true, runValidators: true },
  );
  return { account, profile };
}

async function ensureCode(profile, account) {
  const influencerId = String(profile._id);
  const conflicting = await InfluencerCodeModel.findOne({ code: config.code });
  if (conflicting && String(conflicting.influencerId) !== influencerId) {
    throw new Error(`Referral code ${config.code} belongs to another influencer`);
  }
  return InfluencerCodeModel.findOneAndUpdate(
    { influencerId },
    {
      $set: {
        accountId: String(account._id),
        userId: null,
        code: config.code,
        status: profile.status === "active" ? "active" : "suspended",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: null,
        usageLimit: null,
        metadata: { primary: true, source: "create-complete-influencer-script" },
      },
      $setOnInsert: { usageCount: 0, createdBy: null },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

async function ensureWallet(profile) {
  return InfluencerWalletModel.findOneAndUpdate(
    { influencerId: String(profile._id) },
    {
      $setOnInsert: {
        pendingBalance: 0,
        availableBalance: 0,
        reservedBalance: 0,
        paidBalance: 0,
        reversedBalance: 0,
        expiredBalance: 0,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

async function main() {
  validate();
  await connectMongo();
  const state = SCENARIOS[config.scenario];
  const { account, profile } = await ensureProfileAndAccount(state);
  const [code] = await Promise.all([
    ensureCode(profile, account),
    ensureWallet(profile),
  ]);

  console.log("\nComplete influencer account created/updated");
  console.log(`  Account ID:      ${account._id}`);
  console.log(`  Influencer ID:   ${profile._id}`);
  console.log(`  Email:           ${config.email}`);
  console.log(`  Password:        ${config.password}`);
  console.log(`  Type:            parent`);
  console.log(`  Scenario:        ${config.scenario}`);
  console.log(`  Referral code:   ${code.code}`);
  console.log(`  PAN:             ******${config.panNumber.slice(-4)}`);
  console.log(`  Aadhaar:         ********${config.aadhaarNumber.slice(-4)}`);
  console.log("  Includes: identity, contact, address, KYC documents, bank, UPI, social profiles, referral code, hierarchy, child permission, and coin wallet");
}

main()
  .catch((error) => {
    console.error(`\nUnable to create influencer: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });

