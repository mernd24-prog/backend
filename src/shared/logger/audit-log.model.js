const { mongoose } = require("../../infrastructure/mongo/mongo-client");

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: String, index: true },
    method: { type: String, required: true },
    path: { type: String, required: true, index: true },
    statusCode: { type: Number, required: true },
    requestId: { type: String },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true },
);

const AuditLogModel = mongoose.model("AuditLog", auditLogSchema);

module.exports = { AuditLogModel };
