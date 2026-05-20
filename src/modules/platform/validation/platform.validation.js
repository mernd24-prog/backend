const Joi = require("joi");

const paginationQuery = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const withCategoryAliases = (schema) =>
  schema
    .rename("name", "title", { ignoreUndefined: true, override: false })
    .rename("categoryName", "title", { ignoreUndefined: true, override: false })
    .rename("thumbnails", "imageUrl", { ignoreUndefined: true, override: false })
    .rename("seoUrl", "imageUrl", { ignoreUndefined: true, override: false })
    .rename("priority", "sortOrder", { ignoreUndefined: true, override: false });

const createCategorySchema = Joi.object({
  body: withCategoryAliases(Joi.object({
    categoryKey: Joi.string().trim().required(),
    title: Joi.string().trim().required(),
    parentKey: Joi.string().allow(null, ""),
    level: Joi.number().integer().min(0).default(0),
    attributesSchema: Joi.object().default({}),
    attributeSchema: Joi.array()
      .items(
        Joi.object({
          key: Joi.string().trim().required(),
          label: Joi.string().trim().required(),
          type: Joi.string()
            .valid("text", "number", "select", "multi_select", "boolean", "date")
            .default("text"),
          required: Joi.boolean().default(false),
          options: Joi.array().items(Joi.string().trim()).default([]),
          unit: Joi.string().allow("", null),
          isVariantAttribute: Joi.boolean().default(false),
          isFilterable: Joi.boolean().default(false),
          isSearchable: Joi.boolean().default(false),
        }),
      )
      .default([]),
    active: Joi.boolean().default(true),
    sortOrder: Joi.number().integer().default(0),
    imageUrl: Joi.string().allow(""),
    bannerUrl: Joi.string().allow(""),
    iconUrl: Joi.string().allow(""),
    isDashboardVisible: Joi.boolean().default(false),
  })).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateCategorySchema = Joi.object({
  body: withCategoryAliases(Joi.object({
    title: Joi.string().trim(),
    parentKey: Joi.string().allow(null, ""),
    level: Joi.number().integer().min(0),
    attributesSchema: Joi.object(),
    attributeSchema: Joi.array().items(
      Joi.object({
        key: Joi.string().trim().required(),
        label: Joi.string().trim().required(),
        type: Joi.string().valid("text", "number", "select", "multi_select", "boolean", "date"),
        required: Joi.boolean(),
        options: Joi.array().items(Joi.string().trim()),
        unit: Joi.string().allow("", null),
        isVariantAttribute: Joi.boolean(),
        isFilterable: Joi.boolean(),
        isSearchable: Joi.boolean(),
      }),
    ),
    active: Joi.boolean(),
    sortOrder: Joi.number().integer(),
    imageUrl: Joi.string().allow(""),
    bannerUrl: Joi.string().allow(""),
    iconUrl: Joi.string().allow(""),
    isDashboardVisible: Joi.boolean(),
  })).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    categoryKey: Joi.string().required(),
  }).required(),
});

const listCategoriesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(
    Joi.object({
      parentKey: Joi.string(),
      active: Joi.boolean(),
      categoryKey: Joi.string(),
      tree: Joi.boolean(),
      maxDepth: Joi.number().integer().min(1).max(6),
    }),
  ),
  params: Joi.object({}).required(),
});

const categoryKeySchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    categoryKey: Joi.string().required(),
  }).required(),
});

const createProductFamilySchema = Joi.object({
  body: Joi.object({
    familyCode: Joi.string().trim().required(),
    sellerId: Joi.string().required(),
    title: Joi.string().trim().required(),
    category: Joi.string().required(),
    baseAttributes: Joi.object().default({}),
    variantAxes: Joi.array().items(Joi.string()).default([]),
    status: Joi.string().default("active"),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateProductFamilySchema = Joi.object({
  body: Joi.object({
    title: Joi.string().trim(),
    category: Joi.string(),
    baseAttributes: Joi.object(),
    variantAxes: Joi.array().items(Joi.string()),
    status: Joi.string(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    familyCode: Joi.string().required(),
  }).required(),
});

const listProductFamiliesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(
    Joi.object({
      category: Joi.string(),
      sellerId: Joi.string(),
      status: Joi.string(),
    }),
  ),
  params: Joi.object({}).required(),
});

const productFamilyCodeSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    familyCode: Joi.string().required(),
  }).required(),
});

const createProductVariantSchema = Joi.object({
  body: Joi.object({
    familyCode: Joi.string().trim().required(),
    productId: Joi.string().required(),
    sellerId: Joi.string().required(),
    sku: Joi.string().trim().required(),
    attributes: Joi.object().default({}),
    stock: Joi.number().integer().min(0).default(0),
    reservedStock: Joi.number().integer().min(0).default(0),
    status: Joi.string().default("active"),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateProductVariantSchema = Joi.object({
  body: Joi.object({
    familyCode: Joi.string().trim(),
    productId: Joi.string(),
    sellerId: Joi.string(),
    sku: Joi.string().trim(),
    attributes: Joi.object(),
    stock: Joi.number().integer().min(0),
    reservedStock: Joi.number().integer().min(0),
    status: Joi.string(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    variantId: Joi.string().required(),
  }).required(),
});

const listProductVariantsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(
    Joi.object({
      q: Joi.string().allow(""),
      keyWord: Joi.string().allow(""),
      search: Joi.string().allow(""),
      productId: Joi.string(),
      familyCode: Joi.string(),
      sellerId: Joi.string(),
      sku: Joi.string(),
      status: Joi.string(),
    }),
  ),
  params: Joi.object({}).required(),
});

const productVariantIdSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    variantId: Joi.string().required(),
  }).required(),
});

const createHsnCodeSchema = Joi.object({
  body: Joi.object({
    code: Joi.string().trim().required(),
    description: Joi.string().trim().required(),
    gstRate: Joi.number().min(0).required(),
    cessRate: Joi.number().min(0).default(0),
    taxType: Joi.string().valid("gst", "igst", "sgst", "cgst", "exempt").default("gst"),
    exempt: Joi.boolean().default(false),
    category: Joi.string().allow(null, ""),
    active: Joi.boolean().default(true),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateHsnCodeSchema = Joi.object({
  body: Joi.object({
    description: Joi.string().trim(),
    gstRate: Joi.number().min(0),
    cessRate: Joi.number().min(0),
    taxType: Joi.string().valid("gst", "igst", "sgst", "cgst", "exempt"),
    exempt: Joi.boolean(),
    category: Joi.string().allow(null, ""),
    active: Joi.boolean(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    hsnCode: Joi.string().required(),
  }).required(),
});

const listHsnCodesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(
    Joi.object({
      q: Joi.string().allow(""),
      keyWord: Joi.string().allow(""),
      search: Joi.string().allow(""),
      category: Joi.string(),
      active: Joi.boolean(),
    }),
  ),
  params: Joi.object({}).required(),
});

const hsnCodeParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    hsnCode: Joi.string().required(),
  }).required(),
});

const createGeographySchema = Joi.object({
  body: Joi.object({
    countryCode: Joi.string().trim().required(),
    countryName: Joi.string().trim().required(),
    active: Joi.boolean().default(true),
    states: Joi.array()
      .items(
        Joi.object({
          stateCode: Joi.string().trim().required(),
          stateName: Joi.string().trim().required(),
          cities: Joi.array().items(Joi.string().trim()).default([]),
        }),
      )
      .default([]),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateGeographySchema = Joi.object({
  body: Joi.object({
    countryName: Joi.string().trim(),
    active: Joi.boolean(),
    states: Joi.array().items(
      Joi.object({
        stateCode: Joi.string().trim().required(),
        stateName: Joi.string().trim().required(),
        cities: Joi.array().items(Joi.string().trim()).default([]),
      }),
    ),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    countryCode: Joi.string().required(),
  }).required(),
});

const listGeographiesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(Joi.object({ active: Joi.boolean() })),
  params: Joi.object({}).required(),
});

const geographyParamSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    countryCode: Joi.string().required(),
  }).required(),
});

const cmsImageSchema = Joi.object({
  url: Joi.string().allow("").default(""),
  alt: Joi.string().allow("").default(""),
  title: Joi.string().allow("").default(""),
  caption: Joi.string().allow("").default(""),
  type: Joi.string().allow("").default(""),
});

const cmsCtaSchema = Joi.object({
  label: Joi.string().allow("").default(""),
  url: Joi.string().allow("").default(""),
  target: Joi.string().valid("_self", "_blank").default("_self"),
});

const cmsPointSchema = Joi.object({
  title: Joi.string().allow("").default(""),
  description: Joi.string().allow("").default(""),
  image: cmsImageSchema.default({}),
  cta: cmsCtaSchema.default({}),
  sortOrder: Joi.number().integer().min(0).default(0),
});

const cmsSectionSchema = Joi.object({
  type: Joi.string().allow("").default("content"),
  title: Joi.string().allow("").default(""),
  description: Joi.string().allow("").default(""),
  image: cmsImageSchema.default({}),
  gallery: Joi.array().items(cmsImageSchema).default([]),
  points: Joi.array().items(cmsPointSchema).default([]),
  cta: cmsCtaSchema.default({}),
  sortOrder: Joi.number().integer().min(0).default(0),
});

const cmsSeoSchema = Joi.object({
  metaTitle: Joi.string().allow("").max(70).default(""),
  metaDescription: Joi.string().allow("").max(180).default(""),
  keywords: Joi.array().items(Joi.string().trim()).default([]),
  focusKeyword: Joi.string().allow("").default(""),
  canonicalUrl: Joi.string().allow("").default(""),
  robots: Joi.string().allow("").default("index,follow"),
  ogTitle: Joi.string().allow("").default(""),
  ogDescription: Joi.string().allow("").default(""),
  ogImage: cmsImageSchema.default({}),
  twitterTitle: Joi.string().allow("").default(""),
  twitterDescription: Joi.string().allow("").default(""),
  twitterImage: cmsImageSchema.default({}),
  schemaType: Joi.string().allow("").default("WebPage"),
  schemaJson: Joi.object().default({}),
  breadcrumbs: Joi.array().items(
    Joi.object({
      label: Joi.string().allow("").default(""),
      url: Joi.string().allow("").default(""),
    }),
  ).default([]),
});

const createContentPageSchema = Joi.object({
  body: Joi.object({
    slug: Joi.string().trim().required(),
    title: Joi.string().trim().required(),
    pageType: Joi.string().trim().required(),
    status: Joi.string().valid("draft", "published", "archived").default("draft"),
    description: Joi.string().allow("").default(""),
    body: Joi.string().allow("").default(""),
    excerpt: Joi.string().allow(""),
    category: Joi.string().allow(""),
    tags: Joi.array().items(Joi.string().trim()).default([]),
    image: cmsImageSchema.default({}),
    gallery: Joi.array().items(cmsImageSchema).default([]),
    sections: Joi.array().items(cmsSectionSchema).default([]),
    cta: cmsCtaSchema.default({}),
    seo: cmsSeoSchema.default({}),
    visibility: Joi.object({
      channels: Joi.array().items(Joi.string().trim()).default(["web", "app"]),
      roles: Joi.array().items(Joi.string().trim()).default(["public"]),
    }).default({ channels: ["web", "app"], roles: ["public"] }),
    sortOrder: Joi.number().integer().min(0).default(0),
    coverImage: Joi.string().allow(""),
    thumbnailUrl: Joi.string().allow(""),
    heroImage: Joi.string().allow(""),
    galleryImages: Joi.array().items(Joi.string()).default([]),
    author: Joi.object({
      name: Joi.string().allow(""),
      avatar: Joi.string().allow(""),
    }).default({}),
    readTime: Joi.number().integer().min(0).default(0),
    language: Joi.string().trim().default("en"),
    published: Joi.boolean().default(false),
    publishedAt: Joi.date().optional(),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateContentPageSchema = Joi.object({
  body: Joi.object({
    slug: Joi.string().trim(),
    title: Joi.string().trim(),
    pageType: Joi.string().trim(),
    status: Joi.string().valid("draft", "published", "archived"),
    description: Joi.string().allow(""),
    body: Joi.string().allow(""),
    excerpt: Joi.string().allow(""),
    category: Joi.string().allow(""),
    tags: Joi.array().items(Joi.string().trim()),
    image: cmsImageSchema,
    gallery: Joi.array().items(cmsImageSchema),
    sections: Joi.array().items(cmsSectionSchema),
    cta: cmsCtaSchema,
    seo: cmsSeoSchema,
    visibility: Joi.object({
      channels: Joi.array().items(Joi.string().trim()),
      roles: Joi.array().items(Joi.string().trim()),
    }),
    sortOrder: Joi.number().integer().min(0),
    coverImage: Joi.string().allow(""),
    thumbnailUrl: Joi.string().allow(""),
    heroImage: Joi.string().allow(""),
    galleryImages: Joi.array().items(Joi.string()),
    author: Joi.object({
      name: Joi.string().allow(""),
      avatar: Joi.string().allow(""),
    }),
    readTime: Joi.number().integer().min(0),
    language: Joi.string().trim(),
    published: Joi.boolean(),
    publishedAt: Joi.date().optional(),
    metadata: Joi.object(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    slug: Joi.string().required(),
  }).required(),
});

const listContentPagesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(
    Joi.object({
      q: Joi.string().allow(""),
      keyWord: Joi.string().allow(""),
      search: Joi.string().allow(""),
      pageType: Joi.string(),
      status: Joi.string().valid("draft", "published", "archived"),
      language: Joi.string(),
      published: Joi.boolean(),
    }),
  ),
  params: Joi.object({}).required(),
});

const contentPageSlugSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    slug: Joi.string().required(),
  }).required(),
});

const listProductReviewsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(
    Joi.object({
      q: Joi.string().allow(""),
      keyWord: Joi.string().allow(""),
      search: Joi.string().allow(""),
      productId: Joi.string(),
      buyerId: Joi.string(),
      orderId: Joi.string(),
      status: Joi.string(),
    }),
  ),
  params: Joi.object({}).required(),
});

const updateProductReviewSchema = Joi.object({
  body: Joi.object({
    rating: Joi.number().min(1).max(5),
    title: Joi.string().allow(""),
    reviewText: Joi.string().allow(""),
    media: Joi.array().items(Joi.string()),
    helpfulVotes: Joi.number().integer().min(0),
    status: Joi.string(),
  }).min(1).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    reviewId: Joi.string().required(),
  }).required(),
});

const productReviewIdSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    reviewId: Joi.string().required(),
  }).required(),
});

const createBrandSchema = Joi.object({
  body: Joi.object({
    name: Joi.string().trim().required(),
    logo: Joi.string().allow(""),
    thumbnails: Joi.string().allow(""),
    active: Joi.boolean().default(true),
    sortOrder: Joi.number().integer().default(0),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateBrandSchema = Joi.object({
  body: Joi.object({
    name: Joi.string().trim(),
    logo: Joi.string().allow(""),
    thumbnails: Joi.string().allow(""),
    active: Joi.boolean(),
    sortOrder: Joi.number().integer(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    brandId: Joi.string().required(),
  }).required(),
});

const listBrandsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(
    Joi.object({
      q: Joi.string().allow(""),
      keyWord: Joi.string().allow(""),
      search: Joi.string().allow(""),
      active: Joi.boolean(),
    }),
  ),
  params: Joi.object({}).required(),
});

const brandIdSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    brandId: Joi.string().required(),
  }).required(),
});

const createWarrantyTemplateSchema = Joi.object({
  body: Joi.object({
    period: Joi.string().trim().required(),
    active: Joi.boolean().default(true),
    metadata: Joi.object().default({}),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const updateWarrantyTemplateSchema = Joi.object({
  body: Joi.object({
    period: Joi.string().trim(),
    active: Joi.boolean(),
    metadata: Joi.object(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    templateId: Joi.string().required(),
  }).required(),
});

const listWarrantyTemplatesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(
    Joi.object({
      q: Joi.string().allow(""),
      keyWord: Joi.string().allow(""),
      search: Joi.string().allow(""),
      active: Joi.boolean(),
    }),
  ),
  params: Joi.object({}).required(),
});

const warrantyTemplateIdSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    templateId: Joi.string().required(),
  }).required(),
});

const createFinishSchema = Joi.object({
  body: Joi.object({ name: Joi.string().trim().required(), active: Joi.boolean().default(true) }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});
const updateFinishSchema = Joi.object({
  body: Joi.object({ name: Joi.string().trim(), active: Joi.boolean() }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ finishId: Joi.string().required() }).required(),
});
const listFinishesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(Joi.object({ q: Joi.string().allow(""), keyWord: Joi.string().allow(""), search: Joi.string().allow(""), active: Joi.boolean() })),
  params: Joi.object({}).required(),
});
const finishIdSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ finishId: Joi.string().required() }).required(),
});

const createDimensionSchema = Joi.object({
  body: Joi.object({ dimensions_value: Joi.string().trim().required(), active: Joi.boolean().default(true) }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});
const updateDimensionSchema = Joi.object({
  body: Joi.object({ dimensions_value: Joi.string().trim(), active: Joi.boolean() }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ dimensionId: Joi.string().required() }).required(),
});
const listDimensionsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(Joi.object({ q: Joi.string().allow(""), keyWord: Joi.string().allow(""), search: Joi.string().allow(""), active: Joi.boolean() })),
  params: Joi.object({}).required(),
});
const dimensionIdSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ dimensionId: Joi.string().required() }).required(),
});

const createBatchSchema = Joi.object({
  body: Joi.object({
    batchCode: Joi.string().trim().required(),
    manufactureDate: Joi.number().required(),
    expiryDate: Joi.number().required(),
    active: Joi.boolean().default(true),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});
const updateBatchSchema = Joi.object({
  body: Joi.object({
    batchCode: Joi.string().trim(),
    manufactureDate: Joi.number(),
    expiryDate: Joi.number(),
    active: Joi.boolean(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ batchId: Joi.string().required() }).required(),
});
const listBatchesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(Joi.object({ q: Joi.string().allow(""), keyWord: Joi.string().allow(""), search: Joi.string().allow(""), active: Joi.boolean() })),
  params: Joi.object({}).required(),
});
const batchIdSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ batchId: Joi.string().required() }).required(),
});

const createProductOptionSchema = Joi.object({
  body: Joi.object({ name: Joi.string().trim().required(), active: Joi.boolean().default(true) }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});
const updateProductOptionSchema = Joi.object({
  body: Joi.object({ name: Joi.string().trim(), active: Joi.boolean() }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ optionId: Joi.string().required() }).required(),
});
const listProductOptionsSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(Joi.object({ q: Joi.string().allow(""), keyWord: Joi.string().allow(""), search: Joi.string().allow(""), active: Joi.boolean() })),
  params: Joi.object({}).required(),
});
const productOptionIdSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ optionId: Joi.string().required() }).required(),
});

const createProductOptionValueSchema = Joi.object({
  body: Joi.object({
    optionId: Joi.string(),
    option_id: Joi.string(),
    name: Joi.string().trim().required(),
    valueCode: Joi.string().trim().allow(""),
    active: Joi.boolean().default(true),
  })
    .or("optionId", "option_id")
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});
const updateProductOptionValueSchema = Joi.object({
  body: Joi.object({
    optionId: Joi.string(),
    option_id: Joi.string(),
    name: Joi.string().trim(),
    valueCode: Joi.string().trim().allow(""),
    active: Joi.boolean(),
  }).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ optionValueId: Joi.string().required() }).required(),
});
const listProductOptionValuesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(
    Joi.object({
      q: Joi.string().allow(""),
      keyWord: Joi.string().allow(""),
      search: Joi.string().allow(""),
      option_id: Joi.string(),
      optionId: Joi.string(),
      active: Joi.boolean(),
    }),
  ),
  params: Joi.object({}).required(),
});
const productOptionValueIdSchema = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({ optionValueId: Joi.string().required() }).required(),
});

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesSchema,
  categoryKeySchema,
  createProductFamilySchema,
  updateProductFamilySchema,
  listProductFamiliesSchema,
  productFamilyCodeSchema,
  createProductVariantSchema,
  updateProductVariantSchema,
  listProductVariantsSchema,
  productVariantIdSchema,
  createHsnCodeSchema,
  updateHsnCodeSchema,
  listHsnCodesSchema,
  hsnCodeParamSchema,
  hsnCodeSchema: hsnCodeParamSchema,
  createGeographySchema,
  updateGeographySchema,
  listGeographiesSchema,
  geographyParamSchema,
  geographyCodeSchema: geographyParamSchema,
  listProductReviewsSchema,
  updateProductReviewSchema,
  productReviewIdSchema,
  createBrandSchema,
  updateBrandSchema,
  listBrandsSchema,
  brandIdSchema,
  createWarrantyTemplateSchema,
  updateWarrantyTemplateSchema,
  listWarrantyTemplatesSchema,
  warrantyTemplateIdSchema,
  createFinishSchema,
  updateFinishSchema,
  listFinishesSchema,
  finishIdSchema,
  createDimensionSchema,
  updateDimensionSchema,
  listDimensionsSchema,
  dimensionIdSchema,
  createBatchSchema,
  updateBatchSchema,
  listBatchesSchema,
  batchIdSchema,
  createProductOptionSchema,
  updateProductOptionSchema,
  listProductOptionsSchema,
  productOptionIdSchema,
  createProductOptionValueSchema,
  updateProductOptionValueSchema,
  listProductOptionValuesSchema,
  productOptionValueIdSchema,
};
