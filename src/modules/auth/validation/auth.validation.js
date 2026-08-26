const Joi = require("joi");

const {
  ROLES,
} = require("../../../shared/constants/roles");

const emptyQuerySchema = Joi.object({}).required();
const emptyParamsSchema = Joi.object({}).required();

const registerSchema = Joi.object({
  body: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required(),

    phone: Joi.string()
      .trim()
      .min(10)
      .max(15)
      .required(),

    password: Joi.string()
      .min(8)
      .max(64)
      .required(),

    role: Joi.string()
      .valid(...Object.values(ROLES))
      .default(ROLES.BUYER),

    profile: Joi.object({
      firstName: Joi.string()
        .trim()
        .min(2)
        .max(50)
        .required(),

      lastName: Joi.string()
        .trim()
        .min(2)
        .max(50)
        .required(),
    }).required(),

    referralCode: Joi.string()
      .trim()
      .uppercase()
      .allow("", null),
  }).required(),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

const registerWithOtpSchema = registerSchema;

const verifyRegistrationSchema = Joi.object({
  body: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required(),

    otp: Joi.string()
      .trim()
      .pattern(/^\d{6}$/)
      .required()
      .messages({
        "string.pattern.base":
          "OTP must contain exactly 6 digits",
      }),
  }).required(),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

const loginSchema = Joi.object({
  body: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required(),

    password: Joi.string()
      .required(),
  }).required(),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

const influencerRegistrationSchema = Joi.object({
  body: Joi.object({
    inviteCode: Joi.string().trim().min(10).max(200).required(),
    email: Joi.string().trim().lowercase().email().required(),
    phone: Joi.string().trim().min(10).max(15).required(),
    password: Joi.string().min(8).max(64).required(),
    firstName: Joi.string().trim().min(2).max(50).required(),
    lastName: Joi.string().trim().max(50).allow(""),
  }).required(),
  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

const influencerInviteSchema = Joi.object({
  body: Joi.object({}).required(),
  query: emptyQuerySchema,
  params: Joi.object({ inviteCode: Joi.string().trim().min(10).max(200).required() }).required(),
});

const refreshSchema = Joi.object({
  body: Joi.object({
    refreshToken: Joi.string()
      .required(),
  }).required(),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

const socialLoginSchema = Joi.object({
  body: Joi.object({
    provider: Joi.string()
      .valid("google", "firebase")
      .required(),

    idToken: Joi.string(),

    authCode: Joi.string()
      .trim(),

    clientId: Joi.string()
      .trim(),

    redirectUri: Joi.string()
      .uri(),

    email: Joi.string()
      .trim()
      .lowercase()
      .email(),

    firstName: Joi.string()
      .trim()
      .min(1)
      .max(50),

    lastName: Joi.string()
      .trim()
      .allow("")
      .max(50),

    avatarUrl: Joi.string()
      .uri()
      .allow(""),

    role: Joi.string()
      .valid(...Object.values(ROLES))
      .default(ROLES.BUYER),

    referralCode: Joi.string()
      .trim()
      .uppercase()
      .allow("", null),
  }).xor("idToken", "authCode").required(),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

/*
 * Unified buyer OTP schema.
 *
 * Valid request examples:
 *
 * { email: "user@example.com" }
 * { mobile: "9876543210" }
 * { email: "user@example.com", otp: "123456" }
 * { mobile: "9876543210", otp: "123456" }
 *
 * Exactly one of email or mobile is required.
 */
const buyerOtpAuthSchema = Joi.object({
  body: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .messages({
        "string.email":
          "Enter a valid email address",
      }),

    mobile: Joi.string()
      .trim()
      .pattern(/^(?:\+91|91|0)?[6-9]\d{9}$/)
      .messages({
        "string.pattern.base":
          "Enter a valid Indian mobile number",
      }),

    /*
     * OTP is optional:
     * - Missing OTP means request OTP.
     * - Present OTP means verify OTP.
     */
    otp: Joi.string()
      .trim()
      .pattern(/^\d{6}$/)
      .messages({
        "string.pattern.base":
          "OTP must contain exactly 6 digits",
      }),

    /*
     * Used only when a new buyer is automatically
     * registered after OTP verification.
     */
    firstName: Joi.string()
      .trim()
      .min(1)
      .max(50),

    lastName: Joi.string()
      .trim()
      .allow("")
      .max(50),

    /*
     * Also accept your existing profile payload format.
     */
    profile: Joi.object({
      firstName: Joi.string()
        .trim()
        .min(1)
        .max(50),

      lastName: Joi.string()
        .trim()
        .allow("")
        .max(50),
    }),

    referralCode: Joi.string()
      .trim()
      .uppercase()
      .allow("", null),
  })
    .xor("email", "mobile")
    .required()
    .messages({
      "object.missing":
        "Provide either email or mobile",

      "object.xor":
        "Provide exactly one of email or mobile",
    }),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

const sendOtpSchema = Joi.object({
  body: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required(),

    purpose: Joi.string()
      .valid(
        "registration",
        "forgot_password",
        "influencer_forgot_password",
        "login",
      )
      .default("registration"),
  }).required(),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

const verifyOtpSchema = Joi.object({
  body: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required(),

    otp: Joi.string()
      .trim()
      .pattern(/^\d{6}$/)
      .required()
      .messages({
        "string.pattern.base":
          "OTP must contain exactly 6 digits",
      }),

    purpose: Joi.string()
      .valid(
        "registration",
        "forgot_password",
        "influencer_forgot_password",
        "login",
      )
      .default("registration"),
  }).required(),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

const resendOtpSchema = sendOtpSchema;

const forgotPasswordSchema = Joi.object({
  body: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required(),
  }).required(),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

const resetPasswordSchema = Joi.object({
  body: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required(),

    otp: Joi.string()
      .trim()
      .pattern(/^\d{6}$/)
      .required()
      .messages({
        "string.pattern.base":
          "OTP must contain exactly 6 digits",
      }),

    newPassword: Joi.string()
      .min(8)
      .max(64)
      .required(),
  }).required(),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

const changePasswordSchema = Joi.object({
  body: Joi.object({
    currentPassword: Joi.string()
      .required(),

    newPassword: Joi.string()
      .min(8)
      .max(64)
      .required(),
  }).required(),

  query: emptyQuerySchema,
  params: emptyParamsSchema,
});

module.exports = {
  registerSchema,
  registerWithOtpSchema,
  verifyRegistrationSchema,
  loginSchema,
  influencerRegistrationSchema,
  influencerInviteSchema,
  refreshSchema,
  socialLoginSchema,

  /*
   * New unified buyer OTP validation.
   */
  buyerOtpAuthSchema,

  sendOtpSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
};
