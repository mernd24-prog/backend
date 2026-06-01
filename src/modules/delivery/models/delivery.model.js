"use strict";

const DELIVERY_STATUS = {
  INITIATED: "initiated",
  MANIFESTED: "manifested",
  PICKED_UP: "picked_up",
  IN_TRANSIT: "in_transit",
  OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  FAILED: "failed",
  CANCELLED: "cancelled",
  RTO: "rto",
  LOST: "lost",
  DAMAGED: "damaged",
};

const SHIPPING_MODES = ["standard", "express", "same_day", "hyperlocal"];
const SHIPMENT_STATUS = DELIVERY_STATUS;

module.exports = { DELIVERY_STATUS, SHIPMENT_STATUS, SHIPPING_MODES };
