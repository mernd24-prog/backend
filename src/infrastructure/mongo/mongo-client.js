const mongoose = require("mongoose");
const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");

async function connectMongo() {
  mongoose.set("strictQuery", true);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
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
      return;
    } catch (error) {
      const temporary = ["MongooseServerSelectionError", "MongoNetworkError", "MongoNetworkTimeoutError"].includes(error.name) ||
        ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ETIMEOUT", "EAI_AGAIN"].includes(error.code);
      if (!temporary || attempt === 3) throw error;
      logger.warn({ attempt, nextAttempt: attempt + 1, errorName: error.name, errorCode: error.code },
        "MongoDB startup connection failed temporarily; retrying");
      await mongoose.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

module.exports = { mongoose, connectMongo };
