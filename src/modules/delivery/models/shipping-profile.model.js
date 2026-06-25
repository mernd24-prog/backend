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
    allowedStates: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "allowed_states" },
    allowedCities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "allowed_cities" },
    allowedPincodes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "allowed_pincodes" },
    blockedPincodes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: "blocked_pincodes" },
    codAvailable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "cod_available" },
    shippingCharge: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0, field: "shipping_charge" },
    freeShippingThreshold: { type: DataTypes.DECIMAL(10, 2), allowNull: true, field: "free_shipping_threshold" },
    etaMin: { type: DataTypes.INTEGER, allowNull: true, field: "eta_min" },
    etaMax: { type: DataTypes.INTEGER, allowNull: true, field: "eta_max" },
    isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_default" },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "active" },
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
