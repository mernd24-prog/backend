'use strict';

/**
 * Customers Seed Module
 * Generates 10,000 Indian customer User documents
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const SeedLogger = require('../utils/seed-logger');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randPhone = () => `+91${String(randNum(7000000000, 9999999999))}`;

const FIRST_NAMES_M = ['Aarav','Arjun','Aditya','Akash','Ankit','Arnav','Ayush','Dhruv','Gaurav','Harsh','Karan','Manish','Mohit','Nikhil','Piyush','Rahul','Rajesh','Ravi','Rohit','Rohan','Sachin','Sahil','Sanjay','Shubham','Suresh','Tarun','Tushar','Varun','Vikas','Vivek'];
const FIRST_NAMES_F = ['Aanya','Aditi','Akanksha','Ananya','Anjali','Ankita','Anushka','Avni','Deepa','Divya','Ishaan','Ishita','Jyoti','Kavya','Khushi','Kiara','Komal','Kritika','Mansi','Meera','Neha','Nidhi','Nisha','Poonam','Pooja','Priya','Riya','Shreya','Simran','Sneha','Sona','Swati','Trisha'];
const LAST_NAMES = ['Agarwal','Banerjee','Bose','Chakraborty','Chaudhary','Chatterjee','Desai','Dey','Dubey','Ghosh','Gupta','Iyer','Jain','Joshi','Kapoor','Kaur','Khan','Khanna','Kumar','Malhotra','Mehta','Mishra','Mukherjee','Nair','Patel','Pillai','Rao','Reddy','Roy','Saxena','Shah','Sharma','Singh','Sinha','Srivastava','Tiwari','Verma','Yadav'];
const CITIES = ['Mumbai','Delhi','Bengaluru','Chennai','Hyderabad','Pune','Ahmedabad','Kolkata','Jaipur','Surat','Lucknow','Nagpur','Patna','Indore','Bhopal','Vadodara','Coimbatore','Visakhapatnam','Ludhiana','Agra','Nashik','Faridabad','Meerut','Rajkot','Varanasi','Thane','Aurangabad','Amritsar','Jodhpur','Ranchi','Guwahati','Chandigarh','Kochi','Thiruvananthapuram','Madurai','Noida','Ghaziabad','Dehradun','Udaipur','Mysuru'];
const STATES = ['MH','DL','KA','TN','TG','MH','GJ','WB','RJ','GJ','UP','MH','BR','MP','MP','GJ','TN','AP','PB','UP','MH','HR','UP','GJ','UP','MH','MH','PB','RJ','JH','AS','PB','KL','KL','TN','UP','UP','UK','RJ','KA'];
const DOMAINS = ['gmail.com','yahoo.com','outlook.com','hotmail.com','rediffmail.com','icloud.com'];

class CustomersSeed {
  constructor() {
    this.logger = new SeedLogger('Customers');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info('👥 Seeding Customers — 10,000 Indian shoppers');

    await conn.collection('users').deleteMany({ role: 'BUYER' });

    const passwordHash = await bcrypt.hash('Customer@123456', 10);
    const customerDocs = [];
    const now = new Date();

    for (let i = 0; i < 10000; i++) {
      const isMale = Math.random() < 0.55;
      const firstName = isMale ? rand(FIRST_NAMES_M) : rand(FIRST_NAMES_F);
      const lastName = rand(LAST_NAMES);
      const cityIndex = i % CITIES.length;
      const city = CITIES[cityIndex];
      const state = STATES[cityIndex];
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i + 1}@${rand(DOMAINS)}`;
      const phone = randPhone();
      const pin = String(randNum(110000, 799999));
      const tier = ['bronze','silver','gold','platinum'][Math.floor(i / 2500)];

      const addressCount = randNum(1, 3);
      const addresses = Array.from({ length: addressCount }, (_, ai) => ({
        _id: new mongoose.Types.ObjectId(),
        label: ai === 0 ? 'Home' : ai === 1 ? 'Work' : 'Other',
        firstName,
        lastName,
        phone,
        line1: `${randNum(1, 999)}, ${rand(['Sector','Block','Plot','House No'])} ${randNum(1, 50)}`,
        line2: rand(['Near Park','Opposite Mall','Main Road','','']),
        city,
        state,
        country: 'India',
        postalCode: pin,
        isDefault: ai === 0,
      }));

      customerDocs.push({
        _id: new mongoose.Types.ObjectId(),
        email,
        phone,
        passwordHash,
        role: 'BUYER',
        profile: {
          firstName,
          lastName,
          displayName: `${firstName} ${lastName}`,
          gender: isMale ? 'Male' : 'Female',
          dateOfBirth: new Date(randNum(1975, 2005), randNum(0, 11), randNum(1, 28)),
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${firstName}${lastName}`,
        },
        addresses,
        accountStatus: 'ACTIVE',
        emailVerified: Math.random() > 0.05,
        phoneVerified: Math.random() > 0.1,
        loyaltyTier: tier,
        loyaltyPoints: randNum(0, 10000),
        totalOrders: randNum(0, 50),
        totalSpent: randNum(0, 200000),
        referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
        preferences: {
          language: 'en',
          currency: 'INR',
          notifications: {
            email: Math.random() > 0.2,
            sms: Math.random() > 0.3,
            push: Math.random() > 0.25,
          },
        },
        sessionVersion: 1,
        createdAt: new Date(now.getTime() - randNum(1, 1460) * 86400000),
        updatedAt: new Date(),
      });
    }

    const BATCH = 500;
    for (let i = 0; i < customerDocs.length; i += BATCH) {
      await conn.collection('users').insertMany(customerDocs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, customerDocs.length - i));
    }

    this.logger.printStats();
    return { created: customerDocs.length };
  }
}

module.exports = CustomersSeed;
