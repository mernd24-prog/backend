"use strict";

const { ProductRepository } = require("../../product/repositories/product.repository");
const { DealRepository } = require("../../deal/repositories/deal.repository");
const { PlatformRepository } = require("../../platform/repositories/platform.repository");
const {
  applyPublicProductFilter,
  isPublicProduct,
} = require("../../../shared/catalog/public-product-filter");

const SECTION_CONFIGS = [
  {
    key: "mens-best-sellers",
    title: "Best Sellers in Men's Fashion",
    label: "Trending",
    source: "products",
    category: "mens-fashion",
    sort: "popular",
  },
  {
    key: "home-lifestyle-deals",
    title: "Home & Lifestyle Deals",
    discountTitleSuffix: "Home & Lifestyle",
    label: "Hot Deal",
    source: "deals",
    category: "home",
    sort: "discount",
    minDiscountPercent: 10,
  },
  {
    key: "womens-trending",
    title: "Trending in Women's Fashion",
    label: "New In",
    source: "products",
    category: "womens-fashion",
    sort: "newest",
  },
  {
    key: "kids-popular",
    title: "Top Picks in Kids Fashion",
    label: "Popular",
    source: "products",
    category: "kids",
    sort: "popular",
  },
];

const GENERIC_SECTION_CONFIGS = [
  {
    key: "collage-deals",
    title: "Deals 10% Off & More",
    discountTitleSuffix: "Deals",
    label: "Hot Deal",
    source: "deals",
    sort: "discount",
    minDiscountPercent: 10,
  },
  {
    key: "collage-trending",
    title: "Trending Products",
    label: "Trending",
    source: "products",
    sort: "popular",
  },
  {
    key: "collage-new-arrivals",
    title: "New Arrivals",
    label: "New In",
    source: "products",
    sort: "newest",
  },
  {
    key: "collage-top-picks",
    title: "Top Picks For You",
    label: "Popular",
    source: "products",
    sort: "popular",
  },
];

const FALLBACK_CATEGORIES = {
  "mens-fashion": ["mens-fashion", "men", "mens-shoes", "mens-watches"],
  home: ["home", "home-kitchen", "home-lifestyle", "lifestyle"],
  "womens-fashion": ["womens-fashion", "women", "womens", "beauty-fragrances-perfumes-women"],
  kids: ["kids", "kids-fashion"],
};

const firstDefined = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const normalizeKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const uniqueValues = (values = []) => [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const categoryMatches = (product = {}, categoryCandidates = []) => {
  const allowed = new Set(categoryCandidates.map(normalizeKey).filter(Boolean));
  if (!allowed.size) return true;
  return [
    product.category,
    product.categoryId,
    product.category_id,
    product.categoryKey,
    product.categorySlug,
    product.categoryName,
    product.dealCategory,
  ].some((value) => allowed.has(normalizeKey(value)));
};

class HomeService {
  constructor({
    productRepository = new ProductRepository(),
    dealRepository = new DealRepository(),
    platformRepository = new PlatformRepository(),
  } = {}) {
    this.productRepository = productRepository;
    this.dealRepository = dealRepository;
    this.platformRepository = platformRepository;
    this.categoryCandidateCache = new Map();
    this.activeCategoryCandidatesCache = null;
    this.dashboardCategoryConfigCache = new Map();
  }

  async resolveCategoryCandidates(category, { includeAliases = true } = {}) {
    if (!category) return [];
    const cacheKey = `${category}:${includeAliases ? "aliases" : "strict"}`;
    if (this.categoryCandidateCache.has(cacheKey)) {
      return this.categoryCandidateCache.get(cacheKey);
    }

    const seedCandidates = uniqueValues(includeAliases ? FALLBACK_CATEGORIES[category] || [category] : [category]);
    const candidateKeys = new Set(seedCandidates);

    await Promise.all(seedCandidates.map(async (categoryKey) => {
      const descendants = await this.platformRepository
        .getCategoryDescendantKeys(categoryKey)
        .catch(() => []);
      descendants.forEach((descendantKey) => {
        if (descendantKey) candidateKeys.add(descendantKey);
      });
    }));

    const keys = [...candidateKeys];
    const categoryDocs = keys.length
      ? await this.platformRepository
        .listCategories(
          { categoryKey: { $in: keys } },
          { skip: 0, limit: Math.max(keys.length, 1) },
          { includeTotal: false },
        )
        .then((result) => result.items || [])
        .catch(() => [])
      : [];

    const titleCandidates = categoryDocs.flatMap((item) => [
      item.categoryKey,
      item.title,
      normalizeKey(item.title),
      item.parentKey,
    ]);

    const candidates = uniqueValues([...keys, ...titleCandidates]);
    this.categoryCandidateCache.set(cacheKey, candidates);
    return candidates;
  }

  async resolveActiveCategoryCandidates() {
    if (this.activeCategoryCandidatesCache) return this.activeCategoryCandidatesCache;

    const categories = await this.platformRepository
      .listCategories({ active: true }, { skip: 0, limit: 5000 }, { includeTotal: false })
      .then((result) => result.items || [])
      .catch(() => []);

    this.activeCategoryCandidatesCache = uniqueValues(categories.flatMap((item) => [
      item.categoryKey,
      item.title,
      normalizeKey(item.title),
    ]));
    return this.activeCategoryCandidatesCache;
  }

  async listDashboardCategoryConfigs(limit = 4) {
    const cacheKey = String(limit);
    if (this.dashboardCategoryConfigCache.has(cacheKey)) {
      return this.dashboardCategoryConfigCache.get(cacheKey);
    }

    const categories = await this.platformRepository
      .listCategories(
        { active: true, isDashboardVisible: true },
        { skip: 0, limit: Math.max(limit * 4, 16) },
        { includeTotal: false },
      )
      .then((result) => result.items || [])
      .catch(() => []);

    const configs = categories
      .filter((category) => category?.categoryKey)
      .sort((a, b) =>
        Number(a.level || 0) - Number(b.level || 0) ||
        Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
        String(a.title || "").localeCompare(String(b.title || "")),
      )
      .slice(0, limit)
      .map((category, index) => ({
        key: `category-collage-${category.categoryKey}`,
        title: `${category.title || category.categoryKey} Picks`,
        label: index === 0 ? "Featured" : index === 1 ? "Trending" : index === 2 ? "New In" : "Popular",
        source: "products",
        category: category.categoryKey,
        strictCategory: true,
        sort: index === 2 ? "newest" : "popular",
      }));
    this.dashboardCategoryConfigCache.set(cacheKey, configs);
    return configs;
  }

  buildCategoryFilter(categoryCandidates = []) {
    const candidates = uniqueValues(categoryCandidates);
    if (!candidates.length) return {};

    const normalizedCandidates = uniqueValues(candidates.map(normalizeKey));
    const regexCandidates = uniqueValues([...candidates, ...normalizedCandidates])
      .slice(0, 100)
      .map((value) => new RegExp(`^${escapeRegex(value)}$`, "i"));
    const matchValues = uniqueValues([...candidates, ...normalizedCandidates]);
    const fieldClauses = ["category", "categoryId", "category_id", "categoryKey", "categorySlug", "categoryName"]
      .flatMap((field) => [
        { [field]: { $in: matchValues } },
        { [field]: { $in: regexCandidates } },
      ]);

    return { $or: fieldClauses };
  }

  buildCategoryPrefixFilter(category) {
    const normalizedCategory = normalizeKey(category);
    if (!normalizedCategory) return {};
    const prefixRegex = new RegExp(`^${escapeRegex(normalizedCategory)}(?:-|$)`, "i");
    return {
      $or: ["category", "categoryId", "category_id", "categoryKey", "categorySlug", "categoryName"]
        .map((field) => ({ [field]: prefixRegex })),
    };
  }

  productImage(product = {}) {
    const images = Array.isArray(product.images) ? product.images : [];
    const commonImages = Array.isArray(product.commonImages) ? product.commonImages : [];
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const variantWithImage = variants.find((variant) =>
      variant?.image || (Array.isArray(variant?.images) && variant.images.length),
    );
    const firstImage = images[0] || commonImages[0] || variantWithImage?.image || variantWithImage?.images?.[0];
    if (typeof firstImage === "string") return firstImage;
    return firstDefined(
      firstImage?.url,
      firstImage?.image,
      firstImage?.imageUrl,
      firstImage?.secure_url,
      firstImage?.src,
      product.image,
      product.thumbnail,
      product.thumbnailUrl,
      product.coverImage,
      "",
    );
  }

  productLink(product = {}) {
    const productId = firstDefined(product._id, product.id, product.productId, product.slug);
    return productId ? `/products/${productId}` : "/products";
  }

  productLabel(product = {}) {
    return firstDefined(
      product.shortTitle,
      product.title,
      product.name,
      product.categoryName,
      product.category,
      "Shop Now",
    );
  }

  toCollageItem(product = {}) {
    const image = this.productImage(product);
    if (!image) return null;
    return {
      image,
      link: this.productLink(product),
      label: this.productLabel(product),
      productId: String(firstDefined(product._id, product.id, product.productId, "")),
      category: firstDefined(product.category, product.categoryId, product.category_id, ""),
      price: firstDefined(product.salePrice, product.sellingPrice, product.price, null),
      mrp: firstDefined(product.mrp, product.originalPrice, product.compareAtPrice, null),
      discountPercent: Number(product.discountPercent || product.discount_percent || 0),
      rating: Number(product.rating || 0),
      reviewCount: Number(product.reviewCount || 0),
      source: product?.metadata?.isDealProduct ? "deal" : "product",
    };
  }

  uniqueItems(items = [], limit = 4) {
    const seen = new Set();
    const unique = [];
    items.forEach((item) => {
      const key = item.productId || item.link || item.image;
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(item);
    });
    return unique.slice(0, limit);
  }

  async listProductItems(config, limit, baseCategoryCandidates = []) {
    const hasCategory = Boolean(config.category);
    const categoryCandidates = hasCategory && config.strictCategory !== true
      ? await this.resolveCategoryCandidates(config.category, { includeAliases: config.strictCategory !== true })
      : hasCategory
        ? [config.category]
        : baseCategoryCandidates;
    const projection = {
      title: 1,
      slug: 1,
      category: 1,
      categoryId: 1,
      category_id: 1,
      categoryKey: 1,
      categorySlug: 1,
      categoryName: 1,
      images: 1,
      commonImages: 1,
      "variants.images": 1,
      "variants.image": 1,
      image: 1,
      thumbnail: 1,
      thumbnailUrl: 1,
      price: 1,
      mrp: 1,
      salePrice: 1,
      sellingPrice: 1,
      rating: 1,
      reviewCount: 1,
      analytics: 1,
      status: 1,
      visibility: 1,
      publishedAt: 1,
      scheduledAt: 1,
      metadata: 1,
    };
    const readItems = async (filter = {}, readLimit = limit) => {
      const items = await this.productRepository.list(
        applyPublicProductFilter(filter),
        {
          page: 1,
          limit: Math.max(readLimit * 3, readLimit),
          skip: 0,
          sortBy: config.sort,
          sortDir: "desc",
        },
        { projection, lean: true },
      );
      return (items || []).map((product) => this.toCollageItem(product)).filter(Boolean);
    };

    if (!hasCategory) {
      const baseFilter = this.buildCategoryFilter(categoryCandidates);
      return this.uniqueItems(await readItems(baseFilter, limit * 2), limit);
    }

    const categoryFilter = config.strictCategory === true
      ? this.buildCategoryPrefixFilter(config.category)
      : this.buildCategoryFilter(categoryCandidates);
    const categoryItems = await readItems(categoryFilter);
    const selectedCategoryItems = this.uniqueItems(categoryItems, limit);
    return selectedCategoryItems;
  }

  async listDealItems(config, limit, baseCategoryCandidates = []) {
    const hasCategory = Boolean(config.category);
    const categoryCandidates = hasCategory
      ? await this.resolveCategoryCandidates(config.category, { includeAliases: config.strictCategory !== true })
      : baseCategoryCandidates;
    const deals = await this.dealRepository.listActiveDealProducts({
      sortBy: config.sort === "discount" ? "discount_percent" : "priority",
      sortDir: config.sort === "discount" ? "desc" : "asc",
      limit: Math.max(limit * 8, 24),
    });
    const productIds = [...new Set(deals.map((deal) => String(deal.productId || "")).filter(Boolean))];
    if (!productIds.length) return [];

    const products = await this.productRepository.findByIds(productIds);
    const productById = new Map(products.map((product) => [String(product._id || product.id), product]));
    const dealProducts = deals
      .map((deal) => {
        const product = productById.get(String(deal.productId || ""));
        if (!product || !isPublicProduct(product)) return null;
        const productObject = typeof product.toObject === "function" ? product.toObject() : product;
        return {
          ...productObject,
          price: Number(deal.dealPrice || productObject.salePrice || productObject.price || 0),
          salePrice: Number(deal.dealPrice || productObject.salePrice || productObject.price || 0),
          mrp: Number(deal.originalPrice || productObject.mrp || productObject.price || 0),
          originalPrice: Number(deal.originalPrice || productObject.mrp || productObject.price || 0),
          discountPercent: Number(deal.discountPercent || 0),
          dealCategory: deal.category,
          metadata: {
            ...(productObject.metadata || {}),
            isDealProduct: true,
            dealBadge: deal.metadata?.dealBadge || deal.metadata?.badge || "Deal",
          },
          deal: {
            dealId: deal.id || deal.dealId,
            title: deal.title,
            discountPercent: Number(deal.discountPercent || 0),
            endAt: deal.endAt,
          },
        };
      })
      .filter(Boolean);

    const minDiscountPercent = Number(config.minDiscountPercent || 0);
    const eligibleDeals = dealProducts.filter(
      (product) => Number(product.discountPercent || 0) >= minDiscountPercent,
    );
    const sourceDeals = eligibleDeals.length >= limit ? eligibleDeals : dealProducts;
    const shouldFilterCategory = hasCategory || categoryCandidates.length > 0;
    const filteredSourceDeals = shouldFilterCategory
      ? sourceDeals.filter((product) => categoryMatches(product, categoryCandidates))
      : sourceDeals;

    const categoryItems = filteredSourceDeals
      .map((product) => this.toCollageItem(product))
      .filter(Boolean);
    const topUpItems = filteredSourceDeals
      .map((product) => this.toCollageItem(product))
      .filter(Boolean)
      .slice(0, limit * 2);

    return this.uniqueItems([...categoryItems, ...topUpItems], limit);
  }

  sectionTitle(config, items = []) {
    if (config.source !== "deals") return config.title;
    const discounts = items
      .map((item) => Number(item.discountPercent || 0))
      .filter((discount) => discount > 0);
    const displayDiscount = discounts.length ? Math.min(...discounts) : 0;
    const suffix = config.discountTitleSuffix || "Deals";
    return displayDiscount > 0
      ? `Up to ${Math.round(displayDiscount)}% Off ${suffix}`
      : config.title;
  }

  async buildSection(config, perSectionLimit, usedProductIds = new Set(), baseCategoryCandidates = []) {
    const items = config.source === "deals"
      ? await this.listDealItems(config, perSectionLimit + usedProductIds.size, baseCategoryCandidates)
      : await this.listProductItems(config, perSectionLimit + usedProductIds.size, baseCategoryCandidates);
    const selectedItems = items
      .filter((item) => !usedProductIds.has(String(item.productId || item.link || item.image || "")))
      .slice(0, perSectionLimit);
    if (!selectedItems.length) return null;
    selectedItems.forEach((item) => {
      const key = String(item.productId || item.link || item.image || "");
      if (key) usedProductIds.add(key);
    });
    return {
      key: config.key,
      title: this.sectionTitle(config, selectedItems),
      label: config.label,
      source: config.source,
      category: config.category || null,
      images: selectedItems,
    };
  }

  async buildSectionCandidate(config, perSectionLimit, baseCategoryCandidates = []) {
    const fetchLimit = Math.max(perSectionLimit * (config.category ? 4 : 10), perSectionLimit);
    const items = config.source === "deals"
      ? await this.listDealItems(config, fetchLimit, baseCategoryCandidates)
      : await this.listProductItems(config, fetchLimit, baseCategoryCandidates);
    const uniqueItems = this.uniqueItems(items, fetchLimit);
    if (!uniqueItems.length) return null;
    return {
      key: config.key,
      title: this.sectionTitle(config, uniqueItems),
      label: config.label,
      source: config.source,
      category: config.category || null,
      images: uniqueItems,
    };
  }

  selectSectionCandidate(candidate, perSectionLimit, usedProductIds = new Set()) {
    if (!candidate) return null;
    const selectedItems = (candidate.images || [])
      .filter((item) => !usedProductIds.has(String(item.productId || item.link || item.image || "")))
      .slice(0, perSectionLimit);
    if (!selectedItems.length) return null;
    selectedItems.forEach((item) => {
      const key = String(item.productId || item.link || item.image || "");
      if (key) usedProductIds.add(key);
    });
    return {
      ...candidate,
      title: this.sectionTitle(candidate, selectedItems),
      images: selectedItems,
    };
  }

  async listCollectionCollages(query = {}) {
    const perSectionLimit = Math.min(8, Math.max(1, Number(query.itemsPerSection || query.itemLimit || 4)));
    const sectionLimit = Math.min(8, Math.max(1, Number(query.limit || 4)));
    const dashboardConfigs = await this.listDashboardCategoryConfigs(sectionLimit);
    const sections = [];
    const usedProductIds = new Set();

    const primaryConfigs = dashboardConfigs.length ? dashboardConfigs : SECTION_CONFIGS;
    const primaryCandidates = await Promise.all(
      primaryConfigs
        .slice(0, sectionLimit)
        .map((config) => this.buildSectionCandidate(config, perSectionLimit)),
    );
    for (const candidate of primaryCandidates) {
      const section = this.selectSectionCandidate(candidate, perSectionLimit, usedProductIds);
      if (section) sections.push(section);
    }

    const genericConfigs = GENERIC_SECTION_CONFIGS.filter(
      (config) => !sections.some((section) => section.key === config.key),
    );
    const productGenericConfigs = genericConfigs.filter((config) => config.source !== "deals");
    const dealGenericConfigs = genericConfigs.filter((config) => config.source === "deals");

    const productGenericCandidates = await Promise.all(
      productGenericConfigs.map((config) =>
        this.buildSectionCandidate(
          config,
          perSectionLimit,
          [],
        ),
      ),
    );
    for (const candidate of productGenericCandidates) {
      if (sections.length >= sectionLimit) break;
      if (sections.some((section) => section.key === candidate?.key)) continue;
      const section = this.selectSectionCandidate(candidate, perSectionLimit, usedProductIds);
      if (section) sections.push(section);
    }

    if (sections.length < sectionLimit) {
      const dealGenericCandidates = await Promise.all(
        dealGenericConfigs.map((config) =>
          this.buildSectionCandidate(
            config,
            perSectionLimit,
            [],
          ),
        ),
      );
      for (const candidate of dealGenericCandidates) {
        if (sections.length >= sectionLimit) break;
        if (sections.some((section) => section.key === candidate?.key)) continue;
        const section = this.selectSectionCandidate(candidate, perSectionLimit, usedProductIds);
        if (section) sections.push(section);
      }
    }

    return sections;
  }
}

module.exports = { HomeService };
