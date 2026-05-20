const { getPage } = require("../../../shared/tools/page");
const { AppError } = require("../../../shared/errors/app-error");
const { CmsRepository } = require("../repositories/cms.repository");

class CmsService {
  constructor({ cmsRepository = new CmsRepository() } = {}) {
    this.cmsRepository = cmsRepository;
  }

  async createPage(payload) {
    const nextPayload = this.normalizePagePayload(payload);
    const existing = await this.cmsRepository.findBySlug(nextPayload.slug);
    if (existing) {
      throw new AppError("A page with this slug already exists", 409);
    }
    if (nextPayload.published && !nextPayload.publishedAt) {
      nextPayload.publishedAt = new Date();
    }
    return this.cmsRepository.create(nextPayload);
  }

  async updatePage(slug, payload) {
    const page = await this.cmsRepository.findBySlug(slug);
    if (!page) {
      throw new AppError("Page not found", 404);
    }
    const nextPayload = this.normalizePagePayload(payload, page);
    if (nextPayload.published && !page.publishedAt && !nextPayload.publishedAt) {
      nextPayload.publishedAt = new Date();
    }
    return this.cmsRepository.update(slug, nextPayload);
  }

  async getPage(slug) {
    const page = await this.cmsRepository.findBySlug(slug);
    if (!page) {
      throw new AppError("Page not found", 404);
    }
    return page;
  }

  async getPublishedPage(slug) {
    const page = await this.cmsRepository.findBySlug(slug);
    if (!page || !page.published) {
      throw new AppError("Page not found", 404);
    }
    return page;
  }

  async listPages(query) {
    const pagination = getPage(query);
    const filter = {};
    if (query.pageType) filter.pageType = query.pageType;
    if (query.language) filter.language = query.language;
    if (query.published !== undefined) {
      filter.published = query.published === true || query.published === "true";
    }
    const q = query.q || query.search;
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { slug: { $regex: q, $options: "i" } },
        { body: { $regex: q, $options: "i" } },
      ];
    }
    return this.cmsRepository.list(filter, pagination);
  }

  async listPublishedPages(query) {
    return this.listPages({ ...query, published: true });
  }

  normalizeImage(image = {}, fallback = {}) {
    if (typeof image === "string") {
      return {
        url: image,
        alt: fallback.alt || "",
        title: "",
        caption: "",
        type: fallback.type || "",
      };
    }

    return {
      url: image?.url || fallback.url || "",
      alt: image?.alt || fallback.alt || "",
      title: image?.title || "",
      caption: image?.caption || "",
      type: image?.type || fallback.type || "",
    };
  }

  normalizePagePayload(payload = {}, existing = {}) {
    const nextPayload = { ...payload };
    const title = nextPayload.title || existing.title || "";
    const imageUrl = nextPayload.image?.url || nextPayload.heroImage || nextPayload.coverImage || "";

    if (nextPayload.image !== undefined || imageUrl) {
      nextPayload.image = this.normalizeImage(nextPayload.image, {
        url: imageUrl,
        alt: title,
        type: "hero",
      });
    }

    if (Array.isArray(nextPayload.galleryImages) && !Array.isArray(nextPayload.gallery)) {
      nextPayload.gallery = nextPayload.galleryImages.map((url) =>
        this.normalizeImage(url, { alt: title }),
      );
    }

    if (Array.isArray(nextPayload.gallery)) {
      nextPayload.gallery = nextPayload.gallery.map((item) =>
        this.normalizeImage(item, { alt: title }),
      );
      nextPayload.galleryImages = nextPayload.gallery
        .map((item) => item.url)
        .filter(Boolean);
    }

    if (Array.isArray(nextPayload.sections)) {
      nextPayload.sections = nextPayload.sections.map((section = {}, sectionIndex) => ({
        ...section,
        image: this.normalizeImage(section.image, {
          alt: section.title || title,
          type: "section",
        }),
        gallery: Array.isArray(section.gallery)
          ? section.gallery.map((item) => this.normalizeImage(item, { alt: section.title || title }))
          : [],
        points: Array.isArray(section.points)
          ? section.points.map((point = {}, pointIndex) => ({
              ...point,
              image: this.normalizeImage(point.image, {
                alt: point.title || section.title || title,
                type: "point",
              }),
              sortOrder: Number(point.sortOrder ?? pointIndex),
            }))
          : [],
        sortOrder: Number(section.sortOrder ?? sectionIndex),
      }));

      nextPayload.points = nextPayload.sections.flatMap((section) => section.points || []);
    }

    if (nextPayload.image?.url) {
      nextPayload.heroImage = nextPayload.heroImage || nextPayload.image.url;
      nextPayload.coverImage = nextPayload.coverImage || nextPayload.image.url;
      nextPayload.thumbnailUrl = nextPayload.thumbnailUrl || nextPayload.image.url;
    }

    if (!nextPayload.excerpt && nextPayload.description) {
      nextPayload.excerpt = nextPayload.description;
    }

    const shouldGenerateBodyFromSections =
      Array.isArray(nextPayload.sections) &&
      (!payload.body || payload.body === existing.body);
    if (
      shouldGenerateBodyFromSections ||
      (!nextPayload.body && (nextPayload.description || Array.isArray(nextPayload.sections)))
    ) {
      nextPayload.body = this.makePageBody(nextPayload);
    }

    if (nextPayload.status) {
      nextPayload.published = nextPayload.status === "published";
    } else if (nextPayload.published !== undefined) {
      nextPayload.status = nextPayload.published ? "published" : "draft";
    }

    if (Array.isArray(nextPayload.sections)) {
      const metadata = {
        ...(existing.metadata?.toObject ? existing.metadata.toObject() : existing.metadata || {}),
        ...(nextPayload.metadata || {}),
      };
      const currentData = metadata.data && typeof metadata.data === "object" ? metadata.data : {};
      metadata.data = {
        ...currentData,
        title: nextPayload.title || title,
        description: nextPayload.description || currentData.description || "",
        sections: nextPayload.sections,
        points: nextPayload.points || currentData.points || [],
      };
      nextPayload.metadata = metadata;
    }

    return nextPayload;
  }

  makePageBody(page = {}) {
    const lines = [`<h1>${page.title || ""}</h1>`];
    if (page.description) lines.push(`<p>${page.description}</p>`);
    for (const section of page.sections || []) {
      if (section.title) lines.push(`<h2>${section.title}</h2>`);
      if (section.description) lines.push(`<p>${section.description}</p>`);
      if (Array.isArray(section.points) && section.points.length) {
        lines.push("<ul>");
        for (const point of section.points) {
          if (point.title || point.description) {
            lines.push(`<li><strong>${point.title || ""}</strong>${point.description ? `: ${point.description}` : ""}</li>`);
          }
        }
        lines.push("</ul>");
      }
    }
    return lines.join("\n").trim();
  }

  async deletePage(slug) {
    const page = await this.cmsRepository.findBySlug(slug);
    if (!page) {
      throw new AppError("Page not found", 404);
    }
    return this.cmsRepository.delete(slug);
  }
}

module.exports = { CmsService };
