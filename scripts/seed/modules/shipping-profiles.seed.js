'use strict';

const { v4: uuidv4 } = require('uuid');
const SeedLogger = require('../utils/seed-logger');
const { UserModel } = require('../../../src/modules/user/models/user.model');
const { ProductModel } = require('../../../src/modules/product/models/product.model');
const { ROLES } = require('../../../src/shared/constants/roles');
const { knex } = require('../../../src/infrastructure/postgres/postgres-client');
const { ShippingProfile } = require('../../../src/modules/delivery/models/shipping-profile.model');

const SEED_TAG = 'master-seed-shipping-profiles-v1';
const SYSTEM_ACTOR = 'master-seed';

const PROFILE_TEMPLATES = [
  {
    key: 'standard-all-india',
    name: 'Standard All India',
    description: 'Default all-India delivery profile for regular seller products.',
    shippingMethod: 'standard',
    serviceabilityMode: 'all_india',
    allowedStates: [],
    allowedCities: [],
    allowedPincodes: [],
    blockedPincodes: [],
    codAvailable: true,
    shippingCharge: 49,
    freeShippingThreshold: 999,
    etaMin: 3,
    etaMax: 6,
    isDefault: true,
    active: true,
  },
  {
    key: 'express-metro',
    name: 'Express Metro',
    description: 'Express profile for major metro cities.',
    shippingMethod: 'express',
    serviceabilityMode: 'selected_cities',
    allowedStates: ['Karnataka', 'Maharashtra', 'Delhi', 'Tamil Nadu', 'Telangana'],
    allowedCities: ['Bengaluru', 'Mumbai', 'New Delhi', 'Chennai', 'Hyderabad'],
    allowedPincodes: [],
    blockedPincodes: [],
    codAvailable: true,
    shippingCharge: 99,
    freeShippingThreshold: 2499,
    etaMin: 1,
    etaMax: 3,
    isDefault: false,
    active: true,
  },
  {
    key: 'prepaid-heavy-high-value',
    name: 'Prepaid Heavy and High Value',
    description: 'Higher-charge profile for heavy or high-value products with COD disabled.',
    shippingMethod: 'standard',
    serviceabilityMode: 'block_pincodes',
    allowedStates: [],
    allowedCities: [],
    allowedPincodes: [],
    blockedPincodes: ['180001', '190001', '744101'],
    codAvailable: false,
    shippingCharge: 149,
    freeShippingThreshold: 4999,
    etaMin: 4,
    etaMax: 8,
    isDefault: false,
    active: true,
  },
];

class ShippingProfilesSeed {
  constructor() {
    this.logger = new SeedLogger('ShippingProfiles');
    this.assignProducts = hasFlag('--assign-products');
    this.sellerId = getArgValue('--seller-id');
    this.organizationId = getArgValue('--organization-id');
    this.limit = Number(getArgValue('--limit') || 100);
    this.defaultProfiles = [];
  }

  async execute() {
    this.logger.info('Seeding seller shipping profiles', {
      assignProducts: this.assignProducts,
      sellerId: this.sellerId || null,
      organizationId: this.organizationId || null,
    });

    const sellers = await this.getSellers();
    if (!sellers.length) {
      this.logger.warn('No sellers found. Run npm run seed:sellers first.');
      return { created: 0, updated: 0, skipped: 1 };
    }

    const organizationsBySeller = await this.getOrganizationsBySeller(
      sellers.map((seller) => String(seller._id)),
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const seller of sellers) {
      const sellerId = String(seller._id);
      const organizations = this.resolveTargetOrganizations(sellerId, organizationsBySeller);
      if (!organizations.length) {
        this.logger.warn(`No target organization resolved for seller ${seller.email || sellerId}`);
        skipped += 1;
        continue;
      }

      for (const organization of organizations) {
        const templates = [
          ...PROFILE_TEMPLATES,
          ...this.buildLocalTemplates(seller),
        ];

        for (const template of templates) {
          const result = await this.upsertProfile(seller, organization, template);
          created += result.created;
          updated += result.updated;
          skipped += result.skipped;
        }
      }
    }

    let productsUpdated = 0;
    if (this.assignProducts) {
      productsUpdated = await this.assignDefaultProfilesToProducts();
    }

    this.logger.stats.created += created;
    this.logger.stats.updated += updated;
    this.logger.stats.skipped += skipped;
    this.logger.printStats();

    return {
      created,
      updated,
      skipped,
      productsUpdated,
    };
  }

  async getSellers() {
    const baseQuery = {
      role: ROLES.SELLER,
      ...(this.sellerId ? { _id: this.sellerId } : {}),
    };

    const liveQuery = {
      ...baseQuery,
      'sellerProfile.goLiveStatus': 'live',
    };

    let sellers = await UserModel.find(liveQuery)
      .select('_id email sellerProfile sellerSettings accountStatus')
      .limit(this.limit)
      .lean();

    if (!sellers.length && !this.sellerId) {
      sellers = await UserModel.find(baseQuery)
        .select('_id email sellerProfile sellerSettings accountStatus')
        .limit(this.limit)
        .lean();
    }

    return sellers;
  }

  async getOrganizationsBySeller(sellerIds) {
    if (!sellerIds.length) return new Map();

    const rows = await knex('seller_organizations')
      .whereIn('seller_id', sellerIds)
      .modify((builder) => {
        if (this.organizationId) builder.where('id', this.organizationId);
      })
      .orderBy([
        { column: 'seller_id', order: 'asc' },
        { column: 'is_default', order: 'desc' },
        { column: 'created_at', order: 'asc' },
      ])
      .catch((error) => {
        this.logger.warn('Unable to read seller_organizations; creating seller-level profiles only', {
          message: error.message,
        });
        return [];
      });

    return rows.reduce((map, row) => {
      const sellerId = String(row.seller_id || '');
      if (!sellerId) return map;
      if (!map.has(sellerId)) map.set(sellerId, []);
      map.get(sellerId).push(row);
      return map;
    }, new Map());
  }

  resolveTargetOrganizations(sellerId, organizationsBySeller) {
    const organizations = organizationsBySeller.get(sellerId) || [];
    if (organizations.length) return organizations;
    if (this.organizationId) return [];
    return [null];
  }

  buildLocalTemplates(seller) {
    const address = seller.sellerProfile?.pickupAddress || seller.sellerProfile?.businessAddress || {};
    const pincode = String(address.postalCode || address.pincode || '').trim();
    if (!/^\d{4,10}$/.test(pincode)) return [];

    return [{
      key: 'local-same-day',
      name: 'Local Same Day',
      description: 'Same-day profile for the seller pickup pincode.',
      shippingMethod: 'same_day',
      serviceabilityMode: 'selected_pincodes',
      allowedStates: [],
      allowedCities: [],
      allowedPincodes: [pincode],
      blockedPincodes: [],
      codAvailable: true,
      shippingCharge: 79,
      freeShippingThreshold: 1999,
      etaMin: 0,
      etaMax: 1,
      isDefault: false,
      active: true,
    }];
  }

  async upsertProfile(seller, organization, template) {
    const sellerId = String(seller._id);
    const organizationId = organization?.id || null;
    const where = {
      sellerId,
      organizationId,
      name: template.name,
    };

    if (template.isDefault) {
      await ShippingProfile.update(
        { isDefault: false, updatedBy: SYSTEM_ACTOR },
        { where: { sellerId, organizationId, isDefault: true } },
      );
    }

    const existing = await ShippingProfile.findOne({ where });
    const payload = this.buildProfilePayload(seller, organization, template, existing);

    if (existing) {
      await existing.update(payload);
      if (payload.isDefault) this.defaultProfiles.push({ sellerId, organizationId, profileId: existing.id });
      return { created: 0, updated: 1, skipped: 0 };
    }

    const created = await ShippingProfile.create({
      id: uuidv4(),
      ...payload,
      createdBy: SYSTEM_ACTOR,
    });
    if (payload.isDefault) this.defaultProfiles.push({ sellerId, organizationId, profileId: created.id });
    return { created: 1, updated: 0, skipped: 0 };
  }

  buildProfilePayload(seller, organization, template, existing) {
    const existingJson = existing?.toJSON ? existing.toJSON() : existing;
    const metadata = {
      ...(existingJson?.metadata || {}),
      seedTag: SEED_TAG,
      templateKey: template.key,
      sellerEmail: seller.email || null,
      organizationId: organization?.id || null,
      organizationName: organization?.store_display_name || organization?.legal_business_name || null,
    };

    return {
      sellerId: String(seller._id),
      organizationId: organization?.id || null,
      name: template.name,
      description: template.description,
      shippingMethod: template.shippingMethod,
      serviceabilityMode: template.serviceabilityMode,
      allowedStates: template.allowedStates,
      allowedCities: template.allowedCities,
      allowedPincodes: template.allowedPincodes,
      blockedPincodes: template.blockedPincodes,
      codAvailable: template.codAvailable,
      shippingCharge: template.shippingCharge,
      freeShippingThreshold: template.freeShippingThreshold,
      etaMin: template.etaMin,
      etaMax: template.etaMax,
      isDefault: template.isDefault,
      active: template.active,
      metadata,
      updatedBy: SYSTEM_ACTOR,
    };
  }

  async assignDefaultProfilesToProducts() {
    let productsUpdated = 0;
    const seen = new Set();

    for (const { sellerId, organizationId, profileId } of this.defaultProfiles) {
      const key = `${sellerId}:${organizationId || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const filter = {
        sellerId,
        ...(organizationId ? { organizationId } : {}),
        $or: [
          { 'shipping.shippingProfileId': { $exists: false } },
          { 'shipping.shippingProfileId': null },
          { 'shipping.shippingProfileId': '' },
        ],
      };

      const result = await ProductModel.updateMany(filter, {
        $set: {
          'shipping.shippingProfileId': profileId,
          lastUpdatedBy: SYSTEM_ACTOR,
        },
      });
      productsUpdated += result.modifiedCount || 0;
    }

    this.logger.info('Assigned default shipping profiles to products', { productsUpdated });
    return productsUpdated;
  }
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : '';
}

module.exports = ShippingProfilesSeed;
