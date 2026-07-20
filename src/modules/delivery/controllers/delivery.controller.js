"use strict";

const { okResponse } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { DeliveryService } = require("../services/delivery.service");
const { auditService } = require("../../../shared/logger/audit.service");

class DeliveryController {
  constructor({ deliveryService = new DeliveryService() } = {}) {
    this.deliveryService = deliveryService;
  }

  serviceability = async (req, res) => {
    const result = await this.deliveryService.getServiceability(req.query.pincode, {
      productId: req.query.productId,
    });
    res.json(okResponse(result));
  };

  rate = async (req, res) => {
    const result = await this.deliveryService.calculateRate(req.query);
    res.json(okResponse(result));
  };

  listShipments = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.listShipments(req.query, actor);
    res.json(okResponse(result));
  };

  createShipment = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.createShipment(req.body, actor);
    await auditService.create(req, {
      module: "delivery",
      entityId: result?.id,
      entityType: "Shipment",
      newData: result,
    });
    res.status(201).json(okResponse(result));
  };

  getShipment = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.getShipment(req.params.shipmentId, actor);
    res.json(okResponse(result));
  };

  addTrackingEvent = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.addTrackingEvent(req.params.shipmentId, req.body, actor);
    await auditService.statusChange(req, {
      module: "delivery",
      entityId: req.params.shipmentId,
      entityType: "Shipment",
      newData: result,
      reason: req.body.note || req.body.deliveryException || `tracking_${req.body.status}`,
    });
    res.json(okResponse(result));
  };

}

module.exports = { DeliveryController };
