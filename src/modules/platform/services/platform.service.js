const { getPage } = require("../../../shared/tools/page");
const { buildMongoFilter } = require("../../../shared/tools/query-builder");
const { PlatformRepository } = require("../repositories/platform.repository");
const { AppError } = require("../../../shared/errors/app-error");
const { auditService } = require("../../../shared/logger/audit.service");
const { forget } = require("../../../shared/tools/cache");
const { ProductModel } = require("../../product/models/product.model");
const { OrderRepository } = require("../../order/repositories/order.repository");
const { UserModel } = require("../../user/models/user.model");
const { ORDER_STATUS, PAYMENT_STATUS } = require("../../../shared/domain/commerce-constants");
const {
  AdminTaxModel,
  AdminSubTaxModel,
  AdminTaxRuleModel,
} = require("../../admin/models/common-management.model");

function actorIdFromRequest(req) {
  const auth = req?.auth || {};
  return auth.sub || auth.id || auth.userId || null;
}

function withCreateActor(payload, req) {
  const actorId = actorIdFromRequest(req);
  if (!actorId) return payload;
  return { ...payload, createdBy: String(actorId), updatedBy: String(actorId) };
}

function withUpdateActor(payload, req) {
  const actorId = actorIdFromRequest(req);
  if (!actorId) return payload;
  return { ...payload, updatedBy: String(actorId) };
}

function buyerNameFromUser(user = {}) {
  const first = user.profile?.firstName || user.firstName || "";
  const last = user.profile?.lastName || user.lastName || "";
  const fullName = [first, last].filter(Boolean).join(" ").trim();
  return (
    fullName ||
    user.profile?.fullName ||
    user.displayName ||
    user.name ||
    user.email ||
    ""
  );
}

function buyerImageFromUser(user = {}) {
  return (
    user.profile?.avatarUrl ||
    user.avatarUrl ||
    user.profileImage ||
    user.user_image ||
    user.image ||
    ""
  );
}

function isMongoObjectId(value = "") {
  return /^[a-f\d]{24}$/i.test(String(value || ""));
}

class PlatformService {
  constructor({
    platformRepository = new PlatformRepository(),
    orderRepository = new OrderRepository(),
  } = {}) {
    this.platformRepository = platformRepository;
    this.orderRepository = orderRepository;
  }

  invalidateCatalogCaches() {
    if (typeof forget === "function") {
      forget(/^products:/);
    }
  }

  async createCategory(payload, req) {
    const category = await this.platformRepository.createCategory(payload);
    this.invalidateCatalogCaches();
    auditService.create(req, { module: "categories", entityId: category?._id || category?.categoryKey, entityType: "Category", newData: payload });
    return category;
  }

  async updateCategory(categoryKey, payload, req) {
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) throw AppError.notFound("Category");
    const updated = await this.platformRepository.updateCategory(categoryKey, payload);
    this.invalidateCatalogCaches();
    auditService.update(req, { module: "categories", entityId: categoryKey, entityType: "Category", oldData: category, newData: payload });
    return updated;
  }

  async getCategory(categoryKey) {
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) throw AppError.notFound("Category");
    return category;
  }

  normalizeCategoryAttributes(category = {}) {
    if (Array.isArray(category.attributeSchema) && category.attributeSchema.length) {
      return category.attributeSchema;
    }
    const legacy = category.attributesSchema || {};
    return Object.keys(legacy).map((key) => ({
      key,
      label: key,
      type: Array.isArray(legacy[key]) ? "multi_select" : "text",
      required: false,
      options: Array.isArray(legacy[key]) ? legacy[key] : [],
      isVariantAttribute: false,
      isFilterable: false,
      isSearchable: false,
    }));
  }

  async getCategoryAttributes(categoryKey) {
    const category = await this.getCategory(categoryKey);
    return {
      categoryKey: category.categoryKey,
      title: category.title,
      attributeSchema: this.normalizeCategoryAttributes(category),
    };
  }

  buildCategoryTree(categories = [], maxDepth = 3) {
    const normalizedMaxDepth = Number.isFinite(Number(maxDepth)) ? Number(maxDepth) : 3;
    const byKey = new Map();
    const roots = [];

    categories.forEach((category) => {
      byKey.set(category.categoryKey, { ...category, children: [] });
    });

    byKey.forEach((node) => {
      if (node.parentKey && byKey.has(node.parentKey)) {
        const parent = byKey.get(node.parentKey);
        if ((parent.level ?? 0) < normalizedMaxDepth - 1) {
          parent.children.push(node);
        }
      } else {
        roots.push(node);
      }
    });

    const sortNodes = (nodes = []) => {
      nodes.sort(
        (a, b) =>
          (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
          String(a.title || "").localeCompare(String(b.title || "")),
      );
      nodes.forEach((node) => {
        if (Array.isArray(node.children) && node.children.length) {
          sortNodes(node.children);
        }
      });
    };

    sortNodes(roots);
    return roots;
  }

  async listCategories(query) {
    const isTreeRequested = query.tree === true || query.tree === "true";
    const pagination = isTreeRequested
      ? { page: 1, limit: 5000, skip: 0 }
      : getPage(query);
    const filter = buildMongoFilter({
      search:      query.q || query.keyWord || query.search,
      searchFields:["title", "categoryKey"],
      exactFilters:{
        parentKey:   query.parentKey,
        categoryKey: query.categoryKey,
      },
    });
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";

    const result = await this.platformRepository.listCategories(filter, pagination);

    if (!isTreeRequested) {
      return result;
    }

    const maxDepth = query.maxDepth || 3;
    const tree = this.buildCategoryTree(result.items || [], maxDepth);
    return { items: tree, total: tree.length };
  }

  async deleteCategory(categoryKey, req) {
    const category = await this.platformRepository.getCategory(categoryKey);
    if (!category) throw AppError.notFound("Category");
    const result = await this.platformRepository.deleteCategory(categoryKey);
    this.invalidateCatalogCaches();
    auditService.remove(req, { module: "categories", entityId: categoryKey, entityType: "Category", oldData: category });
    return result;
  }

  async createProductFamily(payload, req) {
    const item = await this.platformRepository.createProductFamily(payload);
    this.invalidateCatalogCaches();
    auditService.create(req, {
      module: "product_families",
      entityId: item?.familyCode || item?._id,
      entityType: "ProductFamily",
      newData: payload,
    });
    return item;
  }

  async updateProductFamily(familyCode, payload, req) {
    const family = await this.platformRepository.getProductFamily(familyCode);
    if (!family) {
      throw AppError.notFound("Product family");
    }
    const item = await this.platformRepository.updateProductFamily(familyCode, payload);
    this.invalidateCatalogCaches();
    auditService.update(req, {
      module: "product_families",
      entityId: familyCode,
      entityType: "ProductFamily",
      oldData: family,
      newData: payload,
    });
    return item;
  }

  async getProductFamily(familyCode) {
    const family = await this.platformRepository.getProductFamily(familyCode);
    if (!family) {
      throw AppError.notFound("Product family");
    }
    return family;
  }

  async listProductFamilies(query) {
    const pagination = { ...getPage(query), sortBy: query.sortBy, sortDir: query.sortDir };
    const filter = {};
    if (query.category) filter.category = query.category;
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.status) filter.status = query.status;
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { familyCode: { $regex: q, $options: "i" } },
      ];
    }
    return this.platformRepository.listProductFamilies(filter, pagination);
  }

  async deleteProductFamily(familyCode, req) {
    const family = await this.platformRepository.getProductFamily(familyCode);
    if (!family) {
      throw AppError.notFound("Product family");
    }
    const item = await this.platformRepository.deleteProductFamily(familyCode);
    this.invalidateCatalogCaches();
    auditService.remove(req, {
      module: "product_families",
      entityId: familyCode,
      entityType: "ProductFamily",
      oldData: family,
    });
    return item;
  }

  async createProductVariant(payload, req) {
    const item = await this.platformRepository.createProductVariant(payload);
    auditService.create(req, {
      module: "product_variants",
      entityId: item?._id,
      entityType: "ProductVariant",
      newData: payload,
    });
    return item;
  }

  async updateProductVariant(variantId, payload, req) {
    const variant = await this.platformRepository.getProductVariant(variantId);
    if (!variant) {
      throw AppError.notFound("Product variant");
    }
    const item = await this.platformRepository.updateProductVariant(variantId, payload);
    auditService.update(req, {
      module: "product_variants",
      entityId: variantId,
      entityType: "ProductVariant",
      oldData: variant,
      newData: payload,
    });
    return item;
  }

  async getProductVariant(variantId) {
    const variant = await this.platformRepository.getProductVariant(variantId);
    if (!variant) {
      throw AppError.notFound("Product variant");
    }
    return variant;
  }

  async listProductVariants(query) {
    const pagination = { ...getPage(query), sortBy: query.sortBy, sortDir: query.sortDir };
    const filter = {};
    if (query.productId) filter.productId = query.productId;
    if (query.familyCode) filter.familyCode = query.familyCode;
    if (query.sellerId) filter.sellerId = query.sellerId;
    if (query.sku) filter.sku = { $regex: query.sku, $options: "i" };
    if (query.status) filter.status = query.status;
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$or = [
        { sku: { $regex: q, $options: "i" } },
        { familyCode: { $regex: q, $options: "i" } },
      ];
    }
    return this.platformRepository.listProductVariants(filter, pagination);
  }

  async deleteProductVariant(variantId, req) {
    const variant = await this.platformRepository.getProductVariant(variantId);
    if (!variant) {
      throw AppError.notFound("Product variant");
    }
    const item = await this.platformRepository.deleteProductVariant(variantId);
    auditService.remove(req, {
      module: "product_variants",
      entityId: variantId,
      entityType: "ProductVariant",
      oldData: variant,
    });
    return item;
  }

  async createHsnCode(payload) {
    const item = await this.platformRepository.createHsnCode(payload);
    this.invalidateCatalogCaches();
    return item;
  }

  async updateHsnCode(code, payload) {
    const item = await this.platformRepository.getHsnCode(code);
    if (!item) {
      throw AppError.notFound("HSN code");
    }
    const updated = await this.platformRepository.updateHsnCode(code, payload);
    this.invalidateCatalogCaches();
    return updated;
  }

  async getHsnCode(code) {
    const item = await this.platformRepository.getHsnCode(code);
    if (!item) {
      throw AppError.notFound("HSN code");
    }
    return item;
  }

  async listHsnCodes(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    if (query.category) filter.category = query.category;
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$or = [
        { code: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } },
      ];
    }
    return this.platformRepository.listHsnCodes(filter, pagination);
  }

  async deleteHsnCode(code) {
    const item = await this.platformRepository.getHsnCode(code);
    if (!item) {
      throw AppError.notFound("HSN code");
    }
    const result = await this.platformRepository.deleteHsnCode(code);
    this.invalidateCatalogCaches();
    return result;
  }

  async createGeography(payload) {
    return this.platformRepository.createGeography(payload);
  }

  async updateGeography(countryCode, payload) {
    const item = await this.platformRepository.getGeography(countryCode);
    if (!item) {
      throw AppError.notFound("Geography record");
    }
    return this.platformRepository.updateGeography(countryCode, payload);
  }

  async getGeography(countryCode) {
    const item = await this.platformRepository.getGeography(countryCode);
    if (!item) {
      throw AppError.notFound("Geography record");
    }
    return item;
  }

  async listGeographies(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    return this.platformRepository.listGeographies(filter, pagination);
  }

  async deleteGeography(countryCode) {
    const item = await this.platformRepository.getGeography(countryCode);
    if (!item) {
      throw AppError.notFound("Geography record");
    }
    return this.platformRepository.deleteGeography(countryCode);
  }

  async createContentPage(payload) {
    const nextPayload = this.normalizeContentPagePayload(payload);
    if (nextPayload.published && !nextPayload.publishedAt) {
      nextPayload.publishedAt = new Date();
    }
    return this.platformRepository.createContentPage(nextPayload);
  }

  async updateContentPage(slug, payload) {
    const item = await this.platformRepository.getContentPage(slug);
    if (!item) {
      throw AppError.notFound("Content page");
    }
    const nextPayload = this.normalizeContentPagePayload(payload, item);
    if (nextPayload.published && !nextPayload.publishedAt) {
      nextPayload.publishedAt = new Date();
    }
    return this.platformRepository.updateContentPage(slug, nextPayload);
  }

  async getContentPage(slug) {
    const item = await this.platformRepository.getContentPage(slug);
    if (!item) {
      throw AppError.notFound("Content page");
    }
    return item;
  }

  async listContentPages(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.pageType) filter.pageType = query.pageType;
    if (query.status) filter.status = query.status;
    if (query.language) filter.language = query.language;
    if (query.published !== undefined) filter.published = query.published === true || query.published === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { slug: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { body: { $regex: q, $options: "i" } },
      ];
    }
    return this.platformRepository.listContentPages(filter, pagination);
  }

  normalizeContentPagePayload(payload = {}, existing = {}) {
    const nextPayload = { ...payload };
    const imageUrl = nextPayload.image?.url || nextPayload.heroImage || nextPayload.coverImage || "";
    const imageAlt = nextPayload.image?.alt || nextPayload.title || existing.title || "";

    if (nextPayload.image || imageUrl) {
      nextPayload.image = {
        url: imageUrl,
        alt: imageAlt,
        title: nextPayload.image?.title || "",
        caption: nextPayload.image?.caption || "",
        type: nextPayload.image?.type || "hero",
      };
    }

    if (Array.isArray(nextPayload.galleryImages) && !Array.isArray(nextPayload.gallery)) {
      nextPayload.gallery = nextPayload.galleryImages.map((url) => ({ url, alt: nextPayload.title || "" }));
    }

    if (Array.isArray(nextPayload.gallery)) {
      nextPayload.galleryImages = nextPayload.gallery.map((item) => item?.url || "").filter(Boolean);
    }

    if (nextPayload.image?.url) {
      nextPayload.heroImage = nextPayload.heroImage || nextPayload.image.url;
      nextPayload.coverImage = nextPayload.coverImage || nextPayload.image.url;
      nextPayload.thumbnailUrl = nextPayload.thumbnailUrl || nextPayload.image.url;
    }

    if (!nextPayload.excerpt && nextPayload.description) {
      nextPayload.excerpt = nextPayload.description;
    }

    if (!nextPayload.body && (nextPayload.description || Array.isArray(nextPayload.sections))) {
      nextPayload.body = this.makeContentPageBody(nextPayload);
    }

    if (nextPayload.status) {
      nextPayload.published = nextPayload.status === "published";
    } else if (nextPayload.published !== undefined) {
      nextPayload.status = nextPayload.published ? "published" : "draft";
    }

    return nextPayload;
  }

  makeContentPageBody(page = {}) {
    const lines = [`# ${page.title || ""}`];
    if (page.description) lines.push("", page.description);
    for (const section of page.sections || []) {
      if (section.title) lines.push("", `## ${section.title}`);
      if (section.description) lines.push(section.description);
      for (const point of section.points || []) {
        if (point.title || point.description) {
          lines.push(`- ${[point.title, point.description].filter(Boolean).join(": ")}`);
        }
      }
    }
    return lines.join("\n").trim();
  }

  async deleteContentPage(slug) {
    const item = await this.platformRepository.getContentPage(slug);
    if (!item) {
      throw AppError.notFound("Content page");
    }
    return this.platformRepository.deleteContentPage(slug);
  }

  async createProductReview(productId, payload, actor) {
    const buyerId = actor.userId || actor.sub || actor.id;
    const buyerName = buyerNameFromUser(actor.user || actor);
    const buyerImage = buyerImageFromUser(actor.user || actor);
    const orderItem = await this.orderRepository.findReviewableOrderItem({
      buyerId,
      productId,
      orderId: payload.orderId,
      orderItemId: payload.orderItemId,
    });

    if (!orderItem) {
      throw new AppError("Only purchased products can be reviewed", 403);
    }

    const deliveredStatuses = new Set([ORDER_STATUS.DELIVERED, ORDER_STATUS.FULFILLED, "completed"]);
    const paidStatuses = new Set([PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.AUTHORIZED, "paid"]);
    if (!deliveredStatuses.has(orderItem.order_status)) {
      throw new AppError("Review can be submitted after delivery is complete", 400);
    }
    if (!paidStatuses.has(orderItem.payment_status)) {
      throw new AppError("Review can be submitted after successful payment", 400);
    }

    const existing = await this.platformRepository.getProductReviewByBuyerAndOrder(
      productId,
      buyerId,
      payload.orderId,
    );
    if (existing) throw AppError.duplicate("Review", "already reviewed this product for this order");

    const review = await this.platformRepository.createProductReview({
      productId,
      sellerId: orderItem.seller_id || payload.sellerId || "",
      organizationId: orderItem.organization_id || payload.organizationId || "",
      buyerId,
      buyerName,
      orderId: payload.orderId,
      orderItemId: orderItem.order_item_id || payload.orderItemId || "",
      rating: payload.rating,
      title: payload.title || "",
      reviewText: payload.reviewText || "",
      media: payload.media || [],
      status: "pending",
    });

    this._syncProductRating(productId).catch(() => {});
    const plain = typeof review.toObject === "function" ? review.toObject() : review;
    return {
      ...plain,
      buyerImage,
      buyerAvatarUrl: buyerImage,
    };
  }

  async enrichProductReviewItems(items = []) {
    const plainItems = items.map((review) =>
      typeof review?.toObject === "function" ? review.toObject() : review,
    );
    const buyerIds = [
      ...new Set(
        plainItems
          .map((review) => review?.buyerId)
          .filter(Boolean)
          .map((buyerId) => String(buyerId)),
      ),
    ];
    const validBuyerIds = buyerIds.filter(isMongoObjectId);
    const users = validBuyerIds.length
      ? await UserModel.find({ _id: { $in: validBuyerIds } }).select("email profile displayName avatarUrl profileImage user_image image")
      : [];
    const userById = new Map(users.map((user) => [String(user._id), user]));

    return plainItems.map((review) => {
      const user = userById.get(String(review?.buyerId));
      const buyerImage = buyerImageFromUser(user);
      return {
        ...review,
        buyerName: review.buyerName || buyerNameFromUser(user) || "Verified Buyer",
        buyerImage,
        buyerAvatarUrl: buyerImage,
      };
    });
  }

  async listProductReviews(query = {}) {
    const pagination = getPage(query);
    const filter = {};
    if (query.productId) filter.productId = query.productId;
    if (query.buyerId) filter.buyerId = query.buyerId;
    if (query.orderId) filter.orderId = query.orderId;
    if (query.status) filter.status = query.status;
    if (query.rating) filter.rating = Number(query.rating);
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { reviewText: { $regex: q, $options: "i" } },
        { productId: { $regex: q, $options: "i" } },
        { buyerId: { $regex: q, $options: "i" } },
      ];
    }
    const result = await this.platformRepository.listProductReviews(filter, pagination);
    return {
      ...result,
      items: await this.enrichProductReviewItems(result.items),
    };
  }

  async listSellerProductReviews(query = {}, actor = {}) {
    const pagination = getPage(query);
    const sellerId = actor.ownerSellerId || actor.userId;
    if (!sellerId) throw AppError.forbidden("Seller context is required");

    const products = await ProductModel.find({
      sellerId,
      ...(actor.organizationId ? { organizationId: actor.organizationId } : {}),
    }).select("_id title slug images sellerId organizationId rating reviewCount");
    const productIds = products.map((product) => String(product._id));
    const productById = new Map(products.map((product) => [String(product._id), product]));

    const filter = {
      $or: [
        { sellerId },
        ...(productIds.length ? [{ productId: { $in: productIds } }] : []),
      ],
    };
    if (actor.organizationId) filter.organizationId = actor.organizationId;
    if (query.productId) filter.productId = query.productId;
    if (query.buyerId) filter.buyerId = query.buyerId;
    if (query.orderId) filter.orderId = query.orderId;
    if (query.status) filter.status = query.status;
    if (query.rating) filter.rating = Number(query.rating);
    const q = query.q || query.keyWord || query.search;
    if (q) {
      filter.$and = [{
        $or: [
          { title: { $regex: q, $options: "i" } },
          { reviewText: { $regex: q, $options: "i" } },
          { productId: { $regex: q, $options: "i" } },
          { buyerId: { $regex: q, $options: "i" } },
        ],
      }];
    }

    const result = await this.platformRepository.listProductReviews(filter, pagination);
    const enrichedReviews = await this.enrichProductReviewItems(result.items);
    return {
      ...result,
      items: enrichedReviews.map((plain) => {
        const product = productById.get(String(plain.productId));
        return {
          ...plain,
          product: product
            ? {
                id: String(product._id),
                title: product.title,
                slug: product.slug,
                image: product.images?.[0] || "",
                rating: product.rating || 0,
                reviewCount: product.reviewCount || 0,
              }
            : null,
        };
      }),
    };
  }

  async listPublicProductReviews(productId, query = {}) {
    const pagination = getPage(query);
    if (query.sort === "highest") {
      pagination.sortBy = "rating";
      pagination.sortDir = "desc";
    } else if (query.sort === "lowest") {
      pagination.sortBy = "rating";
      pagination.sortDir = "asc";
    } else if (query.sort === "helpful") {
      pagination.sortBy = "helpfulVotes";
      pagination.sortDir = "desc";
    } else if (query.sort === "oldest") {
      pagination.sortBy = "createdAt";
      pagination.sortDir = "asc";
    }
    const filter = { productId, status: "published" };
    if (query.rating) filter.rating = Number(query.rating);
    const reviews = await this.platformRepository.listProductReviews(filter, pagination);
    const stats = await this.platformRepository.getProductRatingStats(productId);
    return {
      ...reviews,
      items: await this.enrichProductReviewItems(reviews.items),
      stats,
    };
  }

  async updateProductReview(reviewId, payload, actor = {}) {
    const item = await this.platformRepository.getProductReview(reviewId);
    if (!item) throw AppError.notFound("Product review");
    const updatePayload = { ...payload };
    if (payload.status) {
      updatePayload.moderatedBy = actor.userId || actor.sub || actor.id || null;
      updatePayload.moderatedAt = new Date();
      if (payload.status === "published") updatePayload.rejectionReason = "";
    }
    const updated = await this.platformRepository.updateProductReview(reviewId, updatePayload);
    if (payload.status) {
      this._syncProductRating(item.productId).catch(() => {});
    }
    const [enriched] = await this.enrichProductReviewItems([updated]);
    return enriched || updated;
  }

  async bulkUpdateProductReviews(payload = {}, actor = {}) {
    const reviewIds = Array.isArray(payload.reviewIds)
      ? payload.reviewIds.filter(Boolean)
      : [];
    if (!reviewIds.length) throw new AppError("Select at least one review", 400);

    const status = payload.status || (payload.action === "approve" ? "published" : payload.action);
    if (!["pending", "published", "hidden", "rejected"].includes(status)) {
      throw new AppError("Invalid review status", 400);
    }

    const reviews = await Promise.all(
      reviewIds.map((reviewId) => this.platformRepository.getProductReview(reviewId)),
    );
    const existingReviews = reviews.filter(Boolean);
    if (!existingReviews.length) throw AppError.notFound("Product reviews");

    const update = {
      status,
      moderatedBy: actor.userId || actor.sub || actor.id || null,
      moderatedAt: new Date(),
    };
    if (status === "rejected") {
      update.rejectionReason = payload.rejectionReason || payload.reason || "";
    } else if (status === "published") {
      update.rejectionReason = "";
    }

    const result = await this.platformRepository.bulkUpdateProductReviews(
      existingReviews.map((review) => review._id),
      update,
    );
    const productIds = [...new Set(existingReviews.map((review) => String(review.productId)).filter(Boolean))];
    productIds.forEach((id) => this._syncProductRating(id).catch(() => {}));
    return {
      matchedCount: result.matchedCount ?? result.n ?? existingReviews.length,
      modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
    };
  }

  async deleteProductReview(reviewId) {
    const item = await this.platformRepository.getProductReview(reviewId);
    if (!item) throw AppError.notFound("Product review");
    await this.platformRepository.deleteProductReview(reviewId);
    this._syncProductRating(item.productId).catch(() => {});
    return { deleted: true };
  }

  async deleteOwnReview(reviewId, buyerId) {
    const item = await this.platformRepository.getProductReview(reviewId);
    if (!item) throw AppError.notFound("Review");
    if (String(item.buyerId) !== String(buyerId)) throw AppError.ownershipDenied();
    await this.platformRepository.deleteProductReview(reviewId);
    this._syncProductRating(item.productId).catch(() => {});
    return { deleted: true };
  }

  async toggleHelpfulVote(reviewId, userId) {
    const item = await this.platformRepository.getProductReview(reviewId);
    if (!item) throw AppError.notFound("Review");
    const alreadyVoted = (item.helpfulVotedBy || []).includes(String(userId));
    let updated;
    if (alreadyVoted) {
      updated = await this.platformRepository.removeHelpfulVote(reviewId, userId);
    } else {
      updated = await this.platformRepository.addHelpfulVote(reviewId, userId);
    }
    const [enriched] = await this.enrichProductReviewItems([updated]);
    return enriched || updated;
  }

  async _syncProductRating(productId) {
    const stats = await this.platformRepository.getProductRatingStats(productId);
    await ProductModel.findByIdAndUpdate(productId, {
      rating: stats.avgRating,
      reviewCount: stats.count,
    });
  }

  async createBrand(payload, req) {
    const item = await this.platformRepository.createBrand(payload);
    this.invalidateCatalogCaches();
    auditService.create(req, { module: "brands", entityId: item?._id, entityType: "Brand", newData: payload });
    return item;
  }

  async updateBrand(brandId, payload, req) {
    const item = await this.platformRepository.getBrand(brandId);
    if (!item) throw AppError.notFound("Brand");
    const updated = await this.platformRepository.updateBrand(brandId, payload);
    this.invalidateCatalogCaches();
    auditService.update(req, { module: "brands", entityId: brandId, entityType: "Brand", oldData: item, newData: payload });
    return updated;
  }

  async getBrand(brandId) {
    const item = await this.platformRepository.getBrand(brandId);
    if (!item) throw AppError.notFound("Brand");
    return item;
  }

  async listBrands(query) {
    const pagination = { ...getPage(query), sortBy: query.sortBy, sortDir: query.sortDir || query.sortOrder };
    const filter = buildMongoFilter({
      search:      query.q || query.keyWord || query.search,
      searchFields:["name"],
    });
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    return this.platformRepository.listBrands(filter, pagination);
  }

  async deleteBrand(brandId, req) {
    const item = await this.platformRepository.getBrand(brandId);
    if (!item) throw AppError.notFound("Brand");
    const result = await this.platformRepository.deleteBrand(brandId);
    this.invalidateCatalogCaches();
    auditService.remove(req, { module: "brands", entityId: brandId, entityType: "Brand", oldData: item });
    return result;
  }

  async createBatch(payload, req) {
    const createPayload = withCreateActor(payload, req);
    const item = await this.platformRepository.createBatch(createPayload);
    this.invalidateCatalogCaches();
    auditService.create(req, { module: "platform", entityId: item?._id, entityType: "Batch", newData: createPayload });
    return item;
  }

  async updateBatch(batchId, payload, req) {
    const item = await this.platformRepository.getBatch(batchId);
    if (!item) throw AppError.notFound("Batch");
    const updatePayload = withUpdateActor(payload, req);
    const result = await this.platformRepository.updateBatch(batchId, updatePayload);
    this.invalidateCatalogCaches();
    auditService.update(req, { module: "platform", entityId: batchId, entityType: "Batch", oldData: item, newData: updatePayload });
    return result;
  }

  async listBatches(query) {
    const pagination = { ...getPage(query), sortBy: query.sortBy, sortDir: query.sortDir || query.sortOrder };
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) filter.batchCode = { $regex: q, $options: "i" };
    return this.platformRepository.listBatches(filter, pagination);
  }

  async deleteBatch(batchId, req) {
    const item = await this.platformRepository.getBatch(batchId);
    if (!item) throw AppError.notFound("Batch");
    const result = await this.platformRepository.deleteBatch(batchId);
    this.invalidateCatalogCaches();
    auditService.remove(req, { module: "platform", entityId: batchId, entityType: "Batch", oldData: item });
    return result;
  }

  async createProductOption(payload, req) {
    const item = await this.platformRepository.createProductOption(payload);
    this.invalidateCatalogCaches();
    auditService.create(req, { module: "option_masters", entityId: item?._id, entityType: "ProductOption", newData: payload });
    return item;
  }

  async updateProductOption(optionId, payload, req) {
    const item = await this.platformRepository.getProductOption(optionId);
    if (!item) throw AppError.notFound("Product option");
    const updated = await this.platformRepository.updateProductOption(optionId, payload);
    this.invalidateCatalogCaches();
    auditService.update(req, { module: "option_masters", entityId: optionId, entityType: "ProductOption", oldData: item, newData: payload });
    return updated;
  }

  async listProductOptions(query) {
    const pagination = { ...getPage(query), sortBy: query.sortBy, sortDir: query.sortDir };
    const filter = buildMongoFilter({
      search:      query.q || query.keyWord || query.search,
      searchFields:["name"],
    });
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    if (query.slug) filter.slug = query.slug;
    return this.platformRepository.listProductOptions(filter, pagination);
  }

  async deleteProductOption(optionId, req) {
    const item = await this.platformRepository.getProductOption(optionId);
    if (!item) throw AppError.notFound("Product option");
    const result = await this.platformRepository.deleteProductOption(optionId);
    this.invalidateCatalogCaches();
    auditService.remove(req, { module: "option_masters", entityId: optionId, entityType: "ProductOption", oldData: item });
    return result;
  }

  async createProductOptionValue(payload, req) {
    const normalized = await this.normalizeProductOptionValuePayload(payload);
    const item = await this.platformRepository.createProductOptionValue(normalized);
    this.invalidateCatalogCaches();
    auditService.create(req, {
      module: "option_values",
      entityId: item?._id,
      entityType: "ProductOptionValue",
      newData: normalized,
    });
    return item;
  }

  async updateProductOptionValue(optionValueId, payload, req) {
    const item = await this.platformRepository.getProductOptionValue(optionValueId);
    if (!item) throw AppError.notFound("Product option value");
    const normalized = await this.normalizeProductOptionValuePayload(payload, { partial: true });
    const result = await this.platformRepository.updateProductOptionValue(optionValueId, normalized);
    this.invalidateCatalogCaches();
    auditService.update(req, {
      module: "option_values",
      entityId: optionValueId,
      entityType: "ProductOptionValue",
      oldData: item,
      newData: normalized,
    });
    return result;
  }

  async listProductOptionValues(query) {
    const pagination = { ...getPage(query), sortBy: query.sortBy, sortDir: query.sortDir };
    const filter = {};
    if (query.option_id || query.optionId) filter.optionId = query.option_id || query.optionId;
    if (query.active !== undefined) filter.active = query.active === true || query.active === "true";
    const q = query.q || query.keyWord || query.search;
    if (q) filter.name = { $regex: q, $options: "i" };
    const result = await this.platformRepository.listProductOptionValues(filter, pagination);
    return {
      ...result,
      items: await this.decorateProductOptionValues(result.items),
    };
  }

  async deleteProductOptionValue(optionValueId, req) {
    const item = await this.platformRepository.getProductOptionValue(optionValueId);
    if (!item) throw AppError.notFound("Product option value");
    const result = await this.platformRepository.deleteProductOptionValue(optionValueId);
    this.invalidateCatalogCaches();
    auditService.remove(req, {
      module: "option_values",
      entityId: optionValueId,
      entityType: "ProductOptionValue",
      oldData: item,
    });
    return result;
  }

  async normalizeProductOptionValuePayload(payload = {}, { partial = false } = {}) {
    const optionId = payload.optionId || payload.option_id;
    if (!partial && !optionId) {
      throw AppError.validation("optionId is required");
    }

    const normalized = { ...payload };
    delete normalized.option_id;

    if (optionId) {
      const option = await this.platformRepository.getProductOption(optionId);
      if (!option) {
        throw AppError.notFound("Product option");
      }
      normalized.optionId = String(option._id);
      normalized.option_id = String(option._id);
      normalized.optionName = option.name;
    }

    if (normalized.valueCode === undefined && normalized.name) {
      normalized.valueCode = String(normalized.name)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
    }

    return normalized;
  }

  async decorateProductOptionValues(items = []) {
    if (!Array.isArray(items) || !items.length) return items;
    const optionIds = Array.from(new Set(items.map((item) => String(item.optionId || "")).filter(Boolean)));
    if (!optionIds.length) return items;

    const options = await Promise.all(optionIds.map((id) => this.platformRepository.getProductOption(id)));
    const optionMap = new Map(options.filter(Boolean).map((opt) => [String(opt._id), opt]));

    return items.map((item) => {
      const value = item.toObject ? item.toObject() : { ...item };
      const option = optionMap.get(String(value.optionId || ""));
      return {
        ...value,
        optionId: value.optionId || value.option_id || "",
        optionName: value.optionName || option?.name || "",
      };
    });
  }

  async getCatalogPrefillData(query = {}) {
    const categories = (await this.platformRepository.listCategories({}, { skip: 0, limit: 5000 })).items || [];
    const brands = (await this.platformRepository.listBrands(query.includeInactive ? {} : { active: true }, { skip: 0, limit: 500 })).items || [];
    const families = (await this.platformRepository.listProductFamilies({}, { skip: 0, limit: 500 })).items || [];
    const variants = (await this.platformRepository.listProductVariants({}, { skip: 0, limit: 500 })).items || [];
    const hsnCodes = (await this.platformRepository.listHsnCodes({ active: true }, { skip: 0, limit: 1000 })).items || [];
    const options = await this.platformRepository.listAllProductOptions(query.includeInactive ? {} : { active: true });
    const optionValuesRaw = await this.platformRepository.listAllProductOptionValues(query.includeInactive ? {} : { active: true });
    const optionValues = await this.decorateProductOptionValues(optionValuesRaw);
    const [taxes, subTaxes, taxRules] = await Promise.all([
      AdminTaxModel.find(query.includeInactive ? {} : { active: true }).sort({ name: 1 }),
      AdminSubTaxModel.find(query.includeInactive ? {} : { active: true }).sort({ name: 1 }),
      AdminTaxRuleModel.find(query.includeInactive ? {} : { active: true }).sort({ createdAt: -1 }),
    ]);

    return {
      categories,
      categoryAttributes: categories.map((category) => ({
        categoryKey: category.categoryKey,
        title: category.title,
        attributeSchema: this.normalizeCategoryAttributes(category),
      })),
      brands,
      families,
      variants,
      hsnCodes,
      taxes,
      subTaxes,
      taxRules,
      options,
      optionValues,
    };
  }
}

module.exports = { PlatformService };
