'use strict';

const { v4: uuidv4 } = require('uuid');
const SeedLogger = require('../utils/seed-logger');
const { ShippingProfileTemplate } = require('../../../src/modules/delivery/models/shipping-profile-template.model');

const SEED_TAG = 'master-seed-shipping-profile-templates-v1';
const SYSTEM_ACTOR = 'master-seed';

const ALLOWED_TEMPLATE_OVERRIDES = [
  'name',
  'description',
  'shippingMethod',
  'serviceabilityMode',
  'allowedPincodes',
  'codAvailable',
  'shippingCharge',
  'freeShippingThreshold',
  'etaMin',
  'etaMax',
  'isDefault',
  'active',
];

const ADMIN_TEMPLATES = [
  {
    key: 'standard-all-india',
    name: 'Standard All India',
    description: 'Default all-India delivery template for regular seller products.',
    shippingMethod: 'standard',
    serviceabilityMode: 'all_india',
    allowedPincodes: [],
    codAvailable: true,
    shippingCharge: 49,
    freeShippingThreshold: 999,
    etaMin: 3,
    etaMax: 6,
    version: 1,
    status: 'published',
    active: true,
  },
  {
    key: 'express-metro',
    name: 'Express Metro',
    description: 'Express delivery template for selected metro pincodes.',
    shippingMethod: 'express',
    serviceabilityMode: 'selected_pincodes',
    allowedPincodes: ['560001', '400001', '110001', '600001', '500001'],
    codAvailable: true,
    shippingCharge: 99,
    freeShippingThreshold: 2499,
    etaMin: 1,
    etaMax: 3,
    version: 1,
    status: 'published',
    active: true,
  },
  {
    key: 'prepaid-heavy-high-value',
    name: 'Prepaid Heavy and High Value',
    description: 'Higher-charge template for heavy or high-value products with COD disabled.',
    shippingMethod: 'standard',
    serviceabilityMode: 'all_india',
    allowedPincodes: [],
    codAvailable: false,
    shippingCharge: 149,
    freeShippingThreshold: 4999,
    etaMin: 4,
    etaMax: 8,
    version: 1,
    status: 'published',
    active: true,
  },
  {
    key: 'local-same-day',
    name: 'Local Same Day',
    description: 'Same-day local delivery template for sellers that manage nearby fulfillment.',
    shippingMethod: 'same_day',
    serviceabilityMode: 'selected_pincodes',
    allowedPincodes: ['560001'],
    codAvailable: true,
    shippingCharge: 79,
    freeShippingThreshold: 1999,
    etaMin: 0,
    etaMax: 1,
    version: 1,
    status: 'published',
    active: true,
  },
];

class ShippingProfileTemplatesSeed {
  constructor() {
    this.logger = new SeedLogger('ShippingProfileTemplates');
  }

  async execute() {
    this.logger.info('Seeding admin shipping profile templates');

    let created = 0;
    let updated = 0;

    for (const template of ADMIN_TEMPLATES) {
      const existing = await ShippingProfileTemplate.findOne({
        where: {
          name: template.name,
        },
      });
      const payload = this.buildTemplatePayload(template, existing);

      if (existing) {
        await existing.update(payload);
        updated += 1;
        continue;
      }

      await ShippingProfileTemplate.create({
        id: uuidv4(),
        ...payload,
        createdBy: SYSTEM_ACTOR,
      });
      created += 1;
    }

    this.logger.stats.created += created;
    this.logger.stats.updated += updated;
    this.logger.printStats();

    return {
      created,
      updated,
      skipped: 0,
    };
  }

  buildTemplatePayload(template, existing) {
    const existingJson = existing?.toJSON ? existing.toJSON() : existing;
    return {
      name: template.name,
      description: template.description,
      shippingMethod: template.shippingMethod,
      serviceabilityMode: template.serviceabilityMode,
      allowedPincodes: template.allowedPincodes,
      codAvailable: template.codAvailable,
      shippingCharge: template.shippingCharge,
      freeShippingThreshold: template.freeShippingThreshold,
      etaMin: template.etaMin,
      etaMax: template.etaMax,
      allowedOverrides: ALLOWED_TEMPLATE_OVERRIDES,
      version: template.version,
      status: template.status,
      active: template.active,
      metadata: {
        ...(existingJson?.metadata || {}),
        seedTag: SEED_TAG,
        templateKey: template.key,
        templateScope: 'admin',
      },
      updatedBy: SYSTEM_ACTOR,
    };
  }
}

module.exports = ShippingProfileTemplatesSeed;
