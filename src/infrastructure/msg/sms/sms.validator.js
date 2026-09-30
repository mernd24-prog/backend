const { SmsConfigurationError, SmsTemplateError } = require("./sms.errors");

const normalizeMobile = (mobile = "", country = "91") => {
  let value = String(mobile || "").replace(/\D/g, "");
  if (value.length === 10) value = `${country}${value}`;
  if (!/^\d{11,15}$/.test(value)) {
    throw new SmsTemplateError("A valid mobile number with country code is required");
  }
  return value;
};

const validateTemplateRequest = ({ templateKey, template, variables, config }) => {
  if (!template) throw new SmsTemplateError(`Unknown SMS template key: ${templateKey}`);
  const missingVariables = template.variables.filter((name) => (
    variables?.[name] === undefined || variables?.[name] === null || String(variables[name]).trim() === ""
  ));
  if (missingVariables.length) {
    throw new SmsTemplateError(`Missing SMS template variables: ${missingVariables.join(", ")}`, { templateKey, missingVariables });
  }
  const unknownVariables = Object.keys(variables || {}).filter((name) => !template.variables.includes(name));
  if (unknownVariables.length) {
    throw new SmsTemplateError(`Unexpected SMS template variables: ${unknownVariables.join(", ")}`, { templateKey, unknownVariables });
  }
  if (config.enforceDlt) {
    const missing = [];
    if (!config.peId) missing.push("DLT_PE_ID");
    if (!template.templateId) missing.push(`DLT template ID for ${templateKey}`);
    if (!config.headers[template.header]) missing.push(`DLT header ${template.header}`);
    if (missing.length) throw new SmsConfigurationError(`SMS/DLT configuration is incomplete: ${missing.join(", ")}`, { templateKey, missing });
  }
};

module.exports = { normalizeMobile, validateTemplateRequest };
