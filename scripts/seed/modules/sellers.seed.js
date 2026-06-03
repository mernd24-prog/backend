'use strict';

/**
 * Sellers Seed Module
 * Populates User collection (role=SELLER) + seller_kyc PostgreSQL table
 * 500 realistic Indian sellers with KYC, bank details, addresses
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const SeedLogger = require('../utils/seed-logger');

// ─── Data pools ────────────────────────────────────────────────────────────
const BUSINESS_PREFIXES = ['Tech','Digital','Smart','Prime','Elite','Pro','Global','Metro','Star','Bright','Swift','Best','Top','Power','Sky','Sun','Modern','Quality','Shree','Jai','Majestic','Heritage','Royal','Grand','Supreme','Pioneer','Dynamic','Excel','Vision','Future'];
const BUSINESS_SUFFIXES = ['Enterprises','Solutions','Traders','Commerce','Retail','Distribution','Ventures','Industries','Holdings','Group','Services','Store','Shop','Mart','Market','Bazaar','Palace','Hub','Zone','World'];
const CITIES = ['Mumbai','Delhi','Bengaluru','Chennai','Hyderabad','Pune','Ahmedabad','Kolkata','Jaipur','Surat','Lucknow','Nagpur','Patna','Indore','Bhopal','Vadodara','Coimbatore','Visakhapatnam','Ludhiana','Agra'];
const STATES = ['MH','DL','KA','TN','TG','MH','GJ','WB','RJ','GJ','UP','MH','BR','MP','MP','GJ','TN','AP','PB','UP'];
const BUSINESS_TYPES = ['Sole Proprietor','Partnership','Private Limited','LLP','Public Limited'];
const CATEGORIES = [
  ['electronics','computers'],['mens-fashion','womens-fashion'],['beauty','health-wellness'],
  ['appliances','home-kitchen'],['footwear','bags-luggage'],['furniture'],
  ['food-beverages'],['sports'],['toys'],['automotive'],
  ['jewelry','watches'],['books','office-stationery'],['gaming'],['pet-supplies'],
];
const BANK_NAMES = ['State Bank of India','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra Bank','Punjab National Bank','Bank of Baroda','Canara Bank','IndusInd Bank','Yes Bank','Federal Bank','South Indian Bank','Union Bank of India','Indian Bank','UCO Bank'];
const IFSC_PREFIXES = { 'State Bank of India':'SBIN','HDFC Bank':'HDFC','ICICI Bank':'ICIC','Axis Bank':'UTIB','Kotak Mahindra Bank':'KKBK','Punjab National Bank':'PUNB','Bank of Baroda':'BARB','Canara Bank':'CNRB','IndusInd Bank':'INDB','Yes Bank':'YESB','Federal Bank':'FDRL','South Indian Bank':'SIBL','Union Bank of India':'UBIN','Indian Bank':'IDIB','UCO Bank':'UCBA' };
const STATE_GST_CODES = { MH:'27',DL:'07',KA:'29',TN:'33',TG:'36',GJ:'24',WB:'19',RJ:'08',UP:'09',BR:'10',MP:'23',AP:'28',PB:'03',HR:'06',KL:'32',AS:'18',OD:'21',CG:'22',UK:'05',JH:'20' };
const GENDERS = ['Male','Female'];
const FIRST_NAMES = ['Rahul','Priya','Amit','Divya','Vikram','Sneha','Arjun','Pooja','Harsh','Neha','Rajesh','Anita','Suresh','Kiran','Vivek','Meera','Ravi','Sonia','Arun','Kavya','Manish','Deepa','Nitin','Swati','Sanjay'];
const LAST_NAMES = ['Kumar','Sharma','Patel','Singh','Verma','Gupta','Shah','Mehta','Joshi','Desai','Iyer','Nair','Kapoor','Malhotra','Khanna','Rao','Reddy','Pillai','Bose','Agarwal','Saxena','Tiwari','Mishra','Srivastava','Yadav'];
const DOMAINS = ['gmail.com','yahoo.com','outlook.com','hotmail.com','business.in'];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randPhone = () => `+91${String(randNum(7000000000, 9999999999))}`;
const randPin = () => String(randNum(110000, 799999));

function genGSTIN(stateCode) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pan5 = Array.from({length: 5}, () => letters[randNum(0, 25)]).join('');
  const pan4 = String(randNum(1000, 9999));
  const panLast = letters[randNum(0, 25)];
  return `${String(stateCode).padStart(2,'0')}${pan5}${pan4}${panLast}1Z${randNum(0,9)}`;
}

function genPAN() {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({length:5},()=>L[randNum(0,25)]).join('') + String(randNum(1000,9999)) + L[randNum(0,25)];
}

function genIFSC(bankName) {
  const prefix = IFSC_PREFIXES[bankName] || 'SBIN';
  return `${prefix}0${String(randNum(100000, 999999))}`;
}

async function hashPassword(pwd) {
  return bcrypt.hash(pwd, 10);
}

class SellersSeed {
  constructor() {
    this.logger = new SeedLogger('Sellers');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info('👨‍💼 Seeding Sellers — 500 verified Indian sellers');

    // Clear previous sellers (only SELLER role)
    await conn.collection('users').deleteMany({ role: 'SELLER' });

    const passwordHash = await hashPassword('Seller@123456');
    const sellers = [];

    for (let i = 0; i < 500; i++) {
      const cityIndex = i % CITIES.length;
      const city = CITIES[cityIndex];
      const stateCode = STATES[cityIndex];
      const gstStateCode = STATE_GST_CODES[stateCode] || '27';
      const businessType = rand(BUSINESS_TYPES);
      const businessName = `${rand(BUSINESS_PREFIXES)} ${rand(BUSINESS_SUFFIXES)}`;
      const firstName = rand(FIRST_NAMES);
      const lastName = rand(LAST_NAMES);
      const emailLocal = `seller${(i + 1).toString().padStart(3,'0')}.${firstName.toLowerCase()}`;
      const email = `${emailLocal}@${rand(DOMAINS)}`;
      const phone = randPhone();
      const gstin = genGSTIN(gstStateCode);
      const pan = genPAN();
      const bankName = rand(BANK_NAMES);
      const sellerCategories = rand(CATEGORIES);
      const accountNumber = String(randNum(10000000000, 99999999999));
      const pincode = randPin();

      sellers.push({
        _id: new mongoose.Types.ObjectId(),
        email,
        phone,
        passwordHash,
        role: 'SELLER',
        profile: {
          firstName,
          lastName,
          displayName: `${firstName} ${lastName}`,
          avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${firstName}${lastName}`,
        },
        accountStatus: 'ACTIVE',
        emailVerified: true,
        phoneVerified: true,
        sellerProfile: {
          businessName,
          displayName: businessName,
          legalBusinessName: businessName,
          businessType,
          registrationNumber: `REG${String(randNum(100000, 999999))}`,
          gstin,
          panNumber: pan,
          supportEmail: `support@${businessName.toLowerCase().replace(/\s+/g, '')}.com`,
          supportPhone: randPhone(),
          businessWebsite: `https://www.${businessName.toLowerCase().replace(/\s+/g, '-')}.com`,
          categorySpecializations: sellerCategories,
          bankDetails: {
            accountNumber,
            ifscCode: genIFSC(bankName),
            accountHolderName: `${firstName} ${lastName}`,
            bankName,
            accountType: 'Current',
          },
          businessAddress: {
            line1: `${randNum(1, 999)}, ${rand(['MG Road','Gandhi Nagar','Industrial Area','Sector 5','Civil Lines','Old Town','New Colony'])}`,
            line2: `${rand(['Near Railway Station','Opp. Bus Stand','',`${rand(['Phase 1','Block A','Tower B','Ring Road','NH44'])}`,'']).trim()}`,
            city,
            state: stateCode,
            country: 'India',
            pincode,
          },
          pickupAddress: {
            line1: `Warehouse ${randNum(1, 20)}, ${rand(['Industrial Estate','MIDC Area','Logistics Park','Storage Zone'])}`,
            line2: `${city} ${stateCode}`,
            city,
            state: stateCode,
            country: 'India',
            pincode,
          },
          kycStatus: 'VERIFIED',
          bankVerificationStatus: 'VERIFIED',
          goLiveStatus: 'LIVE',
          onboardingChecklist: {
            profileCompleted: true,
            kycSubmitted: true,
            gstVerified: true,
            bankLinked: true,
            firstProductPublished: true,
          },
          sellerTier: ['Standard','Silver','Gold','Platinum'][i % 4],
          avgRating: parseFloat((3.5 + Math.random() * 1.5).toFixed(1)),
          totalOrders: randNum(50, 10000),
          totalProducts: randNum(10, 500),
          positiveReviews: randNum(30, 95),
          joinedAt: new Date(Date.now() - randNum(90, 1460) * 86400000),
        },
        sellerSettings: {
          autoAcceptOrders: Math.random() > 0.3,
          handlingTimeHours: rand([24, 48, 72]),
          returnWindowDays: rand([7, 10, 15, 30]),
          shippingModes: ['standard', 'express'],
          payoutSchedule: rand(['weekly', 'bi-weekly', 'monthly']),
          holidayMode: false,
        },
        createdAt: new Date(Date.now() - randNum(90, 1460) * 86400000),
        updatedAt: new Date(),
      });
    }

    const BATCH = 100;
    for (let i = 0; i < sellers.length; i += BATCH) {
      await conn.collection('users').insertMany(sellers.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, sellers.length - i));
    }

    // PostgreSQL seller_kyc table
    try {
      const { sequelize } = require('../../../src/infrastructure/sequelize/sequelize-client');
      const { DataTypes } = require('sequelize');
      const SellerKYC = sequelize.define('SellerKYC', {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv4() },
        seller_id: { type: DataTypes.STRING, allowNull: false },
        pan_number: { type: DataTypes.STRING(12) },
        gst_number: { type: DataTypes.STRING(20) },
        legal_name: { type: DataTypes.STRING(200) },
        business_type: { type: DataTypes.STRING(50) },
        status: { type: DataTypes.STRING(30), defaultValue: 'approved' },
      }, { tableName: 'seller_kyc', timestamps: true, underscored: true });

      const kycDocs = sellers.map(s => ({
        id: uuidv4(),
        seller_id: s._id.toString(),
        pan_number: s.sellerProfile.panNumber,
        gst_number: s.sellerProfile.gstin,
        legal_name: s.sellerProfile.legalBusinessName,
        business_type: s.sellerProfile.businessType,
        status: 'approved',
      }));

      for (let i = 0; i < kycDocs.length; i += 100) {
        await SellerKYC.bulkCreate(kycDocs.slice(i, i + 100), { validate: false, ignoreDuplicates: true });
      }
      this.logger.info(`✓ Inserted ${kycDocs.length} KYC records into PostgreSQL`);
    } catch (pgErr) {
      this.logger.warn(`PostgreSQL KYC insert skipped: ${pgErr.message}`);
    }

    this.logger.printStats();
    return { created: sellers.length };
  }
}

module.exports = SellersSeed;
