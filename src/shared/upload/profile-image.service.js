const { UserModel } = require("../../modules/user/models/user.model");
const { storageService } = require("../storage/storage-service");
const { AppError } = require("../errors/app-error");
const https = require("node:https");
const { logger } = require("../logger/logger");

const PROFILE_IMAGE_MODULE = "customer-profiles";
const PROFILE_IMAGE_PATH = "/api/v1/users/me/profile-image";

async function saveProfileImage(userId, image) {
  const user = await UserModel.findByIdAndUpdate(userId, { $set: {
    profileImageAsset: { publicId: image.publicId, format: image.format },
    "profile.avatarUrl": "",
  } });
  if (!user) throw new AppError("User not found", 404);
}

async function getProfileImageAsset(userId) {
  const user = await UserModel.findById(userId).select("+profileImageAsset");
  return user?.profileImageAsset;
}

async function withProfileImage(userId, user) {
  const asset = await getProfileImageAsset(userId);
  if (!asset?.publicId) return user;
  const result = user?.toObject ? user.toObject() : { ...user };
  result.profile = { ...result.profile, avatarUrl: PROFILE_IMAGE_PATH };
  result.profileImageProtected = true;
  delete result.profileImageAsset;
  return result;
}

async function readProfileImage(userId) {
  const asset = await getProfileImageAsset(userId);
  if (!asset?.publicId) throw new AppError("Profile image not found", 404);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
  const { url } = storageService.signProfileImage(asset);
  try {
    return await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => request.destroy(Object.assign(new Error("Cloudinary image request timed out"), { code: "ETIMEDOUT" })), 8000);
      const request = https.get(url, { family: 4, agent: false }, (response) => {
        const contentType = String(response.headers["content-type"] || "").split(";")[0];
        if (response.statusCode !== 200 || !/^image\/(png|jpeg|gif|webp)$/.test(contentType)) {
          response.resume();
          clearTimeout(deadline);
          return reject(Object.assign(new Error(`Cloudinary image response ${response.statusCode} (${contentType})`), {
            providerStatus: response.statusCode, providerReason: response.headers["x-cld-error"],
          }));
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 10 * 1024 * 1024) { response.destroy(new Error("Profile image exceeds size limit")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => { clearTimeout(deadline); resolve({ contentType, body: Buffer.concat(chunks) }); });
        response.on("error", (error) => { clearTimeout(deadline); reject(error); });
        response.on("aborted", () => { clearTimeout(deadline); reject(new Error("Cloudinary image response interrupted")); });
      });
      request.on("error", (error) => { clearTimeout(deadline); reject(error); });
    });
  } catch (error) {
    logger.warn({ userId, attempt, reason: error.code || error.message, providerStatus: error.providerStatus, providerReason: error.providerReason }, "Profile image provider request failed");
    if (attempt < 2 && (!error.providerStatus || error.providerStatus >= 500 || error.providerStatus === 429)) continue;
    throw new AppError("Profile image is temporarily unavailable. Please try again.", 502, null, "PROFILE_IMAGE_UNAVAILABLE");
  }
  }
}

module.exports = { PROFILE_IMAGE_MODULE, PROFILE_IMAGE_PATH, saveProfileImage, getProfileImageAsset, withProfileImage, readProfileImage };
