const { AppError } = require("../../../shared/errors/app-error");

class SmsConfigurationError extends AppError {
  constructor(message, details = null) {
    super(message, 503, details);
    this.name = "SmsConfigurationError";
  }
}

class SmsTemplateError extends AppError {
  constructor(message, details = null) {
    super(message, 400, details);
    this.name = "SmsTemplateError";
  }
}

module.exports = { SmsConfigurationError, SmsTemplateError };
