const { AppError } = require("../../../shared/errors/app-error");
const { makeEvent } = require("../../../contracts/events/event");
const { DOMAIN_EVENTS } = require("../../../contracts/events/domain-events");
const { eventPublisher } = require("../../../infrastructure/events/event-publisher");
const { ProductRepository } = require("../../product/repositories/product.repository");
const { InventoryRepository } = require("../repositories/inventory.repository");

const LOW_STOCK_DEFAULT = 5;

const isSellerRole = (actor = {}) =>
  ["seller", "seller-admin", "seller-sub-admin"].includes(actor.role);

const isScopedSellerRole = (actor = {}) =>
  ["seller-admin", "seller-sub-admin"].includes(actor.role);

const toPlain = (value = {}) =>
  value?.toObject ? value.toObject({ depopulate: true, flattenMaps: true }) : value;

const toNumber = (value) => Number(value || 0);

const normalizeText = (value) => String(value || "").trim();

const variantLabel = (variant = {}) => {
  const attrs = variant.attributes instanceof Map
    ? Object.fromEntries(variant.attributes.entries())
    : variant.attributes || {};
  const values = Object.values(attrs)
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return normalizeText(variant.title) || values.join(" / ") || "Default variant";
};

const stockStatus = (available, threshold) => {
  if (available <= 0) return "out_of_stock";
  if (available <= threshold) return "low_stock";
  return "in_stock";
};

const sellerDisplayName = (product = {}) => {
  const organization = product.organizationSnapshot || {};
  const seller = product.sellerSnapshot || {};
  return normalizeText(
    organization.storeDisplayName ||
      organization.legalBusinessName ||
      organization.legalName ||
      organization.name ||
      organization.businessName ||
      organization.displayName ||
      seller.displayName ||
      seller.businessName ||
      seller.legalBusinessName ||
      seller.name ||
      product.sellerName,
  );
};

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

  buildInventoryProductFilter(query = {}, actor = {}) {
    const filter = {};
    const search = normalizeText(query.search || query.q || query.keyWord);

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
        { "variants.sku": { $regex: search, $options: "i" } },
        { "variants.title": { $regex: search, $options: "i" } },
      ];
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (isSellerRole(actor)) {
      filter.sellerId = actor.ownerSellerId || actor.userId;
      if (isScopedSellerRole(actor)) {
        filter.createdBy = actor.userId;
      }
      if (actor.organizationId) {
        filter.organizationId = actor.organizationId;
      }
      return filter;
    }

    if (query.sellerId) {
      filter.sellerId = query.sellerId;
    }

    return filter;
  }

  assertInventoryProductAccess(product = {}, actor = {}) {
    if (!actor.userId || actor.isSuperAdmin || ["admin", "super-admin"].includes(actor.role)) {
      return;
    }

    if (
      isSellerRole(actor) &&
      String(product.sellerId || "") === String(actor.ownerSellerId || actor.userId)
    ) {
      if (
        isScopedSellerRole(actor) &&
        String(product.createdBy || "") !== String(actor.userId || "")
      ) {
        throw new AppError("Permission denied", 403);
      }
      if (
        actor.organizationId &&
        String(product.organizationId || "") !== String(actor.organizationId)
      ) {
        throw new AppError("Product does not belong to the selected organization", 403);
      }
      return;
    }

    throw new AppError("Permission denied", 403);
  }

  toVariantInventoryRow(productInput, variantInput = {}) {
    const product = toPlain(productInput) || {};
    const variant = toPlain(variantInput) || {};
    const stock = toNumber(variant.stock);
    const reservedStock = toNumber(variant.reservedStock);
    const availableStock = Math.max(0, stock - reservedStock);
    const threshold = toNumber(product.inventorySettings?.lowStockThreshold) || LOW_STOCK_DEFAULT;
    const variantSku = normalizeText(variant.sku);
    const image = Array.isArray(variant.images) && variant.images.length ? variant.images[0] : "";

    return {
      id: `${product._id || product.id}:${variant._id || variantSku}`,
      productId: String(product._id || product.id || ""),
      productName: product.title || product.name || "Untitled product",
      productSku: product.sku || "",
      variantId: String(variant._id || ""),
      variantName: variantLabel(variant),
      variantSku,
      sku: variantSku,
      image,
      currentStock: stock,
      stock,
      reservedStock,
      availableStock,
      status: stockStatus(availableStock, threshold),
      variantStatus: variant.status || product.status || "inactive",
      productStatus: product.status || "",
      sellerId: product.sellerId || "",
      sellerName: sellerDisplayName(product),
      seller: sellerDisplayName(product),
      lastUpdated: variant.updatedAt || product.updatedAt || product.createdAt || null,
      category: product.category?.name || product.category?.title || product.category || "",
      brand: product.brand?.name || product.brand || "",
    };
  }

  async listVariantInventory(query = {}, actor = {}) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || query.size || 20)));
    const productFilter = this.buildInventoryProductFilter(query, actor);
    const batchLimit = Math.min(200, Math.max(limit * 5, limit));
    const products = await this.productRepository.listInventoryProducts(productFilter, {
      page: 1,
      limit: batchLimit,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });

    let rows = [];
    for (const product of products.items || []) {
      for (const variant of product.variants || []) {
        rows.push(this.toVariantInventoryRow(product, variant));
      }
    }

    if (query.variantSku) {
      const sku = normalizeText(query.variantSku).toLowerCase();
      rows = rows.filter((row) => row.variantSku.toLowerCase() === sku);
    }

    if (query.stockStatus) {
      rows = rows.filter((row) => row.status === query.stockStatus);
    }

    if (query.variantStatus) {
      rows = rows.filter((row) => row.variantStatus === query.variantStatus);
    }

    if (["currentStock", "reservedStock", "availableStock"].includes(query.sortBy)) {
      const direction = query.sortDir === "asc" ? 1 : -1;
      rows.sort(
        (left, right) =>
          (toNumber(left?.[query.sortBy]) - toNumber(right?.[query.sortBy])) * direction,
      );
    }

    const rowOffset = (page - 1) * limit;
    const pagedRows = rows.slice(rowOffset, rowOffset + limit);
    return {
      items: pagedRows,
      total: rows.length,
      page,
      limit,
      productTotal: products.total,
    };
  }

  async getProductInventory(productId, query = {}, actor = {}) {
    const product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);
    this.assertInventoryProductAccess(product, actor);

    const plain = toPlain(product);
    const rows = (plain.variants || []).map((variant) => this.toVariantInventoryRow(plain, variant));
    const transactions = await this.inventoryRepository.listTransactions(
      {
        productId: String(productId),
        ...(query.variantSku ? { variantSku: query.variantSku } : {}),
        sortBy: "createdAt",
        sortDir: "desc",
      },
      {
        limit: Math.min(200, Math.max(1, Number(query.historyLimit || 100))),
        offset: 0,
      },
    );

    return {
      product: {
        id: String(plain._id || plain.id || ""),
        productId: String(plain._id || plain.id || ""),
        name: plain.title || plain.name || "Untitled product",
        sku: plain.sku || "",
        status: plain.status || "",
        sellerId: plain.sellerId || "",
        sellerName: sellerDisplayName(plain),
        seller: sellerDisplayName(plain),
        image: rows[0]?.image || "",
        updatedAt: plain.updatedAt || null,
      },
      variants: rows,
      transactions,
    };
  }

  async adjustVariantInventory(productId, variantSku, payload = {}, actor = {}) {
    let updates = null;
    if (Array.isArray(payload)) {
      updates = payload;
    } else if (Array.isArray(payload?.updates)) {
      updates = payload.updates;
    }
    if (updates) {
      if (!updates.length) {
        throw new AppError("No inventory adjustments were provided", 400);
      }

      const product = await this.productRepository.findById(productId);
      if (!product) throw new AppError("Product not found", 404);
      this.assertInventoryProductAccess(product, actor);

      const variants = Array.isArray(product.variants) ? product.variants : [];
      const seenSkus = new Set();
      const plans = updates.map((entry) => {
        const sku = normalizeText(entry?.variantSku);
        if (!sku) {
          throw new AppError("Variant SKU is required for inventory adjustment", 400);
        }
        if (seenSkus.has(sku)) {
          throw new AppError(`Duplicate inventory adjustment for variant SKU "${sku}"`, 400);
        }
        seenSkus.add(sku);

        const variant = variants.find((item) => item.sku === sku);
        if (!variant) {
          throw new AppError(`Variant SKU "${sku}" not found for this product`, 404);
        }
        const adjustment = this.resolveManualAdjustment(product, { ...entry, variantSku: sku });
        const currentStock = Number(variant.stock || 0);
        const reservedStock = Number(variant.reservedStock || 0);
        if (adjustment < 0 && currentStock - reservedStock < Math.abs(adjustment)) {
          throw new AppError(`Insufficient available stock for variant SKU "${sku}"`, 400);
        }
        return { ...entry, variantSku: sku };
      });

      let updated = 0;
      for (const plan of plans) {
        try {
          await this.adjustProductInventory(productId, plan, actor);
          updated += 1;
        } catch (error) {
          if (error?.message === "Inventory adjustment does not change stock") {
            continue;
          }
          throw error;
        }
      }

      const result = await this.getProductInventory(productId, {}, actor);
      return {
        ...result,
        bulk: {
          requested: plans.length,
          updated,
        },
      };
    }

    const sku = normalizeText(variantSku || payload.variantSku);
    if (!sku) {
      throw new AppError("Variant SKU is required for inventory adjustment", 400);
    }

    const product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);
    this.assertInventoryProductAccess(product, actor);

    const variant = (product.variants || []).find((item) => item.sku === sku);
    if (!variant) {
      throw new AppError("Variant SKU not found for this product", 404);
    }

    await this.adjustProductInventory(productId, { ...payload, variantSku: sku }, actor);
    return this.getProductInventory(productId, { variantSku: payload.showAllHistory ? "" : sku }, actor);
  }

  resolveManualAdjustment(product, payload = {}) {
    const requestedVariantSku = payload.variantSku || "";
    const defaultVariant = Array.isArray(product.variants) && product.variants.length
      ? product.variants.find((variant) => variant.isDefault === true) || product.variants[0]
      : null;
    const variantSku = requestedVariantSku || defaultVariant?.sku || "";

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
    let product = await this.productRepository.findById(productId);
    if (!product) throw new AppError("Product not found", 404);

    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
    const requestedVariantSku = payload.variantSku || "";
    let variantSku = requestedVariantSku;
    let usesGeneratedDefaultVariant = false;

    if (hasVariants && !variantSku) {
      throw new AppError("Variant SKU is required for inventory adjustment", 400);
    }

    if (!variantSku && !hasVariants) {
      const defaultVariant = await this.productRepository.ensureDefaultVariant(productId);
      if (defaultVariant?.sku) {
        variantSku = defaultVariant.sku;
        usesGeneratedDefaultVariant = true;
        product = await this.productRepository.findById(productId);
      }
    }

    const adjustment = this.resolveManualAdjustment(product, { ...payload, variantSku });
    if (adjustment === 0) {
      throw new AppError("Inventory adjustment does not change stock", 400);
    }

    let updatedProduct = variantSku
      ? await this.productRepository.adjustVariantStock(productId, variantSku, adjustment)
      : await this.productRepository.adjustStock(productId, adjustment);

    if (!updatedProduct) {
      throw new AppError("Insufficient stock for negative adjustment", 400);
    }

    if (usesGeneratedDefaultVariant) {
      const defaultVariant = (updatedProduct.variants || []).find((variant) => variant.sku === variantSku);
      if (defaultVariant) {
        updatedProduct = await this.productRepository.update(productId, {
          stock: Number(defaultVariant.stock || 0),
          reservedStock: Number(defaultVariant.reservedStock || 0),
        });
      }
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
