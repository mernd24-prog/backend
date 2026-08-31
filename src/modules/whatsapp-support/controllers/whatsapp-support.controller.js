const { okResponse } = require("../../../shared/http/reply");
const { WhatsappFaqRepository } = require("../repositories/whatsapp-faq.repository");
const { WhatsappWebhookService } = require("../services/whatsapp-webhook.service");

class WhatsappSupportController {
  constructor({
    repository = new WhatsappFaqRepository(),
    webhookService = new WhatsappWebhookService({ repository }),
  } = {}) {
    this.repository = repository;
    this.webhookService = webhookService;
  }

  webhook = async (req, res) => {
    try {
      const result = await this.webhookService.processWebhook(req);
      res.status(200).json(okResponse(result));
    } catch (error) {
      if (error.statusCode === 202 || error.status === 202) {
        res.status(200).json(okResponse({
          status: "ignored",
          reason: error.message,
          sent: false,
        }));
        return;
      }
      throw error;
    }
  };

  listFaqs = async (req, res) => {
    const result = await this.repository.listFaqs(req.query || {});
    res.json(okResponse(result.items, {
      meta: {
        total: result.total,
        limit: Number(req.query.limit || 50),
        offset: Number(req.query.offset || 0),
      },
    }));
  };

  createFaq = async (req, res) => {
    const faq = await this.repository.createFaq(req.body || {});
    res.status(201).json(okResponse(faq, { message: "FAQ entry created" }));
  };
}

module.exports = { WhatsappSupportController };
