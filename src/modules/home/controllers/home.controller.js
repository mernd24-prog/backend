"use strict";

const { okResponse } = require("../../../shared/http/reply");
const { HomeService } = require("../services/home.service");

class HomeController {
  constructor({ homeService = new HomeService() } = {}) {
    this.homeService = homeService;
  }

  collectionCollages = async (req, res) => {
    const sections = await this.homeService.listCollectionCollages(req.query);
    res.json(okResponse(sections, { total: sections.length }));
  };
}

module.exports = { HomeController };
