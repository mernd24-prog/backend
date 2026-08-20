const express = require("express");
const { AuthController } = require("../controllers/auth.controller");
const { checkInput } = require("../../../shared/middleware/check-input");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { authRateLimit } = require("../../../shared/middleware/auth-rate-limit");
const { authenticate, authenticateForStatus } = require("../../../shared/middleware/authenticate");
const {
  loginSchema,
  refreshSchema,
  registerSchema,
  registerWithOtpSchema,
  verifyRegistrationSchema,
  socialLoginSchema,
  sendOtpSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  buyerOtpAuthSchema,
} = require("../validation/auth.validation");

const authRoutes = express.Router();
const authController = new AuthController();

authRoutes.use([
  "/register", "/register-otp", "/verify-registration", "/login",
  "/influencer/login", "/social", "/refresh", "/otp-auth", "/send-otp",
  "/influencer/forgot-password", "/influencer/verify-reset-otp", "/influencer/reset-password",
  "/verify-otp", "/resend-otp", "/forgot-password", "/reset-password",
], authRateLimit);
authRoutes.post("/register", checkInput(registerSchema), catchErrors(authController.register));
authRoutes.post("/register-otp", checkInput(registerWithOtpSchema), catchErrors(authController.registerWithOtp));
authRoutes.post("/verify-registration", checkInput(verifyRegistrationSchema), catchErrors(authController.verifyRegistration));
authRoutes.post("/login", checkInput(loginSchema), catchErrors(authController.login));
authRoutes.post(
  "/influencer/login",
  checkInput(loginSchema),
  catchErrors(authController.influencerLogin),
);
authRoutes.post("/influencer/forgot-password", checkInput(forgotPasswordSchema), catchErrors(authController.influencerForgotPassword));
authRoutes.post("/influencer/verify-reset-otp", checkInput(verifyOtpSchema), catchErrors(authController.influencerVerifyResetOtp));
authRoutes.post("/influencer/reset-password", checkInput(resetPasswordSchema), catchErrors(authController.influencerResetPassword));
authRoutes.post("/social", checkInput(socialLoginSchema), catchErrors(authController.socialLogin));
authRoutes.post("/refresh", checkInput(refreshSchema), catchErrors(authController.refresh));
authRoutes.post(
  "/otp-auth",
  checkInput(buyerOtpAuthSchema),
  catchErrors(authController.buyerOtpAuth),
);
authRoutes.post("/send-otp", checkInput(sendOtpSchema), catchErrors(authController.sendOtp));
authRoutes.post("/verify-otp", checkInput(verifyOtpSchema), catchErrors(authController.verifyOtp));
authRoutes.post("/resend-otp", checkInput(resendOtpSchema), catchErrors(authController.resendOtp));
authRoutes.post("/forgot-password", checkInput(forgotPasswordSchema), catchErrors(authController.forgotPassword));
authRoutes.post("/reset-password", checkInput(resetPasswordSchema), catchErrors(authController.resetPassword));
authRoutes.post("/change-password", authenticate, checkInput(changePasswordSchema), catchErrors(authController.changePassword));
authRoutes.get("/status", authenticateForStatus, catchErrors(authController.status));

module.exports = { authRoutes };
