const { operationsReportService } = require("../services/operations-report.service");

class OperationsReportController {
  constructor({ reportService = operationsReportService } = {}) {
    this.reportService = reportService;
  }

  exportOrders = (req, res) => this.sendReport(res, "orders", req.query);
  exportProducts = (req, res) => this.sendReport(res, "products", req.query);
  exportInventory = (req, res) => this.sendReport(res, "inventory", req.query);
  exportShipments = (req, res) => this.sendReport(res, "shipments", req.query);
  exportDeliveryAgents = (req, res) => this.sendReport(res, "delivery-agents", req.query);
  exportReturns = (req, res) => this.sendReport(res, "returns", req.query);
  exportCancellations = (req, res) => this.sendReport(res, "cancellations", req.query);
  exportRefunds = (req, res) => this.sendReport(res, "refunds", req.query);
  exportSellerScorecards = (req, res) => this.sendReport(res, "seller-scorecards", req.query);

  async sendReport(res, reportType, query) {
    const document = await this.reportService.exportReport(reportType, query);
    res.setHeader("Content-Type", document.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${document.fileName}"`);
    res.status(200).send(document.body);
  }
}

module.exports = { OperationsReportController };
