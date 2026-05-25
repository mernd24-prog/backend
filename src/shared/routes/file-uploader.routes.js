const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");
const { AppError } = require("../errors/app-error");
const { okResponse } = require("../http/reply");
const { authenticate } = require("../middleware/authenticate");
const { catchErrors } = require("../middleware/catch-errors");
const {
  ALLOWED_IMAGE_MIME_TYPES,
  fileUploadService,
} = require("../upload/file-upload.service");

const fileUploaderRoutes = express.Router();
const maxImageBytes = 10 * 1024 * 1024;
const tempUploadDir = path.join(os.tmpdir(), "ecommerce-uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(tempUploadDir, { recursive: true });
    cb(null, tempUploadDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: maxImageBytes,
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      return cb(new AppError("Unsupported image type", 400, {
        allowedMimeTypes: Array.from(ALLOWED_IMAGE_MIME_TYPES),
      }));
    }

    return cb(null, true);
  },
});

function runUpload(middleware) {
  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (!error) {
        return next();
      }

      if (error instanceof multer.MulterError) {
        return next(new AppError(error.message, 400));
      }

      return next(error);
    });
  };
}

fileUploaderRoutes.post(
  "/upload",
  authenticate,
  runUpload(upload.single("file")),
  catchErrors(async (req, res) => {
    const image = await fileUploadService.uploadImage(req.file, {
      moduleName: req.body.module,
      imageType: req.body.imageType || req.body.type || "image",
      req,
    });

    return res.status(201).json(okResponse({
      imageURL: image.url,
      url: image.url,
      image,
    }));
  }),
);

fileUploaderRoutes.post(
  "/upload-multi",
  authenticate,
  runUpload(upload.array("file", 10)),
  catchErrors(async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      throw new AppError("At least one image file is required", 400);
    }

    const images = await Promise.all(
      files.map((file, index) =>
        fileUploadService.uploadImage(file, {
          moduleName: req.body.module,
          imageType: req.body.imageType || req.body.type || `image-${index + 1}`,
          req,
        }),
      ),
    );

    return res.status(201).json(okResponse({
      imageURLs: images.map((image) => image.url),
      images,
    }));
  }),
);

module.exports = { fileUploaderRoutes };
