const { okResponse } = require("../../../shared/http/reply");
const { SupportAiService } = require("../services/support-ai.service");

class SupportAiController {
  constructor({ supportAiService = new SupportAiService() } = {}) {
    this.supportAiService = supportAiService;
  }

  chat = async (req, res) => {
    const { message, history } = req.body;
    const result = await this.supportAiService.processChatMessage({
      message,
      history,
      auth: req.auth || null,
    });
    res.json(okResponse(result));
  };
}

module.exports = { SupportAiController };

