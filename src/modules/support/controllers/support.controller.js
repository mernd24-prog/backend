const { okResponse, paginationMeta } = require("../../../shared/http/reply");
const { SupportService } = require("../services/support.service");

class SupportController {
  constructor({ supportService = new SupportService() } = {}) {
    this.supportService = supportService;
  }

  createQuery = async (req, res) => {
    const query = await this.supportService.createQuery(req.body, req.auth);
    res.status(201).json(okResponse(query, { message: "Support query submitted successfully" }));
  };

  listMine = async (req, res) => {
    const result = await this.supportService.listMine(req.query, req.auth);
    res.json(okResponse(result.items, {
      pagination: paginationMeta(
        Math.floor(result.offset / result.limit) + 1,
        result.limit,
        result.total,
      ),
      meta: { total: result.total, limit: result.limit, offset: result.offset },
    }));
  };

  getMine = async (req, res) => {
    const query = await this.supportService.getMine(req.params.queryId, req.auth);
    res.json(okResponse(query));
  };
}

module.exports = { SupportController };
