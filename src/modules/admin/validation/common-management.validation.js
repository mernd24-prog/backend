const Joi = require("joi");

const listQuery = Joi.object({
  q: Joi.string().allow(""),
  keyWord: Joi.string().allow(""),
  search: Joi.string().allow(""),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  size: Joi.number().integer().min(1).max(100),
  countryId: Joi.string(),
  country_code: Joi.string(),
  stateId: Joi.string(),
  state_code: Joi.string(),
  taxId: Joi.string(),
  tax_id: Joi.string(),
  active: Joi.boolean(),
});

const idList = Joi.alternatives().try(
  Joi.string(),
  Joi.array().items(Joi.string()).min(1),
);

const listSchema = Joi.object({
  body: Joi.object({}).required(),
  query: listQuery.required(),
  params: Joi.object({}).required(),
});

const statusSchema = Joi.object({
  body: Joi.object({
    ids: idList,
    _id: idList,
    isDisable: Joi.boolean().required(),
  })
    .or("ids", "_id")
    .required(),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const deleteSchema = Joi.object({
  body: Joi.object({
    ids: idList,
    _id: idList,
  }).default({}),
  query: Joi.object({}).required(),
  params: Joi.object({}).required(),
});

const idParam = (name) =>
  Joi.object({
    body: Joi.object({}).default({}),
    query: Joi.object({}).required(),
    params: Joi.object({
      [name]: Joi.string().required(),
    }).required(),
  });

const countryBody = {
  name: Joi.string().trim().required(),
  code: Joi.string().trim().required(),
  dialCode: Joi.string().allow("", null),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const countryUpdateBody = {
  name: Joi.string().trim(),
  code: Joi.string().trim(),
  dialCode: Joi.string().allow("", null),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const stateBody = {
  name: Joi.string().trim().required(),
  countryId: Joi.string(),
  country_code: Joi.string(),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const stateUpdateBody = {
  name: Joi.string().trim(),
  countryId: Joi.string(),
  country_code: Joi.string(),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const cityBody = {
  name: Joi.string().trim().required(),
  countryId: Joi.string(),
  country_code: Joi.string(),
  stateId: Joi.string(),
  state_code: Joi.string(),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const cityUpdateBody = {
  name: Joi.string().trim(),
  countryId: Joi.string(),
  country_code: Joi.string(),
  stateId: Joi.string(),
  state_code: Joi.string(),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const taxBody = {
  name: Joi.string().trim().required(),
  countryId: Joi.string(),
  country_code: Joi.string(),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const taxUpdateBody = {
  name: Joi.string().trim(),
  countryId: Joi.string(),
  country_code: Joi.string(),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const subTaxBody = {
  name: Joi.string().trim().required(),
  percentage: Joi.number().min(0).max(100),
  percent: Joi.number().min(0).max(100),
  taxId: Joi.string(),
  tax_id: Joi.string(),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const subTaxUpdateBody = {
  name: Joi.string().trim(),
  percentage: Joi.number().min(0).max(100),
  percent: Joi.number().min(0).max(100),
  taxId: Joi.string(),
  tax_id: Joi.string(),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const taxRuleBody = {
  description: Joi.string().trim().required(),
  taxId: Joi.string(),
  tax_id: Joi.string(),
  subTaxIds: Joi.array().items(Joi.string()),
  subTaxes_id: Joi.array().items(Joi.string()),
  category_id: Joi.string().allow("", null),
  category: Joi.string().allow("", null),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
  metadata: Joi.object(),
};

const taxRuleUpdateBody = {
  description: Joi.string().trim(),
  taxId: Joi.string(),
  tax_id: Joi.string(),
  subTaxIds: Joi.array().items(Joi.string()),
  subTaxes_id: Joi.array().items(Joi.string()),
  category_id: Joi.string().allow("", null),
  category: Joi.string().allow("", null),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
  metadata: Joi.object(),
};

const zipCodeBody = {
  zipCode: Joi.string().trim().required(),
  areaName: Joi.string().allow("", null),
  countryId: Joi.string().required(),
  stateId: Joi.string().required(),
  cityId: Joi.string().required(),
  latitude: Joi.number().allow(null),
  longitude: Joi.number().allow(null),
  serviceable: Joi.boolean(),
  codAvailable: Joi.boolean(),
  expressDelivery: Joi.boolean(),
  deliveryCharge: Joi.number().min(0),
  minOrderAmount: Joi.number().min(0),
  estimatedDeliveryDays: Joi.number().integer().min(1),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const zipCodeUpdateBody = {
  zipCode: Joi.string().trim(),
  areaName: Joi.string().allow("", null),
  countryId: Joi.string(),
  stateId: Joi.string(),
  cityId: Joi.string(),
  latitude: Joi.number().allow(null),
  longitude: Joi.number().allow(null),
  serviceable: Joi.boolean(),
  codAvailable: Joi.boolean(),
  expressDelivery: Joi.boolean(),
  deliveryCharge: Joi.number().min(0),
  minOrderAmount: Joi.number().min(0),
  estimatedDeliveryDays: Joi.number().integer().min(1),
  active: Joi.boolean(),
  isDisable: Joi.boolean(),
};

const toBodySchema = (body) =>
  body && typeof body.validate === "function" ? body : Joi.object(body);

const createSchema = (body) =>
  Joi.object({
    body: toBodySchema(body).required(),
    query: Joi.object({}).required(),
    params: Joi.object({}).required(),
  });

const updateSchema = (paramName, body) =>
  Joi.object({
    body: toBodySchema(body).min(1).required(),
    query: Joi.object({}).required(),
    params: Joi.object({
      [paramName]: Joi.string().required(),
    }).required(),
  });

module.exports = {
  listSchema,
  statusSchema,
  deleteSchema,
  countryParamSchema: idParam("countryId"),
  createCountrySchema: createSchema(countryBody),
  updateCountrySchema: updateSchema("countryId", countryUpdateBody),
  stateParamSchema: idParam("stateId"),
  createStateSchema: createSchema(Joi.object(stateBody).or("countryId", "country_code")),
  updateStateSchema: updateSchema("stateId", stateUpdateBody),
  cityParamSchema: idParam("cityId"),
  createCitySchema: createSchema(Joi.object(cityBody).or("stateId", "state_code")),
  updateCitySchema: updateSchema("cityId", cityUpdateBody),
  taxParamSchema: idParam("taxId"),
  createTaxSchema: createSchema(taxBody),
  updateTaxSchema: updateSchema("taxId", taxUpdateBody),
  subTaxParamSchema: idParam("subTaxId"),
  createSubTaxSchema: createSchema(Joi.object(subTaxBody).or("taxId", "tax_id")),
  updateSubTaxSchema: updateSchema("subTaxId", subTaxUpdateBody),
  taxRuleParamSchema: idParam("taxRuleId"),
  createTaxRuleSchema: createSchema(Joi.object(taxRuleBody).or("taxId", "tax_id")),
  updateTaxRuleSchema: updateSchema("taxRuleId", taxRuleUpdateBody),
  zipCodeParamSchema: idParam("zipCodeId"),
  createZipCodeSchema: createSchema(zipCodeBody),
  updateZipCodeSchema: updateSchema("zipCodeId", zipCodeUpdateBody),
};
