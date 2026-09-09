const { AppError } = require("../../../shared/errors/app-error");
const { logger } = require("../../../shared/logger/logger");
const { createQueue } = require("../../../shared/queues/queue-factory");
const { env } = require("../../../config/env");
const { ProductRepository } = require("../../product/repositories/product.repository");
const { StockNotificationRepository } = require("../repositories/stock-notification.repository");

const SELLER_ROLES = new Set(["seller", "seller-admin", "seller-sub-admin"]);
const notificationQueue = createQueue("notifications");

const normalizeText = (value) => String(value || "").trim();

const toPlain = (value = {}) =>
  value?.toObject ? value.toObject({ depopulate: true, flattenMaps: true }) : value;

const getFirstImage = (product = {}, variant = null) => {
  const variantImage = Array.isArray(variant?.images) ? variant.images.find(Boolean) : "";
  if (variantImage) return variantImage;
  if (Array.isArray(product.images)) return product.images.find(Boolean) || "";
  if (Array.isArray(product.commonImages)) return product.commonImages.find(Boolean) || "";
  return product.image || product.thumbnail || "";
};

const getVariantTitle = (variant = {}) => {
  if (!variant) return null;
  const attrs = variant.attributes instanceof Map
    ? Object.fromEntries(variant.attributes.entries())
    : variant.attributes || {};
  return normalizeText(
    variant.title ||
      Object.values(attrs)
        .map((value) => normalizeText(typeof value === "object" ? value.name || value.label || value.value : value))
        .filter(Boolean)
        .join(" / "),
  ) || null;
};

const publicProductUrl = (notification = {}) => {
  const base = String(process.env.CUSTOMER_APP_URL || process.env.WEB_APP_URL || "").replace(/\/+$/, "");
  const slugOrId = notification.productSlug || notification.productId;
  return base && slugOrId ? `${base}/products/${encodeURIComponent(slugOrId)}` : "";
};

class StockNotificationService {
  constructor({
    stockNotificationRepository = new StockNotificationRepository(),
    productRepository = new ProductRepository(),
  } = {}) {
    this.stockNotificationRepository = stockNotificationRepository;
    this.productRepository = productRepository;
  }

  isSeller(actor = {}) {
    return SELLER_ROLES.has(actor.role);
  }

  getSellerId(actor = {}) {
    return String(actor.ownerSellerId || actor.parentSellerId || actor.userId || actor.sub || "").trim();
  }

  async getProductSnapshot(productId, variantId = null) {
    const product = toPlain(await this.productRepository.findById(productId));
    if (!product?._id && !product?.id) {
      throw AppError.notFound("Product");
    }

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const variant = variantId
      ? variants.find((item) => String(item._id || item.id || "") === String(variantId))
      : null;

    return {
      product,
      variant,
      productId: String(product._id || product.id || productId),
      variantId: variant ? String(variant._id || variant.id || variantId) : (variantId || null),
      sellerId: product.sellerId || null,
      organizationId: product.organizationId || null,
      productTitle: product.title || product.name || "Product",
      productSlug: product.slug || null,
      productImage: getFirstImage(product, variant),
      variantTitle: getVariantTitle(variant),
      sku: normalizeText(variant?.sku || product.sku),
    };
  }

  async create(payload = {}, actor = {}) {
    const snapshot = await this.getProductSnapshot(payload.productId, payload.variantId);
    const notification = await this.stockNotificationRepository.upsert({
      userId: payload.userId || actor.userId || actor.sub || null,
      name: normalizeText(payload.name),
      email: normalizeText(payload.email).toLowerCase(),
      productId: snapshot.productId,
      variantId: snapshot.variantId,
      sellerId: snapshot.sellerId,
      organizationId: snapshot.organizationId,
      productTitle: snapshot.productTitle,
      productSlug: snapshot.productSlug,
      productImage: snapshot.productImage,
      variantTitle: snapshot.variantTitle,
      sku: normalizeText(payload.sku) || snapshot.sku,
      price: payload.price ?? null,
      metadata: {
        source: "notify_me_modal",
      },
    });
    return notification;
  }

  async list(query = {}, actor = {}) {
    const filters = { ...query };
    if (this.isSeller(actor)) {
      const sellerId = this.getSellerId(actor);
      if (!sellerId) throw AppError.unauthenticated();
      filters.sellerId = sellerId;
    }
    return this.stockNotificationRepository.list(filters);
  }

  assertSellerCanAccessProduct(actor = {}, product = {}) {
    if (!this.isSeller(actor)) return;
    const sellerId = this.getSellerId(actor);
    if (!sellerId || String(product.sellerId || "") !== sellerId) {
      throw AppError.ownershipDenied();
    }
  }

  buildBackInStockEmail(notification = {}, message = "") {
    const productName = notification.productTitle || "Your requested product";
    const productUrl = publicProductUrl(notification);
    const subject = `${productName} is back in stock`;
    const variantLine = notification.variantTitle
      ? `<p style="margin:4px 0 0;color:#64748b;font-size:14px;">${this.escapeHtml(notification.variantTitle)}</p>`
      : "";
    const cta = productUrl
      ? `<a href="${this.escapeHtml(productUrl)}" style="display:inline-block;background:#1B1D60;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">Shop now</a>`
      : "";
    const customMessage = normalizeText(message)
      ? `<p style="margin:18px 0 0;color:#334155;font-size:15px;line-height:1.6;">${this.escapeHtml(message)}</p>`
      : "";
    const html = `
      <div style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#111827;">
        <div style="max-width:620px;margin:0 auto;padding:28px 16px;">
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
            <div style="background:#1B1D60;color:#ffffff;padding:24px;">
              <p style="margin:0 0 8px;color:#F4C542;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Back in stock</p>
              <h1 style="margin:0;font-size:26px;line-height:1.25;">Your requested product is available now</h1>
            </div>
            <div style="padding:24px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hi ${this.escapeHtml(notification.name || "there")},</p>
              <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.6;">Good news. <strong>${this.escapeHtml(productName)}</strong> is back in stock.</p>
              <div style="display:flex;gap:14px;align-items:center;border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin:0 0 22px;">
                ${notification.productImage ? `<img src="${this.escapeHtml(notification.productImage)}" alt="${this.escapeHtml(productName)}" style="width:74px;height:74px;object-fit:contain;border-radius:10px;background:#f8fafc;" />` : ""}
                <div>
                  <p style="margin:0;color:#111827;font-size:16px;font-weight:700;">${this.escapeHtml(productName)}</p>
                  ${variantLine}
                  ${notification.sku ? `<p style="margin:4px 0 0;color:#64748b;font-size:13px;">SKU: ${this.escapeHtml(notification.sku)}</p>` : ""}
                </div>
              </div>
              ${cta}
              ${customMessage}
              <p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:1.5;">You received this because you asked us to notify you when this item was available again.</p>
            </div>
          </div>
        </div>
      </div>`;
    const text = `Hi ${notification.name || "there"},\n\n${productName} is back in stock.${notification.sku ? `\nSKU: ${notification.sku}` : ""}${productUrl ? `\nShop now: ${productUrl}` : ""}${message ? `\n\n${message}` : ""}`;
    return { subject, html, text };
  }

  escapeHtml(value = "") {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async notifyBackInStock(payload = {}, actor = {}) {
    const snapshot = await this.getProductSnapshot(payload.productId, payload.variantId);
    this.assertSellerCanAccessProduct(actor, snapshot.product);
    const availability = this.getSnapshotAvailability(snapshot);
    if (!availability.inStock) {
      return {
        productId: snapshot.productId,
        variantId: snapshot.variantId,
        total: 0,
        queued: 0,
        skipped: 0,
        failed: 0,
        inStock: false,
        availableStock: availability.availableStock,
        message: "Product is still out of stock. Emails were not queued.",
      };
    }

    const requests = await this.stockNotificationRepository.findPendingForProduct(
      snapshot.productId,
      snapshot.variantId,
      this.isSeller(actor) ? this.getSellerId(actor) : null,
    );

    let queued = 0;
    let failed = 0;
    for (const request of requests) {
      try {
        await this.stockNotificationRepository.markQueued(request.id);
        await this.queueBackInStockEmail(request, payload.message);
        queued += 1;
      } catch (error) {
        failed += 1;
        await this.stockNotificationRepository.markFailed(request.id, error.message);
        logger.error({ err: error, requestId: request.id }, "Back-in-stock email queue failed");
      }
    }

    return {
      productId: snapshot.productId,
      variantId: snapshot.variantId,
      total: requests.length,
      queued,
      failed,
      inStock: true,
      availableStock: availability.availableStock,
    };
  }

  getSnapshotAvailability(snapshot = {}) {
    const product = snapshot.product || {};
    const variant = snapshot.variant || null;
    const source = variant || product;
    const stock = Number(source.stock || 0);
    const reservedStock = Number(source.reservedStock || 0);
    const availableStock = Math.max(0, stock - reservedStock);
    const active = variant
      ? variant.status !== "inactive" && variant.status !== "out_of_stock"
      : product.status !== "inactive" && product.status !== "out_of_stock";
    return {
      availableStock,
      inStock: active && availableStock > 0,
    };
  }

  async queueBackInStockEmail(notification = {}, message = "") {
    const mail = this.buildBackInStockEmail(notification, message);
    await notificationQueue.add("stock-notification-email", {
      notificationId: notification.id,
      to: notification.email,
      ...mail,
    }, {
      jobId: `stock-notification-email:${notification.id}:${Date.now()}`,
      delay: env.smtp.queue.initialDelayMs,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: env.smtp.queue.retryBackoffMs,
      },
    });
  }

  async notifyManyBackInStock(payload = {}, actor = {}) {
    const uniqueItems = Array.from(
      new Map(
        (Array.isArray(payload.items) ? payload.items : [])
          .map((item) => ({
            productId: normalizeText(item.productId),
            variantId: normalizeText(item.variantId) || null,
          }))
          .filter((item) => item.productId)
          .map((item) => [`${item.productId}:${item.variantId || ""}`, item]),
      ).values(),
    );

    const results = [];
    for (const item of uniqueItems) {
      results.push(await this.notifyBackInStock({
        ...item,
        message: payload.message,
      }, actor));
    }

    return {
      requested: uniqueItems.length,
      total: results.reduce((sum, item) => sum + Number(item.total || 0), 0),
      queued: results.reduce((sum, item) => sum + Number(item.queued || 0), 0),
      failed: results.reduce((sum, item) => sum + Number(item.failed || 0), 0),
      skipped: results.filter((item) => !item.inStock).length,
      results,
    };
  }

  async queueForAvailableStock(productId, options = {}, actor = {}) {
    const product = toPlain(await this.productRepository.findById(productId));
    if (!product?._id && !product?.id) return null;
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const variantSku = normalizeText(options.variantSku);
    const targetVariants = variantSku
      ? variants.filter((variant) => variant.sku === variantSku)
      : variants;

    if (targetVariants.length) {
      return this.notifyManyBackInStock({
        message: options.message,
        items: targetVariants.map((variant) => ({
          productId: String(product._id || product.id || productId),
          variantId: String(variant._id || variant.id || ""),
        })),
      }, actor);
    }

    return this.notifyBackInStock({
      productId: String(product._id || product.id || productId),
      message: options.message,
    }, actor);
  }
}

module.exports = { StockNotificationService };
