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
]);

const MIME_EXTENSION_MAP = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
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
  validateImage(file) {
    if (!file) {
      throw new AppError("Image file is required", 400);
    }

    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new AppError("Unsupported image type", 400, {
        allowedMimeTypes: Array.from(ALLOWED_IMAGE_MIME_TYPES),
      });
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

  async uploadImage(file, options = {}) {
    this.validateImage(file);

    const moduleName = sanitizeSegment(options.moduleName, "default");
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
}

const fileUploadService = new FileUploadService();

module.exports = {
  ALLOWED_DOCUMENT_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
  fileUploadService,
};
