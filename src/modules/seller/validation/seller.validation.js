const Joi = require("joi");
const { panPattern, gstPattern, aadhaarPattern } = require("../../../shared/validation/kyc");
const { KYC_STATUS, ORDER_STATUS } = require("../../../shared/domain/commerce-constants");
const { DELIVERY_STATUS } = require("../../delivery/models/delivery.model");
const {
  makeKycDocumentsSchema,
} = require("../../../shared/validation/document-upload");

const sellerKycDocumentKeys = [
  "panDocumentUrl",
  "gstCertificateUrl",
  "aadhaarFrontUrl",
  "aadhaarBackUrl",
  "bankProofUrl",
  "addressProofUrl",
];

const organizationStatuses = ["draft", "pending_review", "resubmitted", "approved", "rejected", "suspended", "blocked", "active"];
const organizationKycStatuses = ["not_submitted", "submitted", "under_review", "verified", "rejected"];
const organizationBankStatuses = ["not_submitted", "submitted", "verified", "rejected"];
const organizationGoLiveStatuses = ["pending", "ready", "live", "blocked", "rejected"];

const sellerOrganizationAddressSchema = Joi.object({
  line1: Joi.string().allow("", null),
  line2: Joi.string().allow("", null),
  city: Joi.string().allow("", null),
  state: Joi.string().allow("", null),
  country: Joi.string().default("India"),
  postalCode: Joi.string().min(5).max(10).allow("", null),
});

const sellerOrganizationBankSchema = Joi.object({
  accountHolderName: Joi.string().allow("", null),
  accountNumber: Joi.string().allow("", null),
  ifscCode: Joi.string().allow("", null),
  bankName: Joi.string().allow("", null),
  branchName: Joi.string().allow("", null),
});

const sellerOrganizationBodySchema = Joi.object({
  legalBusinessName: Joi.string().min(2).max(180),
  legalName: Joi.string().min(2).max(180),
  storeDisplayName: Joi.string().min(2).max(180),
  displayName: Joi.string().min(2).max(180),
  businessName: Joi.string().min(2).max(180),
  businessType: Joi.string().valid("individual", "proprietorship", "partnership", "private_limited", "llp", "public_limited").allow("", null),
  description: Joi.string().max(2000).allow("", null),
  supportEmail: Joi.string().email(),
  supportPhone: Joi.string().pattern(/^\d{10,15}$/),
  registrationNumber: Joi.string().max(128).allow("", null),
  aadhaarNumber: Joi.string().pattern(aadhaarPattern).allow("", null),
  dateOfBirth: Joi.date().iso().allow("", null),
  businessWebsite: Joi.string().uri().allow("", null),
  primaryContactName: Joi.string().min(2).max(180),
  gstin: Joi.string().pattern(gstPattern).allow("", null),
  gstNumber: Joi.string().pattern(gstPattern).allow("", null),
  pan: Joi.string().pattern(panPattern).allow("", null),
  panNumber: Joi.string().pattern(panPattern).allow("", null),
  documents: makeKycDocumentsSchema(sellerKycDocumentKeys),
  kycDocuments: makeKycDocumentsSchema(sellerKycDocumentKeys),
  bankDetails: sellerOrganizationBankSchema.default({}),
  billingAddress: sellerOrganizationAddressSchema.default({}),
  businessAddress: sellerOrganizationAddressSchema.default({}),
  pickupAddress: sellerOrganizationAddressSchema.default({}),
  returnAddress: sellerOrganizationAddressSchema.default({}),
  taxSettings: Joi.object().default({}),
  invoiceSettings: Joi.object().default({}),
  payoutSettings: Joi.object().default({}),
  complianceSettings: Joi.object().default({}),
  metadata: Joi.object().default({}),
  isDefault: Joi.boolean(),
});

const createSellerOrganizationSchema = Joi.object({
  body: sellerOrganizationBodySchema
    .fork([
      "legalBusinessName",
      "storeDisplayName",
      "businessType",
      "supportEmail",
      "supportPhone",
      "gstin",
      "pan",
      "aadhaarNumber",
      "dateOfBirth",
      "primaryContactName",
      "documents",
      "bankDetails",
      "billingAddress",
      "pickupAddress",
    ], (schema) => schema.required())
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateSellerOrganizationSchema = Joi.object({
  body: sellerOrganizationBodySchema.min(1).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    organizationId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const sellerOrganizationParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    organizationId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const listSellerOrganizationsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    q: Joi.string().allow(""),
    approvalStatus: Joi.string().valid(...organizationStatuses),
    kycStatus: Joi.string().valid(...organizationKycStatuses),
    bankVerificationStatus: Joi.string().valid(...organizationBankStatuses),
    goLiveStatus: Joi.string().valid(...organizationGoLiveStatuses),
    organizationId: Joi.string().guid({ version: "uuidv4" }).allow("", null),
    sellerId: Joi.string().allow("", null),
    limit: Joi.number().integer().min(1).max(200),
    offset: Joi.number().integer().min(0),
  }).required(),
  params: Joi.object({}).required(),
});

const adminListSellerOrganizationsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: listSellerOrganizationsSchema.extract("query"),
  params: Joi.object({
    sellerId: Joi.string().required(),
  }).required(),
});

const adminListAllSellerOrganizationsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: listSellerOrganizationsSchema.extract("query"),
  params: Joi.object({}).required(),
});

const adminCreateSellerOrganizationSchema = Joi.object({
  body: sellerOrganizationBodySchema
    .keys({
      approvalStatus: Joi.string().valid(...organizationStatuses),
      kycStatus: Joi.string().valid(...organizationKycStatuses),
      bankVerificationStatus: Joi.string().valid(...organizationBankStatuses),
      goLiveStatus: Joi.string().valid(...organizationGoLiveStatuses),
      rejectionReason: Joi.string().max(2000).allow("", null),
      requiredChanges: Joi.array().items(Joi.string().max(200)).default([]),
    })
    .fork([
      "legalBusinessName",
      "storeDisplayName",
      "businessType",
      "supportEmail",
      "supportPhone",
      "gstin",
      "pan",
      "aadhaarNumber",
      "dateOfBirth",
      "primaryContactName",
      "documents",
      "bankDetails",
      "billingAddress",
      "pickupAddress",
    ], (schema) => schema.required())
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    sellerId: Joi.string().required(),
  }).required(),
});

const adminSellerOrganizationParamSchema = Joi.object({
  body: Joi.object({}).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({
    sellerId: Joi.string().required(),
    organizationId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const adminUpdateSellerOrganizationSchema = Joi.object({
  body: sellerOrganizationBodySchema.keys({
    approvalStatus: Joi.string().valid(...organizationStatuses),
    kycStatus: Joi.string().valid(...organizationKycStatuses),
    bankVerificationStatus: Joi.string().valid(...organizationBankStatuses),
    goLiveStatus: Joi.string().valid(...organizationGoLiveStatuses),
    suspendedAt: Joi.date().allow(null),
    rejectionReason: Joi.string().max(2000).allow("", null),
    requiredChanges: Joi.array().items(Joi.string().max(200)).default([]),
  }).min(1).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    sellerId: Joi.string().required(),
    organizationId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const adminReviewSellerOrganizationSchema = Joi.object({
  body: Joi.object({
    approvalStatus: Joi.string().valid(...organizationStatuses),
    status: Joi.string().valid(...organizationStatuses),
    kycStatus: Joi.string().valid(...organizationKycStatuses),
    bankVerificationStatus: Joi.string().valid(...organizationBankStatuses),
    goLiveStatus: Joi.string().valid(...organizationGoLiveStatuses),
    rejectionReason: Joi.string().max(2000).allow("", null),
    requiredChanges: Joi.array().items(Joi.string().max(200)).default([]),
    notes: Joi.string().allow("", null),
    metadata: Joi.object().default({}),
  }).or("approvalStatus", "status", "kycStatus", "bankVerificationStatus", "goLiveStatus").required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    sellerId: Joi.string().required(),
    organizationId: Joi.string().guid({ version: "uuidv4" }).required(),
  }).required(),
});

const submitKycSchema = Joi.object({
  body: Joi.object({
    panNumber: Joi.string().pattern(panPattern).required(),
    aadhaarNumber: Joi.string().pattern(aadhaarPattern).allow("", null),
    legalName: Joi.string().min(2).max(120).required(),
    businessType: Joi.string().valid("individual", "proprietorship", "partnership", "private_limited"),
    dateOfBirth: Joi.date().iso().allow("", null),
    documents: makeKycDocumentsSchema(sellerKycDocumentKeys),
    bankDetails: Joi.object({
      accountHolderName: Joi.string().allow("", null),
      accountNumber: Joi.string().allow("", null),
      ifscCode: Joi.string().allow("", null),
      bankName: Joi.string().allow("", null),
      branchName: Joi.string().allow("", null),
    }).default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const uploadSellerKycDocumentsSchema = Joi.object({
  body: Joi.object({
    documents: makeKycDocumentsSchema(sellerKycDocumentKeys).min(1).required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const reviewSellerKycSchema = Joi.object({
  body: Joi.object({
    verificationStatus: Joi.string()
      .valid(KYC_STATUS.UNDER_REVIEW, KYC_STATUS.VERIFIED, KYC_STATUS.REJECTED)
      .required(),
    rejectionReason: Joi.string().allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    sellerId: Joi.string().required(),
  }).required(),
});

const updateSellerProfileSchema = Joi.object({
  body: Joi.object({
    displayName: Joi.string().min(2).max(120).required(),
    businessName: Joi.string().min(2).max(160).allow("", null),
    legalBusinessName: Joi.string().min(2).max(160).required(),
    description: Joi.string().max(2000).allow("", null),
    supportEmail: Joi.string().email().required(),
    supportPhone: Joi.string().min(10).max(15).required(),
    businessType: Joi.string().valid("individual", "proprietorship", "partnership", "private_limited", "llp", "public_limited").allow("", null),
    registrationNumber: Joi.string().allow("", null),
    gstNumber: Joi.string().pattern(gstPattern).allow("", null),
    panNumber: Joi.string().pattern(panPattern).allow("", null),
    aadhaarNumber: Joi.string().pattern(aadhaarPattern).allow("", null),
    dateOfBirth: Joi.date().iso().allow("", null),
    businessWebsite: Joi.string().uri().allow("", null),
    primaryContactName: Joi.string().max(120).allow("", null),
    bankDetails: Joi.object({
      accountHolderName: Joi.string().allow("", null),
      accountNumber: Joi.string().allow("", null),
      ifscCode: Joi.string().allow("", null),
      bankName: Joi.string().allow("", null),
      branchName: Joi.string().allow("", null),
    }).default({}),
    businessAddress: Joi.object({
      line1: Joi.string().allow("", null),
      line2: Joi.string().allow("", null),
      city: Joi.string().allow("", null),
      state: Joi.string().allow("", null),
      country: Joi.string().default("India"),
      postalCode: Joi.string().min(5).max(10).allow("", null),
    }).default({}),
    pickupAddress: Joi.object({
      line1: Joi.string().required(),
      line2: Joi.string().allow("", null),
      city: Joi.string().required(),
      state: Joi.string().required(),
      country: Joi.string().default("India"),
      postalCode: Joi.string().min(5).max(10).required(),
    }).required(),
    returnAddress: Joi.object({
      line1: Joi.string().allow("", null),
      line2: Joi.string().allow("", null),
      city: Joi.string().allow("", null),
      state: Joi.string().allow("", null),
      country: Joi.string().default("India"),
      postalCode: Joi.string().min(5).max(10).allow("", null),
    }).default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateSellerSettingsSchema = Joi.object({
  body: Joi.object({
    autoAcceptOrders: Joi.boolean(),
    handlingTimeHours: Joi.number().integer().min(1).max(168),
    returnWindowDays: Joi.number().integer().min(1).max(60),
    ndrResponseHours: Joi.number().integer().min(1).max(72),
    shippingModes: Joi.array().items(Joi.string().valid("standard", "express", "same_day", "hyperlocal")),
    payoutSchedule: Joi.string().valid("daily", "weekly", "biweekly", "monthly"),
  })
    .min(1)
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const sellerChargeSettingsBodySchema = Joi.object({
  cod: Joi.object({
    enabled: Joi.boolean(),
    chargeMode: Joi.string().valid("inherit", "none", "flat"),
    chargeAmount: Joi.number().min(0),
    minOrderAmount: Joi.number().min(0).allow(null),
    maxOrderAmount: Joi.number().min(0).allow(null),
    availabilityMode: Joi.string().valid("inherit", "all_pincodes", "allowlist", "blocklist", "disabled"),
    allowPincodes: Joi.alternatives().try(
      Joi.array().items(Joi.string().trim()),
      Joi.string().allow("", null),
    ),
    blockPincodes: Joi.alternatives().try(
      Joi.array().items(Joi.string().trim()),
      Joi.string().allow("", null),
    ),
    notes: Joi.string().max(1000).allow("", null),
  }),
  delivery: Joi.object({
    mode: Joi.string().valid("none", "flat", "free_over_amount"),
    chargeAmount: Joi.number().min(0),
    freeDeliveryMinOrderAmount: Joi.number().min(0).allow(null),
    notes: Joi.string().max(1000).allow("", null),
  }),
  metadata: Joi.object(),
}).min(1);

const updateSellerChargeSettingsSchema = Joi.object({
  body: sellerChargeSettingsBodySchema.required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateSellerAddressSchema = Joi.object({
  body: Joi.object({
    line1: Joi.string().required(),
    line2: Joi.string().allow("", null),
    city: Joi.string().required(),
    state: Joi.string().required(),
    country: Joi.string().default("India"),
    postalCode: Joi.string().min(5).max(10).required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateSellerBankSchema = Joi.object({
  body: Joi.object({
    accountHolderName: Joi.string().required(),
    accountNumber: Joi.string().required(),
    ifscCode: Joi.string().required(),
    bankName: Joi.string().required(),
    branchName: Joi.string().allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateSellerMoreInfoSchema = Joi.object({
  body: Joi.object({
    description: Joi.string().max(2000).allow("", null),
    businessWebsite: Joi.string().uri().allow("", null),
    primaryContactName: Joi.string().max(120).allow("", null),
    registrationNumber: Joi.string().allow("", null),
    supportEmail: Joi.string().email(),
    supportPhone: Joi.string().min(10).max(15),
  })
    .min(1)
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const sellerDashboardSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    organizationId: Joi.string().guid({ version: "uuidv4" }),
  }).required(),
  params: Joi.object({}).required(),
});

const sellerWebStatusSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const sellerTrackingSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    status: Joi.string().valid(...Object.values(ORDER_STATUS)),
    deliveryStatus: Joi.string().valid(...Object.values(DELIVERY_STATUS), "not_created"),
    organizationId: Joi.string().guid({ version: "uuidv4" }),
    fromDate: Joi.date().iso(),
    toDate: Joi.date().iso(),
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).default(0),
  }).required(),
  params: Joi.object({}).required(),
});

const sellerTrackingOrderSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    orderId: Joi.string().required(),
  }).required(),
});

const permissionActions = [
  "view",
  "create",
  "add",
  "edit",
  "update",
  "delete",
  "approve",
  "approval",
  "reject",
  "assign",
  "export",
  "import",
  "status_change",
  "status",
  "restore",
  "bulk_action",
  "action",
];

const modulePermissionSchema = Joi.array().items(
  Joi.object({
    module: Joi.string().required(),
    actions: Joi.array()
      .items(Joi.string().valid(...permissionActions))
      .min(1)
      .required(),
  }),
);

const listSellerAccessModulesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({
    role: Joi.string().valid("seller", "seller-admin", "seller-sub-admin").default("seller-sub-admin"),
    roleId: Joi.string().guid({ version: "uuidv4" }),
    roleSlug: Joi.string().trim().min(2).max(128),
    userId: Joi.string().trim(),
    active: Joi.boolean().default(true),
    includePermissions: Joi.boolean().default(true),
  })
    .oxor("roleId", "roleSlug")
    .required(),
  params: Joi.object({}).required(),
});

const createSellerSubAdminSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    phone: Joi.string().allow("", null),
    password: Joi.string().min(8).required(),
    profile: Joi.object({
      firstName: Joi.string().required(),
      lastName: Joi.string().allow("", null),
    }).required(),
    role: Joi.string().valid("seller-admin", "seller-sub-admin"),
    allowedModules: Joi.array().items(Joi.string()).min(1).required(),
    modulePermissions: modulePermissionSchema,
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const listSellerSubAdminsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateSellerSubAdminModulesSchema = Joi.object({
  body: Joi.object({
    allowedModules: Joi.array().items(Joi.string()).min(1).required(),
    modulePermissions: modulePermissionSchema,
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    userId: Joi.string().required(),
  }).required(),
});

const updateSellerSubAdminStatusSchema = Joi.object({
  body: Joi.object({
    accountStatus: Joi.string().valid("active", "suspended").required(),
    status: Joi.string().valid("active", "suspended"),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    userId: Joi.string().required(),
  }).required(),
});

const sellerSubAdminParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    userId: Joi.string().required(),
  }).required(),
});

module.exports = {
  submitKycSchema,
  uploadSellerKycDocumentsSchema,
  reviewSellerKycSchema,
  updateSellerProfileSchema,
  updateSellerSettingsSchema,
  updateSellerChargeSettingsSchema,
  updateSellerAddressSchema,
  updateSellerBankSchema,
  updateSellerMoreInfoSchema,
  sellerDashboardSchema,
  sellerWebStatusSchema,
  sellerTrackingSchema,
  sellerTrackingOrderSchema,
  listSellerAccessModulesSchema,
  createSellerSubAdminSchema,
  listSellerSubAdminsSchema,
  updateSellerSubAdminModulesSchema,
  updateSellerSubAdminStatusSchema,
  sellerSubAdminParamSchema,
  createSellerOrganizationSchema,
  updateSellerOrganizationSchema,
  sellerOrganizationParamSchema,
  listSellerOrganizationsSchema,
  adminListAllSellerOrganizationsSchema,
  adminListSellerOrganizationsSchema,
  adminCreateSellerOrganizationSchema,
  adminSellerOrganizationParamSchema,
  adminUpdateSellerOrganizationSchema,
  adminReviewSellerOrganizationSchema,
};
