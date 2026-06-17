'use strict';

const SeedLogger = require('../utils/seed-logger');
const { UserModel } = require('../../../src/modules/user/models/user.model');
const { ROLES } = require('../../../src/shared/constants/roles');
const { hashText } = require('../../../src/shared/tools/hash');

const SEED_TAG = 'master-seed-customers-v1';
const PASSWORD = process.env.SEED_PASSWORD || 'Password@123';
const DEFAULT_COUNT = Number(process.env.SEED_CUSTOMERS_COUNT || 50);

const firstNames = ['Aarav', 'Neha', 'Isha', 'Rohan', 'Meera', 'Kabir', 'Anika', 'Vivaan', 'Tara', 'Dev'];
const lastNames = ['Sharma', 'Rao', 'Kapoor', 'Mehta', 'Iyer', 'Nair', 'Patel', 'Singh', 'Das', 'Verma'];
const pincodes = ['560001', '560038', '560076', '560102', '110001', '400001', '411001', '600001'];

class CustomersSeed {
  constructor() {
    this.logger = new SeedLogger('Customers');
  }

  async execute() {
    this.logger.info('Seeding marketplace customers');
    const passwordHash = await hashText(PASSWORD);
    const now = new Date();
    const operations = [];

    for (let index = 0; index < DEFAULT_COUNT; index += 1) {
      const firstName = firstNames[index % firstNames.length];
      const lastName = lastNames[index % lastNames.length];
      const email = `seed.buyer${String(index + 1).padStart(3, '0')}@example.com`;
      const postalCode = pincodes[index % pincodes.length];

      operations.push({
        updateOne: {
          filter: { email },
          update: {
            $set: {
              email,
              phone: `910300${String(index + 1).padStart(4, '0')}`,
              passwordHash,
              role: ROLES.BUYER,
              accountStatus: 'active',
              emailVerified: true,
              profile: { firstName, lastName },
              referralCode: `BUYERSEED${String(index + 1).padStart(3, '0')}`,
              addresses: [
                {
                  label: 'home',
                  fullName: `${firstName} ${lastName}`,
                  phone: `910300${String(index + 1).padStart(4, '0')}`,
                  line1: `${100 + index}, Seed Market Road`,
                  line2: 'Near Metro Station',
                  city: postalCode.startsWith('56') ? 'Bengaluru' : postalCode.startsWith('40') ? 'Mumbai' : 'Delhi',
                  state: postalCode.startsWith('56') ? 'Karnataka' : postalCode.startsWith('40') ? 'Maharashtra' : 'Delhi',
                  country: 'India',
                  postalCode,
                  isDefault: true,
                },
              ],
            },
            $setOnInsert: {
              authProviders: [],
              refreshSessions: [],
              createdAt: now,
              metadata: { seedTag: SEED_TAG },
            },
          },
          upsert: true,
        },
      });
    }

    await UserModel.bulkWrite(operations, { ordered: false });
    this.logger.recordBatch(operations.length);
    this.logger.printStats();
    return { created: operations.length };
  }
}

module.exports = CustomersSeed;
