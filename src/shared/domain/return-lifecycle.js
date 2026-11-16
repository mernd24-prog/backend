// Unknown future return states block completion until explicitly closed.
const CLOSED_RETURN_STATUSES = [
  "rejected",
  "qc_failure_upheld",
  "refunded",
  "replaced",
  "closed",
];
const isOpenReturn = (request = {}) =>
  !CLOSED_RETURN_STATUSES.includes(String(request.status || "").toLowerCase());
module.exports = { CLOSED_RETURN_STATUSES, isOpenReturn };
