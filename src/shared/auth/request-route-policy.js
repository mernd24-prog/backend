// Generated from the existing mounted Express routes by
// Admin/scripts/audit-rbac-routes.cjs. Specific route guards take precedence
// over URL heuristics, including when a parent router checks permissions.
const rows = require("./route-permission-map.json");
const escape = (value) => Array.from(value, char => ".+*?^$[](){}|\\".includes(char) ? "\\" + char : char).join("");
const rules = rows
  .map(([method, path, module, action]) => ({
    method,
    path,
    module,
    action,
    specificity: path
      .split("/")
      .filter((segment) => segment && !segment.startsWith(":")).length,
    pattern: new RegExp(
      `^${path
        .split("/")
        .map((segment) => (segment.startsWith(":") ? "[^/]+" : escape(segment)))
        .join("/")}/?$`, "i",
    ),
  }))
  .sort(
    (a, b) => b.specificity - a.specificity || b.path.length - a.path.length,
  );

function getRoutePermission(req = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const url = String(req.originalUrl || req.path || "").split("?")[0];
  const path = url.replace(/^\/api(?:\/v\d+)?(?=\/|$)/i, "") || "/";
  return (
    rules.find(
      (rule) =>
        (rule.method === method ||
          (method === "HEAD" && rule.method === "GET")) &&
        rule.pattern.test(path),
    ) || null
  );
}
module.exports = { getRoutePermission };
