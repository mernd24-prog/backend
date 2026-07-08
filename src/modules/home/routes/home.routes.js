"use strict";

const express = require("express");
const { HomeController } = require("../controllers/home.controller");
const { catchErrors } = require("../../../shared/middleware/catch-errors");

const homeRoutes = express.Router();
const homeController = new HomeController();

homeRoutes.get("/collection-collages", catchErrors(homeController.collectionCollages));

module.exports = { homeRoutes };
