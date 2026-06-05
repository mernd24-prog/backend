const Joi = require("joi");

const name = (opts = {}) =>
  Joi.string()
    .trim()
    .min(opts.min ?? 1)
    .max(opts.max ?? 200)
    .required()
    .messages({
      "string.empty": `${opts.label || "Name"} is required.`,
      "string.min": `${opts.label || "Name"} must be at least ${opts.min ?? 1} characters.`,
      "string.max": `${opts.label || "Name"} cannot exceed ${opts.max ?? 200} characters.`,
      "any.required": `${opts.label || "Name"} is required.`,
    });

const text = (opts = {}) =>
  Joi.string()
    .trim()
    .min(opts.min ?? 0)
    .max(opts.max ?? 2000)
    .optional()
    .allow("", null);

const slug = () =>
  Joi.string()
    .trim()
    .lowercase()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(255)
    .optional()
    .messages({
      "string.pattern.base": "Slug must contain only lowercase letters, numbers, and hyphens.",
    });

const email = (opts = {}) =>
  Joi.string()
    .email({ tlds: { allow: false } })
    .lowercase()
    .trim()
    .max(255)
    [opts.required === false ? "optional" : "required"]()
    .messages({
      "string.email": "Please enter a valid email address.",
      "string.empty": "Email is required.",
      "any.required": "Email is required.",
    });

const phone = (opts = {}) =>
  Joi.string()
    .trim()
    .pattern(/^\+?[1-9]\d{6,14}$/)
    [opts.required === false ? "optional" : "required"]()
    .allow("", null)
    .messages({
      "string.pattern.base": "Please enter a valid phone number (7-15 digits, optional + prefix).",
    });

const password = () =>
  Joi.string()
    .min(8)
    .max(128)
    .required()
    .messages({
      "string.min": "Password must be at least 8 characters.",
      "string.empty": "Password is required.",
      "any.required": "Password is required.",
    });

const price = (opts = {}) =>
  Joi.number()
    .precision(2)
    .min(opts.min ?? 0)
    .required()
    .messages({
      "number.base": `${opts.label || "Price"} must be a valid number.`,
      "number.min": `${opts.label || "Price"} cannot be negative.`,
      "any.required": `${opts.label || "Price"} is required.`,
    });

const quantity = (opts = {}) =>
  Joi.number()
    .integer()
    .min(opts.min ?? 0)
    .max(opts.max ?? 999999)
    [opts.required === false ? "optional" : "required"]()
    .messages({
      "number.base": `${opts.label || "Quantity"} must be a whole number.`,
      "number.integer": `${opts.label || "Quantity"} must be a whole number.`,
      "number.min": `${opts.label || "Quantity"} cannot be negative.`,
    });

const percent = (opts = {}) =>
  Joi.number()
    .precision(2)
    .min(0)
    .max(100)
    [opts.required === false ? "optional" : "required"]()
    .messages({
      "number.min": "Percentage cannot be less than 0.",
      "number.max": "Percentage cannot exceed 100.",
    });

const status = (values, opts = {}) =>
  Joi.string()
    .valid(...values)
    [opts.required === false ? "optional" : "required"]()
    .messages({
      "any.only": `Status must be one of: ${values.join(", ")}.`,
      "any.required": "Status is required.",
    });

const objectId = (opts = {}) =>
  Joi.string()
    .pattern(/^[a-f\d]{24}$/i)
    [opts.required === false ? "optional" : "required"]()
    .messages({
      "string.pattern.base": `${opts.label || "ID"} must be a valid identifier.`,
      "any.required": `${opts.label || "ID"} is required.`,
    });

const uuid = (opts = {}) =>
  Joi.string()
    .uuid({ version: "uuidv4" })
    [opts.required === false ? "optional" : "required"]()
    .messages({
      "string.guid": `${opts.label || "ID"} must be a valid UUID.`,
      "any.required": `${opts.label || "ID"} is required.`,
    });

const isoDate = (opts = {}) =>
  Joi.date()
    .iso()
    [opts.required === false ? "optional" : "required"]()
    .messages({
      "date.format": `${opts.label || "Date"} must be a valid ISO date.`,
      "any.required": `${opts.label || "Date"} is required.`,
    });

const dateRange = () =>
  Joi.object({
    startDate: isoDate().label("Start date"),
    endDate: isoDate({ required: false })
      .min(Joi.ref("startDate"))
      .label("End date")
      .messages({ "date.min": "End date must be after start date." }),
  });

const url = (opts = {}) =>
  Joi.string()
    .uri({ scheme: ["http", "https"] })
    .max(2048)
    [opts.required === false ? "optional" : "required"]()
    .allow("", null)
    .messages({ "string.uri": "Please enter a valid URL." });

const pincode = () =>
  Joi.string()
    .trim()
    .pattern(/^\d{4,10}$/)
    .optional()
    .allow("", null)
    .messages({ "string.pattern.base": "Pincode must be 4-10 digits." });

const listQuery = () =>
  Joi.object({
    page:      Joi.number().integer().min(1).default(1),
    limit:     Joi.number().integer().min(1).max(5000).default(20),
    search:    Joi.string().trim().max(200).optional().allow(""),
    sortBy:    Joi.string().trim().max(50).optional().allow(""),
    sortDir:   Joi.string().valid("asc", "desc").default("desc"),
    status:    Joi.string().trim().optional().allow("", "all"),
    startDate: Joi.string().isoDate().optional().allow(""),
    endDate:   Joi.string().isoDate().optional().allow(""),
  }).unknown(true);

const bulkIds = (opts = {}) =>
  Joi.array()
    .items(opts.useUuid ? uuid() : objectId())
    .min(1)
    .required()
    .messages({
      "array.min": "Select at least one record.",
      "any.required": "IDs are required.",
    });

const v = {
  name,
  text,
  slug,
  email,
  phone,
  password,
  price,
  quantity,
  percent,
  status,
  objectId,
  uuid,
  isoDate,
  dateRange,
  url,
  pincode,
  listQuery,
  bulkIds,
};

module.exports = { v, ...v };
