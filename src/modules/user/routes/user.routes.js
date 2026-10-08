const express = require("express");
const { UserController } = require("../controllers/user.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { checkInput } = require("../../../shared/middleware/check-input");
const { allowActions } = require("../../../shared/middleware/access");
const { ACTIONS } = require("../../../shared/constants/actions");
const {
  updateProfileSchema,
  submitUserKycSchema,
  uploadUserKycDocumentsSchema,
  reviewUserKycSchema,
  addAddressSchema,
  updateAddressSchema,
  addressParamSchema,
} = require("../validation/user.validation");

const userRoutes = express.Router();
const userController = new UserController();

userRoutes.get("/me", authenticate, catchErrors(userController.getMe));
userRoutes.get("/me/profile-image", authenticate, catchErrors(userController.profileImage));
userRoutes.patch(
  "/me",
  authenticate,
  checkInput(updateProfileSchema),
  catchErrors(userController.updateMe),
);
userRoutes.post(
  "/me/addresses",
  authenticate,
  checkInput(addAddressSchema),
  catchErrors(userController.addAddress),
);
userRoutes.patch(
  "/me/addresses/:addressId",
  authenticate,
  checkInput(updateAddressSchema),
  catchErrors(userController.updateAddress),
);
userRoutes.delete(
  "/me/addresses/:addressId",
  authenticate,
  checkInput(addressParamSchema),
  catchErrors(userController.deleteAddress),
);
userRoutes.post(
  "/me/kyc/documents",
  authenticate,
  allowActions(ACTIONS.USER_KYC_SUBMIT),
  checkInput(uploadUserKycDocumentsSchema),
  catchErrors(userController.uploadKycDocuments),
);
userRoutes.post(
  "/me/kyc",
  authenticate,
  allowActions(ACTIONS.USER_KYC_SUBMIT),
  checkInput(submitUserKycSchema),
  catchErrors(userController.submitKyc),
);
userRoutes.patch(
  "/:userId/kyc/review",
  authenticate,
  allowActions(ACTIONS.KYC_REVIEW),
  checkInput(reviewUserKycSchema),
  catchErrors(userController.reviewKyc),
);

module.exports = { userRoutes };
