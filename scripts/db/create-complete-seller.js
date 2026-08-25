#!/usr/bin/env node

/**
 * Creates or refreshes one development seller with every onboarding field.
 *
 * Examples:
 *   npm run db:create-complete-seller
 *   npm run db:create-complete-seller -- --scenario=verified --pan=AAACR5055K
 *
 * Scenarios: draft, submitted (default), verified, rejected.
 * This script is intentionally blocked in production.
 */

const { v4: uuidv4 } = require("uuid");
const { connectMongo, mongoose } = require("../../src/infrastructure/mongo/mongo-client");
const { sequelize } = require("../../src/infrastructure/sequelize/sequelize-client");
const { UserModel } = require("../../src/modules/user/models/user.model");
const { ROLES } = require("../../src/shared/constants/roles");
const { hashText } = require("../../src/shared/tools/hash");

const args = Object.fromEntries(
  process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => {
    const [key, ...value] = arg.slice(2).split("=");
    return [key, value.length ? value.join("=") : true];
  }),
);

const config = {
  scenario: String(args.scenario || "submitted").toLowerCase(),
  email: String(args.email || "complete.seller@example.com").toLowerCase(),
  phone: String(args.phone || "9876543210"),
  password: String(args.password || process.env.SELLER_SEED_PASSWORD || "Seller@12345"),
  gstin: String(args.gstin || "27AAACR5055K1Z7").toUpperCase(),
  pan: String(args.pan || "SZKPS5212P").toUpperCase(),
  aadhaar: String(args.aadhaar || "785324677404"),
  allowTaxIdMismatch: args["allow-tax-id-mismatch"] === true,
};

const SCENARIOS = {
  draft: {
    kycStatus: "not_submitted", bankStatus: "not_submitted", approvalStatus: "draft",
    goLiveStatus: "pending", onboardingStatus: "in_progress", verified: false,
  },
  submitted: {
    kycStatus: "under_review", bankStatus: "submitted", approvalStatus: "pending_review",
    goLiveStatus: "pending", onboardingStatus: "under_review", verified: false,
  },
  verified: {
    kycStatus: "verified", bankStatus: "verified", approvalStatus: "approved",
    goLiveStatus: "live", onboardingStatus: "ready_for_go_live", verified: true,
  },
  rejected: {
    kycStatus: "rejected", bankStatus: "rejected", approvalStatus: "rejected",
    goLiveStatus: "rejected", onboardingStatus: "rejected", verified: false,
  },
};

const documents = {
  panDocumentUrl: "/uploads/test/seller/pan.pdf",
  gstCertificateUrl: "/uploads/test/seller/gst-certificate.pdf",
  aadhaarFrontUrl: "/uploads/test/seller/aadhaar-front.jpg",
  aadhaarBackUrl: "/uploads/test/seller/aadhaar-back.jpg",
  bankProofUrl: "/uploads/test/seller/cancelled-cheque.pdf",
  addressProofUrl: "/uploads/test/seller/address-proof.pdf",
  udyogAadhaarDocumentUrl: "/uploads/test/seller/udyam-certificate.pdf",
};

const bankDetails = {
  accountHolderName: "Riya Sharma",
  accountNumber: "123456789012",
  ifscCode: "HDFC0001234",
  bankName: "HDFC Bank",
  branchName: "Mumbai Central",
};

const billingAddress = {
  line1: "101 Commerce House, Andheri East",
  line2: "Near Metro Station",
  city: "Mumbai",
  state: "Maharashtra",
  country: "India",
  postalCode: "400069",
};

const pickupAddress = {
  line1: "Warehouse 7, MIDC Industrial Area",
  line2: "Gate 2",
  city: "Mumbai",
  state: "Maharashtra",
  country: "India",
  postalCode: "400093",
};

const returnAddress = {
  line1: "Returns Desk, 101 Commerce House",
  line2: "Andheri East",
  city: "Mumbai",
  state: "Maharashtra",
  country: "India",
  postalCode: "400069",
};

function validateInput() {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error("This development seed script cannot run in production");
  }
  if (!SCENARIOS[config.scenario]) throw new Error("scenario must be draft, submitted, verified, or rejected");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) throw new Error("Invalid email");
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(config.pan)) throw new Error("Invalid PAN format");
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(config.gstin)) throw new Error("Invalid GSTIN format");
  if (!/^[0-9]{12}$/.test(config.aadhaar)) throw new Error("Aadhaar must contain 12 digits");
  const gstPan = config.gstin.slice(2, 12);
  if (config.scenario === "verified" && gstPan !== config.pan && !config.allowTaxIdMismatch) {
    throw new Error(`GSTIN contains PAN ${gstPan}, but supplied PAN is ${config.pan}. Use matching IDs or the test-only --allow-tax-id-mismatch flag.`);
  }
  if (config.password.length < 8) throw new Error("Password must have at least 8 characters");
}

async function upsertMongoSeller(state) {
  const passwordHash = await hashText(config.password);
  const payload = {
    email: config.email,
    phone: config.phone,
    phoneNormalized: `+91${config.phone}`,
    phoneVerified: true,
    passwordHash,
    role: ROLES.SELLER,
    profile: { firstName: "Riya", lastName: "Sharma", avatarUrl: "/uploads/test/seller/avatar.jpg" },
    emailVerified: true,
    accountStatus: "active",
    sellerProfile: {
      businessName: "Riya Retail Marketplace",
      displayName: "Riya Retail",
      legalBusinessName: "Riya Retail Private Limited",
      description: "Complete development seller covering required and optional onboarding fields.",
      supportEmail: config.email,
      supportPhone: config.phone,
      businessType: "private_limited",
      registrationNumber: "U74999MH2024PTC123456",
      gstNumber: config.gstin,
      panNumber: config.pan,
      aadhaarNumber: config.aadhaar,
      dateOfBirth: new Date("1992-06-15T00:00:00.000Z"),
      businessWebsite: "https://seller.example.com",
      primaryContactName: "Riya Sharma",
      bankDetails,
      businessAddress: billingAddress,
      pickupAddress,
      returnAddress,
      profileCompleted: true,
      kycStatus: state.kycStatus,
      bankVerificationStatus: state.bankStatus,
      goLiveStatus: state.goLiveStatus === "rejected" ? "blocked" : state.goLiveStatus,
      rejectionReason: config.scenario === "rejected" ? "Test rejection: identity details require correction" : null,
      onboardingStatus: state.onboardingStatus,
      onboardingChecklist: {
        profileCompleted: true,
        kycSubmitted: config.scenario !== "draft",
        gstVerified: state.verified,
        bankLinked: state.bankStatus !== "not_submitted",
        firstProductPublished: state.verified,
      },
    },
    sellerSettings: {
      autoAcceptOrders: false,
      handlingTimeHours: 24,
      ndrResponseHours: 24,
      shippingModes: ["platform_shipping", "self_ship"],
      payoutSchedule: "weekly",
    },
    allowedModules: [],
  };

  const existing = await UserModel.findOne({ email: config.email });
  if (existing && existing.role !== ROLES.SELLER) {
    throw new Error(`Email already belongs to role ${existing.role}; refusing to overwrite it`);
  }
  const user = await UserModel.findOneAndUpdate(
    { email: config.email },
    { $set: payload, $setOnInsert: { authProviders: [], refreshSessions: [] } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  return { user, created: !existing };
}

async function upsertPostgresSeller(userId, state, transaction) {
  const now = new Date();
  const rejectionReason = config.scenario === "rejected"
    ? "Test rejection: identity details require correction"
    : null;

  const [existingOrganizations] = await sequelize.query(
    "SELECT id FROM seller_organizations WHERE seller_id = :sellerId AND is_default = TRUE LIMIT 1",
    { replacements: { sellerId: userId }, transaction },
  );
  const organizationId = existingOrganizations[0]?.id || uuidv4();

  await sequelize.query(
    `INSERT INTO seller_organizations (
       id, seller_id, legal_business_name, store_display_name, business_type, description,
       support_email, support_phone, registration_number, aadhaar_number, date_of_birth,
       business_website, primary_contact_name, gstin, pan, kyc_status,
       bank_verification_status, approval_status, documents, bank_details, billing_address,
       pickup_address, return_address, tax_settings, invoice_settings, payout_settings,
       compliance_settings, metadata, is_default, go_live_status, rejection_reason,
       required_changes, verification_history, approved_at, kyc_reviewed_at,
       bank_reviewed_at, go_live_approved_at, created_by, updated_by, created_at, updated_at
     ) VALUES (
       :id, :sellerId, :legalName, :storeName, 'private_limited', :description,
       :email, :phone, :registrationNumber, :aadhaar, '1992-06-15', :website,
       :contactName, :gstin, :pan, :kycStatus, :bankStatus, :approvalStatus,
       CAST(:documents AS jsonb), CAST(:bankDetails AS jsonb), CAST(:billingAddress AS jsonb),
       CAST(:pickupAddress AS jsonb), CAST(:returnAddress AS jsonb), CAST(:taxSettings AS jsonb),
       CAST(:invoiceSettings AS jsonb), CAST(:payoutSettings AS jsonb),
       CAST(:complianceSettings AS jsonb), CAST(:metadata AS jsonb), TRUE, :goLiveStatus,
       :rejectionReason, CAST(:requiredChanges AS jsonb), CAST(:history AS jsonb),
       :reviewedAt, :reviewedAt, :reviewedAt, :reviewedAt, :sellerId, :sellerId, NOW(), NOW()
     ) ON CONFLICT (id) DO UPDATE SET
       legal_business_name = EXCLUDED.legal_business_name, store_display_name = EXCLUDED.store_display_name,
       business_type = EXCLUDED.business_type, description = EXCLUDED.description,
       support_email = EXCLUDED.support_email, support_phone = EXCLUDED.support_phone,
       registration_number = EXCLUDED.registration_number, aadhaar_number = EXCLUDED.aadhaar_number,
       date_of_birth = EXCLUDED.date_of_birth, business_website = EXCLUDED.business_website,
       primary_contact_name = EXCLUDED.primary_contact_name, gstin = EXCLUDED.gstin, pan = EXCLUDED.pan,
       kyc_status = EXCLUDED.kyc_status, bank_verification_status = EXCLUDED.bank_verification_status,
       approval_status = EXCLUDED.approval_status, documents = EXCLUDED.documents,
       bank_details = EXCLUDED.bank_details, billing_address = EXCLUDED.billing_address,
       pickup_address = EXCLUDED.pickup_address, return_address = EXCLUDED.return_address,
       tax_settings = EXCLUDED.tax_settings, invoice_settings = EXCLUDED.invoice_settings,
       payout_settings = EXCLUDED.payout_settings, compliance_settings = EXCLUDED.compliance_settings,
       metadata = EXCLUDED.metadata, go_live_status = EXCLUDED.go_live_status,
       rejection_reason = EXCLUDED.rejection_reason, required_changes = EXCLUDED.required_changes,
       verification_history = EXCLUDED.verification_history, approved_at = EXCLUDED.approved_at,
       kyc_reviewed_at = EXCLUDED.kyc_reviewed_at, bank_reviewed_at = EXCLUDED.bank_reviewed_at,
       go_live_approved_at = EXCLUDED.go_live_approved_at, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    {
      replacements: {
        id: organizationId, sellerId: userId,
        legalName: "Riya Retail Private Limited", storeName: "Riya Retail",
        description: "Complete seller organization used for onboarding, KYC, catalog, order, tax, and payout testing.",
        email: config.email, phone: config.phone, registrationNumber: "U74999MH2024PTC123456",
        aadhaar: config.aadhaar, website: "https://seller.example.com", contactName: "Riya Sharma",
        gstin: config.gstin, pan: config.pan, kycStatus: state.kycStatus,
        bankStatus: state.bankStatus, approvalStatus: state.approvalStatus,
        documents: JSON.stringify(documents), bankDetails: JSON.stringify(bankDetails),
        billingAddress: JSON.stringify(billingAddress), pickupAddress: JSON.stringify(pickupAddress),
        returnAddress: JSON.stringify(returnAddress),
        taxSettings: JSON.stringify({ gstRegistered: true, pricesIncludeTax: true, defaultTaxCode: "GST_18" }),
        invoiceSettings: JSON.stringify({ invoicePrefix: "RIYA", invoiceSeries: "FY26-27", nextInvoiceNumber: 1 }),
        payoutSettings: JSON.stringify({ payoutDestination: "razorpayx", schedule: "weekly", minimumPayoutAmount: 500 }),
        complianceSettings: JSON.stringify({ acceptMarketplaceTerms: true, acceptSellerPolicy: true, consentTimestamp: now.toISOString() }),
        metadata: JSON.stringify({ udyogAadhaarNumber: "UDYAM-MH-12-1234567", source: "create-complete-seller-script", taxIdMismatch: config.gstin.slice(2, 12) !== config.pan }),
        goLiveStatus: state.goLiveStatus, rejectionReason,
        requiredChanges: JSON.stringify(rejectionReason ? ["Correct PAN/GST identity details"] : []),
        history: JSON.stringify([{ status: state.approvalStatus, at: now.toISOString(), source: "seed-script" }]),
        reviewedAt: state.verified || rejectionReason ? now : null,
      },
      transaction,
    },
  );

  await sequelize.query(
    `INSERT INTO seller_kyc (
       id, seller_id, organization_id, pan_number, gst_number, aadhaar_number,
       aadhaar_verified, aadhaar_reference_id, aadhaar_verified_at,
       aadhaar_verification_response, legal_name, business_type, pan_verified,
       pan_verified_at, pan_verification_response, gst_verified, gst_verified_at,
       gst_verification_response, verification_status, documents, rejection_reason,
       submitted_at, reviewed_at, created_at, updated_at
     ) VALUES (
       :id, :sellerId, :organizationId, :pan, :gstin, :aadhaar, :verified,
       :aadhaarReference, :verifiedAt, CAST(:aadhaarResponse AS jsonb), :legalName,
       'private_limited', :verified, :verifiedAt, CAST(:panResponse AS jsonb),
       :verified, :verifiedAt, CAST(:gstResponse AS jsonb), :kycStatus,
       CAST(:documents AS jsonb), :rejectionReason, :submittedAt, :reviewedAt, NOW(), NOW()
     ) ON CONFLICT (seller_id) DO UPDATE SET
       organization_id = EXCLUDED.organization_id, pan_number = EXCLUDED.pan_number,
       gst_number = EXCLUDED.gst_number, aadhaar_number = EXCLUDED.aadhaar_number,
       aadhaar_verified = EXCLUDED.aadhaar_verified, aadhaar_reference_id = EXCLUDED.aadhaar_reference_id,
       aadhaar_verified_at = EXCLUDED.aadhaar_verified_at,
       aadhaar_verification_response = EXCLUDED.aadhaar_verification_response,
       legal_name = EXCLUDED.legal_name, business_type = EXCLUDED.business_type,
       pan_verified = EXCLUDED.pan_verified, pan_verified_at = EXCLUDED.pan_verified_at,
       pan_verification_response = EXCLUDED.pan_verification_response,
       gst_verified = EXCLUDED.gst_verified, gst_verified_at = EXCLUDED.gst_verified_at,
       gst_verification_response = EXCLUDED.gst_verification_response,
       verification_status = EXCLUDED.verification_status, documents = EXCLUDED.documents,
       rejection_reason = EXCLUDED.rejection_reason, submitted_at = EXCLUDED.submitted_at,
       reviewed_at = EXCLUDED.reviewed_at, updated_at = NOW()`,
    {
      replacements: {
        id: uuidv4(), sellerId: userId, organizationId, pan: config.pan, gstin: config.gstin,
        aadhaar: config.aadhaar, verified: state.verified,
        aadhaarReference: state.verified ? `seed_aadhaar_${userId}` : null,
        verifiedAt: state.verified ? now : null,
        legalName: "Riya Retail Private Limited", kycStatus: state.kycStatus,
        documents: JSON.stringify(documents), rejectionReason,
        submittedAt: config.scenario === "draft" ? null : now,
        reviewedAt: state.verified || rejectionReason ? now : null,
        aadhaarResponse: JSON.stringify({ source: "seed-script", verified: state.verified }),
        panResponse: JSON.stringify({ source: "seed-script", verified: state.verified }),
        gstResponse: JSON.stringify({ source: "seed-script", verified: state.verified }),
      },
      transaction,
    },
  );

  await sequelize.query(
    `INSERT INTO wallets (id, user_id, available_balance, locked_balance, created_at, updated_at)
     VALUES (:id, :sellerId, 0, 0, NOW(), NOW())
     ON CONFLICT (user_id) DO NOTHING`,
    { replacements: { id: uuidv4(), sellerId: userId }, transaction },
  );

  const [roles] = await sequelize.query(
    "SELECT id FROM roles WHERE slug = 'seller' AND active = TRUE LIMIT 1",
    { transaction },
  );
  if (!roles[0]) throw new Error("Seller RBAC role is missing. Run npm run db:seed:rbac first.");
  await sequelize.query(
    `INSERT INTO user_roles (id, user_id, role_id, assigned_at)
     SELECT :id, :sellerId, :roleId, NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM user_roles WHERE user_id = :sellerId AND role_id = :roleId AND revoked_at IS NULL
     )`,
    { replacements: { id: uuidv4(), sellerId: userId, roleId: roles[0].id }, transaction },
  );

  return organizationId;
}

async function main() {
  validateInput();
  const state = SCENARIOS[config.scenario];
  let createdMongoUser = false;
  let user = null;
  try {
    await connectMongo();
    await sequelize.authenticate();
    ({ user, created: createdMongoUser } = await upsertMongoSeller(state));
    const userId = String(user._id);
    const transaction = await sequelize.transaction();
    let organizationId;
    try {
      organizationId = await upsertPostgresSeller(userId, state, transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      if (createdMongoUser) await UserModel.deleteOne({ _id: user._id });
      throw error;
    }

    const taxIdsMatch = config.gstin.slice(2, 12) === config.pan;
    console.log("\nComplete seller account created/updated");
    console.log(`  Seller ID:       ${userId}`);
    console.log(`  Organization ID: ${organizationId}`);
    console.log(`  Email:           ${config.email}`);
    console.log(`  Scenario:        ${config.scenario}`);
    console.log(`  GST/PAN match:   ${taxIdsMatch ? "yes" : "no (kept under review for testing)"}`);
    console.log(`  Aadhaar:         ********${config.aadhaar.slice(-4)}`);
    console.log("  Includes: profile, all addresses, bank, KYC documents, GST/PAN/Aadhaar, tax, invoice, payout, compliance, wallet, and RBAC role");
  } finally {
    await sequelize.close().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`\nUnable to create seller: ${error.message}`);
  process.exitCode = 1;
});
