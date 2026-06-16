"use strict";

const { okResponse } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { auditService } = require("../../../shared/logger/audit.service");
const { DealService } = require("../services/deal.service");

class DealController {
  constructor({ dealService = new DealService() } = {}) {
    this.dealService = dealService;
  }

  listDeals = async (req, res) => {
    const result = await this.dealService.listDeals(req.query, getCurrentUser(req));
    res.json(okResponse(result));
  };

  createDeal = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.dealService.createDeal(req.body, actor);
    await auditService.create(req, {
      module: "deals",
      entityId: result?.id,
      entityType: "Deal",
      newData: result,
    });
    res.status(201).json(okResponse(result));
  };

  getDeal = async (req, res) => {
    const result = await this.dealService.getDeal(req.params.dealId, getCurrentUser(req));
    res.json(okResponse(result));
  };

  updateDeal = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.dealService.updateDeal(req.params.dealId, req.body, actor);
    await auditService.update(req, {
      module: "deals",
      entityId: req.params.dealId,
      entityType: "Deal",
      newData: result,
    });
    res.json(okResponse(result));
  };

  submitDeal = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.dealService.submitDeal(req.params.dealId, req.body, actor);
    await auditService.statusChange(req, {
      module: "deals",
      entityId: req.params.dealId,
      entityType: "Deal",
      newData: result,
      reason: "submitted_for_approval",
    });
    res.json(okResponse(result));
  };

  approveDeal = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.dealService.approveDeal(req.params.dealId, req.body, actor);
    await auditService.statusChange(req, {
      module: "deals",
      entityId: req.params.dealId,
      entityType: "Deal",
      newData: result,
      reason: "deal_approved",
    });
    res.json(okResponse(result));
  };

  rejectDeal = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.dealService.rejectDeal(req.params.dealId, req.body, actor);
    await auditService.statusChange(req, {
      module: "deals",
      entityId: req.params.dealId,
      entityType: "Deal",
      newData: result,
      reason: req.body.reason,
    });
    res.json(okResponse(result));
  };

  pauseDeal = async (req, res) => {
    const result = await this.dealService.pauseDeal(req.params.dealId, req.body, getCurrentUser(req));
    res.json(okResponse(result));
  };

  resumeDeal = async (req, res) => {
    const result = await this.dealService.resumeDeal(req.params.dealId, req.body, getCurrentUser(req));
    res.json(okResponse(result));
  };

  cancelDeal = async (req, res) => {
    const result = await this.dealService.cancelDeal(req.params.dealId, req.body, getCurrentUser(req));
    res.json(okResponse(result));
  };

  renewDeal = async (req, res) => {
    const result = await this.dealService.renewDeal(req.params.dealId, req.body, getCurrentUser(req));
    res.status(201).json(okResponse(result));
  };

  upsertCommissionRule = async (req, res) => {
    const result = await this.dealService.upsertCommissionRule(req.params.dealId, req.body, getCurrentUser(req));
    res.json(okResponse(result));
  };

  upsertSponsorship = async (req, res) => {
    const result = await this.dealService.upsertSponsorship(req.params.dealId, req.body, getCurrentUser(req));
    res.json(okResponse(result));
  };

  removeSponsorship = async (req, res) => {
    const result = await this.dealService.removeSponsorship(req.params.sponsorshipId, getCurrentUser(req));
    res.json(okResponse(result));
  };

  publicPlacements = async (req, res) => {
    const result = await this.dealService.getPublicPlacements(req.query);
    res.json(okResponse(result));
  };

  analytics = async (req, res) => {
    const result = await this.dealService.getAnalytics(req.query, getCurrentUser(req));
    res.json(okResponse(result));
  };

  listPayouts = async (req, res) => {
    const result = await this.dealService.listPayouts(req.query, getCurrentUser(req));
    res.json(okResponse(result));
  };

  generatePayout = async (req, res) => {
    const result = await this.dealService.generatePayout(req.body, getCurrentUser(req));
    res.status(201).json(okResponse(result));
  };

  processPayout = async (req, res) => {
    const result = await this.dealService.processPayout(req.params.payoutId, req.body, getCurrentUser(req));
    res.json(okResponse(result));
  };
}

module.exports = { DealController };
