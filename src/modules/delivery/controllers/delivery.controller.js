"use strict";

const { okResponse } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { DeliveryService } = require("../services/delivery.service");

class DeliveryController {
  constructor({ deliveryService = new DeliveryService() } = {}) {
    this.deliveryService = deliveryService;
  }

  serviceability = async (req, res) => {
    const result = await this.deliveryService.getServiceability(req.query.pincode);
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
    res.json(okResponse(result));
  };

  trackingWebhook = async (req, res) => {
    const result = await this.deliveryService.handleTrackingWebhook(req.body);
    res.json(okResponse(result));
  };

  createManifest = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.createManifest(req.body, actor);
    res.status(201).json(okResponse(result));
  };

  createEWayBill = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.createEWayBill(req.params.orderId, req.body, actor);
    res.status(201).json(okResponse(result));
  };

  getEWayBill = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.getEWayBill(req.params.orderId, actor);
    res.json(okResponse(result));
  };

  updateEWayBillStatus = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.updateEWayBillStatus(req.params.ewayBillId, req.body, actor);
    res.json(okResponse(result));
  };
}

module.exports = { DeliveryController };
