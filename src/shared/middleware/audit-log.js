const { AuditLogModel } = require("../logger/audit-log.model");

function auditLog(req, res, next) {
  res.on("finish", () => {
    if (req.path === "/health") {
      return;
    }

    AuditLogModel.create({
      actorId: req.auth?.sub || null,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      requestId: req.id,
      ip: req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    }).catch(() => {});
  });

  next();
}

module.exports = { auditLog };
