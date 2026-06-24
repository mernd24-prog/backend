const { AppError } = require("../../../shared/errors/app-error");
const { WarehouseModel } = require("../models/warehouse.model");
const {
  AdminStateModel,
  AdminCityModel,
  AdminZipCodeModel,
} = require("../../admin/models/common-management.model");

const toPage = ({ page = 1, limit = 20, size } = {}) => {
  const pageNumber = Math.max(Number(page || 1), 1);
  const limitNumber = Math.min(Math.max(Number(limit || size || 20), 1), 100);
  return {
    page: pageNumber,
    limit: limitNumber,
    skip: (pageNumber - 1) * limitNumber,
  };
};

const regex = (value = "") => ({ $regex: String(value || ""), $options: "i" });

const buildSort = (sortBy = "createdAt", sortDir = "desc") => {
  const direction = sortDir === "asc" ? 1 : -1;
  const map = {
    createdAt: { createdAt: direction },
    updatedAt: { updatedAt: direction },
    name: { name: direction },
    code: { code: direction },
    skuCount: { skuCount: direction },
    capacity: { capacity: direction },
    active: { active: direction, name: 1 },
  };
  return map[sortBy] || { createdAt: -1 };
};

class WarehouseService {
  toResponse(record = {}) {
    const item = typeof record.toObject === "function" ? record.toObject() : record;
    return {
      ...item,
      _id: String(item._id),
      id: String(item._id),
      isDisable: item.active === false,
    };
  }

  async list(query = {}) {
    const page = toPage(query);
    const filter = {};
    const q = query.q || query.search || query.keyWord || "";

    if (query.active !== undefined) {
      filter.active = query.active === true || query.active === "true";
    }
    if (query.countryId) filter.countryId = query.countryId;
    if (query.stateId) filter.stateId = query.stateId;
    if (query.cityId) filter.cityId = query.cityId;
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.organizationId) filter.organizationId = query.organizationId;
    if (q) {
      filter.$or = [
        { name: regex(q) },
        { code: regex(q) },
        { managerName: regex(q) },
        { pincode: regex(q) },
      ];
    }

    const populate = [
      { path: "countryId", select: "name code" },
      { path: "stateId", select: "name countryId" },
      { path: "cityId", select: "name stateId" },
      { path: "zipCodeId", select: "zipCode areaName" },
    ];

    const sort = buildSort(query.sortBy, query.sortDir);
    const [items, total] = await Promise.all([
      WarehouseModel.find(filter)
        .sort(sort)
        .skip(page.skip)
        .limit(page.limit)
        .populate(populate),
      WarehouseModel.countDocuments(filter),
    ]);

    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      page: page.page,
      limit: page.limit,
    };
  }

  async assertLocation({ countryId, stateId, cityId, zipCodeId }) {
    const state = await AdminStateModel.findOne({ _id: stateId, countryId }).select("_id").lean();
    if (!state) throw new AppError("State does not belong to selected country", 400);

    const city = await AdminCityModel.findOne({ _id: cityId, stateId }).select("_id").lean();
    if (!city) throw new AppError("City does not belong to selected state", 400);

    if (zipCodeId) {
      const zip = await AdminZipCodeModel.findOne({ _id: zipCodeId, countryId, stateId, cityId })
        .select("_id zipCode")
        .lean();
      if (!zip) throw new AppError("Zip code does not belong to selected city", 400);
      return { pincode: zip.zipCode };
    }

    return {};
  }

  async create(payload, actor = {}) {
    const derived = await this.assertLocation(payload);
    const warehouse = await WarehouseModel.create({
      name: payload.name,
      sellerId: payload.sellerId || actor.ownerSellerId || actor.userId || "",
      organizationId: payload.organizationId || actor.organizationId || "",
      code: String(payload.code || "").toUpperCase(),
      managerName: payload.managerName || "",
      managerPhone: payload.managerPhone || "",
      managerEmail: payload.managerEmail || "",
      addressLine1: payload.addressLine1,
      addressLine2: payload.addressLine2 || "",
      countryId: payload.countryId,
      stateId: payload.stateId,
      cityId: payload.cityId,
      zipCodeId: payload.zipCodeId || null,
      pincode: payload.pincode || derived.pincode,
      capacity: Number(payload.capacity || 0),
      skuCount: Number(payload.skuCount || 0),
      active: payload.active ?? payload.isDisable !== true,
      metadata: payload.metadata || {},
      createdBy: actor.userId || payload.createdBy || null,
      updatedBy: actor.userId || payload.updatedBy || null,
    });
    return this.getById(warehouse._id);
  }

  async getById(id) {
    const warehouse = await WarehouseModel.findById(id).populate([
      { path: "countryId", select: "name code" },
      { path: "stateId", select: "name countryId" },
      { path: "cityId", select: "name stateId" },
      { path: "zipCodeId", select: "zipCode areaName" },
    ]);
    if (!warehouse) throw new AppError("Warehouse not found", 404);
    return this.toResponse(warehouse);
  }

  async update(id, payload, actor = {}) {
    const existing = await WarehouseModel.findById(id);
    if (!existing) throw new AppError("Warehouse not found", 404);

    const nextLocation = {
      countryId: payload.countryId || existing.countryId,
      stateId: payload.stateId || existing.stateId,
      cityId: payload.cityId || existing.cityId,
      zipCodeId: payload.zipCodeId !== undefined ? payload.zipCodeId : existing.zipCodeId,
    };
    const derived = await this.assertLocation(nextLocation);
    const updates = {};
    [
      "name",
      "managerName",
      "managerPhone",
      "managerEmail",
      "addressLine1",
      "addressLine2",
      "countryId",
      "stateId",
      "cityId",
      "zipCodeId",
      "pincode",
      "capacity",
      "skuCount",
      "active",
      "metadata",
      "sellerId",
      "organizationId",
    ].forEach((field) => {
      if (payload[field] !== undefined) updates[field] = payload[field];
    });
    if (payload.code !== undefined) updates.code = String(payload.code).toUpperCase();
    if (payload.isDisable !== undefined) updates.active = !payload.isDisable;
    if (!updates.pincode && payload.zipCodeId) updates.pincode = derived.pincode;
    updates.updatedBy = actor.userId || payload.updatedBy || existing.updatedBy || null;

    await WarehouseModel.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    return this.getById(id);
  }

  async setStatus(ids = [], isDisable = false, actor = {}) {
    const normalizedIds = Array.isArray(ids) ? ids : [ids];
    await WarehouseModel.updateMany(
      { _id: { $in: normalizedIds.filter(Boolean) } },
      {
        $set: {
          active: !isDisable,
          updatedBy: actor.userId || null,
        },
      },
    );
    return { updated: normalizedIds.length, active: !isDisable };
  }

  async deleteMany(ids = []) {
    const normalizedIds = Array.isArray(ids) ? ids : [ids];
    await WarehouseModel.deleteMany({ _id: { $in: normalizedIds.filter(Boolean) } });
    return { deleted: normalizedIds.length };
  }
}

module.exports = { WarehouseService };
