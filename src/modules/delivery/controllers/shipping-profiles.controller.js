"use strict";

const { ShippingProfilesService } = require("../services/shipping-profiles.service");
const { getCurrentUser } = require("../../../shared/auth/current-user");

const service = new ShippingProfilesService();
const toBooleanQuery = (value) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  return value === "true";
};

class ShippingProfilesController {
  list = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await service.list({
      sellerId: req.query.sellerId,
      organizationId: req.query.organizationId,
      active: toBooleanQuery(req.query.active),
      includeArchived: toBooleanQuery(req.query.includeArchived) === true,
      search: req.query.search,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    }, actor);
    res.json({ success: true, data: result });
  };

  listTemplates = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await service.listTemplates({
      status: req.query.status,
      active: toBooleanQuery(req.query.active),
      search: req.query.search,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    }, actor);
    res.json({ success: true, data: result });
  };

  getTemplate = async (req, res) => {
    const actor = getCurrentUser(req);
    const template = await service.getTemplate(req.params.templateId, actor);
    res.json({ success: true, data: template });
  };

  createTemplate = async (req, res) => {
    const actor = getCurrentUser(req);
    const template = await service.createTemplate(req.body, actor);
    res.status(201).json({ success: true, data: template });
  };

  updateTemplate = async (req, res) => {
    const actor = getCurrentUser(req);
    const template = await service.updateTemplate(req.params.templateId, req.body, actor);
    res.json({ success: true, data: template });
  };

  archiveTemplate = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await service.archiveTemplate(req.params.templateId, actor);
    res.json({ success: true, data: result });
  };

  cloneTemplate = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await service.cloneTemplate(req.params.templateId, req.body, actor);
    res.status(201).json({ success: true, data: profile });
  };

  get = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await service.get(req.params.profileId, actor);
    res.json({ success: true, data: profile });
  };

  create = async (req, res) => {
    const actor = getCurrentUser(req);
    const payload = {
      ...req.body,
      sellerId: req.body.sellerId,
    };
    const profile = await service.create(payload, actor);
    res.status(201).json({ success: true, data: profile });
  };

  update = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await service.update(req.params.profileId, req.body, actor);
    res.json({ success: true, data: profile });
  };

  delete = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await service.delete(req.params.profileId, actor);
    res.json({ success: true, data: result });
  };

  bulkDelete = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await service.bulkDelete(req.body.profileIds, actor);
    res.json({ success: true, data: result });
  };

  setDefault = async (req, res) => {
    const actor = getCurrentUser(req);
    const profile = await service.setDefault(req.params.profileId, actor);
    res.json({ success: true, data: profile });
  };
}

module.exports = { ShippingProfilesController };
