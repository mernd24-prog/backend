const { AppError } = require("../../../shared/errors/app-error");
const { logger } = require("../../../shared/logger/logger");
const { createQueue } = require("../../../shared/queues/queue-factory");
const { env } = require("../../../config/env");
const { ProductRepository } = require("../../product/repositories/product.repository");
const { StockNotificationRepository } = require("../repositories/stock-notification.repository");

const SELLER_ROLES = new Set(["seller", "seller-admin", "seller-sub-admin"]);
let notificationQueue;

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

const getNotificationQueue = () => {
  if (!notificationQueue) {
    notificationQueue = createQueue("notifications");
  }
  return notificationQueue;
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
    const brandName = process.env.APP_BRAND_NAME || "Sam Global Ecommerce";
    const currentYear = new Date().getFullYear();
    const variantLine = notification.variantTitle
      ? `<p style="margin:0 0 4px 0;color:#6b7280;font-size:12.5px;">${this.escapeHtml(notification.variantTitle)}</p>`
      : "";
    const customMessage = normalizeText(message)
      ? this.escapeHtml(message)
      : "Stock is limited - order soon to avoid missing out again.";
    const productMedia = notification.productImage
      ? `<img src="${this.escapeHtml(notification.productImage)}" alt="${this.escapeHtml(productName)}" width="72" height="72" style="display:block;width:72px;height:72px;object-fit:contain;border-radius:10px;background:#eceef4;" />`
      : `<span style="display:inline-block;width:72px;height:72px;line-height:72px;text-align:center;background:#eceef4;border-radius:10px;color:#9297a8;font-size:22px;font-weight:700;">S</span>`;
    const cta = productUrl
      ? `
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px 0;">
              <tr>
                <td style="border-radius:8px;background:#f0a93c;">
                  <a href="${this.escapeHtml(productUrl)}" style="display:inline-block;padding:12px 26px;color:#211a5e;font-size:13.5px;font-weight:700;text-decoration:none;">Order Now</a>
                </td>
              </tr>
            </table>`
      : "";
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Back in Stock</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f3f7;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(24,20,80,0.10);">
          <tr>
            <td style="background:#211a5e;padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:24px 36px 22px 36px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <span style="display:inline-block;width:28px;height:28px;background:#f0a93c;border-radius:7px;text-align:center;line-height:28px;font-weight:800;color:#211a5e;font-size:13px;vertical-align:middle;">S</span>
                          <span style="color:#f0a93c;font-size:11.5px;font-weight:700;letter-spacing:1.5px;margin-left:9px;text-transform:uppercase;vertical-align:middle;">${this.escapeHtml(brandName)}</span>
                        </td>
                        <td align="right">
                          <span style="background:rgba(52,211,153,0.18);color:#6ee7b7;font-size:10.5px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;padding:5px 11px;border-radius:20px;">Back in Stock</span>
                        </td>
                      </tr>
                    </table>
                    <h1 style="color:#ffffff;font-size:21px;font-weight:700;line-height:1.35;margin:16px 0 0 0;">Your requested product is available now</h1>
                  </td>
                </tr>
                <tr>
                  <td style="height:4px;background:#f0a93c;"></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 36px 32px 36px;">
              <p style="color:#374151;font-size:14.5px;line-height:1.6;margin:0 0 14px 0;">Hi ${this.escapeHtml(notification.name || "there")},</p>
              <p style="color:#374151;font-size:14.5px;line-height:1.6;margin:0 0 24px 0;">
                Good news - <strong style="color:#1f2937;">${this.escapeHtml(productName)}</strong> is back in stock and ready to order.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fb;border:1px solid #eceef4;border-radius:12px;margin-bottom:26px;">
                <tr>
                  <td style="padding:18px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:76px;vertical-align:top;">${productMedia}</td>
                        <td style="padding-left:16px;vertical-align:middle;">
                          <p style="margin:0 0 4px 0;color:#1f2937;font-size:14.5px;font-weight:700;">${this.escapeHtml(productName)}</p>
                          ${variantLine}
                          ${notification.sku ? `<p style="margin:0;color:#9297a8;font-size:11.5px;">SKU: ${this.escapeHtml(notification.sku)}</p>` : ""}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              ${cta}
              <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">${customMessage}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#f7f8fb;padding:24px 36px;border-top:1px solid #eceef4;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;color:#211a5e;font-size:12.5px;font-weight:700;">${this.escapeHtml(brandName)}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0 0;color:#a5aabb;font-size:11px;line-height:1.6;">
                You received this because you asked us to notify you when this item was available again.<br>
                &copy; ${currentYear} ${this.escapeHtml(brandName)}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
    await getNotificationQueue().add("stock-notification-email", {
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
