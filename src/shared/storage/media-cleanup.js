const { storageService } = require("./storage-service");

// Only collect media owned by the deleted record, never buyer avatars or links.
function productMedia(product) {
  const value = product?.toObject ? product.toObject() : product || {};
  return [
    ...(value.images || []), ...(value.commonImages || []),
    value.thumbnailUrl, ...(value.videos || []),
    ...(value.variants || []).flatMap((variant) => variant.images || []),
  ].filter(Boolean);
}

async function deleteUnreferencedMedia(urls) {
  const { ProductModel } = require("../../modules/product/models/product.model");
  const { ProductRevisionModel } = require("../../modules/product/models/product-revision.model");
  const { ContentPageModel } = require("../../modules/platform/models/content-page.model");
  const { CategoryTreeModel } = require("../../modules/platform/models/category-tree.model");
  const { PlatformBrandModel } = require("../../modules/platform/models/platform-brand.model");
  const { CollectionModel } = require("../../modules/platform/models/collection.model");
  const { PlatformProductOptionValueModel } = require("../../modules/platform/models/platform-product-option-value.model");
  const { ProductReviewModel } = require("../../modules/platform/models/product-review.model");
  const productPaths = ["images", "commonImages", "thumbnailUrl", "variants.images", "videos"];
  const references = [
    [ProductModel, productPaths],
    [ProductRevisionModel, productPaths.map((path) => `draftChanges.${path}`)],
    [ContentPageModel, ["image.url", "heroImage", "coverImage", "thumbnailUrl", "gallery.url", "galleryImages", "points.image.url", "sections.image.url", "sections.gallery.url", "sections.points.image.url", "seo.ogImage.url", "seo.twitterImage.url"]],
    [CategoryTreeModel, ["bannerUrl", "iconUrl"]],
    [PlatformBrandModel, ["logo", "logoUrl", "imageUrl"]],
    [CollectionModel, ["bannerImage", "thumbnailImage"]],
    [PlatformProductOptionValueModel, ["imageUrl"]],
    [ProductReviewModel, ["media"]],
  ];
  const removable = [];
  for (const url of new Set((urls || []).filter(Boolean))) {
    const asset = storageService.assetFromUrl(url);
    if (!asset || !["image", "video"].includes(asset.resourceType)) continue;
    // Match the same public ID even when references use another version or transformation.
    const escaped = encodeURI(asset.publicId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const suffix = asset.resourceType === "raw" ? "(?:[?#].*)?$" : "\\.[^/?#]+(?:[?#].*)?$";
    const regex = new RegExp(`/${asset.resourceType}/${asset.type}/(?:[^?#]*/)?${escaped}${suffix}`);
    let referenced = false;
    for (const [model, paths] of references) {
      if (await model.exists({ $or: paths.map((path) => ({ [path]: regex })) }).setOptions({ strictQuery: false })) {
        referenced = true;
        break;
      }
    }
    if (!referenced) removable.push(url);
  }
  // Support attachments can be reused across tickets too.
  if (removable.length) {
    const { knex } = require("../../infrastructure/postgres/postgres-client");
    const unshared = [];
    for (const url of removable) {
      const shared = await knex("support_queries")
        .whereRaw("attachment_urls @> ?::jsonb", [JSON.stringify([url])])
        .first("id");
      if (!shared) unshared.push(url);
    }
    return storageService.deleteImageByUrls(unshared);
  }
  return [];
}

module.exports = { productMedia, deleteUnreferencedMedia };
