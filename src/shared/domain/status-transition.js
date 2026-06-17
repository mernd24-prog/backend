const { AppError, ERROR_CODES } = require("../errors/app-error");

const FLOWS = {
  product: {
    draft:    ["active", "rejected", "archived"],
    active:   ["inactive", "archived"],
    inactive: ["active", "archived"],
    rejected: ["draft", "archived"],
    archived: ["draft"],
  },

  order: {
    pending_payment: ["confirmed", "cancelled", "payment_failed"],
    payment_failed:  ["pending_payment", "cancelled"],
    confirmed:       ["packed",     "cancelled"],
    packed:          ["shipped"],
    shipped:         ["delivered",  "return_requested"],
    delivered:       ["fulfilled", "return_requested"],
    return_requested:["returned"],
    returned:        ["fulfilled"],
    fulfilled:       [],            // terminal
    cancelled:       [],            // terminal
  },

  return: {
    requested:  ["approved", "rejected"],
    approved:   ["picked_up"],
    picked_up:  ["refunded",  "rejected"],
    rejected:   [],             // terminal
    refunded:   ["closed"],
    closed:     [],             // terminal
  },

  seller_kyc: {
    pending:      ["under_review", "verified", "rejected"],
    submitted:    ["under_review", "verified", "rejected"],
    under_review: ["verified",     "rejected"],
    verified:     ["rejected"],
    rejected:     ["submitted"],
  },

  seller_bank: {
    pending:  ["verified", "rejected"],
    rejected: ["pending"],
    verified: [],               // terminal once verified
  },

  seller: {
    pending:    ["active",   "rejected", "suspended"],
    active:     ["inactive", "suspended"],
    inactive:   ["active",   "suspended"],
    suspended:  ["active",   "rejected"],
    rejected:   ["pending"],
  },

  user: {
    pending:  ["active",   "suspended", "banned"],
    active:   ["inactive", "suspended", "banned"],
    inactive: ["active",   "suspended", "banned"],
    suspended:["active",   "banned"],
    banned:   ["active"],
  },

  payment: {
    pending:    ["processing", "completed", "failed", "cancelled"],
    processing: ["completed",  "failed"],
    completed:  ["refunded"],
    failed:     ["pending"],    // allow retry
    cancelled:  [],
    refunded:   [],
  },

  coupon: {
    draft:    ["active", "archived"],
    active:   ["inactive", "expired", "archived"],
    inactive: ["active",  "archived"],
    expired:  ["archived"],
    archived: [],
  },

  banner: {
    draft:     ["published", "archived"],
    published: ["unpublished", "archived"],
    unpublished:["published",  "archived"],
    archived:  [],
  },

  cms_page: {
    draft:     ["published", "archived"],
    published: ["draft",     "archived"],
    archived:  ["draft"],
  },

  review: {
    pending:  ["approved", "rejected"],
    approved: ["rejected"],
    rejected: ["approved"],
  },

  subscription: {
    pending:    ["active",  "cancelled"],
    active:     ["paused",  "cancelled", "expired"],
    paused:     ["active",  "cancelled"],
    expired:    ["active"],   // renewal
    cancelled:  [],
  },

  inventory: {
    in_stock:     ["low_stock",    "out_of_stock"],
    low_stock:    ["in_stock",     "out_of_stock"],
    out_of_stock: ["in_stock",     "backorder"],
    backorder:    ["in_stock",     "out_of_stock"],
    discontinued: [],
  },

  shipment: {
    pending:     ["picked_up",  "cancelled"],
    picked_up:   ["in_transit", "failed"],
    in_transit:  ["delivered",  "failed",  "returned"],
    delivered:   [],
    failed:      ["pending"],
    returned:    ["picked_up"],
    cancelled:   [],
  },

  warranty: {
    submitted:  ["under_review", "rejected"],
    under_review:["approved",    "rejected"],
    approved:   ["resolved"],
    rejected:   ["submitted"],  // allow re-appeal
    resolved:   [],
  },

  referral: {
    pending:   ["rewarded", "expired", "cancelled"],
    rewarded:  [],
    expired:   [],
    cancelled: [],
  },

  fraud_case: {
    open:       ["investigating", "resolved", "dismissed"],
    investigating:["resolved",   "dismissed"],
    resolved:   [],
    dismissed:  [],
  },
};

function validateStatusTransition(module, fromStatus, toStatus) {
  const moduleKey = String(module || "").toLowerCase().replace(/-/g, "_");
  const flow      = FLOWS[moduleKey];

  if (!flow) return;

  const from = String(fromStatus || "").toLowerCase();
  const to   = String(toStatus   || "").toLowerCase();

  if (from === to) return;

  const allowed = flow[from];
  if (!allowed) {
    throw AppError.invalidStatusTransition(from, to, moduleKey);
  }

  if (!allowed.includes(to)) {
    throw new AppError(
      `Status cannot be changed from "${from}" to "${to}" for ${moduleKey}. ` +
        `Allowed transitions: ${allowed.length ? allowed.join(", ") : "none (terminal state)"}.`,
      422,
      null,
      ERROR_CODES.INVALID_TRANSITION,
    );
  }
}

module.exports = { validateStatusTransition };
