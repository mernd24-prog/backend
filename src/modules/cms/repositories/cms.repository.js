const { ContentPageModel } = require("../../platform/models/content-page.model");

class CmsRepository {
  async create(payload) {
    return ContentPageModel.create(payload);
  }

  async update(slug, payload) {
    return ContentPageModel.findOneAndUpdate({ slug }, payload, {
      new: true,
      runValidators: true,
    });
  }

  async findBySlug(slug) {
    return ContentPageModel.findOne({ slug });
  }

  async list(filter = {}, pagination = {}) {
    const [items, total] = await Promise.all([
      ContentPageModel.find(filter)
        .sort({ sortOrder: 1, createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      ContentPageModel.countDocuments(filter),
    ]);
    return { items, total };
  }

  async delete(slug) {
    return ContentPageModel.findOneAndDelete({ slug });
  }
}

module.exports = { CmsRepository };
