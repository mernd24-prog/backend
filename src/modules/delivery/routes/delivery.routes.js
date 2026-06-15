"use strict";

const express = require("express");
const { DeliveryController } = require("../controllers/delivery.controller");
const { authenticate } = require("../../../shared/middleware/authenticate");
const { allowPermissions } = require("../../../shared/middleware/access");
const { checkInput } = require("../../../shared/middleware/check-input");
const { catchErrors } = require("../../../shared/middleware/catch-errors");
const {
  serviceabilitySchema,
  rateSchema,
  listShipmentsSchema,
  createShipmentSchema,
  shipmentParamSchema,
  trackingEventSchema,
  trackingWebhookSchema,
  createManifestSchema,
  orderDeliveryParamSchema,
  createEWayBillSchema,
  updateEWayBillStatusSchema,
} = require("../validation/delivery.validation");

const deliveryRoutes = express.Router();
const deliveryController = new DeliveryController();

deliveryRoutes.get(
  "/serviceability",
  checkInput(serviceabilitySchema),
  catchErrors(deliveryController.serviceability),
);

deliveryRoutes.get(
  "/rates",
  checkInput(rateSchema),
  catchErrors(deliveryController.rate),
);

deliveryRoutes.get(
  "/shipments",
  authenticate,
  allowPermissions("delivery:view"),
  checkInput(listShipmentsSchema),
  catchErrors(deliveryController.listShipments),
);

deliveryRoutes.post(
  "/shipments",
  authenticate,
  allowPermissions("delivery:create"),
  checkInput(createShipmentSchema),
  catchErrors(deliveryController.createShipment),
);

deliveryRoutes.get(
  "/shipments/:shipmentId",
  authenticate,
  allowPermissions("delivery:view"),
  checkInput(shipmentParamSchema),
  catchErrors(deliveryController.getShipment),
);

deliveryRoutes.post(
  "/shipments/:shipmentId/tracking",
  authenticate,
  allowPermissions("delivery:status_change"),
  checkInput(trackingEventSchema),
  catchErrors(deliveryController.addTrackingEvent),
);

deliveryRoutes.post(
  "/shipments/webhook",
  checkInput(trackingWebhookSchema),
  catchErrors(deliveryController.trackingWebhook),
);

deliveryRoutes.post(
  "/manifests",
  authenticate,
  allowPermissions("delivery:create"),
  checkInput(createManifestSchema),
  catchErrors(deliveryController.createManifest),
);

deliveryRoutes.get(
  "/orders/:orderId/eway-bill",
  authenticate,
  allowPermissions("delivery:view"),
  checkInput(orderDeliveryParamSchema),
  catchErrors(deliveryController.getEWayBill),
);

deliveryRoutes.post(
  "/orders/:orderId/eway-bill",
  authenticate,
  allowPermissions("delivery:create"),
  checkInput(createEWayBillSchema),
  catchErrors(deliveryController.createEWayBill),
);

deliveryRoutes.patch(
  "/eway-bills/:ewayBillId/status",
  authenticate,
  allowPermissions("delivery:status_change"),
  checkInput(updateEWayBillStatusSchema),
  catchErrors(deliveryController.updateEWayBillStatus),
);

module.exports = { deliveryRoutes };
