const mongoose = require("mongoose");
const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");

async function connectMongo() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri, {
    minPoolSize: env.mongo.minPoolSize,
    maxPoolSize: Math.max(env.mongo.minPoolSize, env.mongo.maxPoolSize),
    serverSelectionTimeoutMS: env.mongo.serverSelectionTimeoutMS,
    socketTimeoutMS: env.mongo.socketTimeoutMS,
    connectTimeoutMS: env.mongo.connectTimeoutMS,
    maxIdleTimeMS: env.mongo.maxIdleTimeMS,
    retryWrites: true,
  });
  logger.info("MongoDB connected");
}

module.exports = { mongoose, connectMongo };
