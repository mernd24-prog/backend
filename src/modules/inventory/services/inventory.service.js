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

  async releaseForOrder(orderId) {
    const reservation = await this.inventoryRepository.releaseReservation(orderId);
    if (reservation?.$locals?.inventoryChanged) {
      await eventPublisher.publish(
        makeEvent(
          DOMAIN_EVENTS.INVENTORY_RELEASED_V1,
          { orderId, buyerId: reservation.buyerId, itemCount: reservation.items.length },
          { source: "inventory-module", aggregateId: orderId },
        ),
      );
    }

    return reservation;
  }

  async commitForOrder(orderId) {
    const reservation = await this.inventoryRepository.commitReservation(orderId);
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

  async restockForOrder(orderId) {
    const reservation = await this.inventoryRepository.restockReservation(orderId);
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

  normalizeReturnItems(returnRequest) {
    return (returnRequest.items || []).map((item) => ({
      productId: item.productId,
      variantId: item.variantId || "",
      variantSku: item.variantSku || "",
      sellerId: item.sellerId || "",
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
    }));
  }

  async restockForReturn(returnRequest, actor = {}) {
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
      this.normalizeReturnItems(returnRequest),
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

  async recordReturnDamage(returnRequest, actor = {}, metadata = {}) {
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
      this.normalizeReturnItems(returnRequest),
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

  async adjustProductInventory(productId, payload = {}, actor = {}) {
    const product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);

    const adjustment = Number(payload.adjustment || 0);
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
