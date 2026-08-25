const Joi = require("joi");
const { panPattern, aadhaarPattern } = require("../../../shared/validation/kyc");
const { KYC_STATUS } = require("../../../shared/domain/commerce-constants");
const {
  makeKycDocumentsSchema,
} = require("../../../shared/validation/document-upload");

const userKycDocumentKeys = [
  "panDocumentUrl",
  "aadhaarFrontUrl",
  "aadhaarBackUrl",
  "selfieUrl",
  "addressProofUrl",
];

const userProfileFieldsSchema = {
  firstName: Joi.string().trim().min(2).max(50),
  lastName: Joi.string().trim().min(2).max(50),
  avatarUrl: Joi.string().trim().uri().allow("", null),
  description: Joi.string().trim().max(2000).allow("", null),
};

const updateProfileSchema = Joi.object({
  body: Joi.object({
    profile: Joi.object(userProfileFieldsSchema).min(1),
    ...userProfileFieldsSchema,
  })
    .or("profile", "firstName", "lastName", "avatarUrl", "description")
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const submitUserKycSchema = Joi.object({
  body: Joi.object({
    legalName: Joi.string().min(2).max(120).required(),
    panNumber: Joi.string().pattern(panPattern).allow("", null),
    aadhaarNumber: Joi.string().pattern(aadhaarPattern).allow("", null),
    documents: makeKycDocumentsSchema(userKycDocumentKeys),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const uploadUserKycDocumentsSchema = Joi.object({
  body: Joi.object({
    documents: makeKycDocumentsSchema(userKycDocumentKeys).min(1).required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const reviewUserKycSchema = Joi.object({
  body: Joi.object({
    verificationStatus: Joi.string()
      .valid(KYC_STATUS.UNDER_REVIEW, KYC_STATUS.VERIFIED, KYC_STATUS.REJECTED)
      .required(),
    rejectionReason: Joi.string().allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    userId: Joi.string().required(),
  }).required(),
});

const addressBodySchema = Joi.object({
  label: Joi.string().valid("home", "work", "other").default("home"),
  fullName: Joi.string().required(),
  phone: Joi.string().min(10).max(15).required(),
  line1: Joi.string().required(),
  line2: Joi.string().allow("", null),
  city: Joi.string().required(),
  state: Joi.string().required(),
  country: Joi.string().default("India"),
  postalCode: Joi.string().min(5).max(10).required(),
  isDefault: Joi.boolean().default(false),
});

const addAddressSchema = Joi.object({
  body: addressBodySchema.required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateAddressSchema = Joi.object({
  body: addressBodySchema.fork(
    ["fullName", "phone", "line1", "city", "state", "postalCode"],
    (schema) => schema.optional(),
  ).min(1).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    addressId: Joi.string().required(),
  }).required(),
});

const addressParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    addressId: Joi.string().required(),
  }).required(),
});

module.exports = {
  updateProfileSchema,
  submitUserKycSchema,
  uploadUserKycDocumentsSchema,
  reviewUserKycSchema,
  addAddressSchema,
  updateAddressSchema,
  addressParamSchema,
};
