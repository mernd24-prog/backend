const { AppError } = require("../../../shared/errors/app-error");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { ProductRepository } = require("../../product/repositories/product.repository");
const { InventoryRepository } = require("../repositories/inventory.repository");

class InventoryService {
  constructor({
    inventoryRepository = new InventoryRepository(),
    productRepository = new ProductRepository(),
  } = {}) {
    this.inventoryRepository = inventoryRepository;
    this.productRepository = productRepository;
  }

  async publishLowStockAlerts(items = []) {
    await Promise.all(
      items.map(async (item) => {
        const product = await this.productRepository.findById(item.productId);
        if (!product) return;

        const threshold = Number(product.inventorySettings?.lowStockThreshold ?? 5);
        let available = Number(product.stock || 0) - Number(product.reservedStock || 0);
        if (item.variantSku) {
          const variant = (product.variants || []).find((candidate) => candidate.sku === item.variantSku);
          available = Number(variant?.stock || 0) - Number(variant?.reservedStock || 0);
        }

        if (available <= threshold) {
          await eventPublisher.publish(
            makeEvent(
              DOMAIN_EVENTS.INVENTORY_LOW_STOCK_V1,
              {
                productId: item.productId,
                variantSku: item.variantSku || null,
                sellerId: item.sellerId || product.sellerId || null,
                available,
                threshold,
              },
              { source: "inventory-module", aggregateId: item.productId },
            ),
          );
        }
      }),
    );
  }

  async reserveForOrder(orderId, buyerId, items) {
    try {
      const reservation = await this.inventoryRepository.reserveItems(orderId, buyerId, items);
      if (reservation?.$locals?.inventoryChanged) {
        await eventPublisher.publish(
          makeEvent(
            DOMAIN_EVENTS.INVENTORY_RESERVED_V1,
            { orderId, buyerId, itemCount: items.length },
            { source: "inventory-module", aggregateId: orderId },
          ),
        );
      }
      return reservation;
    } catch (error) {
      throw new AppError(error.message || "Unable to reserve inventory", 409);
    }
  }

  async releaseForOrder(orderId, options = {}) {
    const reservation = await this.inventoryRepository.releaseReservation(orderId, {
      actorId: options.actor?.userId || options.actorId || "",
      actorRole: options.actor?.role || options.actorRole || "",
      reason: options.reason || "order_inventory_release",
      metadata: options.metadata || {},
    });
    if (reservation?.$locals?.inventoryChanged) {
      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.INVENTORY_RELEASED_V1,
          {
            orderId,
            buyerId: reservation.buyerId,
            itemCount: reservation.items.length,
            reason: options.reason || "order_inventory_release",
          },
          { source: "inventory-module", aggregateId: orderId },
        ),
      );
    }

    return reservation;
  }

  async commitForOrder(orderId, options = {}) {
    const reservation = await this.inventoryRepository.commitReservation(orderId, {
      actorId: options.actor?.userId || options.actorId || "",
      actorRole: options.actor?.role || options.actorRole || "",
      reason: options.reason || "order_inventory_commit",
      metadata: options.metadata || {},
    });
    if (reservation?.$locals?.inventoryChanged) {
      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.INVENTORY_COMMITTED_V1,
          { orderId, buyerId: reservation.buyerId, itemCount: reservation.items.length },
          { source: "inventory-module", aggregateId: orderId },
        ),
      );
      await this.publishLowStockAlerts(reservation.items);
    }

    return reservation;
  }

  async restockForOrder(orderId, options = {}) {
    const reservation = await this.inventoryRepository.restockReservation(orderId, {
      actorId: options.actor?.userId || options.actorId || "",
      actorRole: options.actor?.role || options.actorRole || "",
      reason: options.reason || "order_inventory_restock",
      metadata: options.metadata || {},
    });
    if (reservation?.$locals?.inventoryChanged) {
      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.INVENTORY_RESTOCKED_V1,
          { orderId, buyerId: reservation.buyerId, itemCount: reservation.items.length },
          { source: "inventory-module", aggregateId: orderId },
        ),
      );
    }
    return reservation;
  }

  async releaseExpiredReservations(payload = {}, actor = {}) {
    const limit = Math.min(Math.max(Number(payload.limit || 100), 1), 500);
    const now = payload.now ? new Date(payload.now) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new AppError("Invalid reservation cleanup date", 400);
    }

    const reservations = await this.inventoryRepository.findExpiredReservations({ now, limit });
    const summary = {
      scanned: reservations.length,
      released: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (const reservation of reservations) {
      try {
        const released = await this.releaseForOrder(reservation.orderId, {
          actor,
          reason: payload.reason || "expired_reservation_cleanup",
          metadata: {
            source: "expired_reservation_cleanup",
            expiresAt: reservation.expiresAt,
          },
        });

        if (released?.$locals?.inventoryChanged) summary.released += 1;
        else summary.skipped += 1;
      } catch (error) {
        summary.failed += 1;
        summary.errors.push({
          orderId: reservation.orderId,
          message: error.message || "Unable to release reservation",
        });
      }
    }

    return summary;
  }

  normalizeReturnItems(returnRequest, itemsOverride = null) {
    return (itemsOverride || returnRequest.items || []).map((item) => ({
      productId: item.productId,
      variantId: item.variantId || "",
      variantSku: item.variantSku || "",
      sellerId: item.sellerId || "",
      quantity: Number(item.quantity ?? item.receivedQuantity ?? item.approvedQuantity ?? 0),
      unitPrice: Number(item.unitPrice || 0),
    }));
  }

  async restockForReturn(returnRequest, actor = {}, itemsOverride = null) {
    const returnId = String(returnRequest._id || returnRequest.id || "");
    const result = await this.inventoryRepository.restockItems(
      {
        orderId: returnRequest.orderId,
        returnId,
        referenceType: "return",
        referenceId: returnId,
        actorId: actor.userId,
        actorRole: actor.role,
        metadata: { reason: returnRequest.reason },
      },
      this.normalizeReturnItems(returnRequest, itemsOverride),
    );

    if (result.changed) {
      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.INVENTORY_RESTOCKED_V1,
          { orderId: returnRequest.orderId, returnId, itemCount: result.items.length },
          { source: "inventory-module", aggregateId: returnRequest.orderId },
        ),
      );
    }
    return result;
  }

  async recordReturnDamage(returnRequest, actor = {}, metadata = {}, itemsOverride = null) {
    const returnId = String(returnRequest._id || returnRequest.id || "");
    const result = await this.inventoryRepository.recordDamage(
      {
        orderId: returnRequest.orderId,
        returnId,
        referenceType: "return",
        referenceId: returnId,
        actorId: actor.userId,
        actorRole: actor.role,
      },
      this.normalizeReturnItems(returnRequest, itemsOverride),
      { reason: returnRequest.reason, ...metadata },
    );

    if (result.changed) {
      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.INVENTORY_ADJUSTED_V1,
          {
            orderId: returnRequest.orderId,
            returnId,
            adjustmentType: "damage",
            itemCount: result.items.length,
          },
          { source: "inventory-module", aggregateId: returnRequest.orderId },
        ),
      );
    }
    return result;
  }

  async cancelOrderItems(orderId, cancellationId, items, actor = {}, metadata = {}) {
    const result = await this.inventoryRepository.cancelReservationItems(
      orderId,
      cancellationId,
      items,
      {
        actorId: actor.userId || "",
        actorRole: actor.role || "",
        metadata,
      },
    );
    if (result.changed) {
      await eventPublisher.publish(
        makeEvent(
          result.wasCommitted ? DOMAIN_EVENTS.INVENTORY_RESTOCKED_V1 : DOMAIN_EVENTS.INVENTORY_RELEASED_V1,
          {
            orderId,
            cancellationId,
            itemCount: result.items.length,
            reason: "order_cancellation",
          },
          { source: "inventory-module", aggregateId: orderId },
        ),
      );
    }
    return result;
  }

  async assertCommittedForFulfillment(orderId) {
    try {
      return await this.inventoryRepository.assertReservationCommitted(orderId);
    } catch (error) {
      throw new AppError(error.message || "Inventory must be committed before fulfillment", 409);
    }
  }

  async listTransactions(filter = {}, pagination = {}) {
    return this.inventoryRepository.listTransactions(filter, pagination);
  }

  resolveManualAdjustment(product, payload = {}) {
    if (payload.adjustment !== undefined && payload.adjustment !== null && payload.adjustment !== "") {
      const adjustment = Number(payload.adjustment);
      if (!Number.isFinite(adjustment)) {
        throw new AppError("Inventory adjustment must be a valid number", 400);
      }
      return adjustment;
    }

    const quantity = Number(payload.quantity || 0);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new AppError("Inventory quantity must be a non-negative number", 400);
    }

    const adjustmentType = payload.adjustmentType || "add";
    if (adjustmentType === "add") return quantity;
    if (adjustmentType === "remove") return -quantity;
    if (adjustmentType === "set") {
      const variantSku = payload.variantSku || "";
      if (variantSku && !(product.variants || []).some((variant) => variant.sku === variantSku)) {
        throw new AppError("Variant SKU not found for this product", 404);
      }
      const currentStock = variantSku
        ? Number((product.variants || []).find((variant) => variant.sku === variantSku)?.stock || 0)
        : Number(product.stock || 0);
      return quantity - currentStock;
    }

    throw new AppError("Invalid inventory adjustment type", 400);
  }

  async adjustProductInventory(productId, payload = {}, actor = {}) {
    const product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);

    const adjustment = this.resolveManualAdjustment(product, payload);
    if (adjustment === 0) {
      throw new AppError("Inventory adjustment does not change stock", 400);
    }

    const variantSku = payload.variantSku || "";
    const updatedProduct = variantSku
      ? await this.productRepository.adjustVariantStock(productId, variantSku, adjustment)
      : await this.productRepository.adjustStock(productId, adjustment);

    if (!updatedProduct) {
      throw new AppError("Insufficient stock for negative adjustment", 400);
    }

    await this.inventoryRepository.recordTransaction(
      "adjustment",
      {
        referenceType: "manual_adjustment",
        referenceId: payload.reference || `${productId}:${Date.now()}`,
        actorId: actor.userId || "",
        actorRole: actor.role || "",
      },
      {
        productId: String(productId),
        variantSku,
        sellerId: product.sellerId || "",
        quantity: adjustment,
      },
      {
        reason: payload.reason || "",
        note: payload.note || "",
        adjustmentType: payload.adjustmentType || (adjustment > 0 ? "add" : "remove"),
        requestedQuantity: payload.quantity !== undefined ? Number(payload.quantity || 0) : null,
      },
    );

    await this.publishLowStockAlerts([
      {
        productId: String(productId),
        variantSku,
        sellerId: product.sellerId || "",
      },
    ]);

    return updatedProduct;
  }
}

module.exports = { InventoryService };
