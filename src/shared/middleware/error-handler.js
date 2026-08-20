const { failResponse } = require("../http/reply");
const { ERROR_CODES } = require("../errors/app-error");
const { classifyPostgresError } = require("../errors/database-error");

// Maps MongoDB/Mongoose/Sequelize error names → user-friendly messages
const MONGOOSE_DUPLICATE_CODE = 11000;

function buildFieldErrors(joiError) {
  if (!joiError || !Array.isArray(joiError.details)) return null;
  return joiError.details.map((d) => ({
    field:   d.context?.key || d.path?.join(".") || "field",
    message: d.message.replace(/['"]/g, ""),
  }));
}

function buildFieldErrorsFromDetails(details) {
  if (!Array.isArray(details)) return null;

  const fields = details
    .filter((d) => d && typeof d === "object" && d.message)
    .map((d) => ({
      field:   d.context?.key || d.path?.join(".") || "field",
      message: String(d.message).replace(/['"]/g, ""),
    }));

  return fields.length ? fields : null;
}

function handleMongooseError(error) {
  // Duplicate key
  if (error.code === MONGOOSE_DUPLICATE_CODE) {
    const field = Object.keys(error.keyValue || {})[0] || "field";
    const value = error.keyValue?.[field];
    return {
      statusCode: 409,
      message:    value
        ? `A record with this ${field} "${value}" already exists.`
        : `A record with this ${field} already exists.`,
      code: "DUPLICATE_ENTRY",
    };
  }

  // Validation
  if (error.name === "ValidationError") {
    const fields = Object.values(error.errors || {}).map((e) => ({
      field:   e.path,
      message: e.message,
    }));
    return {
      statusCode: 422,
      message:    "Validation failed. Please check the highlighted fields.",
      code:       "VALIDATION_ERROR",
      details:    fields.length ? { fields } : null,
    };
  }

  // Cast error (invalid ObjectId etc.)
  if (error.name === "CastError") {
    return {
      statusCode: 422,
      message:    `Invalid value for field "${error.path}".`,
      code:       "INVALID_VALUE",
    };
  }

  return null;
}

function handleSequelizeError(error) {
  if (error.name === "SequelizeUniqueConstraintError") {
    const field = error.fields ? Object.keys(error.fields)[0] : "field";
    return {
      statusCode: 409,
      message:    `A record with this ${field} already exists.`,
      code:       "DUPLICATE_ENTRY",
    };
  }
  if (error.name === "SequelizeValidationError") {
    const fields = (error.errors || []).map((e) => ({
      field:   e.path,
      message: e.message,
    }));
    return {
      statusCode: 422,
      message:    "Validation failed. Please check the highlighted fields.",
      code:       "VALIDATION_ERROR",
      details:    fields.length ? { fields } : null,
    };
  }
  if (error.name === "SequelizeForeignKeyConstraintError") {
    return {
      statusCode: 409,
      message:    "This record is referenced by other records and cannot be deleted.",
      code:       "DEPENDENCY_IN_USE",
    };
  }
  return null;
}

function handleJoiError(error) {
  if (error.isJoi || (error.name === "ValidationError" && error._original !== undefined)) {
    const fields = buildFieldErrors(error);
    return {
      statusCode: 422,
      message:    fields?.length
        ? fields[0].message
        : "Validation failed. Please check the highlighted fields.",
      code:    "VALIDATION_ERROR",
      details: fields?.length ? { fields } : null,
    };
  }
  return null;
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  let statusCode = error.statusCode || error.status || 500;
  let message    = error.message || "An unexpected error occurred. Please try again.";
  let code       = error.code    || null;
  let details    = error.details || null;

  // Handle known ORM/validation errors
  const mongoResult    = handleMongooseError(error);
  const sequelizeResult= handleSequelizeError(error);
  const joiResult      = handleJoiError(error);
  const postgresResult = classifyPostgresError(error);
  const appFieldDetails= buildFieldErrorsFromDetails(details);

  if (mongoResult) {
    ({ statusCode, message, code } = mongoResult);
    details = mongoResult.details || null;
  } else if (sequelizeResult) {
    ({ statusCode, message, code } = sequelizeResult);
    details = sequelizeResult.details || null;
  } else if (joiResult) {
    ({ statusCode, message, code } = joiResult);
    details = joiResult.details || null;
  } else if (postgresResult) {
    ({ statusCode, message, code } = postgresResult);
    if (postgresResult.retryAfterSeconds) {
      res.set("Retry-After", String(postgresResult.retryAfterSeconds));
    }
  } else if (appFieldDetails) {
    code = code || ERROR_CODES.VALIDATION_ERROR;
    message = appFieldDetails[0]?.message || message;
    details = { fields: appFieldDetails };
  }

  // Payload size
  if (error.type === "entity.too.large" || statusCode === 413) {
    statusCode = 413;
    message    = "Request payload too large. Please reduce the file or data size.";
    code       = "FILE_TOO_LARGE";
  }

  // Generic 500 — hide unknown implementation details, but keep intentional
  // AppError messages because they are already user-facing.
  if (statusCode >= 500) {
    req.log?.error(
      { err: error, statusCode, errorCode: code || "INTERNAL_ERROR" },
      `${req.method} ${req.originalUrl || req.url} -> ${statusCode} ${code || "INTERNAL_ERROR"}: ${message}`,
    );
    if (!postgresResult) message = "An unexpected error occurred. Please try again later.";
  } else {
    req.log?.warn(
      {
        err: error,
        statusCode,
        errorCode: code || "REQUEST_ERROR",
        dbCode: error.code || error.original?.code || error.parent?.code || null,
        route: req.originalUrl || req.url,
      },
      `${req.method} ${req.originalUrl || req.url} -> ${statusCode} ${code || "REQUEST_ERROR"}: ${message}`,
    );
  }

  res.status(statusCode).json(failResponse(message, details, code));
}

module.exports = { errorHandler };
