const { DataTypes } = require("sequelize");
const { sequelize } = require("../sequelize-client");

const TaxInvoice = sequelize.define(
  "TaxInvoice",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    invoiceNumber: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: "invoice_number" },
    orderId: { type: DataTypes.UUID, allowNull: false, field: "order_id" },
    buyerId: { type: DataTypes.STRING(64), allowNull: false, field: "buyer_id" },
    taxableAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, field: "taxable_amount" },
    taxAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, field: "tax_amount" },
    cgstAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, field: "cgst_amount" },
    sgstAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, field: "sgst_amount" },
    igstAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, field: "igst_amount" },
    tcsAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, field: "tcs_amount" },
    totalAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, field: "total_amount" },
    currency: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "INR" },
    taxMode: { type: DataTypes.STRING(32), allowNull: false, field: "tax_mode" },
    gstinMarketplace: { type: DataTypes.STRING(32), field: "gstin_marketplace" },
    gstinSeller: { type: DataTypes.STRING(32), field: "gstin_seller" },
    placeOfSupply: { type: DataTypes.STRING(64), field: "place_of_supply" },
    issuedAt: { type: DataTypes.DATE, allowNull: false, field: "issued_at" },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName: "tax_invoices",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

const TaxLedgerEntry = sequelize.define(
  "TaxLedgerEntry",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    orderId: { type: DataTypes.UUID, allowNull: false, field: "order_id" },
    invoiceId: { type: DataTypes.UUID, field: "invoice_id" },
    entryType: { type: DataTypes.STRING(32), allowNull: false, field: "entry_type" },
    taxComponent: { type: DataTypes.STRING(16), allowNull: false, field: "tax_component" },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    currency: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "INR" },
    referenceType: { type: DataTypes.STRING(32), allowNull: false, field: "reference_type" },
    referenceId: { type: DataTypes.STRING(64), allowNull: false, field: "reference_id" },
  },
  {
    tableName: "tax_ledger_entries",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

const VendorPayout = sequelize.define(
  "VendorPayout",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    sellerId: { type: DataTypes.STRING(64), allowNull: false, field: "seller_id" },
    periodStart: { type: DataTypes.DATE, allowNull: false, field: "period_start" },
    periodEnd: { type: DataTypes.DATE, allowNull: false, field: "period_end" },
    grossAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, field: "gross_amount" },
    commissionAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, field: "commission_amount" },
    processingFeeAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      field: "processing_fee_amount",
    },
    taxWithheldAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      field: "tax_withheld_amount",
    },
    netPayoutAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, field: "net_payout_amount" },
    currency: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "INR" },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "scheduled" },
    scheduledAt: { type: DataTypes.DATE, allowNull: false, field: "scheduled_at" },
    processedAt: { type: DataTypes.DATE, field: "processed_at" },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName: "vendor_payouts",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

const AdminActionLog = sequelize.define(
  "AdminActionLog",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    adminId: { type: DataTypes.STRING(64), allowNull: false, field: "admin_id" },
    actionType: { type: DataTypes.STRING(64), allowNull: false, field: "action_type" },
    targetType: { type: DataTypes.STRING(64), allowNull: false, field: "target_type" },
    targetId: { type: DataTypes.STRING(64), allowNull: false, field: "target_id" },
    ipAddress: { type: DataTypes.STRING(64), field: "ip_address" },
    userAgent: { type: DataTypes.TEXT, field: "user_agent" },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName: "admin_action_logs",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);

const GstFiling = sequelize.define(
  "GstFiling",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    filingPeriod: { type: DataTypes.STRING(16), allowNull: false, unique: true, field: "filing_period" },
    gstrType: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "GSTR-8", field: "gstr_type" },
    totalTaxableValue: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: "total_taxable_value" },
    totalTcsCollected: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: "total_tcs_collected" },
    totalCgst: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: "total_cgst" },
    totalSgst: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: "total_sgst" },
    totalIgst: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: "total_igst" },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "draft" },
    filedAt: { type: DataTypes.DATE, field: "filed_at" },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName: "gst_filings",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

const Module = sequelize.define(
  "Module",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    name: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    slug: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    moduleKey: { type: DataTypes.STRING(128), allowNull: true, unique: true, field: "module_key" },
    description: { type: DataTypes.TEXT },
    icon: { type: DataTypes.STRING(128) },
    routePath: { type: DataTypes.STRING(256), field: "route_path" },
    parentModuleId: { type: DataTypes.UUID, field: "parent_module_id" },
    moduleType: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "module", field: "module_type" },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "active" },
    modulePermissions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "module_permissions" },
    isVisibleInSidebar: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_visible_in_sidebar" },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName: "modules",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

const Permission = sequelize.define(
  "Permission",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    moduleId: { type: DataTypes.UUID, allowNull: false, field: "module_id" },
    name: { type: DataTypes.STRING(128), allowNull: false },
    slug: { type: DataTypes.STRING(128), allowNull: false },
    description: { type: DataTypes.TEXT },
    action: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "view" },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName: "permissions",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

const Role = sequelize.define(
  "Role",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    name: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    slug: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    description: { type: DataTypes.TEXT },
    type: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "custom" },
    isSuperAdmin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_super_admin" },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName: "roles",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

const RolePermission = sequelize.define(
  "RolePermission",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    roleId: { type: DataTypes.UUID, allowNull: false, field: "role_id" },
    permissionId: { type: DataTypes.UUID, allowNull: false, field: "permission_id" },
  },
  {
    tableName: "role_permissions",
    timestamps: false,
    createdAt: "created_at",
  },
);

const UserPermission = sequelize.define(
  "UserPermission",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    userId: { type: DataTypes.STRING(64), allowNull: false, field: "user_id" },
    permissionId: { type: DataTypes.UUID, allowNull: false, field: "permission_id" },
    grantedBy: { type: DataTypes.STRING(64), field: "granted_by" },
    grantedAt: { type: DataTypes.DATE, allowNull: false, field: "granted_at" },
    revokedAt: { type: DataTypes.DATE, field: "revoked_at" },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName: "user_permissions",
    timestamps: false,
  },
);

const UserRole = sequelize.define(
  "UserRole",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    userId: { type: DataTypes.STRING(64), allowNull: false, field: "user_id" },
    roleId: { type: DataTypes.UUID, allowNull: false, field: "role_id" },
    assignedBy: { type: DataTypes.STRING(64), field: "assigned_by" },
    assignedAt: { type: DataTypes.DATE, allowNull: false, field: "assigned_at" },
    revokedAt: { type: DataTypes.DATE, field: "revoked_at" },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
  },
  {
    tableName: "user_roles",
    timestamps: false,
  },
);

const SuperAdmin = sequelize.define(
  "SuperAdmin",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    userId: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: "user_id" },
    email: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    fullName: { type: DataTypes.STRING(128), field: "full_name" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
  },
  {
    tableName: "super_admins",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

// Define relationships
Permission.belongsTo(Module, { foreignKey: "module_id", as: "module" });
Module.hasMany(Permission, { foreignKey: "module_id", as: "permissions" });
Module.belongsTo(Module, { foreignKey: "parent_module_id", as: "parentModule" });
Module.hasMany(Module, { foreignKey: "parent_module_id", as: "children" });

RolePermission.belongsTo(Role, { foreignKey: "role_id", as: "role" });
RolePermission.belongsTo(Permission, { foreignKey: "permission_id", as: "permission" });
Role.hasMany(RolePermission, { foreignKey: "role_id", as: "rolePermissions" });

UserPermission.belongsTo(Permission, { foreignKey: "permission_id", as: "permission" });
Permission.hasMany(UserPermission, { foreignKey: "permission_id", as: "userPermissions" });

UserRole.belongsTo(Role, { foreignKey: "role_id", as: "role" });
Role.hasMany(UserRole, { foreignKey: "role_id", as: "userRoles" });

TaxInvoice.hasMany(TaxLedgerEntry, { foreignKey: "invoice_id", sourceKey: "id", as: "entries" });
TaxLedgerEntry.belongsTo(TaxInvoice, { foreignKey: "invoice_id", targetKey: "id", as: "invoice" });

module.exports = {
  sequelize,
  TaxInvoice,
  TaxLedgerEntry,
  VendorPayout,
  AdminActionLog,
  GstFiling,
  Module,
  Permission,
  Role,
  RolePermission,
  UserPermission,
  UserRole,
  SuperAdmin,
};
