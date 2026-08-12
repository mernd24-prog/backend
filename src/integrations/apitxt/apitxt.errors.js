class ApitxtError extends Error {
  constructor(message, {
    statusCode = 502,
    providerCode = null,
    retryable = false,
    details = null,
  } = {}) {
    super(message);
    this.name = "ApitxtError";
    this.statusCode = statusCode;
    this.providerCode = providerCode;
    this.retryable = retryable;
    this.details = details;
  }
}

module.exports = { ApitxtError };
