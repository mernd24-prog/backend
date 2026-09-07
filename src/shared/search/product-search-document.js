const PRODUCT_TYPE_SIMPLE = "simple";
const PRODUCT_VISIBILITY_PUBLIC = "public";

function toPlainObject(product = {}) {
  return typeof product.toObject === "function" ? product.toObject() : product;
}

function normalizeImageUrl(image) {
  if (!image) return "";
  if (typeof image === "string") return image.trim();
  if (typeof image !== "object") return "";

  return String(
    image.url ||
      image.imageURL ||
      image.imageUrl ||
      image.image_url ||
      image.secure_url ||
      image.src ||
      image.thumbnail ||
      image.thumbnailUrl ||
      image.thumbnail_url ||
      image.path ||
      "",
  ).trim();
}

function normalizeImages(images = []) {
  const list = Array.isArray(images) ? images : [images];
  return Array.from(
    new Set(
      list
        .map((image) => normalizeImageUrl(image))
        .filter(Boolean),
    ),
  );
}

function getAvailableStock(source = {}) {
  return Math.max(0, Number(source.stock || 0) - Number(source.reservedStock || 0));
}

function buildSearchMediaFields(product = {}) {
  const source = toPlainObject(product) || {};
  const variants = Array.isArray(source.variants) ? source.variants : [];
  const searchVariants = variants.map((variant) => {
    const variantImages = normalizeImages(variant.images || variant.image);
    return {
      id: String(variant._id || variant.id || ""),
      sku: variant.sku || "",
      title: variant.title || "",
      price: variant.price,
      salePrice: variant.salePrice || variant.price,
      stock: variant.stock || 0,
      reservedStock: variant.reservedStock || 0,
      availableStock: getAvailableStock(variant),
      status: variant.status || "",
      images: variantImages,
      image: variantImages[0] || "",
    };
  });

  const rootImages = normalizeImages(source.images || source.imageUrl || source.image);
  const commonImages = normalizeImages(source.commonImages);
  const variantImage = searchVariants
    .flatMap((variant) => variant.images || [])
    .find(Boolean);
  const primaryImage =
    normalizeImageUrl(source.image) ||
    normalizeImageUrl(source.imageUrl) ||
    normalizeImageUrl(source.thumbnail) ||
    normalizeImageUrl(source.thumbnailUrl) ||
    rootImages[0] ||
    commonImages[0] ||
    variantImage ||
    "";

  return {
    images: rootImages.length ? rootImages : primaryImage ? [primaryImage] : [],
    commonImages,
    image: primaryImage,
    imageUrl: primaryImage,
    thumbnail: primaryImage,
    variants: searchVariants,
  };
}

function buildProductSearchDocument(product = {}) {
  const source = toPlainObject(product) || {};
  const mediaFields = buildSearchMediaFields(source);

  return {
    id: String(source._id || source.id),
    title: source.title,
    slug: source.slug || "",
    shortDescription: source.shortDescription || "",
    category: source.category,
    categoryId: source.categoryId,
    brand: source.brand || "",
    sku: source.sku || "",
    description: source.description,
    price: source.price,
    salePrice: source.salePrice || source.price,
    gstRate: source.gstRate || 18,
    hsnCode: source.hsnCode || "",
    color: source.color || "",
    productType: source.productType || PRODUCT_TYPE_SIMPLE,
    productFamilyCode: source.productFamilyCode || "",
    tags: Array.isArray(source.tags) ? source.tags : [],
    origin: source.origin || {},
    sellerId: source.sellerId,
    organizationId: source.organizationId,
    storeId: source.storeId || "",
    warehouseId: source.warehouseId || "",
    organizationSnapshot: source.organizationSnapshot || {},
    stock: source.stock || 0,
    reservedStock: source.reservedStock || 0,
    availableStock: getAvailableStock(source),
    rating: source.rating || 0,
    reviewCount: source.reviewCount || 0,
    analytics: {
      views: source.analytics?.views || 0,
      purchases: source.analytics?.purchases || 0,
      cartAdds: source.analytics?.cartAdds || 0,
    },
    attributes: source.attributes
      ? Object.fromEntries(
          source.attributes instanceof Map
            ? source.attributes
            : Object.entries(source.attributes),
        )
      : {},
    ...mediaFields,
    status: source.status,
    approvalStatus: source.approvalStatus,
    visibility: source.visibility || PRODUCT_VISIBILITY_PUBLIC,
    publishedAt: source.publishedAt || source.createdAt,
    scheduledAt: source.scheduledAt || null,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function hasSearchMediaFields(product = {}) {
  return Boolean(
    normalizeImageUrl(product.image) ||
      normalizeImageUrl(product.imageUrl) ||
      normalizeImageUrl(product.thumbnail) ||
      normalizeImages(product.images).length ||
      normalizeImages(product.commonImages).length ||
      (Array.isArray(product.variants) &&
        product.variants.some((variant) => normalizeImages(variant.images || variant.image).length)),
  );
}

async function hydrateMissingSearchMedia(results = [], ProductModel) {
  if (!Array.isArray(results) || !results.length || !ProductModel) return results;

  const missingIds = results
    .filter((item) => !hasSearchMediaFields(item))
    .map((item) => String(item.id || item._id || ""))
    .filter(Boolean);

  if (!missingIds.length) return results;

  const products = await ProductModel.find({ _id: { $in: missingIds } })
    .select("images commonImages variants.images variants.stock variants.reservedStock variants.status variants.sku variants.title variants.price variants.salePrice")
    .lean()
    .catch(() => []);
  const mediaById = new Map(
    products.map((product) => [String(product._id), buildSearchMediaFields(product)]),
  );

  return results.map((item) => {
    const id = String(item.id || item._id || "");
    const mediaFields = mediaById.get(id);
    return mediaFields ? { ...item, ...mediaFields } : item;
  });
}

module.exports = {
  buildProductSearchDocument,
  buildSearchMediaFields,
  hasSearchMediaFields,
  hydrateMissingSearchMedia,
  normalizeImageUrl,
  normalizeImages,
};
