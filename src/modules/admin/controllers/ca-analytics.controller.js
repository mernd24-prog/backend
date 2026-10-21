const { okResponse } = require("../../../shared/http/reply");
const { getCurrentUser } = require("../../../shared/auth/current-user");
const { caAnalyticsService } = require("../services/ca-analytics.service");

const sellerScope = (req) => req.caSellerScope ? {
  sellerId: req.auth?.ownerSellerId || req.auth?.sub,
  organizationId: req.query?.organizationId || req.auth?.selectedOrganizationId || null,
} : {};

class CaAnalyticsController {
  summary = async (req, res) => res.json(okResponse(await caAnalyticsService.getSummary(req.query, sellerScope(req))));
  trends = async (req, res) => res.json(okResponse(await caAnalyticsService.getTrends(req.query, sellerScope(req))));
  reconciliation = async (req, res) => res.json(okResponse(await caAnalyticsService.getReconciliation(req.query, sellerScope(req))));
  register = async (req, res) => res.json(okResponse(await caAnalyticsService.getRegister(req.params.register, req.query, sellerScope(req))));
  importProvider = async (req, res) => res.status(201).json(okResponse(await caAnalyticsService.importProviderFile(req.file, req.body, getCurrentUser(req))));
  export = async (req, res) => {
    const document = await caAnalyticsService.exportReport(req.params.report, req.query, sellerScope(req));
    res.setHeader("Content-Type", document.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${document.fileName}"`);
    res.send(document.body);
  };
}

module.exports = { CaAnalyticsController };
