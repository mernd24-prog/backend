const { mongoose } = require("../../infrastructure/mongo/mongo-client");
const { deleteUnreferencedMedia } = require("./media-cleanup");
const { logger } = require("../logger/logger");

const schema = new mongoose.Schema({
  urls: { type: [String], required: true },
  ownerType: String,
  ownerId: String,
  ready: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });
const MediaCleanupTask = mongoose.models.MediaCleanupTask || mongoose.model("MediaCleanupTask", schema);

// Save the URLs before deleting the owner, so cleanup failures do not lose them.
async function prepareMediaCleanup(urls, ownerType, ownerId) {
  const { storageService } = require("./storage-service");
  const assets = [...new Set(urls.filter((url) => storageService.assetFromUrl(url)))];
  return assets.length ? MediaCleanupTask.create({ urls: assets, ownerType, ownerId }) : null;
}

async function finishMediaCleanup(task) {
  if (!task) return false;
  await MediaCleanupTask.updateOne({ _id: task._id }, { $set: { ready: true } });
  try {
    await deleteUnreferencedMedia(task.urls);
    await MediaCleanupTask.deleteOne({ _id: task._id });
    return false;
  } catch (error) {
    logger.warn({ err: error, ownerType: task.ownerType, ownerId: task.ownerId }, "Deleted record media cleanup queued for retry");
    await MediaCleanupTask.updateOne({ _id: task._id }, {
      $inc: { attempts: 1 }, $set: { nextAttemptAt: new Date(Date.now() + 60000) },
    });
    return true;
  }
}

async function retryMediaCleanup() {
  // Recover a crash between deleting the owner and marking its task ready.
  const { PlatformBrandModel } = require("../../modules/platform/models/platform-brand.model");
  const { CollectionModel } = require("../../modules/platform/models/collection.model");
  const ownerModels = { Brand: PlatformBrandModel, Collection: CollectionModel };
  const tasks = await MediaCleanupTask.find({ nextAttemptAt: { $lte: new Date() } }).limit(20);
  let pending = 0;
  for (const task of tasks) {
    const ownerModel = ownerModels[task.ownerType];
    if (!task.ready && (!ownerModel || await ownerModel.exists({ _id: task.ownerId }))) continue;
    if (await finishMediaCleanup(task)) pending += 1;
  }
  return { checked: tasks.length, pending };
}
module.exports = { prepareMediaCleanup, finishMediaCleanup, retryMediaCleanup };
