"use strict";
const { AppError } = require("../../../shared/errors/app-error");
function scheduledDealStatus(status, startAt, endAt, now = Date.now()) {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new AppError("Select a valid deal period; end must be after start", 400);
  }
  if (!["active", "scheduled"].includes(status)) return status;
  if (end <= now) return "expired";
  return start > now ? "scheduled" : "active";
}
module.exports = { scheduledDealStatus };
