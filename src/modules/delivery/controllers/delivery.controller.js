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

  listDeliveryAgents = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.listDeliveryAgents(req.query, actor);
    res.json(okResponse(result));
  };

  createDeliveryAgent = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.createDeliveryAgent(req.body, actor);
    await auditService.create(req, {
      module: "delivery",
      entityId: result?.id,
      entityType: "DeliveryAgent",
      newData: result,
    });
    res.status(201).json(okResponse(result, { message: "Delivery agent created" }));
  };

  getDeliveryAgent = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.getDeliveryAgent(req.params.deliveryAgentId, actor);
    res.json(okResponse(result));
  };

  updateDeliveryAgent = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.updateDeliveryAgent(req.params.deliveryAgentId, req.body, actor);
    await auditService.update(req, {
      module: "delivery",
      entityId: req.params.deliveryAgentId,
      entityType: "DeliveryAgent",
      newData: result,
    });
    res.json(okResponse(result, { message: "Delivery agent updated" }));
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

  assignDeliveryAgent = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.assignDeliveryAgent(
      req.params.shipmentId,
      req.body.deliveryAgentId,
      actor,
    );
    await auditService.statusChange(req, {
      module: "delivery",
      entityId: req.params.shipmentId,
      entityType: "Shipment",
      newData: result,
      reason: "delivery_agent_assigned",
    });
    res.json(okResponse(result, { message: "Delivery agent assigned" }));
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

  generateDeliveryOtp = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.generateDeliveryOtp(req.params.shipmentId, req.body, actor);
    await auditService.create(req, {
      module: "delivery",
      entityId: req.params.shipmentId,
      entityType: "DeliveryVerificationOtp",
      newData: {
        shipmentId: req.params.shipmentId,
        expiresAt: result.expiresAt,
        channels: result.channels,
      },
    });
    res.status(201).json(okResponse(result, { message: "Delivery OTP generated" }));
  };

  confirmDelivery = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.confirmDelivery(req.params.shipmentId, req.body, actor);
    await auditService.statusChange(req, {
      module: "delivery",
      entityId: req.params.shipmentId,
      entityType: "Shipment",
      newData: result,
      reason: req.body.note || req.body.reason || `delivery_verified_${req.body.method || "otp"}`,
    });
    res.json(okResponse(result, { message: "Delivery verified" }));
  };

  trackingWebhook = async (req, res) => {
    const result = await this.deliveryService.handleTrackingWebhook(req.body, {
      signature: req.headers["x-delivery-signature"],
      rawBody: req.rawBody,
    });
    res.json(okResponse(result));
  };

  createManifest = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.createManifest(req.body, actor);
    await auditService.create(req, {
      module: "delivery",
      entityId: result?.id,
      entityType: "ShipmentManifest",
      newData: result,
    });
    res.status(201).json(okResponse(result));
  };

  createEWayBill = async (req, res) => {
    const actor = getCurrentUser(req);
    const result = await this.deliveryService.createEWayBill(req.params.orderId, req.body, actor);
    await auditService.create(req, {
      module: "delivery",
      entityId: result?.id,
      entityType: "EWayBill",
      newData: result,
    });
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
    await auditService.statusChange(req, {
      module: "delivery",
      entityId: req.params.ewayBillId,
      entityType: "EWayBill",
      newData: result,
      reason: `eway_bill_${req.body.status}`,
    });
    res.json(okResponse(result));
  };
}

module.exports = { DeliveryController };
