const {
  PRODUCT_STATUS,
  PRODUCT_VISIBILITY,
} = require("../domain/commerce-constants");

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function publicDatePredicates(now = new Date()) {
  return [
    {
      $or: [
        { publishedAt: { $exists: false } },
        { publishedAt: null },
        { publishedAt: { $lte: now } },
      ],
    },
    {
      $or: [
        { scheduledAt: { $exists: false } },
        { scheduledAt: null },
        { scheduledAt: { $lte: now } },
      ],
    },
  ];
}

function buildPublicProductFilter(now = new Date()) {
  return {
    status: PRODUCT_STATUS.ACTIVE,
    visibility: PRODUCT_VISIBILITY.PUBLIC,
    $and: publicDatePredicates(now),
  };
}

function applyPublicProductFilter(filter = {}, now = new Date()) {
  const publicFilter = buildPublicProductFilter(now);
  return {
    ...filter,
    status: publicFilter.status,
    visibility: publicFilter.visibility,
    $and: [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      ...publicFilter.$and,
    ],
  };
}

function isPublicProduct(product, now = new Date()) {
  if (!product) return false;

  const source = typeof product.toObject === "function" ? product.toObject() : product;
  const publishedAt = normalizeDate(source.publishedAt);
  const scheduledAt = normalizeDate(source.scheduledAt);

  return (
    source.status === PRODUCT_STATUS.ACTIVE &&
    (source.visibility || PRODUCT_VISIBILITY.PUBLIC) === PRODUCT_VISIBILITY.PUBLIC &&
    (!publishedAt || publishedAt <= now) &&
    (!scheduledAt || scheduledAt <= now)
  );
}

function missingOrPastDateFilter(field, now = new Date()) {
  return {
    bool: {
      should: [
        { bool: { must_not: { exists: { field } } } },
        { range: { [field]: { lte: now.toISOString() } } },
      ],
      minimum_should_match: 1,
    },
  };
}

function buildPublicSearchFilters(now = new Date()) {
  return [
    { term: { status: PRODUCT_STATUS.ACTIVE } },
    { term: { visibility: PRODUCT_VISIBILITY.PUBLIC } },
    missingOrPastDateFilter("publishedAt", now),
    missingOrPastDateFilter("scheduledAt", now),
  ];
}

module.exports = {
  applyPublicProductFilter,
  buildPublicProductFilter,
  buildPublicSearchFilters,
  isPublicProduct,
};
