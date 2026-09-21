'use strict';

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { v5: uuidv5 } = require('uuid');
const SeedLogger = require('../utils/seed-logger');
const { SellerOrganizationRepository } = require('../../../src/modules/seller/repositories/seller-organization.repository');

const SELLER_COUNT = Number(process.env.SEED_SELLER_COUNT || 180);
const NAMESPACE = '84717b2e-2507-4a4c-a355-ea97dd92d554';
const PREFIXES = ['Aarav', 'Aster', 'BluePeak', 'Cedar', 'Evergreen', 'Indus', 'Kaveri', 'Meridian', 'Northstar', 'Nova', 'Orchid', 'Prism', 'Saffron', 'Summit', 'UrbanNest', 'Vertex', 'Willow', 'Zenith'];
const TRADES = ['Consumer Products', 'Digital Commerce', 'Home Supplies', 'Lifestyle Retail', 'Merchandising', 'Retail Ventures', 'Trading House', 'Wellness Goods'];
const SUFFIXES = ['Private Limited', 'LLP', 'Enterprises', 'Industries'];
const LOCATIONS = [
  ['Bengaluru', 'Karnataka', '560001', 'KA'], ['Mumbai', 'Maharashtra', '400001', 'MH'],
  ['New Delhi', 'Delhi', '110001', 'DL'], ['Hyderabad', 'Telangana', '500001', 'TS'],
  ['Chennai', 'Tamil Nadu', '600001', 'TN'], ['Pune', 'Maharashtra', '411001', 'MH'],
  ['Ahmedabad', 'Gujarat', '380001', 'GJ'], ['Kolkata', 'West Bengal', '700001', 'WB'],
  ['Jaipur', 'Rajasthan', '302001', 'RJ'], ['Kochi', 'Kerala', '682001', 'KL'],
];

const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const gstin = (index, state) => `${String((index % 97) + 1).padStart(2, '0')}ABCDE${String(1000 + index).slice(-4)}F1Z${String(index % 10)}`;
const pan = (index) => `ABCDE${String(1000 + index).slice(-4)}F`;

class SellersSeed {
  constructor() {
    this.logger = new SeedLogger('Sellers');
    this.organizationRepository = new SellerOrganizationRepository();
  }

  async execute() {
    const users = mongoose.connection.collection('users');
    const passwordHash = await bcrypt.hash(process.env.SEED_SELLER_PASSWORD || '  ', 10);
    let created = 0;

    for (let index = 0; index < SELLER_COUNT; index += 1) {
      const legalName = `${PREFIXES[index % PREFIXES.length]} ${TRADES[Math.floor(index / PREFIXES.length) % TRADES.length]} ${SUFFIXES[index % SUFFIXES.length]}`;
      const storeName = legalName.replace(/ Private Limited| LLP| Enterprises| Industries/g, '');
      const slug = `${slugify(storeName)}-${String(index + 1).padStart(3, '0')}`;
      const [city, state, postalCode, stateCode] = LOCATIONS[index % LOCATIONS.length];
      const sellerId = new mongoose.Types.ObjectId(uuidv5(`seller:${index}`, NAMESPACE).replace(/-/g, '').slice(0, 24));
      const organizationId = uuidv5(`organization:${index}`, NAMESPACE);
      const email = `commerce@${slug}.in`;
      const phone = `9${String(100000000 + index * 7919).slice(-9)}`;
      const address = { line1: `${18 + (index % 80)}, ${storeName} Business Centre`, line2: `${['Industrial Layout', 'Market Road', 'Commerce Park'][index % 3]}`, city, state, country: 'India', postalCode };
      const profile = {
        businessName: storeName, displayName: storeName, legalBusinessName: legalName,
        description: `${storeName} is an Indian retail business sourcing verified products with documented quality, fulfilment and after-sales processes.`,
        supportEmail: `support@${slug}.in`, supportPhone: phone, businessType: index % 4 === 0 ? 'llp' : 'private_limited',
        registrationNumber: `U${String(52000 + index)}${stateCode}2018PTC${String(100000 + index)}`,
        gstNumber: gstin(index, stateCode), panNumber: pan(index), businessWebsite: `https://www.${slug}.in`,
        primaryContactName: `${PREFIXES[index % PREFIXES.length]} Operations`, businessAddress: address, pickupAddress: address, returnAddress: address,
        bankDetails: { accountHolderName: legalName, accountNumber: `62${String(1000000000 + index * 1777).slice(-10)}`, ifscCode: `HDFC000${String(100 + index).slice(-3)}`, bankName: 'HDFC Bank', branchName: `${city} Commercial Branch` },
        profileCompleted: true, kycStatus: 'verified', bankVerificationStatus: 'verified', goLiveStatus: 'live', onboardingStatus: 'completed',
        onboardingChecklist: { profileCompleted: true, kycSubmitted: true, gstVerified: true, bankLinked: true, firstProductPublished: true },
      };

      await users.updateOne({ _id: sellerId }, { $set: {
        email, phone, phoneNormalized: `+91${phone}`, phoneVerified: true, passwordHash, role: 'seller',
        profile: { firstName: PREFIXES[index % PREFIXES.length], lastName: 'Commerce', avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(storeName)}&background=0f766e&color=fff` },
        sellerProfile: profile, sellerSettings: { autoAcceptOrders: true, handlingTimeHours: 24 + (index % 3) * 12, ndrResponseHours: 24, shippingModes: ['surface', 'air'], payoutSchedule: 'weekly' },
        emailVerified: true, accountStatus: 'active', allowedModules: ['dashboard', 'products', 'orders', 'inventory', 'payments'], updatedAt: new Date(),
      }, $setOnInsert: { createdAt: new Date(Date.now() - (120 + index) * 86400000) } }, { upsert: true });

      const orgPayload = {
        id: organizationId, sellerId: sellerId.toString(), legalBusinessName: legalName, storeDisplayName: storeName,
        businessType: profile.businessType, description: profile.description, supportEmail: profile.supportEmail, supportPhone: phone,
        registrationNumber: profile.registrationNumber, businessWebsite: profile.businessWebsite, primaryContactName: profile.primaryContactName,
        gstin: profile.gstNumber, pan: profile.panNumber, kycStatus: 'verified', bankVerificationStatus: 'verified', approvalStatus: 'approved',
        bankDetails: profile.bankDetails, billingAddress: address, pickupAddress: address, returnAddress: address,
        taxSettings: { gstRegistered: true, gstInclusivePricing: true }, invoiceSettings: { invoicePrefix: `INV-${String(index + 1).padStart(3, '0')}` },
        payoutSettings: { schedule: 'weekly', settlementCycleDays: 7 }, complianceSettings: { panVerified: true, gstVerified: true },
        metadata: { seedManaged: true, sellerCode: `SLR-${String(index + 1).padStart(4, '0')}`, rating: Number((4.1 + (index % 9) / 10).toFixed(1)), ratingCount: 120 + index * 17 },
        goLiveStatus: 'live', isDefault: true, approvedAt: new Date(), goLiveApprovedAt: new Date(),
      };
      const existing = await this.organizationRepository.findById(organizationId);
      if (existing) await this.organizationRepository.update(organizationId, orgPayload);
      else await this.organizationRepository.create(orgPayload);
      created += 1;
      if (created % 25 === 0) this.logger.recordBatch(25);
    }

    if (created % 25) this.logger.recordBatch(created % 25);
    this.logger.printStats();
    return { created, sellers: created, organizations: created };
  }
}

module.exports = SellersSeed;
