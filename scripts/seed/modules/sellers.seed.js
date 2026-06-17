'use strict';

const SeedLogger = require('../utils/seed-logger');
const { UserModel } = require('../../../src/modules/user/models/user.model');
const { ROLES } = require('../../../src/shared/constants/roles');
const { hashText } = require('../../../src/shared/tools/hash');

const SEED_TAG = 'master-seed-sellers-v1';
const PASSWORD = process.env.SEED_PASSWORD || 'Password@123';

const sellerRows = [
  ['seed.techseller@example.com', 'TechNova Retail', '29TECHS1234F1Z5', '560001'],
  ['seed.styleseller@example.com', 'Urban Loom Studio', '29STYLE1234F1Z5', '560038'],
  ['seed.homeseller@example.com', 'HomeCraft Bazaar', '29HOMEA1234F1Z5', '560076'],
  ['seed.beautyseller@example.com', 'GlowGrid Beauty', '29GLOWB1234F1Z5', '560102'],
  ['seed.sportseller@example.com', 'SprintBox Sports', '29SPRTS1234F1Z5', '560066'],
  ['seed.bookseller@example.com', 'PageMint Books', '29BOOKS1234F1Z5', '560004'],
];

class SellersSeed {
  constructor() {
    this.logger = new SeedLogger('Sellers');
  }

  async execute() {
    this.logger.info('Seeding marketplace sellers');
    const passwordHash = await hashText(PASSWORD);
    const now = new Date();

    const operations = sellerRows.map(([email, businessName, gstNumber, postalCode], index) => ({
      updateOne: {
        filter: { email },
        update: {
          $set: {
            email,
            phone: `90020010${String(index + 1).padStart(2, '0')}`,
            passwordHash,
            role: ROLES.SELLER,
            accountStatus: 'active',
            emailVerified: true,
            profile: {
              firstName: businessName.split(' ')[0],
              lastName: 'Seller',
            },
            referralCode: `SELLERSEED${index + 1}`,
            sellerSettings: {
              autoAcceptOrders: true,
              handlingTimeHours: 24,
              returnWindowDays: 7,
              ndrResponseHours: 24,
              shippingModes: ['standard', 'express'],
              payoutSchedule: index % 2 === 0 ? 'weekly' : 'daily',
            },
            sellerProfile: {
              displayName: businessName,
              businessName,
              legalBusinessName: `${businessName} Pvt Ltd`,
              description: `${businessName} seeded seller account for marketplace product, order, shipment, invoice, payout, and analytics flows.`,
              supportEmail: email,
              supportPhone: `90020010${String(index + 1).padStart(2, '0')}`,
              businessType: 'private_limited',
              gstNumber,
              panNumber: `SEEDP${String(index + 1).padStart(4, '0')}Q`,
              profileCompleted: true,
              kycStatus: 'verified',
              bankVerificationStatus: 'verified',
              goLiveStatus: 'live',
              onboardingStatus: 'live',
              onboardingChecklist: {
                profileCompleted: true,
                kycSubmitted: true,
                gstVerified: true,
                bankLinked: true,
                firstProductPublished: true,
              },
              bankDetails: {
                accountHolderName: `${businessName} Pvt Ltd`,
                accountNumber: `50100000000${index + 1}`,
                ifscCode: `HDFC00010${String(index + 1).padStart(2, '0')}`,
                bankName: 'HDFC Bank',
                branchName: 'Bengaluru Main',
              },
              businessAddress: sellerAddress(postalCode),
              pickupAddress: sellerAddress(postalCode, 'Dispatch Warehouse'),
              returnAddress: sellerAddress(postalCode, 'Returns Desk'),
              verifiedBy: 'master-seed',
              verifiedAt: now,
              goLiveApprovedBy: 'master-seed',
              goLiveApprovedAt: now,
            },
          },
          $setOnInsert: {
            authProviders: [],
            refreshSessions: [],
            createdAt: now,
          },
        },
        upsert: true,
      },
    }));

    await UserModel.bulkWrite(operations, { ordered: false });
    this.logger.recordBatch(operations.length);
    this.logger.printStats();
    return { created: operations.length };
  }
}

function sellerAddress(postalCode, line1 = 'Seed Commerce Park') {
  return {
    line1,
    line2: 'Industrial Area',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    postalCode,
  };
}

module.exports = SellersSeed;
