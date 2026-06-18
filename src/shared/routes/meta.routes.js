const express = require("express");
const { env } = require("../../config/env");
const { API_MODULES } = require("../auth/module-catalog");
const { catchErrors } = require("../middleware/catch-errors");
const { CommonManagementService } = require("../../modules/admin/services/common-management.service");
const { PlatformService } = require("../../modules/platform/services/platform.service");
const {
  PRODUCT_STATUS,
  PRODUCT_TYPE,
  PRODUCT_VISIBILITY,
  DIGITAL_FILE_TYPE,
  SUBSCRIPTION_BILLING_CYCLE,
  INVENTORY_TRANSACTION_TYPE,
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  KYC_STATUS,
  COUPON_TYPE,
  WALLET_TRANSACTION_TYPE,
} = require("../domain/commerce-constants");
const { DELIVERY_STATUS, SHIPPING_MODES } = require("../../modules/delivery/models/delivery.model");

const metaRoutes = express.Router();
const commonManagementService = new CommonManagementService();
const platformService = new PlatformService();

const titleize = (value = "") =>
  String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const valuesToOptions = (values = []) =>
  values.map((value) => ({ label: titleize(value), value, id: value, meta: {} }));

const SYSTEM_DROPDOWNS = {
  "account-types": valuesToOptions(["buyer", "seller"]),
  "business-types": valuesToOptions(["individual", "proprietorship", "partnership", "private_limited", "llp", "public_limited"]),
  "bank-review-statuses": valuesToOptions(["verified", "submitted", "rejected"]),
  "coupon-types": valuesToOptions(Object.values(COUPON_TYPE)),
  "delivery-statuses": valuesToOptions(Object.values(DELIVERY_STATUS)),
  "discount-types": valuesToOptions(Object.values(COUPON_TYPE)),
  "digital-file-types": valuesToOptions(Object.values(DIGITAL_FILE_TYPE)),
  "digital-license-types": valuesToOptions(["single_use", "multi_use", "unlimited", "subscription"]),
  "inventory-adjustment-reasons": valuesToOptions(["purchase_restock", "customer_return", "damaged_goods", "stock_count_correction", "transfer", "other"]),
  "inventory-transaction-types": valuesToOptions(Object.values(INVENTORY_TRANSACTION_TYPE)),
  "kyc-statuses": valuesToOptions(Object.values(KYC_STATUS)),
  "kyc-review-statuses": valuesToOptions(["verified", "under_review", "rejected"]),
  "notification-frequencies": valuesToOptions(["real_time", "daily", "weekly", "never"]),
  "module-types": valuesToOptions(["group", "module", "page", "action"]),
  "order-statuses": valuesToOptions(Object.values(ORDER_STATUS)),
  "payment-methods": valuesToOptions(Object.values(PAYMENT_PROVIDER)),
  "payment-statuses": valuesToOptions(Object.values(PAYMENT_STATUS)),
  "product-statuses": valuesToOptions(Object.values(PRODUCT_STATUS)),
  "product-option-display-types": valuesToOptions(["button", "dropdown", "color_swatch", "radio", "thumbnail"]),
  "product-types": valuesToOptions(Object.values(PRODUCT_TYPE)),
  "product-visibilities": valuesToOptions(Object.values(PRODUCT_VISIBILITY)),
  "return-reasons": [
    { label: "Defective / damaged", value: "defective", id: "defective", meta: {} },
    { label: "Not as described", value: "not_as_described", id: "not_as_described", meta: {} },
    { label: "Changed my mind", value: "changed_mind", id: "changed_mind", meta: {} },
    { label: "Other reason", value: "other", id: "other", meta: {} },
  ],
  "return-statuses": valuesToOptions([
    "requested",
    "approved",
    "rejected",
    "reverse_pickup_scheduled",
    "pickup_failed",
    "manual_ship_back",
    "shipped_back",
    "in_reverse_transit",
    "received",
    "qc_passed",
    "qc_failed",
    "qc_completed",
    "refund_pending",
    "refund_failed",
    "partially_refunded",
    "refunded",
    "replacement_pending",
    "replaced",
    "closed",
  ]),
  "record-statuses": valuesToOptions(["active", "inactive", "draft"]),
  "referral-code-statuses": valuesToOptions(["active", "inactive", "expired", "suspended"]),
  "referral-filter-statuses": valuesToOptions(["active", "pending", "suspended", "rejected", "completed", "paid"]),
  "referral-override-modes": valuesToOptions(["nearest_only", "stacked"]),
  "referral-override-scopes": valuesToOptions(["promoted_subtree", "direct_sales_only"]),
  "shipping-modes": valuesToOptions(SHIPPING_MODES),
  "subscription-billing-cycles": valuesToOptions(Object.values(SUBSCRIPTION_BILLING_CYCLE)),
  "warranty-units": valuesToOptions(["days", "weeks", "months", "years"]),
  "wallet-transaction-types": valuesToOptions(Object.values(WALLET_TRANSACTION_TYPE)),
};

const itemId = (item = {}) => String(item._id || item.id || "");

const asOptionsResponse = (res, options, source = {}) =>
  res.json({
    success: true,
    data: options,
    meta: {
      total: source.total ?? options.length,
      page: source.page ?? 1,
      limit: source.limit ?? options.length,
    },
  });

const managedOption = (item, { label, value = label } = {}) => ({
  label: String(item[label] || ""),
  value: String(item[value] || item[label] || ""),
  id: itemId(item),
  meta: {
    active: item.active !== false,
  },
});

metaRoutes.get("/routes", (req, res) => {
  return res.json({
    success: true,
    data: {
      appName: env.appName,
      version: "1.0.0",
      apiPrefix: env.apiPrefix,
      modules: API_MODULES,
      docs: {
        readme: "README.md",
        apiReference: "docs/API_REFERENCE.md",
      },
    },
  });
});

metaRoutes.get(
  "/dropdowns/:resource",
  catchErrors(async (req, res) => {
    const { resource } = req.params;
    const query = { ...req.query, active: req.query.active ?? "true" };
    const parentId = req.query.parentId || "";

    if (SYSTEM_DROPDOWNS[resource]) {
      const search = String(req.query.search || req.query.q || "").toLowerCase();
      const options = search
        ? SYSTEM_DROPDOWNS[resource].filter((option) => option.label.toLowerCase().includes(search))
        : SYSTEM_DROPDOWNS[resource];
      return asOptionsResponse(res, options);
    }

    let result;
    let options;
    switch (resource) {
      case "countries":
        result = await commonManagementService.listCountries(query);
        options = result.items.map((item) => managedOption(item, { label: "name" }));
        break;
      case "states":
        const countryId = parentId || req.query.countryId || "";
        result = countryId
          ? await commonManagementService.listStates({ ...query, countryId })
          : { items: [], total: 0 };
        options = result.items.map((item) => managedOption(item, { label: "name" }));
        break;
      case "cities":
        const stateId = parentId || req.query.stateId || "";
        result = stateId
          ? await commonManagementService.listCities({ ...query, stateId })
          : { items: [], total: 0 };
        options = result.items.map((item) => managedOption(item, { label: "name" }));
        break;
      case "pincodes":
      case "zip-codes":
        const cityId = parentId || req.query.cityId || "";
        result = cityId
          ? await commonManagementService.listZipCodes({ ...query, cityId })
          : { items: [], total: 0 };
        options = result.items.map((item) => ({
          ...managedOption(item, { label: "zipCode" }),
          label: [item.zipCode, item.areaName].filter(Boolean).join(" - "),
          meta: { active: item.active !== false, areaName: item.areaName || "" },
        }));
        break;
      case "taxes":
        result = await commonManagementService.listTaxes(query);
        options = result.items.map((item) => managedOption(item, { label: "name" }));
        break;
      case "categories":
        result = await platformService.listCategories({
          ...query,
          parentKey: req.query.parentKey || parentId || undefined,
        });
        options = result.items.map((item) => ({
          label: item.title || item.name || item.categoryKey,
          value: item.categoryKey,
          id: itemId(item) || item.categoryKey,
          meta: { parentKey: item.parentKey || "", level: item.level ?? null },
        }));
        break;
      case "brands":
        result = await platformService.listBrands(query);
        options = result.items.map((item) => ({
          label: item.name,
          value: item.name,
          id: itemId(item),
          meta: { slug: item.slug || "" },
        }));
        break;
      case "product-families":
        result = await platformService.listProductFamilies({
          ...query,
          category: req.query.parentId || req.query.category || undefined,
          status: req.query.status || "active",
        });
        options = result.items.map((item) => ({
          label: item.title || item.name || item.familyCode,
          value: item.familyCode,
          id: itemId(item) || item.familyCode,
          meta: { category: item.category || "" },
        }));
        break;
      case "hsn-codes":
        result = await platformService.listHsnCodes(query);
        options = result.items.map((item) => ({
          label: [item.code, item.description].filter(Boolean).join(" - "),
          value: item.code,
          id: itemId(item) || item.code,
          meta: { category: item.category || "" },
        }));
        break;
      case "product-options":
        result = await platformService.listProductOptions(query);
        options = result.items.map((item) => ({
          label: item.name,
          value: itemId(item),
          id: itemId(item),
          meta: { slug: item.slug || "", displayType: item.displayType || "" },
        }));
        break;
      case "product-option-values":
        result = parentId
          ? await platformService.listProductOptionValues({ ...query, optionId: parentId })
          : { items: [], total: 0 };
        options = result.items.map((item) => ({
          label: item.name,
          value: itemId(item),
          id: itemId(item),
          meta: { optionId: String(item.optionId || item.option_id || "") },
        }));
        break;
      default:
        return res.status(404).json({ success: false, message: "Dropdown resource not found" });
    }

    return asOptionsResponse(res, options, result);
  }),
);

module.exports = { metaRoutes };
