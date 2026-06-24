const { ProductRepository } = require("../../product/repositories/product.repository");
const { InventoryReservationModel } = require("../models/inventory-reservation.model");
const { InventoryTransactionModel } = require("../models/inventory-transaction.model");

class InventoryRepository {
  constructor({ productRepository = new ProductRepository() } = {}) {
    this.productRepository = productRepository;
  }

  markChanged(reservation, changed) {
    if (reservation) reservation.$locals.inventoryChanged = Boolean(changed);
    return reservation;
  }

  idempotencyKey(type, referenceId, item) {
    return [
      type,
      referenceId,
      item.productId,
      item.variantSku || item.variantId || "root",
    ].join(":");
  }

  async recordTransaction(type, reference, item, metadata = {}) {
    const referenceType = reference.referenceType || "order";
    const referenceId = reference.referenceId || reference.orderId || reference.returnId || reference.shipmentId;
    const idempotencyKey = reference.idempotencyKey || this.idempotencyKey(type, referenceId, item);

    return InventoryTransactionModel.findOneAndUpdate(
      { idempotencyKey },
      {
        $setOnInsert: {
          type,
          status: reference.status || "completed",
          productId: item.productId,
          variantId: item.variantId || "",
          variantSku: item.variantSku || "",
          sellerId: item.sellerId || "",
          organizationId: item.organizationId || item.organization_id || "",
          quantity: Number(item.quantity || 0),
          orderId: reference.orderId || "",
          returnId: reference.returnId || "",
          shipmentId: reference.shipmentId || "",
          referenceType,
          referenceId,
          idempotencyKey,
          actorId: reference.actorId || "",
          actorRole: reference.actorRole || "",
          metadata,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async recordTransactions(type, reference, items, metadata = {}) {
    return Promise.all(
      (items || []).map((item) => this.recordTransaction(type, reference, item, metadata)),
    );
  }

  async reserveItems(orderId, buyerId, items) {
    const existing = await InventoryReservationModel.findOne({ orderId });
    if (existing && existing.status !== "released") {
      return this.markChanged(existing, false);
    }

    const reservedProducts = [];

    try {
      for (const item of items) {
        const updatedProduct = item.variantSku
          ? await this.productRepository.reserveVariantStock(item.productId, item.variantSku, item.quantity)
          : await this.productRepository.reserveStock(item.productId, item.quantity);
        if (!updatedProduct) {
          throw new Error(`Insufficient stock for product ${item.productId}`);
        }

        reservedProducts.push(item);
      }

      const reservation = await InventoryReservationModel.findOneAndUpdate(
        { orderId },
        {
          $set: {
            buyerId,
            status: "reserved",
            items,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        },
        { upsert: true, new: true },
      );
      await this.recordTransactions("reservation", { orderId, referenceType: "order", referenceId: orderId }, items);
      return this.markChanged(reservation, true);
    } catch (error) {
      await Promise.all(
        reservedProducts.map((item) =>
          item.variantSku
            ? this.productRepository.releaseReservedVariantStock(item.productId, item.variantSku, item.quantity)
            : this.productRepository.releaseReservedStock(item.productId, item.quantity),
        ),
      );
      throw error;
    }
  }

  async findReservationByOrderId(orderId) {
    return InventoryReservationModel.findOne({ orderId });
  }

  async findExpiredReservations({ now = new Date(), limit = 100 } = {}) {
    return InventoryReservationModel.find({
      status: "reserved",
      expiresAt: { $lte: now },
    })
      .sort({ expiresAt: 1, createdAt: 1 })
      .limit(limit);
  }

  async releaseReservation(orderId, options = {}) {
    const reservation = await InventoryReservationModel.findOneAndUpdate(
      { orderId, status: "reserved" },
      {
        $set: {
          status: "release_processing",
          "metadata.releaseStartedAt": new Date(),
          "metadata.releaseReason": options.reason || "inventory_release",
        },
      },
      { new: true },
    );

    if (!reservation) {
      return this.markChanged(await InventoryReservationModel.findOne({ orderId }), false);
    }

    try {
      await Promise.all(
        reservation.items.map((item) =>
          item.variantSku
            ? this.productRepository.releaseReservedVariantStock(item.productId, item.variantSku, item.quantity)
            : this.productRepository.releaseReservedStock(item.productId, item.quantity),
        ),
      );

      reservation.status = "released";
      reservation.metadata = {
        ...(reservation.metadata || {}),
        ...(options.metadata || {}),
        releasedAt: new Date(),
        releaseReason: options.reason || "inventory_release",
      };
      await reservation.save();
      await this.recordTransactions(
        "release",
        {
          orderId,
          referenceType: "order",
          referenceId: orderId,
          actorId: options.actorId || "",
          actorRole: options.actorRole || "",
        },
        reservation.items,
        {
          ...(options.metadata || {}),
          reason: options.reason || "inventory_release",
        },
      );
      return this.markChanged(reservation, true);
    } catch (error) {
      reservation.status = "release_failed";
      reservation.metadata = {
        ...(reservation.metadata || {}),
        releaseFailedAt: new Date(),
        releaseError: error.message,
      };
      await reservation.save();
      throw error;
    }
  }

  async commitReservation(orderId, options = {}) {
    const reservation = await InventoryReservationModel.findOneAndUpdate(
      { orderId, status: "reserved" },
      {
        $set: {
          status: "commit_processing",
          "metadata.commitStartedAt": new Date(),
          "metadata.commitReason": options.reason || "inventory_commit",
        },
      },
      { new: true },
    );

    if (!reservation) {
      return this.markChanged(await InventoryReservationModel.findOne({ orderId }), false);
    }

    try {
      await Promise.all(
        reservation.items.map((item) =>
          item.variantSku
            ? this.productRepository.commitReservedVariantStock(item.productId, item.variantSku, item.quantity)
            : this.productRepository.commitReservedStock(item.productId, item.quantity),
        ),
      );

      reservation.status = "committed";
      reservation.metadata = {
        ...(reservation.metadata || {}),
        ...(options.metadata || {}),
        committedAt: new Date(),
        commitReason: options.reason || "inventory_commit",
      };
      await reservation.save();
      await this.recordTransactions(
        "sale",
        {
          orderId,
          referenceType: "order",
          referenceId: orderId,
          actorId: options.actorId || "",
          actorRole: options.actorRole || "",
        },
        reservation.items,
        {
          ...(options.metadata || {}),
          reason: options.reason || "inventory_commit",
        },
      );
      return this.markChanged(reservation, true);
    } catch (error) {
      reservation.status = "commit_failed";
      reservation.metadata = {
        ...(reservation.metadata || {}),
        commitFailedAt: new Date(),
        commitError: error.message,
      };
      await reservation.save();
      throw error;
    }
  }

  async restockReservation(orderId, options = {}) {
    const reservation = await InventoryReservationModel.findOneAndUpdate(
      { orderId, status: "committed" },
      {
        $set: {
          status: "restock_processing",
          "metadata.restockStartedAt": new Date(),
          "metadata.restockReason": options.reason || "inventory_restock",
        },
      },
      { new: true },
    );

    if (!reservation) {
      return this.markChanged(await InventoryReservationModel.findOne({ orderId }), false);
    }

    try {
      await Promise.all(
        reservation.items.map((item) =>
          item.variantSku
            ? this.productRepository.adjustVariantStock(item.productId, item.variantSku, item.quantity)
            : this.productRepository.addStock(item.productId, item.quantity),
        ),
      );

      reservation.status = "restocked";
      reservation.metadata = {
        ...(reservation.metadata || {}),
        ...(options.metadata || {}),
        restockedAt: new Date(),
        restockReason: options.reason || "inventory_restock",
      };
      await reservation.save();
      await this.recordTransactions(
        "restock",
        {
          orderId,
          referenceType: "order",
          referenceId: orderId,
          actorId: options.actorId || "",
          actorRole: options.actorRole || "",
        },
        reservation.items,
        {
          ...(options.metadata || {}),
          reason: options.reason || "inventory_restock",
        },
      );
      return this.markChanged(reservation, true);
    } catch (error) {
      reservation.status = "restock_failed";
      reservation.metadata = {
        ...(reservation.metadata || {}),
        restockFailedAt: new Date(),
        restockError: error.message,
      };
      await reservation.save();
      throw error;
    }
  }

  async restockItems(reference, items) {
    const transactionType = reference.transactionType || "return";
    const transactionChecks = await Promise.all(
      (items || []).map((item) =>
        InventoryTransactionModel.exists({
          idempotencyKey: this.idempotencyKey(transactionType, reference.referenceId || reference.returnId, item),
        }),
      ),
    );
    const itemsToRestock = (items || []).filter((_, index) => !transactionChecks[index]);
    if (!itemsToRestock.length) return { changed: false, items: [] };

    await Promise.all(
      itemsToRestock.map((item) =>
        item.variantSku
          ? this.productRepository.adjustVariantStock(item.productId, item.variantSku, Number(item.quantity || 0))
          : this.productRepository.addStock(item.productId, Number(item.quantity || 0)),
      ),
    );
    await this.recordTransactions(transactionType, reference, itemsToRestock, reference.metadata || {});
    return { changed: true, items: itemsToRestock };
  }

  async cancelReservationItems(orderId, cancellationId, items, options = {}) {
    const existingReservation = await InventoryReservationModel.findOne({ orderId });
    const appliedCancellationIds = existingReservation?.metadata?.appliedCancellationIds || [];
    if (appliedCancellationIds.includes(String(cancellationId))) {
      const wasCommitted = Boolean(existingReservation.metadata?.committedAt);
      await this.recordTransactions(
        wasCommitted ? "cancellation_restock" : "cancellation_release",
        {
          orderId,
          referenceType: "cancellation",
          referenceId: cancellationId,
          actorId: options.actorId || "",
          actorRole: options.actorRole || "",
        },
        items,
        options.metadata || {},
      );
      return { changed: false, reservation: existingReservation, items, wasCommitted };
    }
    if (
      existingReservation?.status === "cancellation_processing" &&
      String(existingReservation.metadata?.cancellationId || "") === String(cancellationId)
    ) {
      throw new Error("Cancellation inventory is awaiting reconciliation after an interrupted update");
    }

    const reservation = await InventoryReservationModel.findOneAndUpdate(
      { orderId, status: { $in: ["reserved", "committed"] } },
      {
        $set: {
          status: "cancellation_processing",
          "metadata.cancellationStartedAt": new Date(),
          "metadata.cancellationId": cancellationId,
        },
      },
      { new: true },
    );
    if (!reservation) {
      const existing = await InventoryReservationModel.findOne({ orderId });
      return { changed: false, reservation: existing, items: [] };
    }

    const wasCommitted = Boolean(reservation.metadata?.committedAt);
    const cancelled = [];
    const adjusted = [];
    try {
      for (const requested of items || []) {
        const reservedItem = reservation.items.find((item) =>
          String(item.productId) === String(requested.productId) &&
          String(item.variantSku || item.variantId || "") === String(requested.variantSku || requested.variantId || ""),
        );
        if (!reservedItem) throw new Error(`Inventory reservation item not found for ${requested.productId}`);
        const quantity = Number(requested.quantity || 0);
        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > Number(reservedItem.quantity || 0)) {
          throw new Error(`Invalid cancellation quantity for ${requested.productId}`);
        }

        if (wasCommitted) {
          if (requested.variantSku) {
            await this.productRepository.adjustVariantStock(requested.productId, requested.variantSku, quantity);
          } else {
            await this.productRepository.addStock(requested.productId, quantity);
          }
        } else if (requested.variantSku) {
          await this.productRepository.releaseReservedVariantStock(requested.productId, requested.variantSku, quantity);
        } else {
          await this.productRepository.releaseReservedStock(requested.productId, quantity);
        }
        adjusted.push({ ...requested, quantity });
        reservedItem.quantity = Number(reservedItem.quantity || 0) - quantity;
        cancelled.push({ ...requested, quantity });
      }

      reservation.items = reservation.items.filter((item) => Number(item.quantity || 0) > 0);
      reservation.status = reservation.items.length
        ? wasCommitted ? "committed" : "reserved"
        : wasCommitted ? "restocked" : "released";
      reservation.metadata = {
        ...(reservation.metadata || {}),
        ...(options.metadata || {}),
        lastCancellationId: cancellationId,
        appliedCancellationIds: [
          ...new Set([...(reservation.metadata?.appliedCancellationIds || []), String(cancellationId)]),
        ],
        cancellationCompletedAt: new Date(),
      };
      await reservation.save();
      await this.recordTransactions(
        wasCommitted ? "cancellation_restock" : "cancellation_release",
        {
          orderId,
          referenceType: "cancellation",
          referenceId: cancellationId,
          actorId: options.actorId || "",
          actorRole: options.actorRole || "",
        },
        cancelled,
        options.metadata || {},
      );
      return { changed: true, reservation, items: cancelled, wasCommitted };
    } catch (error) {
      const compensationErrors = [];
      for (const item of adjusted.reverse()) {
        try {
          if (wasCommitted) {
            if (item.variantSku) {
              await this.productRepository.adjustVariantStock(item.productId, item.variantSku, -Number(item.quantity || 0));
            } else {
              await this.productRepository.adjustStock(item.productId, -Number(item.quantity || 0));
            }
          } else if (item.variantSku) {
            await this.productRepository.reserveVariantStock(item.productId, item.variantSku, Number(item.quantity || 0));
          } else {
            await this.productRepository.reserveStock(item.productId, Number(item.quantity || 0));
          }
        } catch (compensationError) {
          compensationErrors.push(compensationError.message);
        }
      }
      reservation.status = wasCommitted ? "committed" : "reserved";
      reservation.metadata = {
        ...(reservation.metadata || {}),
        cancellationFailedAt: new Date(),
        cancellationError: error.message,
        cancellationCompensationErrors: compensationErrors,
      };
      await reservation.save();
      if (compensationErrors.length) {
        throw new Error(`${error.message}; stock compensation requires manual review: ${compensationErrors.join("; ")}`);
      }
      throw error;
    }
  }

  async recordDamage(reference, items, metadata = {}) {
    const transactionChecks = await Promise.all(
      (items || []).map((item) =>
        InventoryTransactionModel.exists({
          idempotencyKey: this.idempotencyKey("damage", reference.referenceId || reference.returnId || reference.shipmentId, item),
        }),
      ),
    );
    const itemsToRecord = (items || []).filter((_, index) => !transactionChecks[index]);
    if (!itemsToRecord.length) return { changed: false, items: [] };
    await this.recordTransactions("damage", reference, itemsToRecord, metadata);
    return { changed: true, items: itemsToRecord };
  }

  async assertReservationCommitted(orderId) {
    const reservation = await InventoryReservationModel.findOne({ orderId });
    if (!reservation || !["committed", "restocked"].includes(reservation.status)) {
      throw new Error("Inventory must be committed before fulfillment");
    }
    return reservation;
  }

  async listTransactions(filter = {}, { limit = 100, offset = 0 } = {}) {
    const query = {};
    ["type", "status", "productId", "sellerId", "organizationId", "orderId", "returnId", "shipmentId", "referenceType", "referenceId"].forEach((key) => {
      if (filter[key]) query[key] = filter[key];
    });
    const sortMap = {
      createdAt: "createdAt",
      type: "type",
      status: "status",
      quantity: "quantity",
      productId: "productId",
      sellerId: "sellerId",
    };
    const sortField = sortMap[filter.sortBy] || "createdAt";
    const sortDir = filter.sortDir === "asc" ? 1 : -1;
    const [items, total] = await Promise.all([
      InventoryTransactionModel.find(query).sort({ [sortField]: sortDir }).skip(offset).limit(limit).lean(),
      InventoryTransactionModel.countDocuments(query),
    ]);
    return { items, total, limit, offset };
  }
}

module.exports = { InventoryRepository };
