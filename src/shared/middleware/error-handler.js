const { failResponse } = require("../http/reply");

function errorHandler(error, req, res, next) {
  const statusCode = error.statusCode || error.status || 500;

  if (statusCode < 500) {
    req.log?.warn({ err: error }, "Request error");
  } else {
    req.log?.error({ err: error }, "Unhandled request error");
  }

  let message = error.message || "Internal server error";

  if (error.type === "entity.too.large" || statusCode === 413) {
    message = "Request payload too large. Please reduce the size of the data you are sending.";
  }

  res.status(statusCode).json(failResponse(message, error.details));
}

module.exports = { errorHandler };
