"use strict";
const { AppError } = require("../errors/app-error");
const DOORSTEP_CHECKS = ["identity", "serialNumber", "accessories", "packaging", "condition"];
const isDoorstepReturn = request => request.collectionQc?.required === true &&
  request.reverseShipment?.provider !== "customer_manual";
const replacementResolution = request => ["replacement", "exchange"].includes(request.resolution);

function validateDoorstepInspection(request, payload) {
  const approved = (request.items || []).filter(item => Number(item.approvedQuantity) > 0);
  if (!approved.length) throw new AppError("No approved items are available for inspection", 409);
  if (!Array.isArray(payload.items) || payload.items.length !== approved.length)
    throw new AppError("Inspect every approved item exactly once", 400);
  const seen = new Set();
  const decisions = payload.items.map(candidate => {
    const id = String(candidate.orderItemId || "");
    const item = approved.find(entry => String(entry.orderItemId) === id);
    if (!item || seen.has(id)) throw new AppError("Invalid or duplicate inspection item", 400);
    seen.add(id);
    const quantity = Number(candidate.quantity);
    const acceptedQuantity = Number(candidate.acceptedQuantity);
    if (candidate.acceptedQuantity === undefined || candidate.acceptedQuantity === null || candidate.acceptedQuantity === "" ||
      !Number.isInteger(quantity) || quantity !== Number(item.approvedQuantity) ||
      !Number.isInteger(acceptedQuantity) || acceptedQuantity < 0 || acceptedQuantity > quantity)
      throw new AppError("Inspect the approved quantity and record a valid accepted quantity", 400);
    if (!DOORSTEP_CHECKS.every(key => ["pass", "fail", "not_applicable"].includes(candidate.checks?.[key])))
      throw new AppError("Complete all doorstep checks; use not applicable only where policy allows", 400);
    if ([candidate.checks.identity, candidate.checks.condition].includes("not_applicable"))
      throw new AppError("Identity and condition checks cannot be marked not applicable", 400);
    if (acceptedQuantity === 0 && !Object.values(candidate.checks).includes("fail"))
      throw new AppError("Zero accepted units require a failed inspection check; passing units must be accepted", 400);
    if (acceptedQuantity === 0 && !["missing", "rejected"].includes(candidate.result))
      throw new AppError("Zero accepted units require a rejected or missing disposition", 400);
    if (acceptedQuantity > 0 && (candidate.checks.identity !== "pass" || candidate.checks.condition !== "pass" ||
      Object.values(candidate.checks).includes("fail")))
      throw new AppError("Accepted units must pass identity, condition and every applicable check", 400);
    if (!["sellable", "damaged", "missing", "rejected"].includes(candidate.result) ||
      (acceptedQuantity > 0 && !["sellable", "damaged"].includes(candidate.result)))
      throw new AppError("Accepted units require a sellable or reported-damage disposition", 400);
    if (acceptedQuantity > 0 && candidate.result === "damaged" &&
      !["defective", "damaged_in_transit", "quality_issue", "not_as_described"].includes(request.reason))
      throw new AppError("Unreported damage is not eligible for collection; record failed QC with evidence", 409);
    if (!String(candidate.notes || "").trim() || !candidate.photos?.length ||
      candidate.photos.some(photo => typeof photo !== "string" || !photo.trim()))
      throw new AppError("Inspection notes and photos are required for every item", 400);
    return { ...candidate, item, quantity, acceptedQuantity };
  });
  if (payload.collectionConfirmed && !decisions.some(item => item.acceptedQuantity > 0))
    throw new AppError("Failed QC items must remain with the customer", 409);
  return decisions;
}
function assertDoorstepTracking(request, status) {
  if (!isDoorstepReturn(request)) return;
  if (request.collectionQc?.collectedAt &&
      ["initiated", "manifested", "pickup_scheduled", "picked_up", "pickup_failed", "failed", "cancelled"].includes(status))
    throw new AppError("The item has already been collected. Record return transit or warehouse receipt; pickup cannot fail or restart after handover", 409);
  if (["picked_up", "in_transit", "out_for_delivery", "delivered", "received"].includes(status) &&
    !request.collectionQc?.collectedAt)
    throw new AppError("Record doorstep QC and confirm collection before advancing return tracking", 409);
}
module.exports = { DOORSTEP_CHECKS, isDoorstepReturn, replacementResolution, validateDoorstepInspection, assertDoorstepTracking };
