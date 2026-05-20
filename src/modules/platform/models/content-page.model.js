const { mongoose } = require("../../../infrastructure/mongo/mongo-client");

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    alt: { type: String, default: "" },
    title: { type: String, default: "" },
    caption: { type: String, default: "" },
    type: { type: String, default: "" },
  },
  { _id: false },
);

const ctaSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },
    url: { type: String, default: "" },
    target: { type: String, default: "_self" },
  },
  { _id: false },
);

const contentPointSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    image: { type: imageSchema, default: () => ({}) },
    cta: { type: ctaSchema, default: () => ({}) },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const contentSectionSchema = new mongoose.Schema(
  {
    type: { type: String, default: "content" },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    image: { type: imageSchema, default: () => ({}) },
    gallery: { type: [imageSchema], default: [] },
    points: { type: [contentPointSchema], default: [] },
    cta: { type: ctaSchema, default: () => ({}) },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const seoSchema = new mongoose.Schema(
  {
    metaTitle: { type: String, default: "" },
    metaDescription: { type: String, default: "" },
    keywords: [{ type: String, trim: true }],
    focusKeyword: { type: String, default: "" },
    canonicalUrl: { type: String, default: "" },
    robots: { type: String, default: "index,follow" },
    ogTitle: { type: String, default: "" },
    ogDescription: { type: String, default: "" },
    ogImage: { type: imageSchema, default: () => ({}) },
    twitterTitle: { type: String, default: "" },
    twitterDescription: { type: String, default: "" },
    twitterImage: { type: imageSchema, default: () => ({}) },
    schemaType: { type: String, default: "WebPage" },
    schemaJson: { type: Object, default: {} },
    breadcrumbs: [
      {
        label: { type: String, default: "" },
        url: { type: String, default: "" },
      },
    ],
  },
  { _id: false },
);

const contentPageSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    pageType: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
      index: true,
    },
    description: { type: String, default: "" },
    body: { type: String, default: "" },
    excerpt: { type: String, default: "" },
    category: { type: String, default: "", index: true },
    tags: [{ type: String, trim: true }],
    image: { type: imageSchema, default: () => ({}) },
    gallery: { type: [imageSchema], default: [] },
    sections: { type: [contentSectionSchema], default: [] },
    points: { type: [contentPointSchema], default: [] },
    cta: { type: ctaSchema, default: () => ({}) },
    seo: { type: seoSchema, default: () => ({}) },
    visibility: {
      channels: [{ type: String, trim: true }],
      roles: [{ type: String, trim: true }],
    },
    sortOrder: { type: Number, default: 0, index: true },
    coverImage: { type: String, default: "" },
    thumbnailUrl: { type: String, default: "" },
    heroImage: { type: String, default: "" },
    galleryImages: [{ type: String }],
    author: {
      name: { type: String, default: "" },
      avatar: { type: String, default: "" },
    },
    readTime: { type: Number, min: 0, default: 0 },
    language: { type: String, default: "en", index: true },
    published: { type: Boolean, default: false, index: true },
    publishedAt: { type: Date },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

const ContentPageModel = mongoose.model("ContentPage", contentPageSchema);

module.exports = { ContentPageModel };
