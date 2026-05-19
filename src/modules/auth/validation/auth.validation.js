const Joi = require("joi");
const { ROLES } = require("../../../shared/constants/roles");

const registerSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    phone: Joi.string().min(10).max(15).required(),
    password: Joi.string().min(8).max(64).required(),
    role: Joi.string()
      .valid(...Object.values(ROLES))
      .default(ROLES.BUYER),
    profile: Joi.object({
      firstName: Joi.string().min(2).max(50).required(),
      lastName: Joi.string().min(2).max(50).required(),
    }).required(),
    referralCode: Joi.string().trim().uppercase().allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const registerWithOtpSchema = registerSchema;

const verifyRegistrationSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string().length(6).required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const loginSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const refreshSchema = Joi.object({
  body: Joi.object({
    refreshToken: Joi.string().required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const socialLoginSchema = Joi.object({
  body: Joi.object({
    provider: Joi.string().valid("google", "firebase").required(),
    idToken: Joi.string().required(),
    email: Joi.string().email(),
    firstName: Joi.string().min(1).max(50),
    lastName: Joi.string().allow("").max(50),
    avatarUrl: Joi.string().uri().allow(""),
    role: Joi.string()
      .valid(...Object.values(ROLES))
      .default(ROLES.BUYER),
    referralCode: Joi.string().trim().uppercase().allow("", null),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const sendOtpSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    purpose: Joi.string().valid("registration", "forgot_password", "login").default("registration"),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const verifyOtpSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string().length(6).required(),
    purpose: Joi.string().valid("registration", "forgot_password", "login").default("registration"),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const resendOtpSchema = sendOtpSchema;

const forgotPasswordSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const resetPasswordSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string().length(6).required(),
    newPassword: Joi.string().min(8).max(64).required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const changePasswordSchema = Joi.object({
  body: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).max(64).required(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

module.exports = { 
  registerSchema, 
  registerWithOtpSchema,
  verifyRegistrationSchema,
  loginSchema, 
  refreshSchema, 
  socialLoginSchema,
  sendOtpSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema
};
