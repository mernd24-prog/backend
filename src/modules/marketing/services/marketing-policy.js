const { AppError } = require("../../../shared/errors/app-error");

const DEFAULT_MARKETING = {
  enabled: false,
  campaignKey: "default",
  scope: "both",
  startsAt: null,
  endsAt: null,
  firstOrderOnly: false,
  customerEligibility: "all",
  allowDeals: true,
  allowWallet: true,
  productCapMode: "per_line",
  minOrderAmount: 0,
  maxDiscountPerOrder: 0,
  maxReferralPoolPerOrder: 0,
  usesPerCustomer: 0,
  usesPerCustomerPerCode: 0,
  monthlyUsesPerCustomer: 0,
  customerDiscountBudget: 0,
  monthlyCustomerDiscountBudget: 0,
  campaignBudget: 0,
  partnerCommissionBudget: 0,
};
const NUMERIC_FIELDS = Object.keys(DEFAULT_MARKETING).filter(
  (key) => typeof DEFAULT_MARKETING[key] === "number",
);
function normalizeMarketing(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AppError("Invalid marketing settings", 400);
  const result = { ...DEFAULT_MARKETING };
  for (const key of NUMERIC_FIELDS) {
    const value = Number(input[key] ?? result[key]);
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (key.toLowerCase().includes("uses") && !Number.isInteger(value))
    ) {
      throw new AppError(
        `Marketing ${key} must be a non-negative ${key.toLowerCase().includes("uses") ? "whole number" : "number"}`,
        400,
      );
    }
    if (
      !key.toLowerCase().includes("uses") &&
      Math.abs(value * 100 - Math.round(value * 100)) > 0.000001
    )
      throw new AppError(
        `Marketing ${key} supports up to two decimal places`,
        400,
      );
    result[key] = value;
  }
  for (const key of [
    "enabled",
    "firstOrderOnly",
    "allowDeals",
    "allowWallet",
  ]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      throw new AppError(`Marketing ${key} must be true or false`, 400);
    result[key] = input[key] ?? result[key];
  }
  for (const [key, values] of Object.entries({
    scope: ["both", "coupons", "referrals"],
    customerEligibility: ["all", "new", "returning"],
    productCapMode: ["per_line", "per_item"],
  })) {
    result[key] = input[key] ?? result[key];
    if (!values.includes(result[key]))
      throw new AppError(`Invalid marketing ${key}`, 400);
  }
  result.campaignKey = String(input.campaignKey ?? result.campaignKey).trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(result.campaignKey))
    throw new AppError(
      "Campaign key must contain 1–80 letters, numbers, underscores or hyphens",
      400,
    );
  for (const key of ["startsAt", "endsAt"]) {
    const value = input[key];
    if (value && !Number.isFinite(Date.parse(value)))
      throw new AppError(`Invalid marketing ${key}`, 400);
    result[key] = value ? new Date(value).toISOString() : null;
  }
  if (result.startsAt && result.endsAt && result.startsAt >= result.endsAt)
    throw new AppError("Marketing end must be after start", 400);
  return result;
}
const money = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const remaining = (limit, used) =>
  limit > 0 ? Math.max(0, money(limit - used)) : Infinity;

// Pure policy evaluation; checkout supplies persisted usage under a shared lock.
function evaluateMarketing(
  policy,
  discount,
  usage,
  { subtotalAmount, items = [], now = new Date() },
) {
  if (
    (policy.startsAt && now < new Date(policy.startsAt)) ||
    (policy.endsAt && now >= new Date(policy.endsAt))
  )
    throw new AppError("Marketing campaign is not active", 400);
  if (subtotalAmount < policy.minOrderAmount)
    throw new AppError("Order does not meet the marketing minimum amount", 400);
  if (
    (policy.firstOrderOnly || policy.customerEligibility === "new") &&
    usage.previousOrders > 0
  )
    throw new AppError("This offer is only available on your first order", 400);
  if (policy.customerEligibility === "returning" && usage.previousOrders === 0)
    throw new AppError(
      "This offer is only available to returning customers",
      400,
    );
  if (!policy.allowDeals && items.some((item) => item.dealId))
    throw new AppError("This offer cannot be combined with deal products", 400);
  for (const [limit, used, message] of [
    [
      policy.usesPerCustomer,
      usage.customerUses,
      "Customer campaign usage limit reached",
    ],
    [
      policy.usesPerCustomerPerCode,
      usage.codeUses,
      "Customer usage limit for this code reached",
    ],
    [
      policy.monthlyUsesPerCustomer,
      usage.monthlyUses,
      "Monthly customer usage limit reached",
    ],
  ])
    if (limit > 0 && used >= limit) throw new AppError(message, 400);

  let customerDiscount = Math.min(
    discount.discountAmount,
    remaining(policy.maxDiscountPerOrder, 0),
    remaining(policy.customerDiscountBudget, usage.customerDiscount),
    remaining(policy.monthlyCustomerDiscountBudget, usage.monthlyDiscount),
  );
  const context = discount.referralContext;
  let ratio =
    discount.discountAmount > 0
      ? customerDiscount / discount.discountAmount
      : 1;
  if (context) {
    ratio = Math.min(
      ratio,
      remaining(policy.maxReferralPoolPerOrder, 0) / context.referralPoolAmount,
    );
    for (const [id, amount] of [
      [context.influencerId, context.codeOwnerAmount],
      [context.parentInfluencerId, context.parentAmount],
    ]) {
      if (id && amount > 0)
        ratio = Math.min(
          ratio,
          remaining(
            policy.partnerCommissionBudget,
            usage.partnerCommissions?.[String(id)] || 0,
          ) / amount,
        );
    }
  }
  const originalCost =
    Number(discount.discountAmount || 0) +
    (context
      ? Number(context.codeOwnerAmount || 0) +
        (context.parentInfluencerId ? Number(context.parentAmount || 0) : 0)
      : 0);
  if (originalCost > 0)
    ratio = Math.min(
      ratio,
      remaining(policy.campaignBudget, usage.campaignCost) / originalCost,
    );
  ratio = Math.max(0, Math.min(1, ratio));
  // Round down the pool so independent allocations cannot overspend a cap.
  if (context) {
    const pool =
      Math.floor((context.referralPoolAmount * ratio + 1e-9) * 100) / 100;
    const scaled =
      context.referralPoolAmount > 0 ? pool / context.referralPoolAmount : 0;
    const next = { ...context, referralPoolAmount: pool };
    for (const key of [
      "customerDiscountAmount",
      "codeOwnerAmount",
      "parentAmount",
    ])
      next[key] =
        Math.floor((Number(context[key] || 0) * scaled + 1e-9) * 100) / 100;
    discount.referralContext = next;
    customerDiscount = next.customerDiscountAmount;
  } else
    customerDiscount =
      Math.floor((discount.discountAmount * ratio + 1e-9) * 100) / 100;
  if (originalCost > 0 && ratio <= 0)
    throw new AppError("Marketing benefit limit reached", 400);
  discount.discountAmount = customerDiscount;
  const next = discount.referralContext;
  discount.marketing = {
    campaignKey: policy.campaignKey,
    policyType: policy.scope,
    discountAmount: customerDiscount,
    cost: money(
      customerDiscount +
        (next
          ? Number(next.codeOwnerAmount || 0) +
            (next.parentInfluencerId ? Number(next.parentAmount || 0) : 0)
          : 0),
    ),
    commissions: next
      ? [
          {
            partnerId: String(next.influencerId),
            amount: next.codeOwnerAmount,
          },
          ...(next.parentInfluencerId
            ? [
                {
                  partnerId: String(next.parentInfluencerId),
                  amount: next.parentAmount,
                },
              ]
            : []),
        ]
      : [],
    policy,
  };
  return discount;
}
module.exports = {
  DEFAULT_MARKETING,
  NUMERIC_FIELDS,
  normalizeMarketing,
  evaluateMarketing,
};
