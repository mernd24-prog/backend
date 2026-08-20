"use strict";

const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../infrastructure/sequelize/sequelize-client");

const ShippingProfile = sequelize.define(
  "ShippingProfile",
  {
    id: { type: DataTypes.UUID, primaryKey: true, field: "id" },
    sellerId: { type: DataTypes.STRING(64), allowNull: false, field: "seller_id" },
    organizationId: { type: DataTypes.UUID, allowNull: true, field: "organization_id" },
    name: { type: DataTypes.STRING(128), allowNull: false, field: "name" },
    description: { type: DataTypes.TEXT, allowNull: true, field: "description" },
    shippingMethod: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "standard", field: "shipping_method" },
    serviceabilityMode: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "all_india", field: "serviceability_mode" },
    allowedPincodes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "allowed_pincodes" },
    codAvailable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "cod_available" },
    shippingCharge: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0, field: "shipping_charge" },
    freeShippingThreshold: { type: DataTypes.DECIMAL(10, 2), allowNull: true, field: "free_shipping_threshold" },
    etaMin: { type: DataTypes.INTEGER, allowNull: true, field: "eta_min" },
    etaMax: { type: DataTypes.INTEGER, allowNull: true, field: "eta_max" },
    isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_default" },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "active" },
    sourceTemplateId: { type: DataTypes.UUID, allowNull: true, field: "source_template_id" },
    sourceTemplateVersion: { type: DataTypes.INTEGER, allowNull: true, field: "source_template_version" },
    templateSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "template_snapshot" },
    editableFields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "editable_fields" },
    copiedFromTemplateAt: { type: DataTypes.DATE, allowNull: true, field: "copied_from_template_at" },
    archivedAt: { type: DataTypes.DATE, allowNull: true, field: "archived_at" },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "metadata" },
    createdBy: { type: DataTypes.STRING(64), allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: "updated_by" },
  },
  {
    tableName: "shipping_profiles",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = { ShippingProfile };
