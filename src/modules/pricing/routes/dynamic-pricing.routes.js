const express = require("express");
const router = express.Router();

const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowRoles } = require("../../../shared/middleware/access");

const { DynamicPricingService } = require("../services/dynamic-pricing.service");
const { dynamicPricingValidation } = require("../../validation");
const { LoyaltyService } = require("../../loyalty/services/loyalty.service");
const jwt = require("jsonwebtoken");
const { env } = require("../../../config/env");

function optionalAuthenticate(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return next();

  try {
    req.auth = jwt.verify(authHeader.replace("Bearer ", ""), env.jwtAccessSecret);
  } catch {
    req.auth = null;
  }
  return next();
}

// ==============================
// Get price for product (Customer)
// ==============================
router.get("/price", optionalAuthenticate, async (req, res, next) => {
  try {
    const userId = req.auth?.sub;

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
    const loyalty = userId
      ? await LoyaltyService.getOrCreateLoyalty(userId)
      : null;

    const price = await DynamicPricingService.getPriceForProduct(
      value.productId,
      loyalty?.tier || "standard",
      value.quantity,
      { variantId: value.variantId, sku: value.sku },
    );

    return res.status(200).json({
      success: true,
      data: {
        productId: value.productId,
        variantId: value.variantId || null,
        sku: value.sku || null,
        quantity: value.quantity,
        price,
      },
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
