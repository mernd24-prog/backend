const customer = require("./customer-cms-fallback-data.json");

const image = (value, fallbackAlt = "") => {
  if (!value) return {};
  if (typeof value === "string") return { url: value, alt: fallbackAlt };
  return value;
};

const point = (title, description = "", extra = {}) => ({ title, description, ...extra });

const page = (slug, data = {}, pageType = "page") => ({
  slug,
  title: data.title || slug,
  pageType: data.pageType || pageType,
  status: "published",
  published: true,
  publishedAt: new Date(),
  description: data.description || data.excerpt || "",
  excerpt: data.excerpt || "",
  body: data.body || "",
  image: image(data.image, data.title || slug),
  gallery: Array.isArray(data.gallery) ? data.gallery : [],
  sections: Array.isArray(data.sections) ? data.sections : [],
  points: Array.isArray(data.points) ? data.points : [],
  cta: data.cta || {},
  seo: data.seo || {},
  category: data.category || "customer-cms",
  tags: Array.isArray(data.tags) ? data.tags : ["customer", "cms", "fallback"],
  visibility: data.visibility || { channels: ["web", "mobile"], roles: ["customer"] },
  language: data.language || "en",
  metadata: {
    source: "customer-fallback",
    customerCmsKey: slug,
    // Preserve every storefront key, including values not represented by the
    // ContentPage schema. Customer CMS normalizers read metadata.data first.
    data: { slug, ...data },
  },
});

const supportSections = [
  {
    type: "all-help-topics",
    title: "All Help Topics",
    points: customer.support.topics.map((topic, index) => point(topic.title, "", {
      image: image(topic.image, topic.title),
      cta: { label: topic.title, url: topic.path || "#", target: "_self" },
      sortOrder: index,
    })),
  },
  {
    type: "contact-support",
    title: "Contact Support",
    points: customer.support.contacts.map((contact, index) => point(
      contact.title,
      contact.description,
      {
        cta: { label: contact.description, url: contact.path || "#", target: "_self" },
        sortOrder: index,
      },
    )),
  },
];

const heroSections = customer.heroSlides.map((slide, index) => ({
  type: "hero-slide",
  title: `${slide.title || ""}${slide.highlight ? `\n${slide.highlight}` : ""}`,
  description: slide.description || "",
  image: image(slide.image, slide.title),
  points: [
    point(slide.badge || ""),
    point("", "", {
      cta: {
        label: slide.secondaryButton || "Explore Categories",
        url: slide.secondaryLink || "/categories",
        target: "_self",
      },
    }),
  ],
  cta: {
    label: slide.primaryButton || "Shop Now",
    url: slide.primaryLink || "/products",
    target: "_self",
  },
  sortOrder: index,
}));

const promoSections = [{
  type: "campaign-cards",
  title: "Promotional Campaigns",
  points: customer.promoCards.map((card, index) => ({
    title: card.title || "",
    description: card.description || "",
    image: image(card.image, card.title),
    cta: {
      label: card.ctaLabel || "Explore now",
      url: card.link || "/products",
      target: "_self",
    },
    sortOrder: index,
  })),
}];

const shoppingSections = [{
  type: "shopping-banner",
  title: customer.shoppingBanner.title,
  description: customer.shoppingBanner.description,
  image: image(customer.shoppingBanner.image, customer.shoppingBanner.title),
  points: [point(customer.shoppingBanner.description)],
  cta: customer.shoppingBanner.cta || {},
}];

const footerSections = [
  {
    type: "footer-links",
    title: "footer-links",
    points: customer.footer.benefits.map((benefit, index) => ({
      title: benefit.title,
      description: benefit.description,
      image: image(benefit.icon, benefit.alt || benefit.title),
      sortOrder: index,
    })),
  },
  ...customer.footer.linkGroups.map((group, groupIndex) => ({
    type: "links",
    title: group.title,
    points: group.links.map((link, linkIndex) => ({
      title: link.label,
      description: "",
      cta: { label: link.label, url: link.href, target: link.target || "_self" },
      sortOrder: linkIndex,
    })),
    sortOrder: groupIndex + 1,
  })),
  {
    type: "appDownload",
    title: "appDownload",
    description: customer.footer.appDownload.title,
    image: image(customer.footer.logo, "Sam Global"),
    points: customer.footer.appDownload.links.map((link, index) => ({
      title: link.label,
      image: image(link.image, link.alt || link.label),
      cta: { label: link.label, url: link.href, target: link.target || "_self" },
      sortOrder: index,
    })),
  },
  {
    type: "copyright",
    title: "copyright",
    description: customer.footer.copyright,
    points: customer.footer.socialLinks.map((link, index) => ({
      title: link.label,
      image: image(link.icon, link.alt || link.label),
      cta: { label: link.label, url: link.href, target: link.target || "_blank" },
      sortOrder: index,
    })),
  },
];

const policyPages = [
  ["shipping-delivery-policy", customer.policies.shipping],
  ["return-refund-policy", customer.policies.returns],
  ["terms-of-use", customer.policies.terms],
  ["privacy-policy", customer.policies.privacy],
  ["cookie-policy", customer.policies.cookies],
].map(([slug, data]) => page(slug, data, "policy"));

const aboutPages = [
  ["about-banner", customer.about.banner],
  ["about-sam-global", customer.about.story],
  ["our-values", customer.about.values],
  ["our-mission", customer.about.mission],
  ["why-choose-us", customer.about.whyChoose],
].map(([slug, data]) => page(slug, data, "about"));

const customerCmsFallbackPages = [
  page("contact-us", customer.contact, "contact"),
  page("support-center", {
    ...customer.support,
    title: "Help & Support",
    description: "Find answers, manage orders and returns, or contact our support team.",
    sections: supportSections,
  }, "support"),
  page("faq-details", customer.faq, "faq"),
  page("become-a-seller", customer.sellerPage, "seller"),
  page("seller-policy", customer.sellerPolicy, "policy"),
  page("seller-policies", customer.sellerPolicy, "policy"),
  page("Hero Banner", { title: "Home Hero Banner", sections: heroSections, slides: customer.heroSlides }, "banner"),
  page("promo-campaign-carousel", { title: "Promotional Campaigns", sections: promoSections, cards: customer.promoCards }, "campaign"),
  page("shopping-banner", { ...customer.shoppingBanner, sections: shoppingSections }, "banner"),
  page("header-mega-menu", { title: "Header Mega Menu", categories: customer.homeCategories }, "navigation"),
  page("deal-products", { title: "Deal Products" }, "listing"),
  page("footerdata", {
    ...customer.footer,
    image: image(customer.footer.logo, "Sam Global"),
    sections: footerSections,
  }, "footer"),
  ...aboutPages,
  ...policyPages,
];

module.exports = { customerCmsFallbackPages };
