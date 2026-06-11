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

  async releaseReservation(orderId) {
    const reservation = await InventoryReservationModel.findOne({ orderId });
    if (!reservation || reservation.status !== "reserved") {
      return this.markChanged(reservation, false);
    }

    await Promise.all(
      reservation.items.map((item) =>
        item.variantSku
          ? this.productRepository.releaseReservedVariantStock(item.productId, item.variantSku, item.quantity)
          : this.productRepository.releaseReservedStock(item.productId, item.quantity),
      ),
    );

    reservation.status = "released";
    await reservation.save();
    await this.recordTransactions("release", { orderId, referenceType: "order", referenceId: orderId }, reservation.items);
    return this.markChanged(reservation, true);
  }

  async commitReservation(orderId) {
    const reservation = await InventoryReservationModel.findOne({ orderId });
    if (!reservation || reservation.status !== "reserved") {
      return this.markChanged(reservation, false);
    }

    await Promise.all(
      reservation.items.map((item) =>
        item.variantSku
          ? this.productRepository.commitReservedVariantStock(item.productId, item.variantSku, item.quantity)
          : this.productRepository.commitReservedStock(item.productId, item.quantity),
      ),
    );

    reservation.status = "committed";
    await reservation.save();
    await this.recordTransactions("sale", { orderId, referenceType: "order", referenceId: orderId }, reservation.items);
    return this.markChanged(reservation, true);
  }

  async restockReservation(orderId) {
    const reservation = await InventoryReservationModel.findOne({ orderId });
    if (!reservation || reservation.status !== "committed") {
      return this.markChanged(reservation, false);
    }

    await Promise.all(
      reservation.items.map((item) =>
        item.variantSku
          ? this.productRepository.adjustVariantStock(item.productId, item.variantSku, item.quantity)
          : this.productRepository.addStock(item.productId, item.quantity),
      ),
    );

    reservation.status = "restocked";
    await reservation.save();
    await this.recordTransactions("return", { orderId, referenceType: "order", referenceId: orderId }, reservation.items);
    return this.markChanged(reservation, true);
  }

  async restockItems(reference, items) {
    const transactionChecks = await Promise.all(
      (items || []).map((item) =>
        InventoryTransactionModel.exists({
          idempotencyKey: this.idempotencyKey("return", reference.referenceId || reference.returnId, item),
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
    await this.recordTransactions("return", reference, itemsToRestock, reference.metadata || {});
    return { changed: true, items: itemsToRestock };
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
    ["type", "status", "productId", "sellerId", "orderId", "returnId", "shipmentId", "referenceType", "referenceId"].forEach((key) => {
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
