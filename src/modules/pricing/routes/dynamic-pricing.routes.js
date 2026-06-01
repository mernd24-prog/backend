const express = require("express");
const router = express.Router();

const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowRoles } = require("../../../shared/middleware/access");

const { DynamicPricingService } = require("../services/dynamic-pricing.service");
const { dynamicPricingValidation } = require("../../validation");
const { LoyaltyService } = require("../../loyalty/services/loyalty.service");

// ==============================
// Get price for product (Customer)
// ==============================
router.get("/price", authenticate, async (req, res, next) => {
  try {
    const userId = req.auth?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { error, value } =
      dynamicPricingValidation.getPriceForProduct.validate(req.query);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        details: error.details,
      });
    }

    // Get user loyalty tier
    const loyalty = await LoyaltyService.getOrCreateLoyalty(userId);

    const price = await DynamicPricingService.getPriceForProduct(
      value.productId,
      loyalty?.tier || "standard",
      value.quantity
    );

    return res.status(200).json({
      success: true,
      data: { productId: value.productId, quantity: value.quantity, price },
    });
  } catch (err) {
    next(err);
  }
});

// ==============================
// Admin: Adjust product price
// ==============================
router.post(
  "/adjust",
  authenticate,
  allowRoles(["admin"]),
  async (req, res, next) => {
    try {
      const userId = req.auth?.sub;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const { error, value } =
        dynamicPricingValidation.adjustPrice.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          details: error.details,
        });
      }

      const result = await DynamicPricingService.adjustPrice(
        value.productId,
        value.newPrice,
        value.reason
      );

      return res.status(200).json({
        success: true,
        message: "Price adjusted successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
