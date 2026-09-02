const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { env } = require("../../config/env");
const { AppError } = require("../errors/app-error");
const { storageService } = require("../storage/storage-service");
const {
  SUPPORTED_DOCUMENT_MIME_TYPES,
} = require("../validation/document-upload");

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);
const SVG_IMAGE_MIME_TYPE = "image/svg+xml";
const SVG_IMAGE_MODULES = new Set(["thumbnails"]);

const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
]);

const MIME_EXTENSION_MAP = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};
const VIDEO_EXTENSION_MAP = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/ogg": ".ogv",
  "video/quicktime": ".mov",
};
const ALLOWED_DOCUMENT_MIME_TYPES = new Set(SUPPORTED_DOCUMENT_MIME_TYPES);

function sanitizeSegment(value, fallback = "default") {
  const sanitized = String(value || fallback)
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);

  return sanitized || fallback;
}

function hasCloudinaryConfig() {
  return env.cloudinary.enabled;
}

async function readSignature(filePath, length = 512) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function signatureMatches(buffer, mimeType) {
  const ascii = buffer.toString("ascii");
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/gif") return ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a");
  if (mimeType === "image/webp") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  if (mimeType === "image/svg+xml") {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "").trimStart();
    return text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"));
  }
  if (["video/mp4", "video/quicktime"].includes(mimeType)) return ascii.slice(4, 8) === "ftyp";
  if (mimeType === "video/webm") return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === "video/ogg") return ascii.startsWith("OggS");
  return false;
}

function getRequestBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function toAbsoluteUploadUrl(url, req) {
  if (/^https?:\/\//i.test(String(url || ""))) {
    return url;
  }
  if (!req) {
    return url;
  }
  const pathWithSlash = String(url || "").startsWith("/") ? url : `/${url}`;
  return `${getRequestBaseUrl(req)}${pathWithSlash}`;
}

async function moveFile(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.rename(source, destination);
  } catch (error) {
    await fs.copyFile(source, destination);
    await fs.unlink(source).catch(() => {});
  }
}

class FileUploadService {
  validateImage(file, options = {}) {
    if (!file) {
      throw new AppError("Image file is required", 400);
    }

    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new AppError("Unsupported image type", 400, {
        allowedMimeTypes: Array.from(ALLOWED_IMAGE_MIME_TYPES),
      });
    }

    const moduleName = sanitizeSegment(options.moduleName, "default");
    if (
      file.mimetype === SVG_IMAGE_MIME_TYPE &&
      !SVG_IMAGE_MODULES.has(moduleName)
    ) {
      throw new AppError("SVG images are only supported for category uploads", 400);
    }
  }

  validateDocument(file) {
    if (!file) {
      throw new AppError("Document file is required", 400);
    }

    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      throw new AppError("Unsupported document type", 400, {
        allowedMimeTypes: Array.from(ALLOWED_DOCUMENT_MIME_TYPES),
      });
    }
  }

  validateVideo(file) {
    if (!file) {
      throw new AppError("Video file is required", 400);
    }

    if (!ALLOWED_VIDEO_MIME_TYPES.has(file.mimetype)) {
      throw new AppError("Unsupported video type", 400, {
        allowedMimeTypes: Array.from(ALLOWED_VIDEO_MIME_TYPES),
      });
    }
  }

  async uploadImage(file, options = {}) {
    const moduleName = sanitizeSegment(options.moduleName, "default");
    this.validateImage(file, { moduleName });
    if (!signatureMatches(await readSignature(file.path), file.mimetype)) {
      await fs.unlink(file.path).catch(() => {});
      throw new AppError("Image content does not match its declared type", 400);
    }

    const imageType = sanitizeSegment(options.imageType, "image");
    const publicId = `${imageType}-${uuidv4()}`;

    if (hasCloudinaryConfig()) {
      try {
        const upload = await storageService.upload(file.path, {
          resource_type: "image",
          folder: `ecommerce/uploads/${moduleName}`,
          public_id: publicId,
          overwrite: false,
          use_filename: false,
          unique_filename: false,
          context: {
            module: moduleName,
            image_type: imageType,
            original_name: file.originalname || "",
          },
        });

        const url = upload.secure_url || upload.url;
        return {
          imageURL: url,
          url,
          publicId: upload.public_id,
          assetId: upload.asset_id,
          storage: "cloudinary",
          folder: `ecommerce/uploads/${moduleName}`,
          module: moduleName,
          imageType,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        };
      } finally {
        await fs.unlink(file.path).catch(() => {});
      }
    }

    if (!env.upload.localStorageEnabled) {
      await fs.unlink(file.path).catch(() => {});
      throw new AppError("Upload storage is disabled by environment configuration", 503);
    }

    const extension =
      path.extname(file.originalname || "").toLowerCase() ||
      MIME_EXTENSION_MAP[file.mimetype] ||
      ".jpg";
    const fileName = `${publicId}${extension}`;
    const uploadRoot = path.resolve(__dirname, "../../../uploads");
    const destination = path.join(uploadRoot, moduleName, fileName);
    await moveFile(file.path, destination);

    const url = `${getRequestBaseUrl(options.req)}/uploads/${moduleName}/${fileName}`;
    return {
      imageURL: url,
      url,
      publicId: `local/${moduleName}/${fileName}`,
      storage: "local",
      folder: `uploads/${moduleName}`,
      module: moduleName,
      imageType,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  async uploadDocument(file, options = {}) {
    this.validateDocument(file);

    const moduleName = sanitizeSegment(options.moduleName, "default");
    const documentKey = sanitizeSegment(options.documentKey || options.documentType, "document");

    try {
      const contentBase64 = await fs.readFile(file.path, { encoding: "base64" });
      const upload = await storageService.uploadDocument(
        {
          contentBase64,
          mimeType: file.mimetype,
          fileName: file.originalname,
        },
        {
          folder: `ecommerce/uploads/${moduleName}/documents`,
          documentKey,
          ownerType: options.ownerType,
          ownerId: options.ownerId,
        },
      );
      const url = toAbsoluteUploadUrl(upload.secure_url || upload.url, options.req);

      return {
        documentURL: url,
        url,
        publicId: upload.public_id,
        assetId: upload.asset_id,
        storage: upload.storage || "cloudinary",
        folder: `ecommerce/uploads/${moduleName}/documents`,
        module: moduleName,
        documentType: documentKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      };
    } finally {
      await fs.unlink(file.path).catch(() => {});
    }
  }

  async uploadVideo(file, options = {}) {
    this.validateVideo(file);
    if (!signatureMatches(await readSignature(file.path), file.mimetype)) {
      await fs.unlink(file.path).catch(() => {});
      throw new AppError("Video content does not match its declared type", 400);
    }

    const moduleName = sanitizeSegment(options.moduleName, "default");
    const videoType = sanitizeSegment(options.videoType || options.type, "video");
    const publicId = `${videoType}-${uuidv4()}`;

    if (hasCloudinaryConfig()) {
      try {
        const upload = await storageService.upload(file.path, {
          resource_type: "video",
          folder: `ecommerce/uploads/${moduleName}/videos`,
          public_id: publicId,
          overwrite: false,
          use_filename: false,
          unique_filename: false,
          context: {
            module: moduleName,
            video_type: videoType,
            original_name: file.originalname || "",
          },
        });

        const url = upload.secure_url || upload.url;
        return {
          videoURL: url,
          url,
          publicId: upload.public_id,
          assetId: upload.asset_id,
          storage: "cloudinary",
          folder: `ecommerce/uploads/${moduleName}/videos`,
          module: moduleName,
          videoType,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        };
      } finally {
        await fs.unlink(file.path).catch(() => {});
      }
    }

    if (!env.upload.localStorageEnabled) {
      await fs.unlink(file.path).catch(() => {});
      throw new AppError("Upload storage is disabled by environment configuration", 503);
    }

    const extension =
      path.extname(file.originalname || "").toLowerCase() ||
      VIDEO_EXTENSION_MAP[file.mimetype] ||
      ".mp4";
    const fileName = `${publicId}${extension}`;
    const uploadRoot = path.resolve(__dirname, "../../../uploads");
    const destination = path.join(uploadRoot, moduleName, "videos", fileName);
    await moveFile(file.path, destination);

    const url = `${getRequestBaseUrl(options.req)}/uploads/${moduleName}/videos/${fileName}`;
    return {
      videoURL: url,
      url,
      publicId: `local/${moduleName}/videos/${fileName}`,
      storage: "local",
      folder: `uploads/${moduleName}/videos`,
      module: moduleName,
      videoType,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }
}

const fileUploadService = new FileUploadService();

module.exports = {
  ALLOWED_DOCUMENT_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  fileUploadService,
};
