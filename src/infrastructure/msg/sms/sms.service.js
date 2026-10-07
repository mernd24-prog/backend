const { logger } = require("../../../shared/logger/logger");
const { smsConfig } = require("./sms.config");
const { SMS_TEMPLATES } = require("./sms.templates");
const { createSmsProvider } = require("./sms.provider");
const { SmsConfigurationError } = require("./sms.errors");
const { normalizeMobile, validateTemplateRequest } = require("./sms.validator");

const maskMobile = (mobile) => `${mobile.slice(0, 2)}****${mobile.slice(-4)}`;

class SmsService {
  constructor({ config = smsConfig, templates = SMS_TEMPLATES, provider } = {}) {
    this.config = config;
    this.templates = templates;
    this.provider = provider || null;
  }

  async sendTemplate({ template: templateKey, mobile, variables = {}, idempotencyKey } = {}) {
    const template = this.templates[templateKey];
    const diagnostic = {
      provider: this.config.provider,
      templateKey,
      templateId: template?.templateId || null,
      providerTemplateReference: this.config.otpProviderTemplates?.[templateKey]?.referenceId || null,
      header: this.config.headers[template?.header] || null,
      smsEnabled: this.config.enabled,
      enforceDlt: this.config.enforceDlt,
      hasApiKey: Boolean(this.config.apiKey),
      hasPeId: Boolean(this.config.peId),
      variableNames: Object.keys(variables),
      validityMinutes: variables.validityMinutes,
      headerHasLowercase: /[a-z]/.test(this.config.headers[template?.header] || ""),
    };
    logger.debug(diagnostic, "SMS template configuration selected");
    try {
      if (!this.config.enabled) throw new SmsConfigurationError("SMS delivery is disabled");
      validateTemplateRequest({ templateKey, template, variables, config: this.config });
    } catch (error) {
      logger.warn({ ...diagnostic, errorType: error.name, missingVariableNames: template?.variables.filter((name) => variables[name] === undefined || variables[name] === null || String(variables[name]).trim() === ""), hasTemplate: Boolean(template) }, "SMS template validation failed; check template variables and DLT configuration");
      throw error;
    }
    let normalizedMobile;
    let text;
    let provider;
    try {
      normalizedMobile = normalizeMobile(mobile, this.config.country);
      text = template.buildMessage(variables);
      provider = this.provider || createSmsProvider(this.config);
    } catch (error) {
      logger.warn({ ...diagnostic, errorType: error.name }, "SMS mobile normalization, rendering or provider setup failed");
      throw error;
    }
    logger.info({ provider: provider.name, templateKey, category: template.category, headerType: template.header, mobile: maskMobile(normalizedMobile), idempotencyKey: idempotencyKey || null }, "SMS template delivery requested");
    try {
      const response = await provider.send({
        mobile: normalizedMobile,
        message: { text, variables },
        template,
        templateKey,
        header: this.config.headers[template.header],
        idempotencyKey,
      });
      logger.info({ provider: provider.name, templateKey, mobile: maskMobile(normalizedMobile), requestId: response?.requestId || null }, "SMS template delivered to provider");
      return { success: true, provider: provider.name, template: templateKey, requestId: response?.requestId || null, providerResponse: response?.providerResponse || response };
    } catch (error) {
      logger.error({ ...diagnostic, errorType: error.name, statusCode: error.statusCode || null, providerCode: error.providerCode || null, retryable: error.retryable === true, mobile: maskMobile(normalizedMobile) }, "SMS template delivery failed");
      throw error;
    }
  }
}

const smsService = new SmsService();
module.exports = { SmsService, smsService };
