const cloudinary = require("cloudinary").v2;
const fs = require("fs/promises");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { env } = require("../../config/env");
const { AppError } = require("../errors/app-error");
const {
  SUPPORTED_DOCUMENT_MIME_TYPES,
} = require("../validation/document-upload");

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
});

const DATA_URI_PATTERN =
  /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;
const SUPPORTED_DOCUMENT_MIME_TYPE_SET = new Set(SUPPORTED_DOCUMENT_MIME_TYPES);
const DOCUMENT_EXTENSION_MAP = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function ensureCloudinaryConfigured() {
  if (!env.cloudinary.enabled) {
    throw new AppError("Cloudinary storage is not configured", 500);
  }
}

function ensureUploadStorageConfigured() {
  if (env.upload.storageMode === "disabled") {
    throw new AppError("Upload storage is disabled by environment configuration", 503);
  }
}

function normalizeBase64(content) {
  return String(content || "").replace(/\s/g, "");
}

function getBase64Size(content) {
  const normalized = normalizeBase64(content);
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function makeDataUri(mimeType, base64) {
  return `data:${mimeType};base64,${normalizeBase64(base64)}`;
}

function detectDocumentMimeType(base64) {
  const buffer = Buffer.from(base64, "base64");

  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "%PDF") {
    return "application/pdf";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function sanitizePathSegment(value, fallback = "document") {
  const sanitized = String(value || fallback)
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return sanitized || fallback;
}

function getDocumentStem(documentKey = "document") {
  return String(documentKey).replace(/Url$/, "") || "document";
}

function getPublicUploadUrl(relativeUrl) {
  const pathWithSlash = relativeUrl.startsWith("/") ? relativeUrl : `/${relativeUrl}`;
  return env.publicBaseUrl ? `${env.publicBaseUrl}${pathWithSlash}` : pathWithSlash;
}

function buildLocalFolderSegments(folder = "ecommerce/documents") {
  return String(folder)
    .split(/[\\/]+/)
    .map((segment) => sanitizePathSegment(segment, "document"))
    .filter(Boolean);
}

class StorageService {
  signProfileImage({ publicId, format }) {
    ensureCloudinaryConfigured();
    if (!publicId || !format) throw new AppError("Profile image metadata is incomplete", 500);
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    return {
      url: cloudinary.utils.private_download_url(publicId, format, {
        resource_type: "image", type: "authenticated", attachment: false,
        expires_at: expiresAt, secure: true,
      }),
      expiresAt,
    };
  }

  async upload(filePath, options = {}) {
    ensureCloudinaryConfigured();
    return cloudinary.uploader.upload(filePath, options);
  }

  assetFromUrl(url) {
    if (typeof url !== "string" || !url) return null;
    try {
      const parsed = new URL(url);
      if (!["res.cloudinary.com", "res.cloudinary.net"].includes(parsed.hostname)) return null;
      const parts = parsed.pathname.split("/").filter(Boolean);
      const [cloudName, resourceType, type] = parts;
      if (cloudName !== env.cloudinary.cloudName) return null;
      if (!["image", "video", "raw"].includes(resourceType) ||
          !["upload", "authenticated", "private"].includes(type)) return null;
      let assetParts = parts.slice(3);
      // A version follows signatures and transformations in delivery URLs.
      const versionIndex = assetParts.findIndex((part) => /^v\d+$/.test(part));
      if (versionIndex >= 0) assetParts = assetParts.slice(versionIndex + 1);
      else {
        while (assetParts.length && (/^s--.*--$/.test(assetParts[0]) ||
          /^(?:c|w|h|ar|g|q|f|dpr|e|a|b|bo|r|o|x|y|z|fl|t)_/.test(assetParts[0]))) {
          assetParts.shift();
        }
      }
      let publicId = decodeURIComponent(assetParts.join("/"));
      if (resourceType !== "raw") publicId = publicId.replace(/\.[^/.]+$/, "");
      return publicId ? { publicId, resourceType, type } : null;
    } catch {
      return null;
    }
  }

  publicIdFromUrl(url) {
    return this.assetFromUrl(url)?.publicId || null;
  }

  async deleteImageByUrl(url, resourceType) {
    const asset = this.assetFromUrl(url);
    if (!asset) return { skipped: true };
    // Cleanup must also work for older uploads when new uploads use local storage.
    if (!env.cloudinary.configured) {
      throw new AppError("Cloudinary credentials are required to delete uploaded media", 503);
    }
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await cloudinary.uploader.destroy(asset.publicId, {
          resource_type: resourceType || asset.resourceType,
          type: asset.type,
          invalidate: true,
          timeout: 10000,
        });
        if (!["ok", "not found"].includes(result?.result)) {
          throw new Error("Cloudinary did not confirm media deletion");
        }
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    console.error("[Cloudinary] Media deletion failed", { publicId: asset.publicId, error: lastError?.message });
    throw new AppError("Data was deleted, but Cloudinary media cleanup failed. Please retry media cleanup.", 502);
  }

  async deleteImageByUrls(urls, resourceType) {
    const assets = new Map();
    for (const url of urls || []) {
      const asset = this.assetFromUrl(url);
      if (asset) assets.set(`${asset.resourceType}/${asset.type}/${asset.publicId}`, url);
    }
    // Try every asset even if one fails; never silently report cleanup success.
    const results = await Promise.allSettled(
      [...assets.values()].map((url) => this.deleteImageByUrl(url, resourceType)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    return results.map((result) => result.value);
  }

  deleteByUrl(url, resourceType = "image") {
    if (!env.cloudinary.enabled) return;
    const publicId = this.publicIdFromUrl(url);
    if (!publicId) return;
    cloudinary.uploader
      .destroy(publicId, { resource_type: resourceType, invalidate: true })
      .catch((err) => {
        // Non-critical – log but never block the main flow
        console.error("[Cloudinary] deleteByUrl failed", { publicId, err: err?.message });
      });
  }

  /**
   * Fire-and-forget: delete multiple assets from Cloudinary by their URLs.
   * @param {string[]} urls
   * @param {"image"|"video"|"raw"} [resourceType="image"]
   */
  deleteByUrls(urls, resourceType = "image") {
    if (!env.cloudinary.enabled) return;
    const validUrls = (urls || []).filter(Boolean);
    validUrls.forEach((url) => this.deleteByUrl(url, resourceType));
  }

  isUploadPayload(value) {
    if (!value) {
      return false;
    }

    if (typeof value === "string") {
      return DATA_URI_PATTERN.test(value);
    }

    if (typeof value === "object") {
      return Boolean(value.dataUri || value.contentBase64);
    }

    return false;
  }

  buildDataUri(value) {
    if (typeof value === "string") {
      const match = value.match(DATA_URI_PATTERN);
      if (!match) {
        throw new AppError("Invalid document data URI", 400);
      }
      return {
        dataUri: makeDataUri(match[1].toLowerCase(), match[2]),
        mimeType: match[1].toLowerCase(),
        base64: match[2],
        fileName: null,
      };
    }

    if (value?.dataUri) {
      const parsed = this.buildDataUri(value.dataUri);
      return {
        ...parsed,
        fileName: value.fileName || null,
      };
    }

    const mimeType = String(value?.mimeType || "").toLowerCase();
    const base64 = value?.contentBase64;
    if (!mimeType || !base64) {
      throw new AppError(
        "Document upload requires mimeType and contentBase64",
        400,
      );
    }

    return {
      dataUri: makeDataUri(mimeType, base64),
      mimeType,
      base64,
      fileName: value.fileName || null,
    };
  }

  validateDocumentPayload(document) {
    if (!SUPPORTED_DOCUMENT_MIME_TYPE_SET.has(document.mimeType)) {
      throw new AppError("Unsupported document file type", 400, {
        allowedMimeTypes: SUPPORTED_DOCUMENT_MIME_TYPES,
      });
    }

    const normalizedBase64 = normalizeBase64(document.base64);
    if (!normalizedBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedBase64)) {
      throw new AppError("Invalid document base64 content", 400);
    }

    const detectedMimeType = detectDocumentMimeType(normalizedBase64);
    if (!detectedMimeType || detectedMimeType !== document.mimeType) {
      throw new AppError("Document content does not match the declared mimeType", 400, {
        detectedMimeType,
        declaredMimeType: document.mimeType,
      });
    }

    const size = getBase64Size(normalizedBase64);
    if (size > env.upload.maxDocumentBytes) {
      throw new AppError("Document file is too large", 400, {
        maxBytes: env.upload.maxDocumentBytes,
      });
    }
  }

  async uploadDocument(value, options = {}) {
    ensureUploadStorageConfigured();
    const document = this.buildDataUri(value);
    this.validateDocumentPayload(document);

    const documentKey = options.documentKey || "document";
    const publicId = [
      sanitizePathSegment(getDocumentStem(document.fileName || documentKey)),
      uuidv4(),
    ].join("-");

    if (env.upload.localStorageEnabled) {
      const extension = DOCUMENT_EXTENSION_MAP[document.mimeType] || ".bin";
      const fileName = `${publicId}${extension}`;
      const folderSegments = buildLocalFolderSegments(options.folder || "ecommerce/documents");
      const uploadRoot = path.resolve(__dirname, "../../../uploads");
      const destination = path.join(uploadRoot, ...folderSegments, fileName);

      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, Buffer.from(normalizeBase64(document.base64), "base64"));

      const relativeUrl = path.posix.join("/uploads", ...folderSegments, fileName);
      const url = getPublicUploadUrl(relativeUrl);
      return {
        secure_url: url,
        url,
        public_id: `local/${folderSegments.join("/")}/${fileName}`,
        asset_id: publicId,
        resource_type: "auto",
        storage: "local",
        bytes: getBase64Size(document.base64),
        format: extension.replace(/^\./, ""),
      };
    }

    ensureCloudinaryConfigured();
    return cloudinary.uploader.upload(document.dataUri, {
      resource_type: "auto",
      folder: options.folder || "ecommerce/documents",
      public_id: publicId,
      overwrite: false,
      use_filename: false,
      unique_filename: false,
      context: {
        document_key: documentKey,
        owner_type: options.ownerType || "",
        owner_id: options.ownerId || "",
      },
    });
  }

  async uploadKycDocuments(documents = {}, options = {}) {
    const normalized = {};
    const ownerType = sanitizePathSegment(options.ownerType || "kyc");
    const ownerId = sanitizePathSegment(options.ownerId || "anonymous");
    const folder = options.folder || `ecommerce/kyc/${ownerType}/${ownerId}`;

    for (const [documentKey, value] of Object.entries(documents || {})) {
      if (!this.isUploadPayload(value)) {
        normalized[documentKey] = value;
        continue;
      }

      const upload = await this.uploadDocument(value, {
        folder,
        ownerType,
        ownerId,
        documentKey,
      });

      normalized[documentKey] = upload.secure_url || upload.url;
    }

    return normalized;
  }
}

const storageService = new StorageService();

module.exports = { storageService };
