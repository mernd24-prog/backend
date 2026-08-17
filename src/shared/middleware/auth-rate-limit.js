const rateLimit = require("express-rate-limit");
const { RedisRateLimitStore } = require("./redis-rate-limit-store");

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore({ prefix: "rate:auth:", windowMs: 15 * 60 * 1000 }),
  message: {
    success: false,
    error: {
      message: "Too many authentication attempts. Please try again later.",
    },
  },
});

module.exports = { authRateLimit };
