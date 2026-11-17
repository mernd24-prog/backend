const returnDisplayStatuses = {
  received: "return_received", reverse_pickup_scheduled: "return_pickup_scheduled",
  pickup_failed: "return_pickup_failed", manual_ship_back: "return_ship_back_required",
  shipped_back: "return_shipped_back", in_reverse_transit: "return_in_transit",
  qc_passed: "return_qc_passed", qc_completed: "return_qc_passed", qc_failed: "return_qc_failed",
};
const normalizeReturnDisplayStatus = status => returnDisplayStatuses[status] || status;
const isReturnDisplayStatus = status => /^(return_|refund_|replacement_)/.test(status) || ["refunded", "partially_refunded", "returned", "partially_returned", "replaced"].includes(status);
function aggregateReturnDisplay(statuses = []) {
  const active = statuses.filter(status => status !== "cancelled");
  if (!active.some(isReturnDisplayStatus)) return null;
  return active.every(status => status === active[0]) ? active[0] : "return_in_progress";
}
module.exports = { normalizeReturnDisplayStatus, aggregateReturnDisplay };
