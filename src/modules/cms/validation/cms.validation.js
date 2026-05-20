const Joi = require("joi");

const paginationQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const slugParam = Joi.object({
  body: Joi.object({}).required(),
  query: Joi.object({}).required(),
  params: Joi.object({
    slug: Joi.string().required(),
  }).required(),
});

const imageSchema = Joi.object({
  url: Joi.string().allow("").default(""),
  alt: Joi.string().allow("").default(""),
  title: Joi.string().allow("").default(""),
  caption: Joi.string().allow("").default(""),
  type: Joi.string().allow("").default(""),
});

const ctaSchema = Joi.object({
  label: Joi.string().allow("").default(""),
  url: Joi.string().allow("").default(""),
  target: Joi.string().valid("_self", "_blank").default("_self"),
});

const pointSchema = Joi.object({
  title: Joi.string().allow("").default(""),
  description: Joi.string().allow("").default(""),
  image: Joi.alternatives().try(imageSchema, Joi.string().allow("")).default({}),
  cta: ctaSchema.default({}),
  sortOrder: Joi.number().integer().min(0).default(0),
});

const sectionSchema = Joi.object({
  type: Joi.string().allow("").default("content"),
  title: Joi.string().allow("").default(""),
  description: Joi.string().allow("").default(""),
  image: Joi.alternatives().try(imageSchema, Joi.string().allow("")).default({}),
  gallery: Joi.array().items(imageSchema).default([]),
  points: Joi.array().items(pointSchema).default([]),
  cta: ctaSchema.default({}),
  sortOrder: Joi.number().integer().min(0).default(0),
});

const seoSchema = Joi.object({
  metaTitle: Joi.string().allow("").max(70).default(""),
  metaDescription: Joi.string().allow("").max(180).default(""),
  keywords: Joi.array().items(Joi.string().trim()).default([]),
  focusKeyword: Joi.string().allow("").default(""),
  canonicalUrl: Joi.string().allow("").default(""),
  robots: Joi.string().allow("").default("index,follow"),
  ogTitle: Joi.string().allow("").default(""),
  ogDescription: Joi.string().allow("").default(""),
  ogImage: imageSchema.default({}),
  twitterTitle: Joi.string().allow("").default(""),
  twitterDescription: Joi.string().allow("").default(""),
  twitterImage: imageSchema.default({}),
  schemaType: Joi.string().allow("").default("WebPage"),
  schemaJson: Joi.object().default({}),
  breadcrumbs: Joi.array().items(
    Joi.object({
      label: Joi.string().allow("").default(""),
      url: Joi.string().allow("").default(""),
    }),
  ).default([]),
});

const createPageSchema = Joi.object({
  body: Joi.object({
    slug: Joi.string().trim().required(),
    pageType: Joi.string().trim().required(),
    title: Joi.string().trim().required(),
    status: Joi.string().valid("draft", "published", "archived").default("draft"),
    body: Joi.string().allow("").default(""),
    description: Joi.string().allow("").default(""),
    excerpt: Joi.string().allow("").default(""),
    category: Joi.string().allow("").default(""),
    tags: Joi.array().items(Joi.string().trim()).default([]),
    image: Joi.alternatives().try(imageSchema, Joi.string().allow("")).default({}),
    gallery: Joi.array().items(imageSchema).default([]),
    sections: Joi.array().items(sectionSchema).default([]),
    cta: ctaSchema.default({}),
    seo: seoSchema.default({}),
    visibility: Joi.object({
      channels: Joi.array().items(Joi.string().trim()).default(["web", "app"]),
      roles: Joi.array().items(Joi.string().trim()).default(["public"]),
    }).default({ channels: ["web", "app"], roles: ["public"] }),
    sortOrder: Joi.number().integer().min(0).default(0),
    coverImage: Joi.string().allow("").default(""),
    thumbnailUrl: Joi.string().allow("").default(""),
    heroImage: Joi.string().allow("").default(""),
    galleryImages: Joi.array().items(Joi.string().allow("")).default([]),
    points: Joi.array().items(pointSchema).default([]),
    author: Joi.object({
      name: Joi.string().allow("").default(""),
      avatar: Joi.string().allow("").default(""),
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

const updatePageSchema = Joi.object({
  body: Joi.object({
    slug: Joi.string().trim(),
    title: Joi.string().trim(),
    pageType: Joi.string().trim(),
    status: Joi.string().valid("draft", "published", "archived"),
    body: Joi.string().allow(""),
    description: Joi.string().allow(""),
    excerpt: Joi.string().allow(""),
    category: Joi.string().allow(""),
    tags: Joi.array().items(Joi.string().trim()),
    image: Joi.alternatives().try(imageSchema, Joi.string().allow("")),
    gallery: Joi.array().items(imageSchema),
    sections: Joi.array().items(sectionSchema),
    cta: ctaSchema,
    seo: seoSchema,
    visibility: Joi.object({
      channels: Joi.array().items(Joi.string().trim()),
      roles: Joi.array().items(Joi.string().trim()),
    }),
    sortOrder: Joi.number().integer().min(0),
    coverImage: Joi.string().allow(""),
    thumbnailUrl: Joi.string().allow(""),
    heroImage: Joi.string().allow(""),
    galleryImages: Joi.array().items(Joi.string().allow("")),
    points: Joi.array().items(pointSchema),
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

const listPagesSchema = Joi.object({
  body: Joi.object({}).required(),
  query: paginationQuery.concat(
    Joi.object({
      q: Joi.string().allow(""),
      search: Joi.string().allow(""),
      pageType: Joi.string(),
      status: Joi.string().valid("draft", "published", "archived"),
      language: Joi.string(),
      published: Joi.boolean(),
    }),
  ),
  params: Joi.object({}).required(),
});

module.exports = {
  slugParam,
  createPageSchema,
  updatePageSchema,
  listPagesSchema,
};
