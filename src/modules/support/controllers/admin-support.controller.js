const { okResponse, paginationMeta } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { SupportService } = require("../services/support.service");

class AdminSupportController {
  constructor({ supportService = new SupportService() } = {}) {
    this.supportService = supportService;
  }

  listQueries = async (req, res) => {
    const result = await this.supportService.listForAdmin({
      ...req.query,
      userType: req.query.user_type,
    });
    res.json(okResponse(result.items, {
      pagination: paginationMeta(
        Math.floor(result.offset / result.limit) + 1,
        result.limit,
        result.total,
      ),
      meta: { total: result.total, limit: result.limit, offset: result.offset },
    }));
  };

  getQuery = async (req, res) => {
    const query = await this.supportService.getForAdmin(req.params.queryId);
    res.json(okResponse(query));
  };

  updateStatus = async (req, res) => {
    const actor = getCurrentUser(req);
    const query = await this.supportService.updateStatus(req.params.queryId, req.body, actor);
    res.json(okResponse(query, { message: "Support query status updated successfully" }));
  };
}

module.exports = { AdminSupportController };
