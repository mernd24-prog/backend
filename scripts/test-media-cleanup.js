const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
function load(file, mocks) {
  const filename = path.resolve(__dirname, "..", file);
  const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, URL, console: { error() {} },
    __dirname: path.dirname(filename), require: (name) => mocks[name] || localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return context.module.exports;
}
async function main() {
  const calls = [];
  let fail = false;
  const env = { cloudinary: { cloudName: "shop", configured: true, enabled: false } };
  const { storageService: storage } = load("src/shared/storage/storage-service.js", {
    "../../config/env": { env }, cloudinary: { v2: { config() {}, uploader: {
      async destroy(publicId, options) {
        calls.push({ publicId, ...options });
        if (fail) throw new Error("unavailable");
        return { result: "ok" };
      },
    } } },
  });
  const root = "https://res.cloudinary.com/shop/";
  assert.equal(storage.publicIdFromUrl(root + "image/upload/c_fill,w_100/v123/products/a.b.jpg"), "products/a.b");
  assert.equal(storage.publicIdFromUrl(root + "image/upload/c_fill/products/a.jpg"), "products/a");
  assert.equal(storage.publicIdFromUrl(root + "image/upload/v1/products/a%20b.png"), "products/a b");
  assert.equal(storage.publicIdFromUrl("https://evilcloudinary.com/shop/image/upload/v1/a.png"), null);
  assert.equal(storage.publicIdFromUrl("https://res.cloudinary.com/other/image/upload/v1/a.png"), null);
  await storage.deleteImageByUrls([
    root + "image/upload/v1/products/a.jpg", root + "image/upload/v2/products/a.png",
    root + "video/upload/v1/products/clip.mp4", root + "raw/private/v1/documents/file.pdf",
    root + "image/authenticated/v1/avatar.jpg", "/uploads/local.png",
  ]);
  assert.equal(calls.length, 4);
  assert.equal(calls[1].resource_type, "video");
  assert.equal(calls[2].publicId, "documents/file.pdf");
  assert.equal(calls[2].type, "private");
  assert.equal(calls[3].type, "authenticated");
  assert.ok(calls.every((call) => call.invalidate));
  fail = true;
  await assert.rejects(storage.deleteImageByUrls([root + "image/upload/v1/broken.jpg"]), /cleanup failed/);
  assert.equal(calls.length, 7);
  fail = false;
  env.cloudinary.configured = false;
  await assert.rejects(storage.deleteImageByUrl(root + "image/upload/v1/a.jpg"), /credentials/);
  env.cloudinary.configured = true;
  let retained = true;
  const model = { exists(query) {
    return { async setOptions() { return retained && query.$or.some((entry) =>
      entry.images?.test(root + "image/upload/v8/products/a.png") ||
      entry.videos?.test(root + "video/upload/v8/products/clip.mp4")); } };
  } };
  const mocks = { "./storage-service": { storageService: storage } };
  for (const [file, name] of [
    ["product/models/product", "ProductModel"], ["product/models/product-revision", "ProductRevisionModel"],
    ["platform/models/content-page", "ContentPageModel"], ["platform/models/category-tree", "CategoryTreeModel"],
    ["platform/models/platform-brand", "PlatformBrandModel"], ["platform/models/collection", "CollectionModel"],
    ["platform/models/platform-product-option-value", "PlatformProductOptionValueModel"],
    ["platform/models/product-review", "ProductReviewModel"],
  ]) mocks[`../../modules/${file}.model`] = { [name]: model };
  mocks["../../infrastructure/postgres/postgres-client"] = {
    knex: () => ({ whereRaw() { return this; }, async first() { return null; } }),
  };
  const cleanup = load("src/shared/storage/media-cleanup.js", mocks);
  const count = calls.length;
  await cleanup.deleteUnreferencedMedia([root + "image/upload/v1/products/a.jpg"]);
  assert.equal(calls.length, count, "shared image must survive");
  retained = false;
  await cleanup.deleteUnreferencedMedia([root + "image/upload/v1/products/a.jpg"]);
  assert.equal(calls.length, count + 1);
  assert.deepEqual(Array.from(cleanup.productMedia({ images: ["a"], commonImages: ["b"], videos: ["c"], documents: ["d"], variants: [{ images: ["e"] }] })), ["a", "b", "c", "e"]);
  retained = true;
  const beforeSharedVideo = calls.length;
  await cleanup.deleteUnreferencedMedia([root + "video/upload/v1/products/clip.mp4"]);
  assert.equal(calls.length, beforeSharedVideo, "shared video must survive");
  retained = false;
  const beforeNonImages = calls.length;
  await cleanup.deleteUnreferencedMedia([
    root + "video/upload/v1/products/clip.mp4",
    root + "raw/upload/v1/documents/file.pdf",
  ]);
  assert.equal(calls.length, beforeNonImages + 1, "product cleanup must delete video but preserve documents");
  assert.equal(calls.at(-1).resource_type, "video");
  assert.equal(calls.at(-1).publicId, "products/clip");
  // Exercise the actual category/brand delete methods with isolated dependencies.
  const source = fs.readFileSync(path.resolve(__dirname, "../src/modules/platform/services/platform.service.js"), "utf8");
  const methods = [
    source.slice(source.indexOf("  async deleteCategory("), source.indexOf("  async createProductFamily(")),
    source.slice(source.indexOf("  async deleteBrand("), source.indexOf("  async createBatch(")),
  ].join("\n");
  const events = [];
  const context = {
    AppError: { notFound: (name) => new Error(`${name} missing`) },
    auditService: { remove() {} },
    async prepareMediaCleanup(urls) { return { urls }; },
    async finishMediaCleanup(task) { await context.deleteUnreferencedMedia(task.urls); return false; },
    async deleteUnreferencedMedia(urls) {
      await Promise.resolve();
      events.push({ type: "cleanup", urls: Array.from(urls) });
    },
  };
  vm.runInNewContext(`class DeleteService { ${methods} }; this.DeleteService = DeleteService`, context);
  const service = new context.DeleteService();
  service.invalidateCatalogCaches = () => {};
  service.platformRepository = {
    async getCategory() { return { bannerUrl: "parent" }; },
    async deleteCategory() {
      events.push({ type: "delete-category" });
      return { deletedCount: 2, mediaUrls: ["parent", "child"] };
    },
    async getBrand() { return { logo: "logo", logoUrl: "logo-url", imageUrl: "brand-image" }; },
    async deleteBrand() { events.push({ type: "delete-brand" }); return { deleted: true }; },
  };
  const categoryResult = await service.deleteCategory("category", {});
  assert.equal(categoryResult.deletedCount, 2);
  assert.equal(categoryResult.mediaUrls, undefined);
  assert.deepEqual(events, [{ type: "delete-category" }, { type: "cleanup", urls: ["parent", "child"] }]);
  events.length = 0;
  await service.deleteBrand("brand", {});
  assert.deepEqual(events, [{ type: "delete-brand" }, { type: "cleanup", urls: ["logo", "logo-url", "brand-image"] }]);
  events.length = 0;
  service.platformRepository.getCategory = async () => null;
  await assert.rejects(service.deleteCategory("missing", {}), /Category missing/);
  assert.equal(events.length, 0);
  let taskDeleted = false;
  let failCleanup = true;
  const task = { _id: "task", urls: [root + "image/upload/v1/brand.jpg"], ownerId: "brand", ownerType: "Brand" };
  const tasks = {
    async create(payload) { return { ...task, ...payload }; },
    async updateOne() {},
    async deleteOne() { taskDeleted = true; },
    find() { return { async limit() { return [task]; } }; },
  };
  const queue = load("src/shared/storage/media-cleanup-task.js", {
    "../../infrastructure/mongo/mongo-client": { mongoose: { Schema: class {}, models: { MediaCleanupTask: tasks } } },
    "./storage-service": { storageService: storage },
    "./media-cleanup": { async deleteUnreferencedMedia() { if (failCleanup) throw new Error("Cloudinary unavailable"); } },
    "../logger/logger": { logger: { warn() {} } },
    "../../modules/platform/models/platform-brand.model": { PlatformBrandModel: { async exists() { return false; } } },
    "../../modules/platform/models/collection.model": { CollectionModel: { async exists() { return false; } } },
  });
  assert.equal(await queue.prepareMediaCleanup(["/uploads/local.png"], "Brand", "brand"), null);
  const prepared = await queue.prepareMediaCleanup(task.urls, "Brand", "brand");
  assert.equal(await queue.finishMediaCleanup(prepared), true);
  assert.equal(taskDeleted, false, "cleanup failure must retain URLs for retry");
  failCleanup = false;
  await queue.retryMediaCleanup();
  assert.equal(taskDeleted, true, "successful retry removes pending task");
  console.log("Media cleanup checks passed (mocked Cloudinary/database; no live assets deleted).");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
