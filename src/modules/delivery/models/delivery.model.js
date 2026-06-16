"use strict";

const DELIVERY_STATUS = {
  INITIATED: "initiated",
  MANIFESTED: "manifested",
  PICKED_UP: "picked_up",
  IN_TRANSIT: "in_transit",
  OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  DELIVERED_VERIFIED: "delivered_verified",
  FAILED: "failed",
  CANCELLED: "cancelled",
  RTO: "rto",
  LOST: "lost",
  DAMAGED: "damaged",
};

const SHIPPING_MODES = ["standard", "express", "same_day", "hyperlocal"];
const SHIPMENT_STATUS = DELIVERY_STATUS;
const DELIVERY_VERIFICATION_METHODS = ["otp", "signature", "photo", "qr", "courier_api", "manual_override"];
const DELIVERY_VERIFICATION_STATUS = {
  SENT: "sent",
  VERIFIED: "verified",
  FAILED: "failed",
  OVERRIDDEN: "overridden",
};

module.exports = {
  DELIVERY_STATUS,
  SHIPMENT_STATUS,
  SHIPPING_MODES,
  DELIVERY_VERIFICATION_METHODS,
  DELIVERY_VERIFICATION_STATUS,
};
