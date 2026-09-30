const { apitxtService } = require("../../../integrations/apitxt");
const { SMS_PROVIDER_NAMES } = require("./sms.constants");
const { SmsConfigurationError } = require("./sms.errors");

class ApitxtSmsProvider {
  constructor(config) {
    this.config = config;
    this.name = SMS_PROVIDER_NAMES.APITXT;
  }

  async send({ mobile, message, template, header }) {
    if (template.otp) {
      return apitxtService.sendSmsOtp({
        authKey: this.config.apiKey,
        url: this.config.otpApiUrl || undefined,
        mobile,
        otp: message.variables.otp,
        channel: "sms",
        templateId: template.templateId,
        country: this.config.country,
        sender: header,
        peId: this.config.peId,
      });
    }
    if (!this.config.apiUrl) {
      throw new SmsConfigurationError("SMS_API_URL is required for transactional/service SMS");
    }
    return apitxtService.sendDltSms({
      url: this.config.apiUrl,
      method: this.config.apiMethod,
      mobile,
      message: message.text,
      sender: header,
      templateId: template.templateId,
      peId: this.config.peId,
      route: this.config.route,
      country: this.config.country,
      username: this.config.username,
      password: this.config.password,
      apiKey: this.config.apiKey,
    });
  }
}

const createSmsProvider = (config) => {
  if (config.provider === SMS_PROVIDER_NAMES.APITXT) return new ApitxtSmsProvider(config);
  throw new SmsConfigurationError(`Unsupported SMS provider: ${config.provider}`);
};

module.exports = { ApitxtSmsProvider, createSmsProvider };
